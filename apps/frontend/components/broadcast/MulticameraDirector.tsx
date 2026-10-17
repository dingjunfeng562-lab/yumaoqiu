'use client';

import styles from './MulticameraDirector.module.css';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { VideoQuality } from 'livekit-client';
import { Alert, Button, Card, Input, Popconfirm, Select, Space, Switch, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { type LiveSnapshot, useLiveRoom } from '@/lib/multicamera';
import { LiveCameraVideo } from './LiveCameraVideo';
import { CameraPairingPanel } from './CameraPairingPanel';
import { BroadcastSettings } from './BroadcastSettings';
import { BroadcastOverlay } from './BroadcastOverlay';
import type { OverlaySettings, OverlaySnapshot } from '@/lib/broadcast-types';

export function MulticameraDirector({ broadcastId }: { broadcastId: string }) {
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const root = session?.user?.role === 'ROOT';
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [directorId, setDirectorId] = useState('');
  const [canAudio, setCanAudio] = useState(false);
  const [overlayDraft, setOverlayDraft] = useState<OverlaySettings | null>(null);
  const [overlaySaved, setOverlaySaved] = useState<OverlaySettings | null>(null);
  const [overlayPreview, setOverlayPreview] = useState<OverlaySnapshot | null>(null);
  const [overlaySaving, setOverlaySaving] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  // 手动重建一次媒体连接：机位重连后浏览器偶尔会停在最后一帧，点一下即可恢复。
  const [reseed, setReseed] = useState(0);
  const { room, error: mediaError, revision } = useLiveRoom(broadcastId, 'director', snapshot?.enabled && snapshot.status !== 'ENDED' ? token : undefined, reseed);
  const base = `/broadcasts/${encodeURIComponent(broadcastId)}/live`;
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const next = await apiFetch<LiveSnapshot>(base, { token, redirectOnForbidden: false });
      setSnapshot((old) => old && old.sequence > next.sequence ? old : next); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '导播状态加载失败'); }
  }, [base, token]);
  useEffect(() => { const first = setTimeout(() => void load(), 0); const timer = setInterval(() => void load(), 2000); return () => { clearTimeout(first); clearInterval(timer); }; }, [load]);
  // 记分牌设置与预览：导播在切换画面的同时就能调整比分板，不必回后台。
  useEffect(() => {
    if (!token || !root) return;
    let disposed = false;
    const pull = async () => {
      try {
        const [detail, preview] = await Promise.all([
          apiFetch<{ overlaySettings: OverlaySettings }>(`/broadcasts/${encodeURIComponent(broadcastId)}`, { token, redirectOnForbidden: false }),
          apiFetch<OverlaySnapshot>(`/broadcasts/${encodeURIComponent(broadcastId)}/preview`, { token, redirectOnForbidden: false }).catch(() => null),
        ]);
        if (disposed) return;
        setOverlaySaved(detail.overlaySettings);
        setOverlayDraft((current) => current ?? detail.overlaySettings);
        if (preview) setOverlayPreview(preview);
      } catch { /* 权限不足或网络抖动时保留上一次结果 */ }
    };
    void pull();
    const timer = setInterval(() => void pull(), 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [broadcastId, root, token]);
  useEffect(() => {
    room?.remoteParticipants.forEach((participant) => participant.videoTrackPublications.forEach((track) => {
      const id = participant.identity.replace(/^camera_/, '');
      track.setVideoQuality(id === snapshot?.activeCameraId || id === snapshot?.previewCameraId ? VideoQuality.HIGH : VideoQuality.LOW);
    }));
  }, [room, snapshot?.activeCameraId, snapshot?.previewCameraId, revision]);

  async function command(action: string, extra: Record<string, unknown> = {}) {
    if (!token || !snapshot) return;
    setBusy(true);
    try {
      const next = await apiFetch<LiveSnapshot>(`${base}/${action}`, { method: 'POST', token, redirectOnForbidden: false,
        body: JSON.stringify({ sequence: snapshot.sequence, ...extra }) });
      setSnapshot(next);
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败'); await load(); }
    finally { setBusy(false); }
  }
  async function unpair(cameraId: string) {
    if (!token) return;
    try {
      await apiFetch(`${base}/cameras/${cameraId}/pair`, { method: 'DELETE', token });
      message.success('已释放机位，新手机可扫描直播间二维码接入'); await load();
    } catch (e) { message.error(e instanceof Error ? e.message : '解除配对失败'); }
  }
  async function grant(revoke = false) {
    if (!token || !directorId.trim()) return;
    try {
      await apiFetch(`${base}/directors${revoke ? `/${encodeURIComponent(directorId.trim())}` : ''}`, { token, method: revoke ? 'DELETE' : 'POST',
        ...(revoke ? {} : { body: JSON.stringify({ userId: directorId.trim(), canAudio }) }) });
      message.success(revoke ? '导播授权已撤销' : '导播授权已保存');
    } catch (e) { message.error(e instanceof Error ? e.message : '授权失败'); }
  }
  const cameraName = (id: string | null) => snapshot?.cameras.find((c) => c.id === id)?.code ?? '未选择';
  const overlayDirty = Boolean(overlayDraft && overlaySaved && JSON.stringify(overlayDraft) !== JSON.stringify(overlaySaved));
  async function saveOverlay() {
    if (!token || !overlayDraft) return;
    setOverlaySaving(true);
    try {
      await apiFetch(`/broadcasts/${encodeURIComponent(broadcastId)}`, {
        method: 'PATCH', token, redirectOnForbidden: false,
        body: JSON.stringify({ overlaySettings: overlayDraft }),
      });
      setOverlaySaved(overlayDraft);
      message.success('记分牌设置已保存，观众页与 OBS 记分牌同步更新');
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败'); }
    finally { setOverlaySaving(false); }
  }
  // 导播电脑麦克风：推一路到直播间，观众端与场边主音频一起混音播放。
  async function toggleMic() {
    if (!room) { message.error('直播连接尚未就绪，请等画面出现后再试'); return; }
    setMicBusy(true);
    try {
      const next = !micOn;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      message.success(next ? '电脑麦克风已开启，会与场边机位声音一起播出' : '电脑麦克风已关闭');
    } catch {
      setMicOn(false);
      message.error('麦克风开启失败：请允许浏览器的麦克风权限，并确认页面是 HTTPS');
    } finally { setMicBusy(false); }
  }
  return <main className={styles.page} style={{ maxWidth: 1440, margin: 'auto', padding: '24px 16px', background: '#f4f6fa', minHeight: '100vh' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><Typography.Title level={3} style={{ margin: 0 }}>{snapshot?.title ?? '赛事直播'} · 直播导播</Typography.Title>
          <Typography.Text type="secondary">选择预监机位，再按 TAKE 切换正式画面。主音频独立保持。</Typography.Text></div>
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} style={{ minHeight: 40 }} href="/nicaiyixiahh/broadcasts">返回上级</Button>
          <Tag color={snapshot?.live ? 'red' : 'default'}>{snapshot?.live ? 'ON AIR' : snapshot?.status === 'ENDED' ? '已结束' : snapshot?.waiting ? '待开始' : 'STANDBY'}</Tag>
          <Button href={`/live/${encodeURIComponent(broadcastId)}`} target="_blank">观众页面</Button>
          <Button onClick={() => void load()}>刷新状态</Button>
          <Button onClick={() => setReseed((n) => n + 1)}>重连视频</Button></Space>
      </div>
      {status === 'unauthenticated' && <Alert type="warning" title="请先登录具有导播权限的账号" action={<Button href={`/login?redirect=${encodeURIComponent(`/director/${broadcastId}`)}`}>登录</Button>} />}
      {(error || mediaError) && <Alert showIcon type="warning" title={error || mediaError} />}
      {root && <CameraPairingPanel key={broadcastId} broadcastId={broadcastId} token={token} snapshot={snapshot} onChange={load} />}
      {snapshot && !snapshot.enabled && !root && <Alert type="info" title="请联系管理员打开直播间配对二维码，接入摄像手机。" />}
      {snapshot?.enabled && <>
        {snapshot.waiting && <Alert showIcon type="info" title="待开始" description="观众页已开放，正式画面和主音频就绪后自动播放；多机位请先选择正式画面和主音频。" />}
        {snapshot.activeCameraId && !snapshot.cameras.find((c) => c.id === snapshot.activeCameraId)?.online && <Alert showIcon type="error" title="PGM 机位已离线，请预监并切换到备用机位" />}
        {snapshot.audioCameraId && !snapshot.cameras.find((c) => c.id === snapshot.audioCameraId)?.online && <Alert showIcon type="error" title="主音频机位已离线，请检查设备或切换主音频" />}
        <Card style={{ position: 'sticky', top: 8, zIndex: 10, boxShadow: '0 4px 20px #0002' }}><Space wrap size={16}>
          <Button type="primary" danger size="large" loading={busy} onClick={() => void command('take')}>TAKE → 正式画面</Button>
          <span>主音频</span><Select aria-label="主音频机位" style={{ minWidth: 180 }} value={snapshot.audioCameraId} disabled={!snapshot.canAudio || busy}
            placeholder="选择主收音手机" options={snapshot.cameras.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
            onChange={(cameraId) => void command('audio', { cameraId })} />
          <Button loading={busy} onClick={() => void command(snapshot.live || snapshot.waiting ? 'pause' : 'start')}>{snapshot.live || snapshot.waiting ? '暂停对外直播' : '开始对外直播'}</Button>
          <Button danger loading={busy} disabled={snapshot.status === 'ENDED'} onClick={() => void command('end')}>结束直播</Button>
        </Space></Card>
        <Card size="small" title="电脑麦克风（可选）" extra={<Switch checked={micOn} loading={micBusy} checkedChildren="开" unCheckedChildren="关" onChange={() => void toggleMic()} />}>
          <Typography.Text type="secondary">
            开启后，观众会同时听到场边机位和这台电脑的麦克风。请戴耳机：用扬声器时麦克风会把直播声音收回去，产生回声。
          </Typography.Text>
        </Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
          {snapshot.cameras.map((camera) => <Card key={camera.id} size="small" title={`${camera.code} · ${camera.name}`}
            style={{ border: `2px solid ${camera.onAir ? '#e54242' : snapshot.previewCameraId === camera.id ? '#36a269' : '#dbe1e9'}` }}
            extra={<Tag color={camera.onAir ? 'red' : camera.online ? 'green' : 'default'}>{camera.onAir ? 'ON AIR' : camera.online ? 'STANDBY' : '离线'}</Tag>}>
            <button aria-label={`预监 ${camera.code}`} onClick={() => void command('preview', { cameraId: camera.id })}
              style={{ border: 0, padding: 0, display: 'block', width: '100%', aspectRatio: '16 / 9', cursor: 'pointer' }}>
              <LiveCameraVideo room={room} cameraId={camera.id} revision={revision} />
            </button>
            <Typography.Paragraph style={{ margin: '10px 0', fontSize: 12 }}>
              {camera.state?.fps ?? '—'} FPS · ↑ {camera.state?.bitrateKbps ?? '—'} kbps · RTT {camera.state?.rttMs ?? '—'} ms<br />
              {camera.state?.networkType ?? '网络未知'} · 电量 {camera.state?.battery ?? '—'}% · 丢包 {camera.state?.packetLoss ?? '—'}%<br />
              AUDIO: {camera.audioEnabled ? camera.state?.audioSource || '等待主麦克风' : 'OFF'}
              {camera.audioEnabled && camera.state?.audioLevelDb != null && ` · ${camera.state.audioLevelDb.toFixed(0)} dB`}
            </Typography.Paragraph>
            {camera.audioEnabled && camera.state?.audioStatus === 'INTERNAL_MIC' && <Alert type="warning" title="当前使用内置麦克风，请检查 USB 接收器" />}
            {(camera.state?.battery != null && camera.state.battery <= 15 || ['HOT', 'CRITICAL'].includes(camera.state?.thermal ?? '')) && <Alert type="warning" title="设备电量或温度异常，请检查摄像手机" />}
            <Space wrap style={{ marginTop: 8 }}>
              <Button style={{ minHeight: 44 }} loading={busy} onClick={() => void command('preview', { cameraId: camera.id })}>设为 PVW</Button>
              {root && <Popconfirm title={`解除 ${camera.code} 配对？`} description="当前手机将断开，释放后的机位可由新手机扫描直播间二维码接入。"
                okText="解除配对" cancelText="取消" onConfirm={() => unpair(camera.id)}>
                <Button style={{ minHeight: 44 }}>解除配对</Button>
              </Popconfirm>}
            </Space>
          </Card>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
          <Card size="small" title={`PVW · ${cameraName(snapshot.previewCameraId)}`}><div style={{ aspectRatio: '16 / 9' }}><LiveCameraVideo room={room} cameraId={snapshot.previewCameraId} revision={revision} quality="high" /></div></Card>
          <Card size="small" title={`PGM · ${cameraName(snapshot.activeCameraId)}`}><div style={{ aspectRatio: '16 / 9' }}><LiveCameraVideo room={room} cameraId={snapshot.activeCameraId} revision={revision} quality="high" /></div></Card>
        </div>
        {root && overlayDraft && <>
          <BroadcastSettings value={overlayDraft} onChange={setOverlayDraft} disabled={overlaySaving} />
          <Card size="small" title="记分牌预览（1920×1080 画面比例）" extra={<Space>
            <Button type="primary" loading={overlaySaving} disabled={!overlayDirty} onClick={() => void saveOverlay()}>保存比分设置</Button>
            <Button disabled={!overlayDirty} onClick={() => setOverlayDraft(overlaySaved)}>放弃改动</Button>
          </Space>}>
            <BroadcastOverlay preview={overlayPreview ? { ...overlayPreview, settings: overlayDraft } : null} />
          </Card>
        </>}
        {root && <Card size="small" title="导播授权"><Space wrap>
          <Input aria-label="导播用户 ID" placeholder="导播账号的用户 ID" value={directorId} onChange={(e) => setDirectorId(e.target.value)} />
          <Switch checked={canAudio} onChange={setCanAudio} checkedChildren="允许切音频" unCheckedChildren="仅切视频" />
          <Button onClick={() => void grant()}>保存授权</Button><Button danger onClick={() => void grant(true)}>撤销授权</Button>
        </Space><Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>授权后，将当前导播页面链接交给该用户。</Typography.Paragraph></Card>}
        <details><summary>最近操作记录</summary>{snapshot.logs.map((log) => <div key={log.id}>{new Date(log.createdAt).toLocaleTimeString()} · #{log.sequence} · {log.kind} · {cameraName(log.fromId)} → {cameraName(log.toId)}</div>)}</details>
      </>}
    </div>
  </main>;
}
