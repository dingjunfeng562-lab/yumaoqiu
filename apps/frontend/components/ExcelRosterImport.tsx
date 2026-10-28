'use client';

import { useState } from 'react';
import { Alert, Button, Modal, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { DownloadOutlined, FileExcelOutlined, InboxOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import {
  DEFAULT_ROSTER_FIELD_RULES,
  entrantTypeLabel,
  parseRosterSheet,
  rosterImportGroups,
  rosterPeopleCount,
  type RosterEntry,
  type RosterEventOption,
  type RosterFieldRules,
  type RosterGrid,
  type RosterMerge,
} from '@/lib/excel-roster';

type ExistingPlayer = {
  eventId?: string;
  name: string;
  primaryName?: string;
  phone: string;
  studentId?: string;
  partner?: { name: string; phone?: string; studentId?: string } | null;
};

type ParseResult = {
  fileName: string;
  sheets: string[];
  headerRow: number;
  entries: RosterEntry[];
  messages: string[];
};

const SCHOOL_TEMPLATE_URL = '/templates/yudongyun-roster-import-school.xls';
const SOCIAL_TEMPLATE_URL = '/templates/yudongyun-roster-import-social.xls';
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const BATCH_LIMIT = 500;

function genderLabel(value?: string | null) {
  return value === 'MALE' ? '男' : value === 'FEMALE' ? '女' : '-';
}

function contactKey(value?: string) {
  return (value ?? '').replace(/\s+/g, '');
}

function entryKey(eventId: string, name: string, phone: string) {
  return `${eventId}\u0000${name}\u0000${contactKey(phone)}`;
}

function studentKey(eventId: string, studentId: string) {
  return `${eventId}\u0000SID\u0000${studentId}`;
}

function markExistingEntries(entries: RosterEntry[], players: ExistingPlayer[]) {
  const existing = new Set<string>();
  const existingStudents = new Set<string>();
  for (const player of players) {
    if (!player.eventId) continue;
    const primaryName = player.primaryName ?? player.name;
    if (primaryName && player.phone) existing.add(entryKey(player.eventId, primaryName, player.phone));
    if (player.studentId) existingStudents.add(studentKey(player.eventId, player.studentId));
    if (player.partner?.name && player.partner.phone) {
      existing.add(entryKey(player.eventId, player.partner.name, player.partner.phone));
    }
    if (player.partner?.studentId) {
      existingStudents.add(studentKey(player.eventId, player.partner.studentId));
    }
  }
  if (!existing.size && !existingStudents.size) return;
  for (const entry of entries) {
    if (!entry.eventId) continue;
    for (const person of entry.people) {
      const byStudent = person.studentId
        ? existingStudents.has(studentKey(entry.eventId, person.studentId))
        : false;
      const byContact = person.name && person.contact
        ? existing.has(entryKey(entry.eventId, person.name, person.contact))
        : false;
      if (!byStudent && !byContact) continue;
      const text = `已在该项目报名：${person.name}（${person.studentId || person.contact}）`;
      if (!entry.errors.includes(text)) entry.errors.push(text);
    }
  }
}

function sheetToGrid(sheet: Record<string, unknown>, XLSX: typeof import('xlsx')) {
  const ref = typeof sheet['!ref'] === 'string' ? sheet['!ref'] : 'A1';
  const range = XLSX.utils.decode_range(ref);
  const grid: RosterGrid = [];
  for (let r = 0; r <= range.e.r; r += 1) {
    const row: RosterGrid[number] = [];
    for (let c = 0; c <= range.e.c; c += 1) {
      const cell = (sheet as Record<string, { v?: unknown } | undefined>)[XLSX.utils.encode_cell({ r, c })];
      row.push(cell?.v as RosterGrid[number][number]);
    }
    grid.push(row);
  }
  const merges = (Array.isArray(sheet['!merges']) ? sheet['!merges'] : []) as RosterMerge[];
  return { grid, merges };
}

const stack = (values: string[]) => (
  <Space orientation="vertical" size={0}>
    {values.map((value, index) => (
      <Typography.Text key={`${value}-${index}`} type={index === 0 ? undefined : 'secondary'}>
        {value || '-'}
      </Typography.Text>
    ))}
  </Space>
);

export default function ExcelRosterImportModal({
  competitionId,
  events,
  existingPlayers = [],
  fieldRules = DEFAULT_ROSTER_FIELD_RULES,
  maxEventsPerPerson = 2,
  allowCrossEvent = true,
  open,
  token,
  onClose,
  onImported,
}: {
  competitionId: string;
  events: RosterEventOption[];
  existingPlayers?: ExistingPlayer[];
  fieldRules?: RosterFieldRules;
  maxEventsPerPerson?: number;
  allowCrossEvent?: boolean;
  open: boolean;
  token?: string;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const [result, setResult] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  function reset() {
    setResult(null);
    setParsing(false);
    setImporting(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function fetchExistingPlayers(): Promise<ExistingPlayer[]> {
    if (!token) return existingPlayers;
    try {
      const data = await apiFetch<ExistingPlayer[]>(`/admin/competitions/${competitionId}/players`, {
        token,
        redirectOnForbidden: false,
      });
      return Array.isArray(data) ? data : existingPlayers;
    } catch {
      return existingPlayers;
    }
  }

  async function parseFile(file: File) {
    if (!/\.(xls|xlsx)$/i.test(file.name)) {
      message.error('只支持 .xls / .xlsx 文件');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      message.error('文件超过 5MB，请拆分后再导入');
      return;
    }
    setParsing(true);
    setResult(null);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      const entries: RosterEntry[] = [];
      const sheets: string[] = [];
      const problems: string[] = [];
      let headerRow: number | null = null;

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName] as unknown as Record<string, unknown> | undefined;
        if (!sheet || typeof sheet['!ref'] !== 'string') continue;
        const { grid, merges } = sheetToGrid(sheet, XLSX);
        const parsed = parseRosterSheet({
          sheet: sheetName,
          grid,
          merges,
          events,
          fieldRules,
          maxEventsPerPerson,
          allowCrossEvent,
        });
        if (parsed.headerRow === null) {
          problems.push(`${sheetName}：${parsed.messages[0] ?? '没有找到表头'}`);
          continue;
        }
        if (parsed.messages.length) {
          problems.push(...parsed.messages.map((text) => `${sheetName}：${text}`));
        }
        headerRow = headerRow ?? parsed.headerRow;
        sheets.push(parsed.kind ? `${sheetName}（${entrantTypeLabel(parsed.kind)}）` : sheetName);
        entries.push(...parsed.entries);
      }

      if (headerRow === null) {
        setResult(null);
        message.error(problems[0] ?? '没有找到可识别的表头，请使用官方模板');
        return;
      }
      markExistingEntries(entries, await fetchExistingPlayers());
      if (!entries.length) {
        setResult({ fileName: file.name, sheets, headerRow, entries: [], messages: problems });
        message.warning('文件里只有标题、说明或示例数据，没有可导入的选手');
        return;
      }
      setResult({ fileName: file.name, sheets, headerRow, entries, messages: problems });
    } catch (error) {
      setResult(null);
      message.error(error instanceof Error ? `文件解析失败：${error.message}` : '文件解析失败，请确认文件没有损坏');
    } finally {
      setParsing(false);
    }
  }

  const entries = result?.entries ?? [];
  const errorEntries = entries.filter((entry) => entry.errors.length);
  const importableEntries = entries.filter((entry) => !entry.errors.length);
  const peopleCount = rosterPeopleCount(entries);
  const importablePeople = rosterPeopleCount(importableEntries);
  const singles = entries.filter((entry) => entry.kind === 'SINGLE').length;
  const doubles = entries.filter((entry) => entry.kind === 'DOUBLE').length;
  const projectSummary = (() => {
    const map = new Map<string, { singles: number; doubles: number; errors: number }>();
    for (const entry of entries) {
      const label = entry.eventLabel ?? (entry.project || '未识别项目');
      const item = map.get(label) ?? { singles: 0, doubles: 0, errors: 0 };
      if (entry.kind === 'DOUBLE') item.doubles += 1;
      else item.singles += 1;
      if (entry.errors.length) item.errors += 1;
      map.set(label, item);
    }
    return [...map];
  })();

  async function submit() {
    if (!token) return;
    const groups = rosterImportGroups(entries);
    if (!groups.length) return;
    setImporting(true);
    let created = 0;
    const failures: string[] = [];
    for (const group of groups) {
      const label = events.find((event) => event.id === group.eventId)?.label ?? '项目';
      for (let index = 0; index < group.players.length; index += BATCH_LIMIT) {
        const chunk = group.players.slice(index, index + BATCH_LIMIT);
        try {
          const response = await apiFetch<{ createdCount: number }>(`/admin/competitions/${competitionId}/players/batch`, {
            method: 'POST',
            token,
            body: JSON.stringify({
              eventId: group.eventId,
              entrantType: group.entrantType,
              players: chunk,
            }),
          });
          created += response.createdCount;
        } catch (error) {
          failures.push(`${label}：${error instanceof Error ? error.message : '导入失败'}`);
        }
      }
    }
    setImporting(false);
    if (created) message.success(`已导入 ${created} 条参赛记录${errorEntries.length ? `，跳过 ${errorEntries.length} 条待修正记录` : ''}`);
    if (failures.length) {
      message.error(`部分名单未导入：${[...new Set(failures)].join('；')}`);
      if (!created) return;
      // 已有成功写入的记录，刷新列表并关闭，避免再次提交造成重复报名。
      close();
      await onImported();
      return;
    }
    close();
    await onImported();
  }

  const fieldRuleText = `本赛事学生组：学号${fieldRules.SCHOOL.studentId === 'required' ? '必填' : fieldRules.SCHOOL.studentId === 'optional' ? '选填' : '不收集'}、学院${fieldRules.SCHOOL.college === 'required' ? '必填' : fieldRules.SCHOOL.college === 'optional' ? '选填' : '不收集'}、年级专业${fieldRules.SCHOOL.majorGrade === 'required' ? '必填' : fieldRules.SCHOOL.majorGrade === 'optional' ? '选填' : '不收集'}`;

  return (
    <Modal
      title={
        <Space size={8}>
          <FileExcelOutlined />
          <span>Excel 批量导入参赛选手</span>
        </Space>
      }
      open={open}
      width={1180}
      onCancel={close}
      onOk={submit}
      okText={
        importablePeople
          ? `导入 ${importablePeople} 人${errorEntries.length ? `（跳过 ${errorEntries.length} 条）` : ''}`
          : '导入'
      }
      cancelText="取消"
      confirmLoading={importing}
      okButtonProps={{ disabled: !importablePeople }}
      destroyOnHidden
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          title="上传学生模板或社会模板均可，系统会按表头自动识别组别、项目列和双打配对"
          description={`支持 .xls / .xlsx。学生模板 9 列（含学号/学院/年级专业），社会模板 6 列；示例行会自动跳过；双打把两人的「单位」单元格合并表示一对。${fieldRuleText}。`}
          action={
            <Space>
              <Button size="small" icon={<DownloadOutlined />} href={SCHOOL_TEMPLATE_URL} download="羽动云赛报名批量导入学生模板.xls">
                学生模板
              </Button>
              <Button size="small" icon={<DownloadOutlined />} href={SOCIAL_TEMPLATE_URL} download="羽动云赛报名批量导入社会模板.xls">
                社会模板
              </Button>
            </Space>
          }
        />
        <Upload.Dragger
          accept=".xls,.xlsx"
          maxCount={1}
          showUploadList={false}
          disabled={parsing || importing}
          beforeUpload={(file) => {
            void parseFile(file as File);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{parsing ? '正在解析文件…' : '点击或把 Excel 文件拖到这里'}</p>
          <p className="ant-upload-hint">.xls / .xlsx，不超过 5MB；可一次导入多个项目</p>
        </Upload.Dragger>

        {result ? (
          <Alert
            type={!entries.length ? 'warning' : errorEntries.length ? 'error' : 'success'}
            showIcon
            title={
              entries.length
                ? `已识别 ${peopleCount} 人：单打 ${singles} 人、双打 ${doubles} 对，共 ${entries.length} 条记录`
                : '没有可导入的数据'
            }
            description={
              <Space orientation="vertical" size={2}>
                <span>
                  文件：{result.fileName}；工作表：{result.sheets.join('、') || '-'}；表头：第 {result.headerRow} 行（列顺序已自动识别）
                </span>
                <span>
                  {errorEntries.length
                    ? `其中 ${errorEntries.length} 条需要修正后才能导入。`
                    : '全部检查通过，可以导入。'}
                </span>
                {result.messages.map((text) => (
                  <Typography.Text key={text} type="warning">
                    {text}
                  </Typography.Text>
                ))}
              </Space>
            }
          />
        ) : null}

        {entries.length ? (
          <Space wrap size={8}>
            <Typography.Text type="secondary">名单分布：</Typography.Text>
            {projectSummary.map(([label, item]) => (
              <Tag key={label} color={item.errors ? 'red' : 'blue'}>
                {label}
                {item.singles ? ` ${item.singles} 人` : ''}
                {item.doubles ? ` ${item.doubles} 对` : ''}
                {item.errors ? `（${item.errors} 条待修正）` : ''}
              </Tag>
            ))}
          </Space>
        ) : null}

        {entries.length ? (
          <Table<RosterEntry>
            size="small"
            rowKey="key"
            dataSource={entries}
            pagination={false}
            scroll={{ x: 1360, y: 340 }}
            columns={[
              { title: '行', key: 'rows', width: 74, render: (_, entry) => entry.rows.join('、') },
              {
                title: '组别',
                key: 'entrantType',
                width: 84,
                render: (_, entry) => (
                  <Tag color={entry.entrantType === 'SOCIAL' ? 'orange' : 'blue'}>
                    {entrantTypeLabel(entry.entrantType)}
                  </Tag>
                ),
              },
              {
                title: '项目',
                key: 'project',
                width: 200,
                render: (_, entry) => (
                  <Space size={4}>
                    <Tag color={entry.eventId ? (entry.kind === 'DOUBLE' ? 'purple' : 'blue') : 'default'}>
                      {entry.eventId ? (entry.kind === 'DOUBLE' ? '双打' : '单打') : '未识别'}
                    </Tag>
                    <span>{entry.eventLabel ?? (entry.project || '-')}</span>
                  </Space>
                ),
              },
              { title: '单位', dataIndex: 'unit', width: 170, render: (value: string) => value || '-' },
              {
                title: '姓名',
                key: 'name',
                width: 150,
                render: (_, entry) => stack(entry.people.map((person) => person.name)),
              },
              {
                title: '性别',
                key: 'gender',
                width: 76,
                render: (_, entry) => stack(entry.people.map((person) => genderLabel(person.gender))),
              },
              {
                title: '学号',
                key: 'studentId',
                width: 130,
                render: (_, entry) => stack(entry.people.map((person) => person.studentId ?? '')),
              },
              {
                title: '学院',
                key: 'college',
                width: 150,
                render: (_, entry) => stack(entry.people.map((person) => person.college ?? '')),
              },
              {
                title: '年级专业',
                key: 'majorGrade',
                width: 150,
                render: (_, entry) => stack(entry.people.map((person) => person.majorGrade ?? '')),
              },
              {
                title: '联系方式',
                key: 'contact',
                width: 190,
                render: (_, entry) => stack(entry.people.map((person) => person.contact)),
              },
              {
                title: '状态',
                key: 'status',
                width: 260,
                render: (_, entry) =>
                  entry.errors.length ? (
                    <Space orientation="vertical" size={0}>
                      {entry.errors.map((text) => (
                        <Typography.Text key={text} type="danger" style={{ fontSize: 12 }}>
                          {text}
                        </Typography.Text>
                      ))}
                    </Space>
                  ) : (
                    <Tag color="green">可导入</Tag>
                  ),
              },
            ]}
          />
        ) : null}
      </Space>
    </Modal>
  );
}
