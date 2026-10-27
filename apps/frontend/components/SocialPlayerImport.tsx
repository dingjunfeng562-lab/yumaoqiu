'use client';

import { useState } from 'react';
import { Alert, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';

// 社会人员批量导入：没有学号/学院班级，「单位」存为学校；每个项目单独导入。
//   单打：单位、姓名、性别、联系方式
//   双打：单位、姓名、性别、联系方式、队友姓名、队友性别、队友联系方式（队友单位同前）
// 男单/男双必须为男，女单/女双必须为女，混双一男一女且前后顺序不限。

export type SocialImportEvent = { id: string; type: string; label: string; isDouble: boolean };
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
  const columns = event.isDouble
    ? '单位、姓名、性别、联系方式、队友姓名、队友性别、队友联系方式'
    : '单位、姓名、性别、联系方式';
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
  const rows: Row[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    // Excel 粘贴按制表符分列（保留名字里的空格）；手输可用空格、逗号或顿号。
    const cells = (line.includes('\t') ? line.split('\t') : line.trim().split(/[\s、，,]+/)).map((cell) => cell.trim());
    while (cells.length > expected && !cells[cells.length - 1]) cells.pop();
    if (!rows.length && cells[0] === '单位' && cells[1] === '姓名') continue;
    const [school = '', name = '', genderRaw = '', contact = '', partnerName = '', partnerGenderRaw = '', partnerContact = ''] = cells;
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
    };
    if (cells.length !== expected) row.error = `需要 ${expected} 列，当前 ${cells.length} 列`;
    else if (!school || !name || !contact || (isDouble && (!partnerName || !partnerContact))) row.error = '单位、姓名、联系方式均必填';
    else if (!gender || (isDouble && !partnerGender)) row.error = '性别需填写男或女';
    else if (!PHONE.test(contact) || (isDouble && !PHONE.test(partnerContact))) row.error = '联系方式需为电话号码';
    else row.error = genderError(event?.type, gender, partnerGender);
    rows.push(row);
  }
  return rows;
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
  const rows = parseSocialRows(text, event);
  const errorCount = rows.filter((row) => row.error).length;

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
            ...(event.isDouble
              ? { partnerName: row.partnerName, partnerGender: row.partnerGender, partnerContact: row.partnerContact }
              : {}),
          })),
        }),
      });
      message.success(`已新增 ${result.createdCount} 条社会人员参赛记录`);
      close();
      await onImported();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '社会人员导入失败');
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
      title="社会人员批量导入"
      open={open}
      onCancel={close}
      onOk={save}
      okText={`新增 ${rows.length - errorCount} 条`}
      okButtonProps={{ disabled: !rows.length || errorCount > 0 }}
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
          scroll={{ x: 760, y: 260 }}
          columns={[
            { title: '行', dataIndex: 'lineNumber', width: 56 },
            { title: '单位', dataIndex: 'school', width: 160, render: (value: string) => value || '-' },
            { title: '姓名', key: 'name', render: (_: unknown, row: Row) => pair(row.name, row.partnerName) },
            { title: '性别', key: 'gender', width: 70, render: (_: unknown, row: Row) => pair(genderLabel(row.gender), genderLabel(row.partnerGender)) },
            { title: '联系方式', key: 'contact', render: (_: unknown, row: Row) => pair(row.contact, row.partnerContact) },
            {
              title: '状态',
              key: 'status',
              width: 200,
              render: (_: unknown, row: Row) => (row.error ? <Tag color="red">{row.error}</Tag> : <Tag color="green">可导入</Tag>),
            },
          ]}
        />
      </Space>
    </Modal>
  );
}
