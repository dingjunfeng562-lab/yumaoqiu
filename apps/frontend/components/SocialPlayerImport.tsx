'use client';

import { useMemo, useState } from 'react';
import { Alert, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';
import type { AgeRule, GroupFields } from '@/lib/registration-groups';
import {
  duplicateIdentities,
  fieldStateText,
  identityForSubmit,
  identityImportError,
  ignoredFieldsNotice,
  importFieldRules,
  maskIdentityNumber,
  normalizeIdentityNumber,
  type ImportFieldRules,
} from '@/lib/import-fields';

// 第三方人员批量导入：没有学号/学院班级，「单位」存为学校；每个项目单独导入。
//   单打：单位、姓名、性别、联系方式
//   双打：单位、姓名、性别、联系方式、队友姓名、队友性别、队友联系方式（队友单位同前）
//   行末可再加身份证号（单打 1 列；双打本人、队友各 1 列），按项目所属组别的「报名字段」检查，组别不收集时忽略。
// 男单/男双必须为男，女单/女双必须为女，混双一男一女且前后顺序不限。

export type SocialImportEvent = {
  id: string;
  type: string;
  label: string;
  isDouble: boolean;
  entrantType?: string;
  groupFields?: GroupFields | null;
  ageRule?: AgeRule | null;
};

export function socialImportRules(event?: SocialImportEvent): ImportFieldRules {
  return importFieldRules(event?.groupFields, event?.ageRule, event?.entrantType === 'SCHOOL');
}
type Gender = 'MALE' | 'FEMALE';
type Row = {
  key: string;
  lineNumber: number;
  school: string;
  name: string;
  gender?: Gender;
  contact: string;
  partnerName?: string;
  partnerGender?: Gender;
  partnerContact?: string;
  identityNumber?: string;
  partnerIdentityNumber?: string;
  error?: string;
};

const PHONE = /^\+?[\d-]{6,20}$/;

function toGender(value: string): Gender | undefined {
  const normalized = value.trim().toUpperCase();
  if (['男', 'MALE', 'M'].includes(normalized)) return 'MALE';
  if (['女', 'FEMALE', 'F'].includes(normalized)) return 'FEMALE';
  return undefined;
}

const genderLabel = (value?: Gender) => (value === 'MALE' ? '男' : value === 'FEMALE' ? '女' : '-');

function genderError(eventType: string | undefined, gender: Gender, partnerGender?: Gender) {
  if (eventType === 'MENS_SINGLES' && gender !== 'MALE') return '男子单打性别必须为男';
  if (eventType === 'WOMENS_SINGLES' && gender !== 'FEMALE') return '女子单打性别必须为女';
  if (eventType === 'MENS_DOUBLES' && (gender !== 'MALE' || partnerGender !== 'MALE')) return '男子双打两人性别必须均为男';
  if (eventType === 'WOMENS_DOUBLES' && (gender !== 'FEMALE' || partnerGender !== 'FEMALE')) return '女子双打两人性别必须均为女';
  if (eventType === 'MIXED_DOUBLES' && gender === partnerGender) return '混合双打必须一男一女';
  return undefined;
}

export function socialFormatText(event?: SocialImportEvent) {
  if (!event) return '请先选择参赛项目';
  const idState = socialImportRules(event).fields.identityNumber;
  const columns = (event.isDouble
    ? '单位、姓名、性别、联系方式、队友姓名、队友性别、队友联系方式'
    : '单位、姓名、性别、联系方式')
    + (idState === 'hidden' ? '' : `，行末再加${event.isDouble ? '本人身份证号、队友身份证号' : '身份证号'}（本组${fieldStateText(idState)}）`);
  const rule: Record<string, string> = {
    MENS_SINGLES: '性别须为男',
    WOMENS_SINGLES: '性别须为女',
    MENS_DOUBLES: '两人性别均须为男',
    WOMENS_DOUBLES: '两人性别均须为女',
    MIXED_DOUBLES: '须一男一女，谁填前面都可以',
  };
  return `${event.label}：${columns}（${rule[event.type] ?? ''}）`;
}

export function parseSocialRows(text: string, event?: SocialImportEvent): Row[] {
  const isDouble = Boolean(event?.isDouble);
  const expected = isDouble ? 7 : 4;
  // 行末的身份证号列：单打 1 列，双打 2 列（只填本人的也行）。
  const maxColumns = expected + (isDouble ? 2 : 1);
  const rules = socialImportRules(event);
  const rows: Row[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    // Excel 粘贴按制表符分列（保留名字里的空格）；手输可用空格、逗号或顿号。
    const cells = (line.includes('\t') ? line.split('\t') : line.trim().split(/[\s、，,]+/)).map((cell) => cell.trim());
    while (cells.length > expected && !cells[cells.length - 1]) cells.pop();
    if (!rows.length && cells[0] === '单位' && cells[1] === '姓名') continue;
    const [school = '', name = '', genderRaw = '', contact = '', partnerName = '', partnerGenderRaw = '', partnerContact = ''] = cells;
    const identityNumber = normalizeIdentityNumber(cells[expected]) || undefined;
    const partnerIdentityNumber = isDouble ? normalizeIdentityNumber(cells[expected + 1]) || undefined : undefined;
    const gender = toGender(genderRaw);
    const partnerGender = isDouble ? toGender(partnerGenderRaw) : undefined;
    const row: Row = {
      key: `${index + 1}-${line}`,
      lineNumber: index + 1,
      school,
      name,
      gender,
      contact,
      ...(isDouble ? { partnerName, partnerGender, partnerContact } : {}),
      identityNumber,
      partnerIdentityNumber,
    };
    if (cells.length < expected || cells.length > maxColumns) {
      row.error = `需要 ${expected} 列${rules.fields.identityNumber === 'hidden' ? '' : `（行末可再加${isDouble ? '本人、队友' : ''}身份证号）`}，当前 ${cells.length} 列`;
    } else if (!school || !name || !contact || (isDouble && (!partnerName || !partnerContact))) row.error = '单位、姓名、联系方式均必填';
    else if (!gender || (isDouble && !partnerGender)) row.error = '性别需填写男或女';
    else if (!PHONE.test(contact) || (isDouble && !PHONE.test(partnerContact))) row.error = '联系方式需为电话号码';
    else row.error = genderError(event?.type, gender, partnerGender)
      ?? identityImportError(identityNumber, rules)
      ?? (isDouble ? identityImportError(partnerIdentityNumber, rules, '队友') : undefined)
      ?? (isDouble && identityNumber && identityNumber === partnerIdentityNumber && rules.fields.identityNumber !== 'hidden'
        ? '本人和队友不能使用同一身份证号' : undefined);
    rows.push(row);
  }
  // 同一个项目里一个人只能出现一次：身份证号重复的行标出来。
  if (rules.fields.identityNumber !== 'hidden') {
    const duplicates = duplicateIdentities(rows.flatMap((row) => (row.error ? [] : [
      { key: `${row.lineNumber}`, identityNumber: row.identityNumber },
      { key: `${row.lineNumber}-partner`, identityNumber: row.partnerIdentityNumber },
    ])));
    for (const row of rows) {
      const first = duplicates.get(`${row.lineNumber}`) ?? duplicates.get(`${row.lineNumber}-partner`);
      if (!row.error && first) row.error = `身份证号与第 ${first.split('-')[0]} 行重复`;
    }
  }
  return rows;
}

/** 组别不收集却填了的列（身份证号、性别）：不拦，提示导入时忽略。 */
export function socialIgnoredNotice(rows: Row[], event?: SocialImportEvent): string | undefined {
  const rules = socialImportRules(event);
  const rowsWith = (has: (row: Row) => unknown) => rows.filter((row) => !row.error && has(row)).map((row) => row.lineNumber);
  return ignoredFieldsNotice([
    { label: '身份证号', rows: rules.fields.identityNumber === 'hidden' ? rowsWith((row) => row.identityNumber || row.partnerIdentityNumber) : [] },
    { label: '性别', rows: rules.grouped && rules.fields.gender === 'hidden' ? rowsWith((row) => row.gender || row.partnerGender) : [] },
  ], rules.grouped);
}

export default function SocialPlayerImportModal({
  competitionId,
  events,
  defaultEventId,
  open,
  token,
  onClose,
  onImported,
}: {
  competitionId: string;
  events: SocialImportEvent[];
  defaultEventId?: string;
  open: boolean;
  token?: string;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [eventId, setEventId] = useState<string>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const activeEventId = eventId ?? defaultEventId ?? events[0]?.id;
  const event = events.find((item) => item.id === activeEventId);
  const rows = useMemo(() => parseSocialRows(text, event), [text, event]);
  const errorCount = rows.filter((row) => row.error).length;
  const rules = socialImportRules(event);
  const ignoredNotice = socialIgnoredNotice(rows, event);
  const showIdentity = rules.fields.identityNumber !== 'hidden' || rows.some((row) => row.identityNumber || row.partnerIdentityNumber);

  function close() {
    setText('');
    setEventId(undefined);
    onClose();
  }

  async function save() {
    if (!event) return message.warning('请选择参赛项目');
    if (!rows.length) return message.warning('请先粘贴选手数据');
    const firstError = rows.find((row) => row.error);
    if (firstError) return message.error(`第 ${firstError.lineNumber} 行：${firstError.error}`);
    setBusy(true);
    try {
      const result = await apiFetch<{ createdCount: number }>(`/admin/competitions/${competitionId}/players/batch`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          eventId: event.id,
          players: rows.map((row) => ({
            social: true,
            school: row.school,
            name: row.name,
            gender: row.gender,
            contact: row.contact,
            identityNumber: identityForSubmit(row.identityNumber, rules),
            ...(event.isDouble
              ? {
                  partnerName: row.partnerName,
                  partnerGender: row.partnerGender,
                  partnerContact: row.partnerContact,
                  partnerIdentityNumber: identityForSubmit(row.partnerIdentityNumber, rules),
                }
              : {}),
          })),
        }),
      });
      message.success(`已新增 ${result.createdCount} 条第三方人员参赛记录`);
      close();
      await onImported();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '第三方人员导入失败');
    } finally {
      setBusy(false);
    }
  }

  const double = Boolean(event?.isDouble);
  const pair = (first: React.ReactNode, second: React.ReactNode) => (
    <Space direction="vertical" size={0}>
      <Typography.Text>{first || '-'}</Typography.Text>
      {double ? <Typography.Text type="secondary">{second || '-'}</Typography.Text> : null}
    </Space>
  );

  return (
    <Modal
      title="第三方人员批量导入"
      open={open}
      onCancel={close}
      onOk={save}
      okText={`新增 ${rows.length - errorCount} 条`}
      okButtonProps={{ disabled: !rows.length || errorCount > 0 }}
      cancelText="取消"
      confirmLoading={busy}
      width={960}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Select
          value={activeEventId}
          onChange={(value) => {
            setEventId(value);
            setText('');
          }}
          options={events.map((item) => ({ value: item.id, label: item.label }))}
          placeholder="选择参赛项目"
          style={{ width: '100%', maxWidth: 480 }}
        />
        <Alert
          type={errorCount ? 'error' : 'info'}
          showIcon
          message={socialFormatText(event)}
          description="每个项目单独导入（男单、女单、男双、女双、混双分开）。每行一条，可从 Excel 直接粘贴（可带表头），也可用空格、逗号或顿号分隔。双打队友单位与第一列相同。"
        />
        {ignoredNotice ? <Alert type="warning" showIcon title={ignoredNotice} /> : null}
        <Input.TextArea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            double
              ? event?.type === 'MIXED_DOUBLES'
                ? '例如：飞羽俱乐部、张三、男、13800000000、李四、女、13900000000'
                : `例如：飞羽俱乐部、张三、${event?.type === 'WOMENS_DOUBLES' ? '女' : '男'}、13800000000、李四、${event?.type === 'WOMENS_DOUBLES' ? '女' : '男'}、13900000000`
              : `例如：飞羽俱乐部、张三、${event?.type === 'WOMENS_SINGLES' ? '女' : '男'}、13800000000`
          }
        />
        <Table
          size="small"
          rowKey="key"
          dataSource={rows}
          pagination={false}
          scroll={{ x: showIdentity ? 940 : 760, y: 260 }}
          columns={[
            { title: '行', dataIndex: 'lineNumber', width: 56 },
            { title: '单位', dataIndex: 'school', width: 160, render: (value: string) => value || '-' },
            { title: '姓名', key: 'name', render: (_: unknown, row: Row) => pair(row.name, row.partnerName) },
            { title: '性别', key: 'gender', width: 70, render: (_: unknown, row: Row) => pair(genderLabel(row.gender), genderLabel(row.partnerGender)) },
            { title: '联系方式', key: 'contact', render: (_: unknown, row: Row) => pair(row.contact, row.partnerContact) },
            ...(showIdentity
              ? [{
                  title: `身份证号（${fieldStateText(rules.fields.identityNumber)}）`,
                  key: 'identityNumber',
                  width: 180,
                  render: (_: unknown, row: Row) => {
                    // 不收集时划掉并变灰：导入时忽略。
                    const ignored = rules.fields.identityNumber === 'hidden';
                    const show = (value?: string) => (value
                      ? <Typography.Text type={ignored ? 'secondary' : undefined} delete={ignored}>{maskIdentityNumber(value)}</Typography.Text>
                      : '-');
                    return pair(show(row.identityNumber), show(row.partnerIdentityNumber));
                  },
                }]
              : []),
            {
              title: '状态',
              key: 'status',
              width: 220,
              render: (_: unknown, row: Row) => (row.error ? <Tag color="red" style={{ whiteSpace: 'normal' }}>{row.error}</Tag> : <Tag color="green">可导入</Tag>),
            },
          ]}
        />
      </Space>
    </Modal>
  );
}
