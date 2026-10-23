'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Button, Input, Modal, Popconfirm, Space, Tooltip, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';
import ClearResultsButton from './ClearResultsButton';

type ClearRequest = { id: string; status: string; reason?: string | null; requesterId: string; requesterNameSnapshot?: string | null };
type Progress = { id: string; teamMatches: Array<{ matches: Array<{ status: string; startedAt?: string | null; games: unknown[] }> }> };

/** Shared by team detail and draw scheduling so cancellation/approval rules stay identical. */
export default function TeamDrawActions({ competitionId, token, hasDraw, disabled, revision, onChanged }: {
  competitionId: string; token?: string; hasDraw: boolean; disabled?: boolean; revision?: unknown; onChanged: () => Promise<void>;
}) {
  const { data: session } = useSession();
  const access = useCurrentAccess();
  const isRoot = access.role === 'ROOT';
  const version = useRef(0);
  const [snapshot, setSnapshot] = useState<{ progress: Progress; requests: ClearRequest[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [remark, setRemark] = useState('');
  const load = useCallback(async () => {
    const current = ++version.current;
    if (!token || !hasDraw) { setSnapshot(null); return; }
    try {
      const [progress, requests] = await Promise.all([
        apiFetch<Progress>(`/team-competitions/${competitionId}`, { token }),
        apiFetch<ClearRequest[]>(`/team-competitions/${competitionId}/draw/clear-requests`, { token }),
      ]);
      if (current === version.current) { setSnapshot({ progress, requests }); setError(''); }
    } catch (failure) {
      if (current === version.current) { setSnapshot(null); setError(failure instanceof Error ? failure.message : '加载取消申请失败'); }
    }
  }, [competitionId, token, hasDraw]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setRequestOpen(false); setDecision(null); void load(); }, 0);
    return () => { window.clearTimeout(timer); };
  }, [load, revision]);
  async function run(path: string, body: unknown, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/team-competitions/${competitionId}/${path}`, { method: 'POST', token, body: JSON.stringify(body) });
      message.success(success); setRequestOpen(false); setDecision(null);
      await onChanged(); await load();
    } catch (failure) { message.error(failure instanceof Error ? failure.message : '操作失败'); }
    finally { setBusy(false); }
  }
  if (!hasDraw) return null;
  const current = snapshot?.progress.id === competitionId ? snapshot : null;
  const pending = current?.requests.find(request => request.status === 'PENDING');
  const started = current?.progress.teamMatches.some(encounter => encounter.matches.some(match => match.status !== 'PENDING' || match.startedAt || match.games.length));
  const blocked = disabled || busy || !current;
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Space wrap>
      {pending ? <Tooltip title="已有待审批的取消申请"><Button danger icon={<DeleteOutlined />} disabled>取消对阵</Button></Tooltip>
        : started && !isRoot
          ? <Button danger icon={<DeleteOutlined />} disabled={blocked} onClick={() => { setReason(''); setRequestOpen(true); }}>申请取消对阵</Button>
          : <Popconfirm title="清空抽签、对阵、赛前名单和成绩，并取消公开？" description="队伍名单和赛制配置保留，清空后无法撤销。" okText="清空" cancelText="取消" disabled={blocked}
            onConfirm={() => run('draw/clear', {}, '已取消对阵，可调整队伍后重新生成')}>
            <Button danger icon={<DeleteOutlined />} loading={busy} disabled={blocked}>取消对阵</Button>
          </Popconfirm>}
      <ClearResultsButton scope="team" id={competitionId} token={token} disabled={disabled || busy} onChanged={async () => { await onChanged(); await load(); }} />
    </Space>
    {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={load}>重试</Button>} />}
    {pending && <Alert type="warning" showIcon title={isRoot ? '有待审批的取消对阵申请' : '取消对阵申请待超级管理员审批'}
      description={`提交人：${pending.requesterNameSnapshot ?? '管理员'}${pending.reason ? `；理由：${pending.reason}` : ''}`}
      action={isRoot ? <Space>
        <Button size="small" type="primary" disabled={blocked} onClick={() => { setRemark(''); setDecision('approve'); }}>通过并清空</Button>
        <Button size="small" disabled={blocked} onClick={() => { setRemark(''); setDecision('reject'); }}>驳回</Button>
      </Space> : pending.requesterId === session?.user?.id
        ? <Button size="small" disabled={blocked} onClick={() => run(`draw/clear-requests/${pending.id}/cancel`, {}, '已撤回取消申请')}>撤回申请</Button> : null} />}
    <Modal title="申请取消对阵" open={requestOpen} onCancel={() => setRequestOpen(false)} okText="提交申请" cancelText="取消" confirmLoading={busy}
      onOk={() => run('draw/clear-request', { reason }, '已提交取消申请，等待超级管理员审批')}>
      <Alert type="warning" showIcon title="审批通过后，将清空全部对阵、赛前名单和比赛结果，并取消公开。" style={{ marginBottom: 12 }} />
      <Input.TextArea aria-label="取消原因" rows={4} maxLength={500} showCount value={reason} onChange={event => setReason(event.target.value)} placeholder="请说明取消原因" />
    </Modal>
    <Modal title={decision === 'approve' ? '通过取消申请？' : '驳回取消申请？'} open={Boolean(decision)} onCancel={() => setDecision(null)}
      okText={decision === 'approve' ? '通过并清空' : '驳回'} cancelText="取消" confirmLoading={busy} okButtonProps={{ danger: decision === 'approve' }}
      onOk={() => pending && decision && run(`draw/clear-requests/${pending.id}/${decision}`, { reason: remark }, decision === 'approve' ? '已通过申请并清空对阵' : '已驳回取消申请')}>
      <Alert type="warning" showIcon title={decision === 'approve' ? '全部对阵、赛前名单和比赛结果将被清空，并取消公开，无法撤销。' : '驳回后申请关闭，可重新提交。'} style={{ marginBottom: 12 }} />
      <Input.TextArea aria-label="审批备注" rows={3} maxLength={500} showCount value={remark} onChange={event => setRemark(event.target.value)} placeholder="审批备注（可选）" />
    </Modal>
  </Space>;
}
