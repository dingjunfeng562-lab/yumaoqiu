'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/home/Header';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type MyRegistration = {
  id: string;
  studentId: string;
  name: string;
  school?: string;
  contact?: string;
  remark?: string;
  genderLabel: string;
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  statusLabel: string;
  rejectReason?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  eventSummary: string;
  items: Array<{
    eventName: string;
    partnerName?: string | null;
    partnerStudentId?: string | null;
    partnerClassName?: string | null;
  }>;
  competition: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    location?: string | null;
  };
};

const STATUS_META: Record<MyRegistration['status'], { label: string; tone: string }> = {
  pending: { label: '待审核', tone: 'bg-amber-100 text-amber-700' },
  approved: { label: '已通过', tone: 'bg-green-100 text-green-700' },
  rejected: { label: '已驳回', tone: 'bg-red-100 text-red-700' },
  removed: { label: '已移除', tone: 'bg-slate-200 text-slate-600' },
};

function formatDate(value?: string | null) {
  if (!value) return '待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MyRegistrationsPage() {
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const role = (session?.user as { role?: string } | undefined)?.role;

  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let alive = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/competitions/me/registrations`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('加载失败');
        const data = (await res.json()) as MyRegistration[];
        if (alive) setRegistrations(data);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [token]);

  if (status === 'loading') {
    return (
      <main className="min-h-screen bg-[#f5f8ff]">
        <Header activeHref="/my-registrations" />
        <div className="mx-auto max-w-[1100px] px-4 py-10 text-sm font-semibold text-slate-500">
          加载中...
        </div>
      </main>
    );
  }

  if (role && role !== 'PLAYER') {
    return (
      <main className="min-h-screen bg-[#f5f8ff]">
        <Header activeHref="/my-registrations" />
        <div className="mx-auto max-w-[800px] px-4 py-10">
          <div className="rounded-xl border border-blue-100 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-black text-slate-900">仅选手账号可访问"我的报名"</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              当前账号角色为 {role},请使用选手账号登录后查看本人报名信息。
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f8ff]">
      <Header activeHref="/my-registrations" />
      <section className="relative overflow-hidden bg-[#04163f] px-4 py-9 text-white sm:px-6 sm:py-12 lg:px-8 lg:py-14">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(2,11,39,0.98),rgba(4,50,123,0.88)_48%,rgba(2,12,42,0.98))]" />
        <div className="relative z-10 mx-auto max-w-[1100px]">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-100 sm:text-xs">My Registrations</p>
          <h1 className="mt-2 text-2xl font-black leading-tight sm:mt-3 sm:text-3xl md:text-4xl">我的报名</h1>
          <p className="mt-3 max-w-2xl text-[13px] font-semibold leading-6 text-blue-50/78 sm:mt-4 sm:text-sm md:text-base">
            这里仅展示你本人提交的报名信息。审核通过后即可在赛事的参赛选手列表中看到自己。
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {loading ? (
          <div className="rounded-xl border border-blue-100 bg-white p-10 text-center text-sm font-semibold text-slate-500 shadow-sm">
            加载中...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-10 text-center text-sm font-bold text-red-600 shadow-sm">
            {error}
          </div>
        ) : registrations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-blue-200 bg-white p-12 text-center shadow-sm">
            <h2 className="text-lg font-black text-slate-900">还没有任何报名记录</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              在赛事列表选择一个赛事即可报名。
            </p>
            <Link
              href="/competitions"
              className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-amber-400 px-5 text-sm font-black text-white shadow-sm transition hover:bg-amber-500"
            >
              去赛事列表 →
            </Link>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-5">
            {registrations.map((registration) => {
              const meta = STATUS_META[registration.status];
              return (
                <article
                  key={registration.id}
                  className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm"
                >
                  <header className="flex flex-wrap items-start justify-between gap-3 border-b border-blue-50 px-5 py-4">
                    <div className="min-w-0">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-black ${meta.tone}`}>
                        {meta.label}
                      </span>
                      <h2 className="mt-2 text-lg font-black text-slate-900 sm:text-xl">
                        {registration.competition.title}
                      </h2>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {formatDate(registration.competition.startDate)} - {formatDate(registration.competition.endDate)}
                        {registration.competition.location ? ` · ${registration.competition.location}` : ''}
                      </p>
                    </div>
                    <Link
                      href={`/competitions/${registration.competition.id}`}
                      className="text-xs font-black text-blue-700 transition hover:text-blue-900"
                    >
                      查看赛事详情 →
                    </Link>
                  </header>

                  <dl className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Fact label="姓名">{registration.name}</Fact>
                    <Fact label="性别">{registration.genderLabel}</Fact>
                    <Fact label="学校">{registration.school || '未填写'}</Fact>
                    <Fact label="学号">{registration.studentId}</Fact>
                    <Fact label="联系方式">{registration.contact || '未填写'}</Fact>
                    <Fact label="提交时间">{formatDateTime(registration.createdAt)}</Fact>
                  </dl>

                  <div className="border-t border-blue-50 px-5 py-4">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">报名项目</p>
                    <ul className="mt-2 space-y-1.5 text-sm font-semibold text-slate-700">
                      {registration.items.map((item, index) => (
                        <li key={`${registration.id}-${index}`} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-slate-900">{item.eventName}</span>
                          {item.partnerName ? (
                            <span className="text-slate-500">
                              · 搭档 {item.partnerName}({item.partnerStudentId || '学号未填'})
                              {item.partnerClassName ? ` · 学院班级：${item.partnerClassName}` : ''}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {registration.status === 'rejected' && registration.rejectReason ? (
                    <div className="border-t border-blue-50 bg-red-50/60 px-5 py-3 text-xs font-bold text-red-700">
                      驳回原因:{registration.rejectReason}
                    </div>
                  ) : null}

                  {registration.status === 'rejected' ? (
                    <div className="border-t border-blue-50 px-5 py-3 text-right">
                      <Link
                        href={`/competitions/${registration.competition.id}/register`}
                        className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-800"
                      >
                        修改并重新提交
                      </Link>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-blue-50/50 px-3 py-2.5">
      <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-bold text-slate-900">{children}</dd>
    </div>
  );
}
