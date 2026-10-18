'use client';

import { useState } from 'react';
import { Alert, Input, Modal, Space, Table, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';

export type TeamImportCompetition = { id: string; name: string };
type Row = { lineNumber: number; teamName: string; name: string; gender?: 'MALE' | 'FEMALE'; affiliation: string; contact: string; error?: string };

export function parseTeamRoster(text: string) {
  const rows: Row[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    // Keep empty cells and spaces inside names/units when pasted from a spreadsheet.
    const cells = line.includes('\t') ? line.split('\t') : line.split(/[,，、]/);
    const [teamName = '', name = '', genderText = '', affiliation = '', contact = ''] = cells.map(cell => cell.trim());
    if (!rows.length && ['团体名称', '队伍名称'].includes(teamName) && name === '姓名' && genderText === '性别') continue;
    const normalized = genderText.toUpperCase();
    const gender = ['男', 'MALE', 'M'].includes(normalized) ? 'MALE' : ['女', 'FEMALE', 'F'].includes(normalized) ? 'FEMALE' : undefined;
    const error = cells.length < 3 || cells.length > 5 ? '应为 3 至 5 列：团体名称、姓名、性别、单位、联系方式'
      : !teamName || !name ? '团体名称和姓名必填' : !gender ? '性别请填写男或女' : undefined;
    rows.push({ lineNumber: index + 1, teamName, name, gender, affiliation, contact, error });
  }
  const grouped = new Map<string, Row[]>();
  rows.forEach(row => grouped.set(row.teamName, [...(grouped.get(row.teamName) ?? []), row]));
  const groups = [...grouped].map(([teamName, members]) => {
    const male = members.filter(row => row.gender === 'MALE').length;
    const female = members.filter(row => row.gender === 'FEMALE').length;
    const error = members.some(row => row.error) ? '请修正下方行数据' : undefined;
    return { teamName, count: members.length, male, female, lines: members.map(row => row.lineNumber).join('、'), error };
  });
  return { rows, groups, valid: rows.length > 0 && groups.every(group => !group.error) };
}

export async function importTeamRoster(competition: TeamImportCompetition, text: string, token?: string) {
  const parsed = parseTeamRoster(text);
  if (!parsed.valid) throw new Error('请先修正导入预览中的行数据问题');
  return apiFetch<{ teamCount: number; playerCount: number }>(`/team-competitions/${competition.id}/teams/batch-import`, {
    method: 'POST', token, body: JSON.stringify({ players: parsed.rows.map(row => ({ teamName: row.teamName, name: row.name, gender: row.gender, affiliation: row.affiliation, contact: row.contact, lineNumber: row.lineNumber })) }),
  });
}

export function TeamRosterImportInput({ text, onChange }: { competition: TeamImportCompetition; text: string; onChange: (text: string) => void }) {
  const { rows, groups } = parseTeamRoster(text);
  return <Space orientation="vertical" size={12} style={{ width: '100%' }}>
    <Alert type="info" showIcon title="团体名称、姓名、性别、单位、联系方式" description="每行一名队员，同名团体自动归为一队。前三列必填；单位和联系方式可留空。支持从 Excel 粘贴，可带表头，也可用逗号或顿号分隔。每队人数不限，不限制男女人数，出场项目赛前另行填报。" />
    <Input.TextArea aria-label="团体队员数据" rows={8} value={text} onChange={event => onChange(event.target.value)} placeholder={'团体名称\t姓名\t性别\t单位\t联系方式\n飞羽队\t张三\t男\t第一学校\t13800000000\n飞羽队\t李四\t女\t第一学校\t13900000000'} />
    <Table size="small" rowKey="teamName" dataSource={groups} pagination={false} scroll={{ x: 560 }} columns={[
      { title: '团体名称', dataIndex: 'teamName' }, { title: '人数', render: (_, row) => `${row.count} 人（${row.male} 男 ${row.female} 女）` },
      { title: '来源行号', dataIndex: 'lines' }, { title: '检查', render: (_, row) => <Typography.Text type={row.error ? 'danger' : 'success'}>{row.error || '可导入'}</Typography.Text> },
    ]} />
    <Table size="small" rowKey="lineNumber" dataSource={rows} pagination={false} scroll={{ x: 700, y: 250 }} columns={[
      { title: '行号', dataIndex: 'lineNumber' }, { title: '团体名称', dataIndex: 'teamName' }, { title: '姓名', dataIndex: 'name' },
      { title: '性别', render: (_, row) => row.gender === 'MALE' ? '男' : row.gender === 'FEMALE' ? '女' : '-' },
      { title: '单位', dataIndex: 'affiliation' }, { title: '联系方式', dataIndex: 'contact' },
      { title: '检查', render: (_, row) => <Typography.Text type={row.error ? 'danger' : 'success'}>{row.error || '格式正确'}</Typography.Text> },
    ]} />
  </Space>;
}

export default function TeamRosterImportModal({ competition, open, onClose, onImported, token }: {
  competition: TeamImportCompetition; open: boolean; onClose: () => void; onImported: () => Promise<void>; token?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = parseTeamRoster(text);
  async function save() {
    setBusy(true);
    try {
      const result = await importTeamRoster(competition, text, token);
      message.success(`已导入 ${result.teamCount} 个团体、${result.playerCount} 名队员`);
      setText(''); onClose(); await onImported();
    } catch (error) { message.error(error instanceof Error ? error.message : '导入失败'); }
    finally { setBusy(false); }
  }
  return <Modal title="批量导入团体队员" open={open} width={960} onCancel={onClose} onOk={save} cancelText="取消" confirmLoading={busy}
    okText={`导入 ${parsed.groups.length} 个团体、${parsed.rows.length} 人`} okButtonProps={{ disabled: !parsed.valid }}>
    <TeamRosterImportInput competition={competition} text={text} onChange={setText} />
  </Modal>;
}
