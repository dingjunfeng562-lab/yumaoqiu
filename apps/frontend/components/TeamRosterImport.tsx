'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Input, Modal, Space, Table, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';
import type { AgeRule, GroupFields } from '@/lib/registration-groups';
import {
  checkTeamRows,
  fieldStateText,
  identityForSubmit,
  importFieldRules,
  lenientWarningNotice,
  maskIdentityNumber,
  parseTeamRosterText,
  type ImportFieldRules,
  type TeamRosterRow,
} from '@/lib/import-fields';
import { confirmImportWarnings } from '@/components/admin/confirmImportWarnings';

// 列表和详情接口都带 tournamentId / groupId / entrantType；没带时导入前再查一次详情。
export type TeamImportCompetition = { id: string; name: string; tournamentId?: string; groupId?: string | null; entrantType?: string };

export function parseTeamRoster(text: string) {
  return parseTeamRosterText(text);
}

type GroupSetting = { id: string; fieldRules?: Partial<GroupFields> | null; ageRule?: AgeRule | null };

const rulesCache = new Map<string, Promise<ImportFieldRules | null>>();

/**
 * 团体赛所属组别的报名字段和年龄要求，导入前按它检查。读不到时返回 null，此时不做这层检查，以服务端结果为准。
 * fresh：弹窗每次打开都重新读，组别设置可能刚改过。
 */
export function loadTeamImportRules(competition: TeamImportCompetition, token?: string, fresh = false): Promise<ImportFieldRules | null> {
  const cached = rulesCache.get(competition.id);
  if (cached && !fresh) return cached;
  const task = (async () => {
    let { tournamentId, groupId, entrantType } = competition;
    if (!tournamentId) {
      const detail = await apiFetch<{ tournamentId: string; groupId?: string | null; entrantType?: string }>(
        `/team-competitions/${competition.id}`, { token, redirectOnForbidden: false });
      ({ tournamentId, groupId, entrantType } = detail);
    }
    const school = entrantType === 'SCHOOL';
    if (!groupId) return importFieldRules(null, null, school);
    const groups = await apiFetch<GroupSetting[]>(`/admin/competitions/${tournamentId}/groups`, { token, redirectOnForbidden: false });
    const group = groups.find((item) => item.id === groupId);
    return group ? importFieldRules(group.fieldRules ?? {}, group.ageRule ?? null, school) : null;
  })().catch(() => null);
  rulesCache.set(competition.id, task);
  return task;
}

/**
 * 有标黄提醒（报名字段没填或有误、年龄不符）时先弹框确认，点了取消返回 null。
 * 后台批量导入不强制报名字段：标黄的照常导入，有误的身份证号不提交。
 */
export async function importTeamRoster(competition: TeamImportCompetition, text: string, token?: string) {
  const parsed = parseTeamRosterText(text);
  if (!parsed.valid) throw new Error('请先修正导入预览中的行数据问题');
  const rules = await loadTeamImportRules(competition, token);
  if (rules) {
    const checked = checkTeamRows(parsed.rows, rules);
    if (checked.errorCount) throw new Error(`有 ${checked.errorCount} 行需要修改，请按预览中「检查」列的提示修改后再导入`);
    if (!(await confirmImportWarnings(checked.warningCount, checked.warningLines))) return null;
  }
  return apiFetch<{ teamCount: number; playerCount: number; drawCleared?: boolean }>(`/team-competitions/${competition.id}/teams/batch-import`, {
    method: 'POST', token, body: JSON.stringify({ players: parsed.rows.map(row => ({
      teamName: row.teamName, name: row.name, gender: row.gender, affiliation: row.affiliation, contact: row.contact,
      identityNumber: rules ? identityForSubmit(row.identityNumber, rules) : row.identityNumber, lineNumber: row.lineNumber,
    })) }),
  });
}

/**
 * onBusyChange：正在读取本组报名设置（读完前不能导入）；
 * onValidChange：有没有必须修改的行（同一批里身份证号重复等）。报名字段没填或有误只标黄，不影响导入。
 */
export function TeamRosterImportInput({ competition, text, onChange, token, onBusyChange, onValidChange }: {
  competition: TeamImportCompetition;
  text: string;
  onChange: (text: string) => void;
  token?: string;
  onBusyChange?: (busy: boolean) => void;
  onValidChange?: (valid: boolean) => void;
}) {
  const { id, name, tournamentId, groupId, entrantType } = competition;
  const target = useMemo(() => ({ id, name, tournamentId, groupId, entrantType }), [id, name, tournamentId, groupId, entrantType]);
  const [loaded, setLoaded] = useState<{ id: string; rules: ImportFieldRules | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadTeamImportRules(target, token, true).then((rules) => { if (alive) setLoaded({ id: target.id, rules }); });
    return () => { alive = false; };
  }, [target, token]);
  const loading = loaded?.id !== id;
  const rules = !loading && loaded ? loaded.rules : null;
  const parsed = useMemo(() => parseTeamRosterText(text), [text]);
  const checked = useMemo(() => (rules ? checkTeamRows(parsed.rows, rules) : null), [parsed, rules]);
  const fieldsValid = !checked || checked.errorCount === 0;
  useEffect(() => { onBusyChange?.(loading); }, [onBusyChange, loading]);
  useEffect(() => { onValidChange?.(fieldsValid); }, [onValidChange, fieldsValid]);

  const rows: TeamRosterRow[] = checked?.rows ?? parsed.rows;
  const groups = checked?.groups ?? parsed.groups;
  const idState = rules?.fields.identityNumber;
  const problems = rows.filter((row) => row.error);
  const settingText = rules
    ? `${rules.grouped ? '本组' : '本赛事'}报名设置：性别${fieldStateText(rules.fields.gender)}，身份证号${fieldStateText(rules.fields.identityNumber)}。`
    : '';

  return <Space orientation="vertical" size={12} style={{ width: '100%' }}>
    <Alert type="info" showIcon title="团体名称、姓名、性别、单位、联系方式、身份证号"
      description={`每行一名队员，同名团体自动归为一队。可从 Excel 粘贴；第一行是表头（含「团体名称」和「姓名」）时按表头认列，列顺序随意，其余列忽略；没有表头时按上面的顺序，也可用逗号或顿号分隔。团体名称和姓名必填，单位和联系方式可留空。${settingText}每队人数不限，出场项目赛前另行填报。`} />
    {loading ? <Typography.Text type="secondary">正在读取本组报名设置…</Typography.Text> : null}
    {!loading && !rules ? <Alert type="warning" showIcon title="没能读取本组报名设置，导入前无法检查身份证号等必填项，以提交结果为准。" /> : null}
    {checked?.notice ? <Alert type="warning" showIcon title={checked.notice} /> : null}
    {checked?.warningCount ? <Alert type="warning" showIcon title={lenientWarningNotice(checked.warningCount)} /> : null}
    {problems.length ? <Alert type="error" showIcon title={`有 ${problems.length} 行需要修改后才能导入`}
      description={problems.slice(0, 5).map((row) => `第 ${row.lineNumber} 行 ${row.name || ''}：${row.error}`).join('；') + (problems.length > 5 ? `；另有 ${problems.length - 5} 行见下表` : '')} /> : null}
    <Input.TextArea aria-label="团体队员数据" rows={8} value={text} onChange={event => onChange(event.target.value)} placeholder={'团体名称\t姓名\t性别\t单位\t联系方式\t身份证号\n飞羽队\t张三\t男\t第一学校\t13800000000\n飞羽队\t李四\t女\t第一学校\t13900000000'} />
    <Table size="small" rowKey="teamName" dataSource={groups} pagination={false} scroll={{ x: 560 }} columns={[
      { title: '团体名称', dataIndex: 'teamName' }, { title: '人数', render: (_, row) => `${row.count} 人（${row.male} 男 ${row.female} 女）` },
      { title: '来源行号', dataIndex: 'lines' },
      { title: '检查', render: (_, row) => row.error ? <Typography.Text type="danger">{row.error}</Typography.Text>
        : row.warnings ? <Typography.Text type="warning">{`可导入（${row.warnings} 人标黄）`}</Typography.Text>
          : <Typography.Text type="success">可导入</Typography.Text> },
    ]} />
    <Table size="small" rowKey="lineNumber" dataSource={rows} pagination={false} scroll={{ x: 860, y: 250 }} columns={[
      { title: '行号', dataIndex: 'lineNumber', width: 64 }, { title: '团体名称', dataIndex: 'teamName' }, { title: '姓名', dataIndex: 'name' },
      { title: '性别', width: 64, render: (_, row) => row.gender === 'MALE' ? '男' : row.gender === 'FEMALE' ? '女' : '-' },
      { title: '单位', dataIndex: 'affiliation' }, { title: '联系方式', dataIndex: 'contact' },
      {
        title: idState ? `身份证号（${fieldStateText(idState)}）` : '身份证号', width: 190,
        render: (_, row) => !row.identityNumber ? '-'
          : idState === 'hidden' ? <Typography.Text type="secondary" delete title="本组不收集身份证号，导入时忽略">{maskIdentityNumber(row.identityNumber)}</Typography.Text>
            // 号码有误：划掉，导入时不保存。
            : rules && !identityForSubmit(row.identityNumber, rules) ? <Typography.Text type="secondary" delete title="身份证号有误，导入时不保存">{maskIdentityNumber(row.identityNumber)}</Typography.Text>
              : maskIdentityNumber(row.identityNumber),
      },
      { title: '检查', width: 240, render: (_, row) => row.error ? <Typography.Text type="danger">{row.error}</Typography.Text>
        : row.warning ? <Typography.Text type="warning">{`${row.warning}，照常导入`}</Typography.Text>
          : <Typography.Text type="success">格式正确</Typography.Text> },
    ]} />
  </Space>;
}

export default function TeamRosterImportModal({ competition, open, onClose, onImported, token }: {
  competition: TeamImportCompetition; open: boolean; onClose: () => void; onImported: () => Promise<void>; token?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingRules, setLoadingRules] = useState(true);
  const [fieldsValid, setFieldsValid] = useState(true);
  const parsed = parseTeamRosterText(text);
  async function save() {
    setBusy(true);
    try {
      const result = await importTeamRoster(competition, text, token);
      if (!result) return; // 标黄提醒确认框里点了取消
      message.success(`已导入 ${result.teamCount} 个团体、${result.playerCount} 名队员${result.drawCleared ? '；原对阵尚未发布，已清空，请重新生成对阵' : ''}`);
      setText(''); onClose(); await onImported();
    } catch (error) { message.error(error instanceof Error ? error.message : '导入失败'); }
    finally { setBusy(false); }
  }
  return <Modal title="批量导入团体队员" open={open} width={1000} onCancel={onClose} onOk={save} cancelText="取消" confirmLoading={busy}
    okText={`导入 ${parsed.groups.length} 个团体、${parsed.rows.length} 人`} okButtonProps={{ disabled: !parsed.valid || !fieldsValid || loadingRules }}>
    {open ? <TeamRosterImportInput competition={competition} text={text} onChange={setText} token={token} onBusyChange={setLoadingRules} onValidChange={setFieldsValid} /> : null}
  </Modal>;
}
