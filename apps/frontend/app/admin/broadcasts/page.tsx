'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, message,
} from 'antd';
import {
  CopyOutlined, DeleteOutlined, DesktopOutlined, PlusOutlined, ReloadOutlined, StopOutlined, SyncOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import type { LiveSnapshot } from '@/lib/multicamera';
import { BroadcastSettings } from '@/components/broadcast/BroadcastSettings';
import { BroadcastOverlay } from '@/components/broadcast/BroadcastOverlay';
import { PrivateCameraPreview } from '@/components/broadcast/PrivateCameraPreview';
import { CameraPairingPanel } from '@/components/broadcast/CameraPairingPanel';
import {
  BROADCAST_STATUS_LABELS,
  type BroadcastDetail, type BroadcastStatus, type BroadcastSummary,
  type OverlaySettings, type OverlaySnapshot,
} from '@/lib/broadcast-types';

type Tournament = { id: string; name: string; edition: number };

const STATUS_COLORS: Record<BroadcastStatus, string> = {
  READY: 'default', LIVE: 'red', INTERRUPTED: 'orange', ENDED: 'default',
};

function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success(`${label}已复制`);
  } catch {
    message.error('复制失败，请手动复制链接');
  }
}

export default function AdminBroadcastsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [list, setList] = useState<BroadcastSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<BroadcastDetail>();
  const [draftSettings, setDraftSettings] = useState<OverlaySettings>();
  const [preview, setPreview] = useState<OverlaySnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [overlayLink, setOverlayLink] = useState<{ title: string; url: string }>();
  const [cameraReady, setCameraReady] = useState(false);
  const [createForm] = Form.useForm<{ title: string; tournamentId: string; venueId?: string }>();
  const createTournamentId = Form.useWatch('tournamentId', createForm);
  const [createVenues, setCreateVenues] = useState<{ id: string; name: string }[]>([]);

  // Tournament filter arrives from the 赛事管理 entry. Read on the client to
  // keep this page out of a Suspense boundary for useSearchParams.
  const [tournamentFilter, setTournamentFilter] = useState<string>();
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('tournamentId');
    setTournamentFilter(value ?? undefined);
  }, []);

  const loadList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const query = tournamentFilter ? `?tournamentId=${encodeURIComponent(tournamentFilter)}` : '';
      setList(await apiFetch<BroadcastSummary[]>(`/broadcasts${query}`, { token }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '直播间加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, tournamentFilter]);

  const loadDetail = useCallback(async (id: string) => {
    if (!token) return;
    try {
      const next = await apiFetch<BroadcastDetail>(`/broadcasts/${encodeURIComponent(id)}`, { token });
      setDetail(next);
      setDraftSettings(next.overlaySettings);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '直播间详情加载失败');
    }
  }, [token]);

  // Status-only refresh for the polling timer: merges the camera block without
  // touching the operator's unsaved overlay/camera edits.
  const loadCameraStatus = useCallback(async (id: string) => {
    if (!token) return;
    try {
      const next = await apiFetch<BroadcastDetail>(`/broadcasts/${encodeURIComponent(id)}`, { token });
      setDetail((current) => (current && current.id === id
        ? { ...current, camera: next.camera, mediaMode: next.mediaMode,
          configVersion: current.mediaMode !== next.mediaMode ? next.configVersion : current.configVersion,
          status: next.status, isPublic: next.isPublic, playbackUrl: next.playbackUrl }
        : current));
      setList((current) => current.map((item) => item.id === id ? { ...item, status: next.status, isPublic: next.isPublic, camera: next.camera } : item));
    } catch {
      // A failed poll must not disturb the form.
    }
  }, [token]);

  const loadPreview = useCallback(async (id: string) => {
    if (!token) return;
    try {
      setPreview(await apiFetch<OverlaySnapshot | null>(`/broadcasts/${encodeURIComponent(id)}/preview`, { token }));
    } catch {
      setPreview(null);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadList();
  }, [token, loadList]);

  useEffect(() => {
    if (!token) return;
    apiFetch<Tournament[]>('/tournaments', { token })
      .then(setTournaments)
      .catch(() => setTournaments([]));
  }, [token]);

  useEffect(() => {
    if (selectedId) { void loadDetail(selectedId); void loadPreview(selectedId); }
    else { setDetail(undefined); setPreview(null); }
  }, [selectedId, loadDetail, loadPreview]);

  // Keep the operator's preview in step with the referee's scoring.
  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(() => void loadPreview(selectedId), 4000);
    return () => clearInterval(interval);
  }, [selectedId, loadPreview]);

  // The camera app reports every 5 s; refresh the online light on the same beat.
  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(() => void loadCameraStatus(selectedId), 5000);
    return () => clearInterval(interval);
  }, [selectedId, loadCameraStatus]);

  useEffect(() => {
    if (!token || !createTournamentId) { setCreateVenues([]); return; }
    apiFetch<{ venues?: { id: string; name: string }[] }>(`/tournaments/${encodeURIComponent(createTournamentId)}`, { token })
      .then((data) => setCreateVenues(data.venues ?? []))
      .catch(() => setCreateVenues([]));
  }, [token, createTournamentId]);

  async function patch(body: Record<string, unknown>, successText?: string) {
    if (!token || !detail) return;
    setSaving(true);
    try {
      const next = await apiFetch<BroadcastDetail>(`/broadcasts/${encodeURIComponent(detail.id)}`, {
        method: 'PATCH', token,
        body: JSON.stringify({ configVersion: detail.configVersion, ...body }),
      });
      setDetail(next);
      setDraftSettings(next.overlaySettings);
      await loadList();
      await loadPreview(next.id);
      if (successText) message.success(successText);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 409) await loadDetail(detail.id);
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function createBroadcast() {
    if (!token) return;
    const values = await createForm.validateFields();
    try {
      const created = await apiFetch<BroadcastSummary & { overlayToken: string }>('/broadcasts', {
        method: 'POST', token, body: JSON.stringify(values),
      });
      setCreateOpen(false);
      createForm.resetFields();
      await loadList();
      setSelectedId(created.id);
      setOverlayLink({
        title: created.title,
        url: absoluteUrl(`/broadcast/overlay/${encodeURIComponent(created.overlayToken)}`),
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败');
    }
  }

  async function rotateToken() {
    if (!token || !detail) return;
    try {
      const result = await apiFetch<{ overlayToken: string }>(
        `/broadcasts/${encodeURIComponent(detail.id)}/rotate-overlay-token`, { method: 'POST', token },
      );
      await loadDetail(detail.id);
      setOverlayLink({
        title: detail.title,
        url: absoluteUrl(`/broadcast/overlay/${encodeURIComponent(result.overlayToken)}`),
      });
      message.success('已生成新的记分牌链接，旧链接立即失效');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重置失败');
    }
  }

  async function publishBroadcast() {
    if (!token || !detail) return;
    setSaving(true);
    try {
      const next = await apiFetch<BroadcastDetail>(`/broadcasts/${encodeURIComponent(detail.id)}/publish`, { method: 'POST', token });
      setDetail(next);
      await loadList();
      message.success('已确认发布，观众现在可以观看');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发布失败，请先确认预览画面已就绪');
    } finally { setSaving(false); }
  }

  async function startBroadcast() {
    if (!token || !detail) return;
    setSaving(true);
    try {
      const base = `/broadcasts/${encodeURIComponent(detail.id)}/live`;
      let state = await apiFetch<LiveSnapshot>(base, { token });
      if (!state.enabled) state = await apiFetch<LiveSnapshot>(`${base}/enable`, {
        method: 'POST', token, body: JSON.stringify({ cameraCount: 1 }),
      });
      const next = await apiFetch<LiveSnapshot>(`${base}/start`, {
        method: 'POST', token, body: JSON.stringify({ sequence: state.sequence }),
      });
      await loadDetail(detail.id);
      await loadList();
      message.success(next.live ? '直播已开始，观众可以观看' : '观众页已开放，等待手机画面接入');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '开始直播失败');
    } finally { setSaving(false); }
  }

  async function withdrawBroadcast() {
    if (!token || !detail) return;
    setSaving(true);
    try {
      const next = await apiFetch<BroadcastDetail>(`/broadcasts/${encodeURIComponent(detail.id)}/withdraw`, { method: 'POST', token });
      setDetail(next);
      await loadList();
      message.success('已撤回发布，观众立即不可见');
    } catch (error) { message.error(error instanceof Error ? error.message : '撤回失败'); }
    finally { setSaving(false); }
  }

  async function endBroadcast() {
    if (!token || !detail) return;
    setSaving(true);
    try {
      const next = await apiFetch<BroadcastDetail>(`/broadcasts/${encodeURIComponent(detail.id)}/end`, { method: 'POST', token });
      setDetail(next);
      await loadList();
      message.success('本系统直播间已结束；手机 App 会自动停止推流，抖音请自行停止');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    } finally { setSaving(false); }
  }

  async function removeBroadcast(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/broadcasts/${encodeURIComponent(id)}`, { method: 'DELETE', token });
      if (selectedId === id) setSelectedId(undefined);
      await loadList();
      message.success('直播间已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  const matchOptions = useMemo(() => (detail?.matches ?? []).map((match) => ({
    value: match.id,
    label: `${match.status === 'LIVE' ? '进行中 · ' : match.status === 'COMPLETED' ? '已结束 · ' : ''}`
      + `${match.eventName} ${match.round} 第${match.matchNo}场：${match.side1Name} vs ${match.side2Name}`
      + `${match.venueName ? `（${match.venueName}）` : ''}`,
  })), [detail?.matches]);

  const settingsDirty = Boolean(detail && draftSettings
    && JSON.stringify(draftSettings) !== JSON.stringify(detail.overlaySettings));

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>直播管理</Typography.Title>
          <Typography.Text type="secondary">
            每个直播间统一使用一个配对二维码，单机位和多机位都从这里扫码接入；在导播台预览画面、选择主音频并开播。
          </Typography.Text>
        </div>
        <Space>
          {tournamentFilter && (
            <Button onClick={() => { setTournamentFilter(undefined); setSelectedId(undefined); }}>
              显示全部赛事
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void loadList()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建直播间</Button>
        </Space>
      </div>

      <Table<BroadcastSummary>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={list}
        pagination={{ pageSize: 8 }}
        rowClassName={(record) => (record.id === selectedId ? 'ant-table-row-selected' : '')}
        onRow={(record) => ({ onClick: () => setSelectedId(record.id) })}
        columns={[
          { title: '直播间', dataIndex: 'title' },
          { title: '赛事', render: (_, record) => record.tournament.name },
          { title: '场地', render: (_, record) => record.venue?.name ?? '未绑定' },
          {
            title: '视频状态',
            render: (_, record) => <Tag color={STATUS_COLORS[record.status]}>{BROADCAST_STATUS_LABELS[record.status]}</Tag>,
          },
          {
            title: '开放情况',
            render: (_, record) => (
              <Space size={4} wrap>
                <Tag color={record.enabled ? 'green' : 'default'}>{record.enabled ? '已启用' : '已停用'}</Tag>
                <Tag color={record.isPublic ? 'blue' : 'default'}>{record.isPublic ? '观众可见' : '仅内部'}</Tag>
                {record.camera.paired && (
                  <Tag color={record.camera.online ? 'green' : 'default'}>{record.camera.online ? '手机在线' : '手机离线'}</Tag>
                )}
                {!record.tournament.isPublic && <Tag color="orange">赛事未公开</Tag>}
              </Space>
            ),
          },
          {
            title: '操作',
            render: (_, record) => (
              <Space>
                <Button size="small" onClick={(event) => { event.stopPropagation(); setSelectedId(record.id); }}>
                  配置
                </Button>
                <Button size="small" href={`/director/${encodeURIComponent(record.id)}`} onClick={(event) => event.stopPropagation()}>直播导播</Button>
                <Popconfirm
                  title="删除直播间？"
                  description="删除后该直播间的 OBS 链接和观众页都会失效，比赛和比分不受影响。"
                  okText="删除" cancelText="取消"
                  onConfirm={() => void removeBroadcast(record.id)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={(event) => event.stopPropagation()} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      {detail && (
        <Card
          title={`${detail.title} · 直播间配置`}
          extra={
            <Space wrap>
              <Button icon={<SyncOutlined />} onClick={() => void rotateToken()}>重置记分牌链接</Button>
              {(detail.mediaMode === 'livekit' || !detail.camera.paired) && (
                <Button type="primary" loading={saving} disabled={detail.status === 'LIVE' || detail.status === 'READY' && detail.isPublic}
                  onClick={() => void startBroadcast()}>
                  {detail.status === 'LIVE' ? '直播中' : detail.status === 'READY' && detail.isPublic ? '待开始' : '开始直播'}
                </Button>
              )}
              {detail.mediaMode === 'livekit' ? (
                <Button type="primary" href={`/director/${encodeURIComponent(detail.id)}`}>预览并控制直播</Button>
              ) : detail.isPublic ? (
                <Popconfirm title="撤回观众发布？" description="观众会立即失去视频和比分。" okText="撤回" cancelText="取消" onConfirm={() => void withdrawBroadcast()}>
                  <Button danger loading={saving}>撤回发布</Button>
                </Popconfirm>
              ) : (
                <Popconfirm title="确认发布给观众？" description="请先检查下面的手机预览、声音、横竖屏和取景。" okText="确认发布" cancelText="取消" onConfirm={() => void publishBroadcast()}>
                  <Button type="primary" disabled={!cameraReady || !detail.tournament.isPublic} loading={saving}>确认发布给观众</Button>
                </Popconfirm>
              )}
              <Popconfirm
                title="结束本系统直播间？"
                description="仅关闭本系统直播间。OBS 推流和抖音开播需要你手动停止。"
                okText="结束" cancelText="取消"
                onConfirm={() => void endBroadcast()}
              >
                <Button icon={<StopOutlined />} loading={saving} disabled={detail.status === 'ENDED'}>结束直播间</Button>
              </Popconfirm>
            </Space>
          }
        >
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            {!detail.tournament.isPublic && (
              <Alert
                type="warning" showIcon
                message="赛事尚未审核发布或已归档，观众页暂不可用，仅本页预览可见。"
              />
            )}

            <Row gutter={[16, 12]}>
              <Col xs={24} md={8}>
                <Typography.Text type="secondary">绑定场地</Typography.Text>
                <Select
                  style={{ width: '100%' }} allowClear placeholder="不绑定场地"
                  value={detail.venueId ?? undefined}
                  options={detail.venues.map((venue) => ({ value: venue.id, label: venue.name }))}
                  onChange={(value) => void patch({ venueId: value ?? null, currentMatchId: null }, '场地已更新')}
                  aria-label="绑定场地"
                />
              </Col>
              <Col xs={24} md={16}>
                <Typography.Text type="secondary">当前比赛</Typography.Text>
                <Select
                  style={{ width: '100%' }} allowClear showSearch optionFilterProp="label"
                  placeholder="选择要直播的比赛"
                  value={detail.currentMatchId ?? undefined}
                  options={matchOptions}
                  onChange={(value) => void patch({ currentMatchId: value ?? null }, '已切换比赛')}
                  aria-label="当前比赛"
                />
              </Col>
              <Col xs={24} md={8}>
                <Typography.Text type="secondary">视频直播状态</Typography.Text>
                <Tag color={detail.status === 'LIVE' ? 'green' : 'default'}>
                  {BROADCAST_STATUS_LABELS[detail.status]}
                </Tag>
              </Col>
              <Col xs={12} md={8}>
                <Typography.Text type="secondary">启用直播间</Typography.Text>
                <Select
                  style={{ width: '100%' }} value={detail.enabled}
                  options={[{ value: true, label: '已启用' }, { value: false, label: '已停用（链接立即失效）' }]}
                  onChange={(value) => void patch({ enabled: value }, '已更新')}
                  aria-label="启用直播间"
                />
              </Col>
              <Col xs={12} md={8}>
                <Typography.Text type="secondary">观众可见</Typography.Text>
                <Select
                  style={{ width: '100%' }} value={detail.isPublic}
                  options={[{ value: false, label: '仅内部使用' }, { value: true, label: '向网站观众开放' }]}
                  onChange={(value) => void patch({ isPublic: value }, '已更新')}
                  aria-label="观众可见"
                />
              </Col>
              <Col xs={24}>
                <Alert type="info" showIcon message="一台或多台手机均扫描本直播间的同一个二维码，然后在 App 点“开始接入”。" description="点击“开始直播”即可开放观众页，无画面时显示“待开始”。单机位接入画面和声音后自动播放；多机位需在导播台设置正式画面与主音频。" />
              </Col>
            </Row>

            <Space wrap>
              <Button
                icon={<CopyOutlined />}
                onClick={() => void copy(absoluteUrl(`/live/${encodeURIComponent(detail.id)}`), '观众观看链接')}
              >
                复制观众观看链接
              </Button>
              <Button
                icon={<DesktopOutlined />}
                href={`/live/${encodeURIComponent(detail.id)}`}
                target="_blank" rel="noopener noreferrer"
              >
                打开观众页
              </Button>
              <Typography.Text type="secondary">
                观众页自带记分牌，无需 OBS。OBS 记分牌链接仅用于要把比分烧进视频的场合，只在创建或重置时显示一次。
              </Typography.Text>
            </Space>

            <CameraPairingPanel key={detail.id} broadcastId={detail.id} token={token} showDirectorLink
              onChange={() => loadCameraStatus(detail.id)} />
            {detail.mediaMode !== 'livekit' && detail.camera.paired && <Card size="small" title="当前手机画面">
              <PrivateCameraPreview key={detail.id} broadcastId={detail.id} token={token} onReady={setCameraReady} />
            </Card>}

            <BroadcastSettings
              value={draftSettings ?? detail.overlaySettings}
              onChange={setDraftSettings}
              disabled={saving}
            />
            <Space>
              <Button
                type="primary" loading={saving} disabled={!settingsDirty}
                onClick={() => draftSettings && void patch({ overlaySettings: draftSettings }, '记分牌样式已保存')}
              >
                保存样式
              </Button>
              <Button disabled={!settingsDirty} onClick={() => setDraftSettings(detail.overlaySettings)}>
                放弃改动
              </Button>
            </Space>

            <Card size="small" title="记分牌预览（1920×1080 画面比例）">
              <BroadcastOverlay
                preview={preview && draftSettings ? { ...preview, settings: draftSettings } : preview}
              />
            </Card>
          </Space>
        </Card>
      )}

      <Modal
        title="新建直播间" open={createOpen} okText="创建" cancelText="取消"
        onOk={() => void createBroadcast()}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="title" label="直播间标题" rules={[{ required: true, message: '请输入直播间标题' }]}>
            <Input maxLength={120} placeholder="例如：中心场地直播" />
          </Form.Item>
          <Form.Item name="tournamentId" label="所属赛事" rules={[{ required: true, message: '请选择赛事' }]}>
            <Select
              showSearch optionFilterProp="label"
              options={tournaments.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item name="venueId" label="绑定场地（可选）">
            <Select allowClear options={createVenues.map((venue) => ({ value: venue.id, label: venue.name }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="OBS 记分牌链接" open={Boolean(overlayLink)} footer={null}
        onCancel={() => setOverlayLink(undefined)}
      >
        {overlayLink && (
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="info" showIcon
              message="仅当需要把比分烧进视频（例如推给抖音）时才用：在 OBS 中添加“浏览器”来源，粘贴此网址，宽高填 1920×1080，勾选“页面透明”。网站观众页不需要它。"
            />
            <div data-allow-copy>
              <Input aria-label="OBS 记分牌链接" value={overlayLink.url} readOnly />
            </div>
            <Space>
              <Button type="primary" icon={<CopyOutlined />} onClick={() => void copy(overlayLink.url, 'OBS 记分牌链接')}>
                复制 OBS 记分牌链接
              </Button>
              <Button href={overlayLink.url} target="_blank" rel="noopener noreferrer">浏览器打开查看</Button>
            </Space>
            <Typography.Text type="secondary">
              此链接只显示一次。后台切换比赛后，OBS 无需重新粘贴网址。
            </Typography.Text>
          </Space>
        )}
      </Modal>
    </Space>
  );
}
