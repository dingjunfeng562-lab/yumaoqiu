'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Select, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';

type Referee = { id: string; username?: string | null; email?: string | null };
type Court = { id: string; name: string; referees: Referee[] };

export default function CourtRefereesPanel({ tournamentId, token, referees }: {
  tournamentId: string;
  token: string;
  referees: Referee[];
}) {
  const [courts, setCourts] = useState<Court[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const base = `/scoring/tournaments/${encodeURIComponent(tournamentId)}`;

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Court[]>(`${base}/court-referees`, { token, signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setCourts(data); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '加载场地失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, token]);

  async function save(court: Court, refereeIds: string[]) {
    setSaving(court.id);
    try {
      const updated = await apiFetch<Court[]>(`${base}/courts/${encodeURIComponent(court.id)}/referees`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ refereeIds }),
      });
      setCourts(updated);
      setDrafts(current => {
        const next = { ...current };
        delete next[court.id];
        return next;
      });
      message.success(`${court.name}的裁判已保存`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存裁判分配失败');
    } finally {
      setSaving('');
    }
  }

  return (
    <Card title="按场地分配裁判" loading={loading} style={{ marginBottom: 16 }}>
      <Typography.Paragraph type="secondary">
        每个场地可选多个裁判。保存后，该赛事会出现在裁判账号的赛事列表。场地分配内的裁判可相互接手，一场比赛由当前执裁账号计分和判罚。
      </Typography.Paragraph>
      {error ? <Alert type="error" title={error} showIcon /> : courts.length ? (
        <div className="space-y-3">
          {courts.map(court => {
            const options = [...new Map([...court.referees, ...referees].map(referee => [referee.id, referee])).values()]
              .map(referee => ({ value: referee.id, label: referee.username || referee.email || referee.id }));
            const saved = court.referees.map(referee => referee.id);
            const selected = drafts[court.id] ?? saved;
            const changed = saved.length !== selected.length || selected.some(id => !saved.includes(id));
            return (
              <div key={court.id} className="flex flex-wrap items-center gap-3">
                <Typography.Text strong className="min-w-24">{court.name}</Typography.Text>
                <Select
                  aria-label={`${court.name}裁判`}
                  className="min-w-56 flex-1"
                  mode="multiple"
                  maxCount={50}
                  allowClear
                  placeholder="选择裁判账号"
                  optionFilterProp="label"
                  options={options}
                  value={selected}
                  disabled={Boolean(saving)}
                  onChange={(ids: string[]) => setDrafts(current => ({ ...current, [court.id]: ids }))}
                />
                <Button type="primary" disabled={!changed || Boolean(saving)} loading={saving === court.id} onClick={() => void save(court, selected)}>
                  保存
                </Button>
              </div>
            );
          })}
        </div>
      ) : <Empty description="请先在场地排程中添加场地" />}
    </Card>
  );
}
