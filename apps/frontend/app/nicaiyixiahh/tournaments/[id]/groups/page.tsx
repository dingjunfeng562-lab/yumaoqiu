'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Alert, Card, Space, Typography } from 'antd';
import { apiFetch } from '@/lib/api';
import { RegistrationGroupsManager, type GroupsTournamentMeta } from '@/components/admin/RegistrationGroupsManager';

export default function RegistrationGroupsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  // 二维码海报要印赛事名、年龄参照日期默认取赛事开始日；读不到时不影响组别设置。
  const [tournament, setTournament] = useState<GroupsTournamentMeta | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<GroupsTournamentMeta>(`/tournaments/${id}`, { token })
      .then((data) => { if (!cancelled) setTournament(data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [id, token]);

  return (
    <div className="space-y-5">
      <Space wrap>
        <Link href="/nicaiyixiahh/tournaments">返回赛事管理</Link>
        <Typography.Title level={3} style={{ margin: 0 }}>参赛组别</Typography.Title>
        {tournament ? <Typography.Text type="secondary">{tournament.name}</Typography.Text> : null}
      </Space>
      <Alert
        type="info"
        showIcon
        title="按赛事规程设置组别"
        description="一个赛事一个报名码，报名人扫码后自己选组别。每个组别依次设置：组别和年龄要求 → 比赛项目 → 报名字段 → 报名设置。年龄可按年龄填写（U8 = 未满 9 岁），系统自动推算出生日期范围。U7-U10 可作为一个组，若需四个年龄独立抽签，请分别新增四个组。"
      />
      <Card>
        <RegistrationGroupsManager tournamentId={id} token={token} tournament={tournament} />
      </Card>
    </div>
  );
}
