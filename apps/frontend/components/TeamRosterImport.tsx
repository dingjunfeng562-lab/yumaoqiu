'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Spin, Table, Tag, Typography, Upload, message } from 'antd';
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { apiBlob, apiFetch, apiUpload } from '@/lib/api';
import {
  applyTeamRosterFieldRules,
  gridToTeamRosterText,
  parseTeamRoster,
  rowsToTeamRosterText,
  type TeamRosterFieldRules,
  type TeamRosterFieldState,
  type TeamRosterRow,
} from '@/lib/team-roster-import';
import { decodeCsvBytes, sheetToGrid } from '@/lib/xlsx-grid';

export type TeamImportCompetition = { id: string; name: string };

type AiMember = { name: string; gender?: 'MALE' | 'FEMALE'; contact?: string; confidence?: number };
type AiTeam = { name: string; affiliation?: string; members: AiMember[] };
type AiParseResult = { teams: AiTeam[]; warnings: string[]; model: string; elapsedMs: number };

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const RECOGNIZE_TIMEOUT_MS = 180_000;
const SPREADSHEET = /\.(xlsx?|csv)$/i;
const IMAGE_OR_PDF = /\.(jpe?g|png|webp|pdf)$/i;
const IMAGE_OR_PDF_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const FIELD_STATE_LABELS: Record<TeamRosterFieldState, string> = { required: '必填', optional: '选填', hidden: '不收集' };
/** 模型自评的识别把握低于这个值时标橙，提醒重点核对。 */
const LOW_CONFIDENCE = 0.8;

/** 识别把握按「团体名称 + 姓名」记；文本框里改了这两项的行就不再显示（已经人工改过）。 */
const confidenceKey = (teamName: string, name: string) => `${teamName.trim()}\u0000${name.trim()}`;

function errorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return '识别超时，请把 PDF 拆成几份、或裁剪图片后再试';
  }
  // 网关（nginx / CDN）先断开时返回的是网页，不是后端的 JSON 提示。
  const status = (error as { status?: number } | null)?.status;
  if (status === 502 || status === 504 || status === 524) {
    return '识别时间过长，连接被服务器网关断开；请把 PDF 拆成几份、或裁剪图片后再试';
  }
  return error instanceof Error ? error.message : '识别失败';
}

function teamsToRows(teams: AiTeam[]): TeamRosterRow[] {
  const rows: TeamRosterRow[] = [];
  for (const team of teams) {
    for (const member of team.members) {
      rows.push({
        lineNumber: rows.length + 1,
        teamName: team.name,
        name: member.name,
        gender: member.gender,
        affiliation: team.affiliation ?? '',
        contact: member.contact ?? '',
      });
    }
  }
  return rows;
}

async function readSpreadsheet(file: File) {
  const XLSX = await import('xlsx');
  const isCsv = /\.csv$/i.test(file.name);
  // CSV 自动识别 UTF-8 / GBK；raw 让单元格保持原文，18 位身份证号和 0 开头的电话不会被当成数字。
  const workbook = isCsv
    ? XLSX.read(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())), { type: 'string', raw: true })
    : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheetName || !sheet) throw new Error('Excel 里没有工作表');
  const { grid, merges } = sheetToGrid(sheet as unknown as Record<string, unknown>, XLSX);
  return gridToTeamRosterText(grid, merges);
}

export async function importTeamRoster(competition: TeamImportCompetition, text: string, token?: string) {
  const parsed = parseTeamRoster(text);
  if (!parsed.valid) throw new Error('请先修正导入预览中的行数据问题');
  return apiFetch<{ teamCount: number; playerCount: number; reusedCount?: number; drawCleared?: boolean }>(`/team-competitions/${competition.id}/teams/batch-import`, {
    method: 'POST', token, body: JSON.stringify({ players: parsed.rows.map(row => ({ teamName: row.teamName, name: row.name, gender: row.gender, affiliation: row.affiliation, contact: row.contact, identityNumber: row.identityNumber, lineNumber: row.lineNumber })) }),
  });
}

export function TeamRosterImportInput({ competition, text, onChange, token, onBusyChange, onValidChange }: {
  competition: TeamImportCompetition;
  text: string;
  onChange: (text: string) => void;
  token?: string;
  onBusyChange?: (busy: boolean) => void;
  /** 结合本组报名字段后的校验结果（如身份证号必填却没填），外层据此禁用导入按钮。 */
  onValidChange?: (valid: boolean) => void;
}) {
  const [fieldRules, setFieldRules] = useState<TeamRosterFieldRules | null>(null);
  const { rows, groups, valid } = applyTeamRosterFieldRules(parseTeamRoster(text), fieldRules);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [parsing, setParsing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summaries, setSummaries] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Map<string, number>>(() => new Map());
  const pending = useRef<File[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => { onBusyChange?.(parsing); }, [onBusyChange, parsing]);
  useEffect(() => { onValidChange?.(valid); }, [onValidChange, valid]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void apiFetch<TeamRosterFieldRules>(`/team-competitions/${competition.id}/roster-fields`, { token, cache: 'no-store', redirectOnForbidden: false })
      .then(result => { if (!cancelled) setFieldRules(result); })
      .catch(() => { if (!cancelled) setFieldRules(null); });
    return () => { cancelled = true; };
  }, [competition.id, token]);

  async function downloadTemplate() {
    if (!token) { message.error('登录已过期，请刷新页面后重试'); return; }
    setDownloading(true);
    try {
      const blob = await apiBlob(`/team-competitions/${competition.id}/roster-template`, { token, redirectOnForbidden: false });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fieldRules?.groupName ?? competition.name}团体赛队员导入模板.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板下载失败');
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void apiFetch<{ enabled: boolean }>('/team-competitions/ai-recognition/status', { token, cache: 'no-store', redirectOnForbidden: false })
      .then(result => { if (!cancelled) setAiEnabled(result.enabled); })
      .catch(() => { if (!cancelled) setAiEnabled(null); });
    return () => { cancelled = true; };
  }, [token]);

  function queueFiles(files: File[]) {
    const known = new Set(pending.current);
    for (const file of files) if (!known.has(file)) pending.current.push(file);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const batch = pending.current;
      pending.current = [];
      if (batch.length) void recognize(batch);
    }, 50);
  }

  async function recognize(files: File[]) {
    if (!token) { message.error('登录已过期，请刷新页面后重试'); return; }
    setParsing(true);
    setWarnings([]);
    setSummaries([]);
    setConfidence(new Map());
    const collected: TeamRosterRow[] = [];
    const scores = new Map<string, number>();
    const warnings: string[] = [];
    const summaries: string[] = [];
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`正在处理第 ${index + 1}/${files.length} 个文件：${file.name}`);
        if (file.size > MAX_FILE_SIZE) { failures.push(`${file.name}：超过 15MB`); continue; }
        try {
          if (SPREADSHEET.test(file.name)) {
            const sheetText = await readSpreadsheet(file);
            const parsed = parseTeamRoster(sheetText);
            if (!parsed.rows.length) throw new Error('没有读到队员数据');
            collected.push(...parsed.rows);
            const bad = parsed.rows.filter(row => row.error).length;
            summaries.push(`${file.name}：读取到 ${parsed.rows.length} 行${bad ? `，其中 ${bad} 行需要修正` : ''}`);
            if (bad) warnings.push(`${file.name}：有 ${bad} 行格式不正确，请在下方预览里修改`);
          } else if (IMAGE_OR_PDF.test(file.name) || IMAGE_OR_PDF_TYPES.includes(file.type)) {
            if (aiEnabled === false) throw new Error('报名表识别未开启，请联系超级管理员，或改用 Excel 导入');
            const form = new FormData();
            form.append('file', file);
            const result = await apiUpload<AiParseResult>(`/team-competitions/${competition.id}/teams/ai-parse`, form, {
              token,
              signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS),
            });
            collected.push(...teamsToRows(result.teams));
            for (const team of result.teams) {
              for (const member of team.members) {
                if (typeof member.confidence !== 'number') continue;
                const key = confidenceKey(team.name, member.name);
                scores.set(key, Math.min(scores.get(key) ?? 1, member.confidence));
              }
            }
            const people = result.teams.reduce((total, team) => total + team.members.length, 0);
            summaries.push(`${file.name}：识别到 ${result.teams.length} 个团体、${people} 人（${result.model}，${(result.elapsedMs / 1000).toFixed(1)} 秒）`);
            warnings.push(...result.warnings);
          } else {
            throw new Error('只支持 Excel、JPG/PNG/WebP 图片或 PDF');
          }
        } catch (error) {
          failures.push(`${file.name}：${errorMessage(error)}`);
        }
      }
      if (collected.length) {
        onChange(rowsToTeamRosterText(collected));
        setConfidence(scores);
        const low = [...scores.values()].filter(value => value < LOW_CONFIDENCE).length;
        if (low) summaries.push(`其中 ${low} 人识别把握较低（低于 ${Math.round(LOW_CONFIDENCE * 100)}%），已在下方标橙，请重点核对`);
        message.success(`已识别 ${collected.length} 名队员，请核对后导入`);
      } else if (!failures.length) {
        message.warning('没有识别到队员');
      }
      setSummaries(summaries);
      setWarnings([...new Set([...warnings, ...failures])].slice(0, 20));
    } finally {
      setParsing(false);
      setProgress('');
    }
  }

  const accept = aiEnabled === false ? '.xlsx,.xls,.csv' : '.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.pdf';
  const requiredFields = [
    '团体名称', '姓名',
    ...(fieldRules?.gender === 'required' ? ['性别'] : []),
    ...(fieldRules?.identityNumber === 'required' ? ['身份证号'] : []),
  ];
  const missingGender = rows.filter(row => !row.gender).length;

  return <Space orientation="vertical" size={12} style={{ width: '100%' }}>
    <Alert type="info" showIcon title="上传文件或粘贴名单"
      description={<>
        建议先下载本组模板填写：表头按本组报名字段生成，性别可下拉选择。也支持其他 Excel（.xlsx/.xls/.csv）、报名表照片（.jpg/.png/.webp）和 PDF；照片和 PDF 由 AI 识别，Excel 在本地解析。
        {aiEnabled ? '照片和 PDF 会发送给第三方 AI 服务识别（系统不保存原图，识别结果不直接入库）；不希望名单外传时请改用 Excel。' : ''}
        {`必填：${requiredFields.join('、')}，其余可以留空。`}同名团体自动归为一队；识别结果必须人工核对后再导入。
        {fieldRules ? <div style={{ marginTop: 4 }}>
          {`${fieldRules.groupName ? `「${fieldRules.groupName}」` : '本组'}报名字段：性别${FIELD_STATE_LABELS[fieldRules.gender]}、身份证号${FIELD_STATE_LABELS[fieldRules.identityNumber]}。`}
          {fieldRules.notCollected.length ? `${fieldRules.notCollected.join('、')}在团体赛导入中不收集。` : ''}
        </div> : null}
      </>}
      action={<Button size="small" icon={<DownloadOutlined />} loading={downloading} onClick={() => void downloadTemplate()}>下载本组模板</Button>} />

    <Upload.Dragger multiple accept={accept} showUploadList={false} disabled={parsing}
      beforeUpload={(_file, fileList) => { queueFiles(fileList as File[]); return false; }}>
      <p className="ant-upload-drag-icon"><InboxOutlined /></p>
      <p className="ant-upload-text">点击或把报名表拖到这里</p>
      <p className="ant-upload-hint">
        可多选。Excel 读取第一个工作表并立即解析；照片/PDF 逐张调用 AI 识别，通常需要 10–30 秒。
      </p>
    </Upload.Dragger>

    {parsing ? <Space><Spin size="small" /><Typography.Text type="secondary">{progress || '正在识别…'}</Typography.Text></Space> : null}

    {aiEnabled === false ? <Alert type="warning" showIcon title="报名表识别未开启"
      description="当前只能导入 Excel。需要照片/PDF 识别请联系超级管理员，在「AI 助手配置 → 报名表识别」中开启。" /> : null}

    {summaries.length ? <Alert type="success" showIcon title="识别完成"
      description={<ul style={{ margin: 0, paddingInlineStart: 18 }}>{summaries.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>} /> : null}

    {warnings.length ? <Alert type="warning" showIcon title="识别提示（请重点核对）"
      description={<ul style={{ margin: 0, paddingInlineStart: 18 }}>{warnings.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>} /> : null}

    <div>
      <Typography.Text strong>队员数据（识别结果可直接修改）</Typography.Text>
      <Typography.Text type="secondary" style={{ marginInlineStart: 8 }}>
        每行一名队员：团体名称、姓名、性别、单位、联系方式、身份证号，用 Tab 或逗号分隔
      </Typography.Text>
    </div>
    <Input.TextArea aria-label="团体队员数据" rows={8} value={text} onChange={event => onChange(event.target.value)}
      placeholder={'团体名称\t姓名\t性别\t单位\t联系方式\n飞羽队\t张三\t男\t第一学校\t13800000000\n飞羽队\t李四\t女\t第一学校\t13900000000'} />

    {text.trim() ? <Typography.Text type={valid ? 'secondary' : 'danger'}>
      已识别 {rows.length} 行、{groups.length} 个团体（同名团体合并为一队）。
    </Typography.Text> : null}

    {fieldRules?.gender === 'hidden' && rows.length ? <Alert type="warning" showIcon
      title="本组报名字段设为不收集性别：导入的队员都会是「待资格核验」，抽签前需要逐人完成核验。" />
      : fieldRules?.gender !== 'required' && missingGender ? <Alert type="info" showIcon
        title={`有 ${missingGender} 名队员未填性别，抽签前需要先完成资格核验。`} /> : null}

    {fieldRules?.identityNumber === 'hidden' && rows.some(row => row.identityNumber) ? <Alert type="warning" showIcon
      title="本组报名字段设为不收集身份证号，填写的身份证号导入时会被忽略。" /> : null}

    <Table size="small" rowKey="teamName" dataSource={groups} pagination={false} scroll={{ x: 560 }} columns={[
      { title: '团体名称', dataIndex: 'teamName' }, { title: '人数', render: (_, row) => `${row.count} 人（${row.male} 男 ${row.female} 女）` },
      { title: '来源行号', dataIndex: 'lines' }, { title: '检查', render: (_, row) => <Typography.Text type={row.error ? 'danger' : 'success'}>{row.error || '可导入'}</Typography.Text> },
    ]} />
    <Table size="small" rowKey="lineNumber" dataSource={rows} pagination={false} scroll={{ x: 700, y: 250 }} columns={[
      { title: '行号', dataIndex: 'lineNumber' }, { title: '团体名称', dataIndex: 'teamName' }, { title: '姓名', dataIndex: 'name' },
      { title: '性别', render: (_, row) => row.gender === 'MALE' ? '男' : row.gender === 'FEMALE' ? '女' : '-' },
      { title: '单位', dataIndex: 'affiliation' }, { title: '联系方式', dataIndex: 'contact' },
      ...(confidence.size ? [{ title: '识别把握', render: (_: unknown, row: TeamRosterRow) => {
        const value = confidence.get(confidenceKey(row.teamName, row.name));
        if (value === undefined) return '-';
        return <Tag color={value < LOW_CONFIDENCE ? 'orange' : 'green'}>{`${Math.round(value * 100)}%${value < LOW_CONFIDENCE ? ' 请核对' : ''}`}</Tag>;
      } }] : []),
      { title: '检查', render: (_, row) => <Typography.Text type={row.error ? 'danger' : 'success'}>{row.error || '格式正确'}</Typography.Text> },
    ]} />
  </Space>;
}

export default function TeamRosterImportModal({ competition, open, onClose, onImported, token }: {
  competition: TeamImportCompetition; open: boolean; onClose: () => void; onImported: () => Promise<void>; token?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [fieldsValid, setFieldsValid] = useState(true);
  const parsed = parseTeamRoster(text);
  async function save() {
    setBusy(true);
    try {
      const result = await importTeamRoster(competition, text, token);
      message.success(`已导入 ${result.teamCount} 个团体、${result.playerCount} 名队员${result.reusedCount ? `，其中 ${result.reusedCount} 人沿用选手库已有档案` : ''}${result.drawCleared ? '；原对阵尚未发布，已清空，请重新生成对阵' : ''}`);
      setText(''); onClose(); await onImported();
    } catch (error) { message.error(error instanceof Error ? error.message : '导入失败'); }
    finally { setBusy(false); }
  }
  return <Modal title="批量导入团体队员" open={open} width={960} onCancel={onClose} onOk={save} cancelText="取消" confirmLoading={busy}
    okText={`导入 ${parsed.groups.length} 个团体、${parsed.rows.length} 人`} okButtonProps={{ disabled: !parsed.valid || !fieldsValid || parsing }}>
    <TeamRosterImportInput competition={competition} text={text} onChange={setText} token={token} onBusyChange={setParsing} onValidChange={setFieldsValid} />
  </Modal>;
}
