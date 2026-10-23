'use client';

import { useState } from 'react';
import { Button, Popconfirm, Tooltip, message } from 'antd';
import { ClearOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';

export default function ClearResultsButton({ scope, id, token, disabled, onChanged }: {
  scope: 'event' | 'team'; id: string; token?: string; disabled?: boolean; onChanged: () => Promise<void>;
}) {
  const access = useCurrentAccess();
  const [busy, setBusy] = useState(false);
  const allowed = access.role === 'ROOT';
  async function clear() {
    if (busy || !allowed || !id || !token) return;
    setBusy(true);
    try {
      await apiFetch(`/${scope === 'team' ? 'team-competitions' : 'events'}/${id}/results/clear`, {
        method: 'POST', token, body: JSON.stringify({ confirm: true }),
      });
      message.success('全部成绩已作废，已撤回晋级；分组、对阵和排程已保留');
      await onChanged();
    } catch (error) { message.error(error instanceof Error ? error.message : '清除比分失败'); }
    finally { setBusy(false); }
  }
  const unavailable = !allowed || disabled || !id || busy;
  return <Tooltip title={allowed
    ? '丢弃当前项目的全部比分、胜负、弃权和排名，撤回由成绩产生的晋级，并释放裁判认领。保留分组、签表位置、场地和时间；裁判需重新接手，轮空仍按原签位处理。'
    : '仅超级管理员可清除比分并撤回晋级'}>
    <span><Popconfirm title="清除全部比分，保留对阵？"
      description="已得比分和比赛结果将全部作废，分组积分与排名归零，已晋级的队伍撤回，裁判需重新接手，无法撤销。"
      okText="丢弃全部成绩" cancelText="取消" okButtonProps={{ danger: true }}
      disabled={unavailable} onConfirm={clear}>
      <Button danger icon={<ClearOutlined />} loading={busy} disabled={unavailable}>清除比分，保留对阵</Button>
    </Popconfirm></span>
  </Tooltip>;
}
