'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Select, Space, Spin, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/components/competitions/types';

type OrderMode = 'REGISTRATION_FIRST' | 'START_DATE_DESC' | 'START_DATE_ASC';
type PublicOrder = {
  mode: OrderMode;
  orderedIds: string[];
  competitions: Array<{ id: string; name: string; startDate: string }>;
};

const ORDER_PATH = '/admin/competitions/order';
const ORDER_RULES = [
  { value: 'REGISTRATION_FIRST', label: '报名中优先' },
  { value: 'START_DATE_DESC', label: '开赛日期从新到旧' },
  { value: 'START_DATE_ASC', label: '开赛日期从旧到新' },
];

export function CompetitionOrderModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [draft, setDraft] = useState<PublicOrder>();
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<PublicOrder>(ORDER_PATH, { token, cache: 'no-store', signal: controller.signal })
      .then(setDraft)
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : '排序设置加载失败');
      });
    return () => controller.abort();
  }, [token]);

  function move(index: number, amount: -1 | 1) {
    if (!draft) return;
    const orderedIds = [...draft.orderedIds];
    const other = index + amount;
    if (other < 0 || other >= orderedIds.length) return;
    [orderedIds[index], orderedIds[other]] = [orderedIds[other], orderedIds[index]];
    setDraft({ ...draft, orderedIds });
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const { mode, orderedIds } = draft;
      await apiFetch(ORDER_PATH, { token, method: 'PATCH', body: JSON.stringify({ mode, orderedIds }) });
      message.success('前台赛事排序已保存');
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '排序保存失败');
    } finally {
      setSaving(false);
    }
  }

  const selected = new Set(draft?.orderedIds);
  const byId = new Map(draft?.competitions.map((competition) => [competition.id, competition]));
  const available = draft?.competitions.filter((competition) => !selected.has(competition.id)) ?? [];
  return (
    <Modal
      open
      title="前台赛事排序"
      width={640}
      onCancel={saving ? undefined : onClose}
      onOk={() => void save()}
      okText="保存排序"
      okButtonProps={{ disabled: !draft }}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      confirmLoading={saving}
    >
      {loadError ? <Alert type="error" title={loadError} /> : !draft ? <Spin /> : (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <label htmlFor="competition-order-rule">全站排序规则</label>
          <Select<OrderMode>
            id="competition-order-rule"
            value={draft.mode}
            options={ORDER_RULES}
            onChange={(mode) => setDraft({ ...draft, mode })}
            disabled={saving}
            style={{ width: '100%' }}
          />
          <Typography.Text strong>手动排序</Typography.Text>
          <Typography.Text type="secondary">这里的赛事按指定顺序排在前面，其余赛事按全站规则排列。</Typography.Text>
          <Select<string | null>
            aria-label="添加到手动排序"
            placeholder="搜索并添加已发布赛事"
            value={null}
            showSearch={{ optionFilterProp: 'label' }}
            options={available.map(({ id, name, startDate }) => ({
              value: id,
              label: `${name} · ${formatDate(startDate)}`,
            }))}
            onChange={(id) => { if (id) setDraft({ ...draft, orderedIds: [...draft.orderedIds, id] }); }}
            disabled={saving || !available.length}
            style={{ width: '100%' }}
          />
          <Space wrap>
            <Button size="small" disabled={saving || !available.length} onClick={() => setDraft({
              ...draft,
              orderedIds: [...draft.orderedIds, ...available.map(({ id }) => id)],
            })}>添加剩余赛事</Button>
            <Button size="small" disabled={saving || !draft.orderedIds.length} onClick={() => setDraft({ ...draft, orderedIds: [] })}>
              清空手动排序
            </Button>
          </Space>
          {draft.orderedIds.length ? (
            <ol style={{ listStyle: 'decimal inside', maxHeight: '38vh', overflowY: 'auto', margin: 0, padding: 0 }}>
              {draft.orderedIds.map((id, index) => {
                const name = byId.get(id)?.name ?? id;
                return (
                  <li key={id} style={{ padding: '6px 0' }}>
                    <Typography.Text>{name}</Typography.Text>
                    <Space size={4} wrap style={{ marginInlineStart: 8 }}>
                      <Button size="small" aria-label={`上移 ${name}`} disabled={saving || index === 0} onClick={() => move(index, -1)}>上移</Button>
                      <Button size="small" aria-label={`下移 ${name}`} disabled={saving || index === draft.orderedIds.length - 1} onClick={() => move(index, 1)}>下移</Button>
                      <Button size="small" aria-label={`移除 ${name}`} disabled={saving} onClick={() => setDraft({
                        ...draft,
                        orderedIds: draft.orderedIds.filter((item) => item !== id),
                      })}>移除</Button>
                    </Space>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </Space>
      )}
    </Modal>
  );
}
