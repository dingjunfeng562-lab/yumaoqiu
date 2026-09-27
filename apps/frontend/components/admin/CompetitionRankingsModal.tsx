'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, InputNumber, Modal, Select, Space, Spin, Table, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';

type Entry = { id: string; name: string; teamName: string | null; affiliation: string; rank: number | null };
type Group = { id: string; kind: 'event' | 'team'; name: string; rankingLimit: number | null; entries: Entry[] };
type Rankings = { id: string; title: string; groups: Group[] };

export function CompetitionRankingsModal({ competition, token, onClose }: {
  competition: { id: string; title: string };
  token: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Rankings>();
  const [selected, setSelected] = useState<string>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rankingLimit, setRankingLimit] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const group = data?.groups.find((item) => item.id === selected);

  useEffect(() => {
    let active = true;
    apiFetch<Rankings>(`/admin/competitions/${encodeURIComponent(competition.id)}/rankings`, { token })
      .then((result) => {
        if (!active) return;
        setData(result);
        setSelected(result.groups[0]?.id);
        setEntries(result.groups[0]?.entries ?? []);
        setRankingLimit(result.groups[0]?.rankingLimit ?? null);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : '排名加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [competition.id, token, attempt]);

  function afterDiscard(action: () => void) {
    if (!dirty) return action();
    Modal.confirm({ title: '有尚未保存的名次，是否放弃修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: action });
  }

  async function save() {
    if (!group) return;
    if (rankingLimit !== null && (!Number.isInteger(rankingLimit) || rankingLimit < 1 || rankingLimit > 9999)) {
      message.error('取前几名必须是 1 至 9999 的整数');
      return;
    }
    if (entries.some((entry) => entry.rank !== null && (!Number.isInteger(entry.rank) || entry.rank < 1 || entry.rank > 9999))) {
      message.error('名次必须是 1 至 9999 的整数');
      return;
    }
    setSaving(true);
    try {
      const result = await apiFetch<Rankings>(`/admin/competitions/${encodeURIComponent(competition.id)}/rankings`, {
        token, method: 'PATCH', body: JSON.stringify({
          kind: group.kind, groupId: group.id, rankingLimit, entries: entries.map(({ id, rank }) => ({ id, rank })),
        }),
      });
      setData(result);
      setEntries(result.groups.find((item) => item.id === selected)?.entries ?? []);
      setRankingLimit(result.groups.find((item) => item.id === selected)?.rankingLimit ?? null);
      setDirty(false);
      message.success('最终名次已保存');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  }

  return <Modal title={`${competition.title} · 设置排名`} open width={800}
    onCancel={() => { if (!saving) afterDiscard(onClose); }} closable={!saving} mask={{ closable: false }}
    footer={<Space wrap>
      <Button disabled={saving} onClick={() => afterDiscard(onClose)}>关闭</Button>
      <Button disabled={loading || saving || !entries.length} onClick={() => {
        setEntries((current) => current.map((entry) => ({ ...entry, rank: null })));
        setDirty(true);
      }}>清空本项目名次</Button>
      <Button type="primary" loading={saving} disabled={loading || !dirty || !group} onClick={save}>保存名次</Button>
    </Space>}>
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon title="按项目填写最终名次，相同数字表示并列。"
        description="裁判确认全部场次结束后，前台自动公布计算出的名次；也可提前设置最终名次，完赛后优先采用手动设置。取前几名控制前台展示范围（含并列）；清空名次后恢复自动排名。" />
      {loading ? <Spin /> : error ? <Alert type="error" title={error}
        action={<Button onClick={() => { setLoading(true); setError(undefined); setAttempt((value) => value + 1); }}>重试</Button>} /> : data?.groups.length ? <>
        <Select aria-label="排名项目" style={{ width: '100%' }} value={selected} disabled={saving}
          options={data.groups.map((item) => ({ value: item.id, label: `${item.name}（${item.entries.length} 个参赛方）` }))}
          onChange={(value) => afterDiscard(() => {
            const next = data.groups.find((item) => item.id === value);
            setSelected(value); setEntries(next?.entries ?? []); setRankingLimit(next?.rankingLimit ?? null);
            setSearch(''); setPage(1); setDirty(false);
          })} />
        <Space wrap>
          <Typography.Text>展示范围</Typography.Text>
          <InputNumber aria-label="取前几名" min={1} max={9999} placeholder="全部名次" value={rankingLimit}
            disabled={saving} style={{ width: 135 }} onChange={(value) => { setRankingLimit(value); setDirty(true); }} />
          {[3, 6, 8].map((limit) => <Button key={limit} disabled={saving} type={rankingLimit === limit ? 'primary' : 'default'}
            onClick={() => { setRankingLimit(limit); setDirty(true); }}>前 {limit} 名</Button>)}
          <Button disabled={saving} onClick={() => { setRankingLimit(null); setDirty(true); }}>全部名次</Button>
        </Space>
        <Typography.Text type="secondary">{rankingLimit == null ? '展示全部已确定名次' : `只展示第 1 至第 ${rankingLimit} 名，之后的名次不展示`}。范围外的记录仍会保留。</Typography.Text>
        <Input.Search aria-label="搜索参赛选手或队伍" placeholder="搜索姓名、搭档或队伍名称" allowClear value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <style jsx global>{`.competition-rankings-table .ant-table { min-width: 0; }`}</style>
        <Table<Entry> className="competition-rankings-table" rowKey="id"
          dataSource={entries.filter((entry) => `${entry.name} ${entry.teamName ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))}
          pagination={{ current: page, onChange: setPage, pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: search.trim() ? '没有找到匹配的选手或队伍' : '该项目暂无已通过审核的选手或队伍' }}
          columns={[
            { title: '参赛选手／队伍', key: 'name', render: (_, entry) => <>
              <Typography.Text strong>{entry.name}</Typography.Text>
              {entry.teamName && <div><Typography.Text type="secondary">{entry.teamName}</Typography.Text></div>}
            </> },
            { title: '单位', dataIndex: 'affiliation', responsive: ['sm'], render: (value: string) => value || '—' },
            { title: '最终名次', key: 'rank', width: 145, render: (_, entry) => <InputNumber
              aria-label={`${entry.name}的最终名次`} min={1} max={9999} step={1} value={entry.rank}
              placeholder="未设置" disabled={saving} style={{ width: 110 }}
              onChange={(value) => {
                setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, rank: value } : item));
                setDirty(true);
              }} /> },
          ]} />
      </> : <Empty description="该赛事暂无比赛项目" />}
    </Space>
  </Modal>;
}
