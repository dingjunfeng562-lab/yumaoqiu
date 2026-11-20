'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Select, Space, Spin, Tag, Typography, message } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

export type DrawSwapOption = {
  key: string;
  label: string;
  entrantId?: string | null;
  teamId?: string | null;
  group?: string;
  groupId?: string;
  position?: number;
  slotCode?: string;
  roundNo?: number;
  matchNo?: number;
  side?: number;
};

export type DrawSwapScope = {
  scope: string;
  title: string;
  description: string;
  disabled: boolean;
  reason: string | null;
  options: DrawSwapOption[];
};

export type DrawSwapOptions = {
  canSwap: boolean;
  reason: string | null;
  drawId?: string | null;
  scopes: DrawSwapScope[];
};

/**
 * 换签位统一弹窗：签位列表由后端按赛制给出（单淘汰签位 / 小组位置 / A–H / 自动淘汰赛 / 团体赛），
 * 这里只负责选两个位置、预览、提交。提交时带上「当前看到的两侧 id」，后端据此做幂等与并发保护，
 * 因此双击不会出现交换两次互相抵消的问题。
 */
export function DrawSwapModal({
  open,
  token,
  optionsUrl,
  submitUrl,
  title = '换签位',
  description,
  onClose,
  onDone,
}: {
  open: boolean;
  token?: string;
  optionsUrl: string | null;
  submitUrl: string | null;
  title?: string;
  description?: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<DrawSwapOptions | null>(null);
  const [scopeKey, setScopeKey] = useState<string | undefined>(undefined);
  const [fromKey, setFromKey] = useState<string | undefined>(undefined);
  const [toKey, setToKey] = useState<string | undefined>(undefined);

  const reset = useCallback(() => {
    setFromKey(undefined);
    setToKey(undefined);
  }, []);

  const load = useCallback(async () => {
    if (!token || !optionsUrl) return;
    setLoading(true);
    try {
      const next = await apiFetch<DrawSwapOptions>(optionsUrl, { token });
      setData(next);
      const firstUsable = next.scopes.find((scope) => !scope.disabled && scope.options.length >= 2);
      setScopeKey(firstUsable?.scope ?? next.scopes[0]?.scope);
      reset();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载签位失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, optionsUrl, reset]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const scope = useMemo(
    () => data?.scopes.find((item) => item.scope === scopeKey) ?? data?.scopes[0] ?? null,
    [data, scopeKey],
  );
  const from = useMemo(() => scope?.options.find((item) => item.key === fromKey) ?? null, [scope, fromKey]);
  const to = useMemo(() => scope?.options.find((item) => item.key === toKey) ?? null, [scope, toKey]);
  const ready = Boolean(scope && !scope.disabled && from && to && from.key !== to.key);

  function changeScope(next: string) {
    setScopeKey(next);
    reset();
  }

  async function submit() {
    if (!ready || !submitUrl || submitting) return;
    setSubmitting(true);
    try {
      const payload = buildPayload(scope!.scope, data, from!, to!);
      const result = await apiFetch<{ changed?: boolean; message?: string }>(submitUrl, {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      if (result?.changed === false) {
        message.info(result.message ?? '两个位置已经是目标状态，无需再换');
      } else {
        message.success('签位已交换');
      }
      await onDone();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '签位交换失败');
    } finally {
      setSubmitting(false);
    }
  }

  const disabledReason = data && !data.canSwap ? data.reason : null;

  return (
    <Modal
      title={title}
      open={open}
      onOk={submit}
      onCancel={() => {
        if (submitting) return;
        onClose();
      }}
      okText="确认交换"
      cancelText="取消"
      okButtonProps={{ disabled: !ready, loading: submitting }}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="选择两个签位互换，交换后对阵原地更新"
            description={
              description ??
              '只换人，不动场次：已经排好的场地、时间、裁判和比分记录都会保留。双击不会重复提交。'
            }
          />
          {disabledReason ? <Alert type="warning" showIcon message={disabledReason} /> : null}

          {data && data.scopes.length > 1 ? (
            <Space wrap size={8}>
              {data.scopes.map((item) => (
                <Tag.CheckableTag
                  key={item.scope}
                  checked={item.scope === scopeKey}
                  onChange={() => changeScope(item.scope)}
                >
                  {item.title}
                </Tag.CheckableTag>
              ))}
            </Space>
          ) : null}

          {scope ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {scope.description}
              {scope.disabled && scope.reason ? `（${scope.reason}）` : ''}
            </Typography.Text>
          ) : null}

          <Select
            showSearch
            optionFilterProp="label"
            value={fromKey}
            onChange={(value) => {
              setFromKey(value);
              if (value === toKey) setToKey(undefined);
            }}
            placeholder="选择第一个签位"
            style={{ width: '100%' }}
            disabled={!scope || scope.disabled}
            options={(scope?.options ?? [])
              .filter((option) => option.key !== toKey)
              .map((option) => ({ value: option.key, label: option.label }))}
          />
          <SwapOutlined style={{ alignSelf: 'center', color: '#d48806', fontSize: 20 }} />
          <Select
            showSearch
            optionFilterProp="label"
            value={toKey}
            onChange={(value) => {
              setToKey(value);
              if (value === fromKey) setFromKey(undefined);
            }}
            placeholder="选择第二个签位"
            style={{ width: '100%' }}
            disabled={!scope || scope.disabled}
            options={(scope?.options ?? [])
              .filter((option) => option.key !== fromKey)
              .map((option) => ({ value: option.key, label: option.label }))}
          />

          {from && to ? (
            <Alert
              type="success"
              showIcon
              message={`${from.label}  ⇄  ${to.label}`}
              description={swapHint(scope?.scope ?? '')}
            />
          ) : null}
        </Space>
      </Spin>
    </Modal>
  );
}

function swapHint(scope: string) {
  switch (scope) {
    case 'GROUP':
      return '两人所在小组对调，只重排这两个小组的组内循环对阵；同组内换位不影响对阵。';
    case 'SECOND_STAGE':
      return 'A–H 签位对调后会重算第二阶段对阵，已排定的场次 id 与排程保持不变。';
    case 'KNOCKOUT_SIDE':
      return '换首轮位置后，后续轮次的晋级关系会按新签位重算；已开赛的场次不允许交换。';
    case 'TEAM_SLOT':
      return '团体淘汰赛首轮位置对调，轮空位会跟着签位走。';
    case 'TEAM_GROUP':
      return '两支队伍所在小组对调，只重排这两个小组的小组赛对阵。';
    default:
      return '交换后立即更新当前对阵，确认无误后再发布。';
  }
}

function buildPayload(scope: string, data: DrawSwapOptions | null, from: DrawSwapOption, to: DrawSwapOption) {
  const drawId = data?.drawId ?? undefined;
  switch (scope) {
    case 'GROUP':
      return {
        scope,
        drawId,
        fromGroupCode: from.group,
        toGroupCode: to.group,
        fromEntrantId: from.entrantId,
        toEntrantId: to.entrantId,
        expectFromId: from.entrantId,
        expectToId: to.entrantId,
      };
    case 'SECOND_STAGE':
      return {
        scope,
        fromSlot: from.slotCode,
        toSlot: to.slotCode,
        expectFromId: from.entrantId,
        expectToId: to.entrantId,
      };
    case 'KNOCKOUT_SIDE':
      return {
        scope,
        drawId,
        fromRoundNo: from.roundNo,
        fromMatchNo: from.matchNo,
        fromSide: from.side,
        toRoundNo: to.roundNo,
        toMatchNo: to.matchNo,
        toSide: to.side,
        expectFromId: from.entrantId,
        expectToId: to.entrantId,
      };
    case 'TEAM_SLOT':
      return {
        scope,
        fromRoundNo: from.roundNo,
        fromMatchNo: from.matchNo,
        fromSide: from.side,
        toRoundNo: to.roundNo,
        toMatchNo: to.matchNo,
        toSide: to.side,
        expectFromId: from.teamId,
        expectToId: to.teamId,
      };
    case 'TEAM_GROUP':
      return {
        scope,
        fromTeamId: from.teamId,
        toTeamId: to.teamId,
        // 小组位置用「队伍当前所在小组」做幂等比对：重复提交会被识别为已是目标状态。
        expectFromId: from.groupId,
        expectToId: to.groupId,
      };
    default:
      return {
        scope: 'SLOT',
        drawId,
        positionA: from.position,
        positionB: to.position,
        expectFromId: from.entrantId,
        expectToId: to.entrantId,
      };
  }
}
