'use client';

import { useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space, Table, message } from 'antd';
import { apiFetch } from '@/lib/api';

export type GroupVenueRule = { groupId: string; name: string; restrictVenues: boolean; venueIds: string[] };
type Venue = { id: string; name: string; isActive: boolean };

export function GroupVenueSettings({ tournamentId, token, groups, venues, onSaved }: {
  tournamentId: string; token: string; groups: GroupVenueRule[]; venues: Venue[]; onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<GroupVenueRule[]>([]);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [search, setSearch] = useState('');
  const [batch, setBatch] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const options = venues.map(v => ({ value: v.id, label: `${v.name}${v.isActive ? '' : '（停用，请重新选择）'}`, disabled: !v.isActive }));
  const update = (id: string, change: Partial<GroupVenueRule>) => setRows(current => current.map(r => r.groupId === id ? { ...r, ...change } : r));
  async function save() {
    if (rows.some(r => r.restrictVenues && !r.venueIds.length)) { message.error('指定场地的组别至少选择一片场地'); return; }
    setSaving(true);
    try {
      const result = await apiFetch<{ affectedMatchCount: number }>(`/tournaments/${tournamentId}/group-venues`, {
        method: 'PATCH', token, body: JSON.stringify({ groups: rows.map(({ groupId, restrictVenues, venueIds }) => ({ groupId, restrictVenues, venueIds: restrictVenues ? venueIds : [] })) }),
      });
      await onSaved(); setOpen(false);
      Modal.info({ title: '组别场地规则已保存', okText: '知道了', content: result.affectedMatchCount
        ? `有 ${result.affectedMatchCount} 场未开始比赛需要调整。请预览并应用自动排程，或手动调整；大屏在实际排程保存后更新。`
        : '规则将在下次排程时使用。当前比赛安排保持不变。' });
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败'); }
    finally { setSaving(false); }
  }
  return <>
    <Button disabled={!tournamentId} onClick={() => { setRows(groups.map(r => ({ ...r, venueIds: [...r.venueIds] }))); setSelected([]); setSearch(''); setOpen(true); }}>组别场地分配</Button>
    <Modal title="组别场地分配" open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving} width={850} okText="保存规则" cancelText="取消">
      <Alert type="info" showIcon title="指定场地后，自动排程只使用所选场地。多个组别可错时共用；手动调整时可为单场设置临时借场。" style={{ marginBottom: 16 }} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="搜索组别" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
        <Select mode="multiple" placeholder="批量选择场地" value={batch} onChange={setBatch} options={options} style={{ minWidth: 220 }} />
        <Button disabled={!selected.length || !batch.length} onClick={() => setRows(current => current.map(r => selected.includes(r.groupId) ? { ...r, restrictVenues: true, venueIds: batch } : r))}>应用于所选组别</Button>
        <Button disabled={!selected.length} onClick={() => setRows(current => current.map(r => selected.includes(r.groupId) ? { ...r, restrictVenues: false, venueIds: [] } : r))}>恢复不限制</Button>
      </Space>
      <Table rowKey="groupId" dataSource={rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))} pagination={{ pageSize: 10 }} rowSelection={{ selectedRowKeys: selected, onChange: setSelected, preserveSelectedRowKeys: true }} columns={[
        { title: '组别', dataIndex: 'name', width: 150 },
        { title: '场地模式', width: 150, render: (_, row) => <Select value={row.restrictVenues ? 'specified' : 'all'} style={{ width: 120 }} options={[{ value: 'all', label: '不限制' }, { value: 'specified', label: '指定场地' }]} onChange={mode => update(row.groupId, { restrictVenues: mode === 'specified', ...(mode === 'specified' ? {} : { venueIds: [] }) })} /> },
        { title: '可用场地', render: (_, row) => row.restrictVenues ? <Select mode="multiple" value={row.venueIds} onChange={venueIds => update(row.groupId, { venueIds })} options={options} placeholder="至少选择一片场地" style={{ width: '100%' }} /> : '全部启用场地' },
      ]} />
    </Modal>
  </>;
}
