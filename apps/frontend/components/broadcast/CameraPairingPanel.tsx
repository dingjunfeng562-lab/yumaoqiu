'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Popconfirm, Select, Space, Typography, message } from 'antd';
import { apiFetch } from '@/lib/api';
import type { LiveSnapshot } from '@/lib/multicamera';
import { CameraPairingModal, type CameraPairing } from './CameraPairingModal';

type Props = {
  broadcastId: string;
  token?: string;
  snapshot?: LiveSnapshot | null;
  onChange?: () => void | Promise<void>;
  showDirectorLink?: boolean;
};

/** One room invitation, shared by the management page and the director desk. */
export function CameraPairingPanel({ broadcastId, token, snapshot, onChange, showDirectorLink }: Props) {
  const [loaded, setLoaded] = useState<LiveSnapshot | null>(null);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState<CameraPairing>();
  const current = snapshot ?? loaded;
  const base = `/broadcasts/${encodeURIComponent(broadcastId)}/live`;
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const next = await apiFetch<LiveSnapshot>(base, { token });
      setLoaded(next); setError('');
      return next;
    } catch (e) { setError(e instanceof Error ? e.message : '接入状态加载失败'); }
  }, [base, token]);
  useEffect(() => {
    if (snapshot !== undefined) return;
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 5000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [load, snapshot]);

  async function openCode(rotate = false) {
    if (!token) return;
    setBusy(true);
    try {
      let next = await apiFetch<LiveSnapshot>(base, { token });
      if (!next.enabled) {
        next = await apiFetch<LiveSnapshot>(`${base}/enable`, { token, method: 'POST', body: JSON.stringify({ cameraCount: count }) });
        setLoaded(next);
        await onChange?.();
      }
      const result = await apiFetch<{ code: string; serverUrls: string[]; expiresAt: string }>(`${base}/join-code`, {
        token, method: 'POST', body: JSON.stringify({ rotate }),
      });
      setPairing({ title: next.title, token: result.code, serverUrls: result.serverUrls, version: 2, shared: true, expiresAt: result.expiresAt });
      setError('');
    } catch (e) { message.error(e instanceof Error ? e.message : '二维码操作失败'); }
    finally { setBusy(false); }
  }
  async function closeCode() {
    if (!token) return;
    setBusy(true);
    try {
      await apiFetch(`${base}/join-code`, { token, method: 'DELETE' });
      setPairing(undefined);
      message.success('二维码已关闭，已配对手机不受影响');
    } catch (e) { message.error(e instanceof Error ? e.message : '关闭二维码失败'); }
    finally { setBusy(false); }
  }

  return <Card size="small" title="手机扫码接入">
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Text>每个直播间共用一个配对二维码。只用一台手机也扫这个码，多台手机依次扫码，自动分配空闲机位。</Typography.Text>
      {error && <Alert showIcon type="warning" title={error} />}
      <Space wrap>
        {current && !current.enabled && <><span>机位数量</span><Select aria-label="机位数量" value={count} onChange={setCount} disabled={busy}
          options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n} 个机位` }))} /></>}
        <Button type="primary" loading={busy} onClick={() => void openCode()}>配对二维码</Button>
        {current?.enabled && <>
          <Popconfirm title="重置直播间二维码？" description="旧二维码将失效，已配对手机继续使用；需要重新扫码的手机会恢复原机位。"
            okText="重置" cancelText="取消" onConfirm={() => openCode(true)}>
            <Button disabled={busy}>重置二维码</Button>
          </Popconfirm>
          <Button disabled={busy} onClick={() => void closeCode()}>关闭二维码</Button>
          <Typography.Text type="secondary">已配对 {current.cameras.filter((c) => c.paired).length}/{current.cameras.length} 台</Typography.Text>
        </>}
        {showDirectorLink && <Button href={`/director/${encodeURIComponent(broadcastId)}`}>打开导播台</Button>}
      </Space>
      <Typography.Text type="secondary">有效期内反复打开均为同一码。同一台手机重新扫码会恢复原机位，不占用新机位。</Typography.Text>
    </Space>
    <CameraPairingModal pairing={pairing} onClose={() => setPairing(undefined)} />
  </Card>;
}
