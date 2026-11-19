'use client';

import { useState } from 'react';
import dayjs from 'dayjs';
import { Alert, Empty, Input, List, Modal, Space, Tag, Typography } from 'antd';
import { apiFetch } from '@/lib/api';
import type { MMStatus } from '@/lib/match-management';
import { StatusTag } from './display';

const { Text } = Typography;

type SearchItem = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  tournamentArchived: boolean;
  project: string;
  round: string;
  matchNo: number;
  status: MMStatus;
  scheduledAt: string | null;
  venue: string | null;
  side1Name: string;
  side2Name: string;
  winnerSide: number | null;
  scoreText: string;
};

/**
 * 跨赛事搜选手 / 队伍：输入名字，列出他在所有（管理员：自己的）赛事里的场次；点一场就切到那个赛事并打开管理。
 */
export function GlobalMatchSearch({
  open,
  token,
  onClose,
  onPick,
}: {
  open: boolean;
  token?: string;
  onClose: () => void;
  onPick: (item: { tournamentId: string; matchId: string }) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ keyword: string; items: SearchItem[]; truncated: boolean } | null>(null);
  const [error, setError] = useState('');

  async function search(value: string) {
    const q = value.trim();
    if (!q || !token) return;
    setLoading(true);
    setError('');
    try {
      setResult(await apiFetch(`/match-management/search?q=${encodeURIComponent(q)}`, { token, cache: 'no-store' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onCancel={onClose} footer={null} title="跨赛事搜选手 / 队伍" width={720} destroyOnHidden>
      <Input.Search
        autoFocus
        allowClear
        enterButton="搜索"
        placeholder="输入选手姓名或队伍名，例如 张三"
        value={keyword}
        loading={loading}
        onChange={(event) => setKeyword(event.target.value)}
        onSearch={(value) => void search(value)}
      />
      {error ? <Alert type="error" showIcon style={{ marginTop: 12 }} title={error} /> : null}
      {result ? (
        <>
          <Text type="secondary" style={{ display: 'block', margin: '12px 0 4px', fontSize: 12 }}>
            「{result.keyword}」共 {result.items.length} 场{result.truncated ? '（只显示前 60 场，请输入更完整的名字）' : ''}，进行中的在前
          </Text>
          <List
            dataSource={result.items}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到相关场次" /> }}
            style={{ maxHeight: 460, overflowY: 'auto' }}
            renderItem={(item) => (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => onPick({ tournamentId: item.tournamentId, matchId: item.id })}
              >
                <div style={{ width: '100%' }}>
                  <Space size={6} wrap>
                    <StatusTag status={item.status} />
                    <Text strong>{item.tournamentName}</Text>
                    {item.tournamentArchived ? <Tag style={{ marginInlineEnd: 0 }}>已归档</Tag> : null}
                    <Text type="secondary" style={{ fontSize: 12 }}>{item.project} · {item.round} · 第 {item.matchNo} 场</Text>
                  </Space>
                  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      <span style={{ fontWeight: item.winnerSide === 1 ? 800 : 500 }}>{item.side1Name}</span>
                      <Text type="secondary"> vs </Text>
                      <span style={{ fontWeight: item.winnerSide === 2 ? 800 : 500 }}>{item.side2Name}</span>
                    </span>
                    <Text strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{item.scoreText || '未记分'}</Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.scheduledAt ? dayjs(item.scheduledAt).format('YYYY-MM-DD HH:mm') : '待排时间'} · {item.venue ?? '待排场地'}
                  </Text>
                </div>
              </List.Item>
            )}
          />
        </>
      ) : null}
    </Modal>
  );
}
