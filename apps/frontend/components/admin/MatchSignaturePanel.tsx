'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Image,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DownloadOutlined, FileProtectOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiBlob, apiFetch } from '@/lib/api';

export type ScoreSheetStatus = 'VALID' | 'VOID' | 'STALE';

export type ScoreSheetSummary = {
  id: string;
  matchId: string;
  signedAt: string;
  endType: string;
  endTypeLabel: string;
  status: ScoreSheetStatus;
  voidedAt: string | null;
  voidReason: string | null;
  eventLabel: string;
  roundLabel: string;
  matchLabel: string;
  matchNo: number | null;
  side1Name: string;
  side2Name: string;
  scoreText: string;
  winnerSide: 1 | 2 | null;
  winnerName: string | null;
  winnerSignerName: string | null;
  refereeName: string;
  hasSheetImage: boolean;
};

type ScoreSheetDetail = ScoreSheetSummary & {
  contentHash: string;
  refereeId: string | null;
  clientIp: string | null;
  userAgent: string | null;
  integrity: { ok: boolean; problems: string[] };
};

const STATUS_TAGS: Record<ScoreSheetStatus, { color: string; label: string }> = {
  VALID: { color: 'green', label: '有效' },
  VOID: { color: 'default', label: '已作废' },
  STALE: { color: 'orange', label: '已失效' },
};

function formatTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—';
}

/** 同一场可能有多份（重开后重签）；列表里优先显示有效的那份。 */
export function pickMatchSheet(sheets: ScoreSheetSummary[], matchId: string) {
  const own = sheets.filter((sheet) => sheet.matchId === matchId);
  return own.find((sheet) => sheet.status === 'VALID') ?? own[0] ?? null;
}

export function ScoreSheetStatusTag({ sheet }: { sheet: ScoreSheetSummary }) {
  const tag = STATUS_TAGS[sheet.status];
  const title = sheet.status === 'VOID'
    ? sheet.voidReason ?? '已作废'
    : sheet.status === 'STALE'
      ? '签字后比赛结果又被改动（重排、清空成绩等），这份比分单不再代表当前结果'
      : `签字时间 ${formatTime(sheet.signedAt)}`;
  return <Tag color={tag.color} title={title}>{tag.label}</Tag>;
}

/** 某个赛事的签字开关和电子比分单列表。 */
export function useMatchSignatures(token: string | undefined, tournamentId: string) {
  const [enabled, setEnabled] = useState(false);
  const [sheets, setSheets] = useState<ScoreSheetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!token || !tournamentId) {
      setSheets([]);
      setEnabled(false);
      return;
    }
    setLoading(true);
    try {
      const [setting, list] = await Promise.all([
        apiFetch<{ requireMatchSignature: boolean }>(`/scoring/tournaments/${tournamentId}/signature-setting`, { token }),
        apiFetch<ScoreSheetSummary[]>(`/scoring/tournaments/${tournamentId}/score-sheets`, { token }),
      ]);
      setEnabled(setting.requireMatchSignature);
      setSheets(list);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载签字设置失败');
    } finally {
      setLoading(false);
    }
  }, [token, tournamentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback(async (next: boolean) => {
    if (!token || !tournamentId) return;
    setSaving(true);
    try {
      const result = await apiFetch<{ requireMatchSignature: boolean }>(
        `/scoring/tournaments/${tournamentId}/signature-setting`,
        { method: 'PATCH', token, body: JSON.stringify({ enabled: next }) },
      );
      setEnabled(result.requireMatchSignature);
      message.success(result.requireMatchSignature ? '已开启：比赛结束需胜方和裁判签字' : '已关闭比赛结束签字');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [token, tournamentId]);

  return { enabled, sheets, loading, saving, reload, update };
}

type MatchSignaturePanelProps = {
  token?: string;
  tournamentName?: string;
  signatures: ReturnType<typeof useMatchSignatures>;
  onView: (sheet: ScoreSheetSummary) => void;
};

/** 「裁判分配」页里的签字设置卡片：开关 + 本赛事全部电子比分单（含团体赛子项）。 */
export function MatchSignaturePanel({ tournamentName, signatures, onView }: MatchSignaturePanelProps) {
  const { enabled, sheets, loading, saving, reload, update } = signatures;
  const validCount = sheets.filter((sheet) => sheet.status === 'VALID').length;

  return (
    <Card
      style={{ marginBottom: 16 }}
      title={(
        <Space>
          <FileProtectOutlined />
          <span>比赛结束签字</span>
        </Space>
      )}
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>刷新</Button>}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[260px] flex-1">
          <Typography.Text strong>
            {tournamentName ? `「${tournamentName}」` : '本赛事'}比赛结束需胜方和裁判签字
          </Typography.Text>
          <div className="mt-1 text-sm text-slate-500">
            开启后，裁判端每结束一场比赛（含弃权、伤退、黑牌），都要先由胜方选手签字（双打两人中一人签），
            再由裁判签字，签完才能结束；签字和电子比分单保存在后台，只有有「裁判分配」权限的账号能查看。
            后台直接结束、改分不需要签字。
          </div>
        </div>
        <Popconfirm
          title={enabled ? '关闭比赛结束签字？' : '开启比赛结束签字？'}
          description={enabled
            ? '关闭后裁判端结束比赛不再需要签字，已保存的签字和比分单不受影响。'
            : '开启后裁判端结束比赛必须签字，已经结束的比赛不受影响。'}
          okText={enabled ? '关闭' : '开启'}
          cancelText="取消"
          onConfirm={() => update(!enabled)}
        >
          <Switch checked={enabled} loading={saving || loading} checkedChildren="需签字" unCheckedChildren="不需签字" />
        </Popconfirm>
      </div>

      <div className="mt-4">
        <Typography.Text type="secondary">
          已保存的电子比分单：有效 {validCount} 份，共 {sheets.length} 份（含作废）
        </Typography.Text>
        <Table
          style={{ marginTop: 8 }}
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={sheets}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有签字记录" /> }}
          scroll={{ x: 900 }}
          columns={[
            { title: '签字时间', dataIndex: 'signedAt', width: 170, render: (value: string) => formatTime(value) },
            {
              title: '项目 / 场次',
              render: (_, row: ScoreSheetSummary) => (
                <div>
                  <div>{row.eventLabel || '—'}</div>
                  <div className="text-xs text-slate-500">{row.matchLabel || row.roundLabel}</div>
                </div>
              ),
            },
            { title: '对阵', render: (_, row: ScoreSheetSummary) => `${row.side1Name} VS ${row.side2Name}` },
            {
              title: '结果',
              render: (_, row: ScoreSheetSummary) => (
                <div>
                  <div>{row.scoreText || '—'}</div>
                  <div className="text-xs text-slate-500">{row.endTypeLabel}{row.winnerName ? ` · 胜方 ${row.winnerName}` : ''}</div>
                </div>
              ),
            },
            {
              title: '签字人',
              render: (_, row: ScoreSheetSummary) => (
                <div className="text-xs">
                  <div>胜方：{row.winnerSide ? row.winnerSignerName ?? '—' : '无（双方弃权）'}</div>
                  <div>裁判：{row.refereeName}</div>
                </div>
              ),
            },
            { title: '状态', width: 90, render: (_, row: ScoreSheetSummary) => <ScoreSheetStatusTag sheet={row} /> },
            {
              title: '操作',
              width: 100,
              fixed: 'right',
              render: (_, row: ScoreSheetSummary) => <Button size="small" onClick={() => onView(row)}>比分单</Button>,
            },
          ]}
        />
      </div>
    </Card>
  );
}

type ScoreSheetViewerProps = {
  token?: string;
  /** 打开时要看的场次和比分单；sheetId 为空时显示该场最新的有效比分单。 */
  target: { matchId: string; sheetId?: string | null } | null;
  onClose: () => void;
};

/** 查看某场的电子比分单：图片、签名原图、签字信息、文件与指纹校验结果、历史版本。 */
export function ScoreSheetViewer({ token, target, onClose }: ScoreSheetViewerProps) {
  const [details, setDetails] = useState<ScoreSheetDetail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');

  useEffect(() => {
    if (!target || !token) {
      setDetails([]);
      setSelectedId(null);
      return;
    }
    let alive = true;
    setLoading(true);
    apiFetch<ScoreSheetDetail[]>(`/scoring/matches/${target.matchId}/score-sheets`, { token })
      .then((list) => {
        if (!alive) return;
        setDetails(list);
        const preferred = list.find((item) => item.id === target.sheetId)
          ?? list.find((item) => item.status === 'VALID')
          ?? list[0]
          ?? null;
        setSelectedId(preferred?.id ?? null);
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载比分单失败'))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [target, token]);

  const selected = useMemo(() => details.find((item) => item.id === selectedId) ?? null, [details, selectedId]);

  useEffect(() => {
    if (!selected || !token) {
      setImageUrl(null);
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    setImageLoading(true);
    setImageError('');
    apiBlob(`/scoring/matches/${selected.matchId}/score-sheets/${selected.id}/sheet`, { token })
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch((error) => {
        if (alive) setImageError(error instanceof Error ? error.message : '比分单图片加载失败');
      })
      .finally(() => {
        if (alive) setImageLoading(false);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected, token]);

  async function download(kind: 'sheet' | 'winner' | 'referee') {
    if (!selected || !token) return;
    try {
      const blob = await apiBlob(`/scoring/matches/${selected.matchId}/score-sheets/${selected.id}/${kind}`, { token });
      const url = URL.createObjectURL(blob);
      const label = kind === 'sheet' ? '比分单' : kind === 'winner' ? '胜方签名' : '裁判签名';
      const link = document.createElement('a');
      link.href = url;
      link.download = `${label}-${selected.side1Name}VS${selected.side2Name}-${dayjs(selected.signedAt).format('YYYYMMDDHHmm')}.png`
        .replace(/[\\/:*?"<>|\s]+/g, '');
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '下载失败');
    }
  }

  return (
    <Modal
      open={Boolean(target)}
      title="电子比分单"
      width="min(1000px, 96vw)"
      okText="关闭"
      cancelText="取消"
      onCancel={onClose}
      footer={[
        <Button key="winner" onClick={() => void download('winner')} disabled={!selected?.winnerSide}>胜方签名原图</Button>,
        <Button key="referee" onClick={() => void download('referee')} disabled={!selected}>裁判签名原图</Button>,
        <Button key="sheet" type="primary" icon={<DownloadOutlined />} onClick={() => void download('sheet')} disabled={!selected}>
          下载比分单
        </Button>,
        <Button key="close" onClick={onClose}>关闭</Button>,
      ]}
    >
      <Spin spinning={loading}>
        {!loading && !details.length ? <Empty description="本场没有签字记录" /> : null}
        {details.length > 1 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">本场共 {details.length} 份：</span>
            {details.map((item) => (
              <Button
                key={item.id}
                size="small"
                type={item.id === selectedId ? 'primary' : 'default'}
                onClick={() => setSelectedId(item.id)}
              >
                {formatTime(item.signedAt)} · {STATUS_TAGS[item.status].label}
              </Button>
            ))}
          </div>
        ) : null}
        {selected ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-h-[320px] rounded-lg border border-slate-200 bg-slate-50 p-2 text-center">
              {imageLoading ? <Spin style={{ marginTop: 120 }} /> : null}
              {!imageLoading && imageError ? <Alert type="error" showIcon title={imageError} /> : null}
              {!imageLoading && imageUrl ? (
                <Image src={imageUrl} alt="电子比分单" style={{ maxWidth: '100%' }} />
              ) : null}
            </div>
            <div className="space-y-3">
              {selected.integrity.ok ? (
                <Alert type="success" showIcon title="校验通过" description="签名图片、比分单图片和比分数据与签字时记录的指纹一致。" />
              ) : (
                <Alert
                  type="error"
                  showIcon
                  title="校验不通过"
                  description={<ul className="m-0 pl-4">{selected.integrity.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
                />
              )}
              {selected.status !== 'VALID' ? (
                <Alert
                  type="warning"
                  showIcon
                  title={selected.status === 'VOID' ? '这份比分单已作废' : '这份比分单已失效'}
                  description={selected.status === 'VOID'
                    ? `${selected.voidReason ?? ''}${selected.voidedAt ? `（${formatTime(selected.voidedAt)}）` : ''}`
                    : '签字后比赛结果又被改动（重排、清空成绩等），这份比分单不再代表当前结果。'}
                />
              ) : null}
              <Descriptions
                size="small"
                column={1}
                bordered
                items={[
                  { key: 'status', label: '状态', children: <ScoreSheetStatusTag sheet={selected} /> },
                  { key: 'end', label: '结束方式', children: selected.endTypeLabel },
                  { key: 'score', label: '比分', children: selected.scoreText || '—' },
                  { key: 'winner', label: '胜方', children: selected.winnerName ?? '无' },
                  {
                    key: 'winner-signer',
                    label: '胜方签字',
                    children: selected.winnerSide ? selected.winnerSignerName ?? '—' : '无（双方弃权）',
                  },
                  { key: 'referee', label: '裁判签字', children: selected.refereeName },
                  { key: 'signed-at', label: '签字时间', children: formatTime(selected.signedAt) },
                  {
                    key: 'device',
                    label: '提交设备',
                    children: (
                      <div className="text-xs">
                        <div>IP：{selected.clientIp ?? '—'}</div>
                        <div className="break-all text-slate-500">{selected.userAgent ?? '—'}</div>
                      </div>
                    ),
                  },
                  { key: 'id', label: '记录编号', children: <span className="break-all text-xs">{selected.id}</span> },
                  { key: 'hash', label: '指纹 SHA-256', children: <span className="break-all text-xs">{selected.contentHash}</span> },
                ]}
              />
            </div>
          </div>
        ) : null}
      </Spin>
    </Modal>
  );
}
