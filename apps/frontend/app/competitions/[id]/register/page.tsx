'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type Competition = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string | null;
  events?: string[];
  projects?: string[];
  registrationEndTime?: string | null;
  registrationStatus?: string;
};

type FormState = {
  name: string;
  studentId: string;
  className: string;
  phone: string;
  gender: 'MALE' | 'FEMALE';
  eventName: '男子单打' | '女子单打';
  remark: string;
};

const initialForm: FormState = {
  name: '',
  studentId: '',
  className: '',
  phone: '',
  gender: 'MALE',
  eventName: '男子单打',
  remark: '',
};

function formatDateTime(value?: string | null) {
  if (!value) return '待公布';
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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function CompetitionRegisterPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let alive = true;
    async function loadCompetition() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/competitions/${id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('赛事信息加载失败');
        const data = (await res.json()) as Competition;
        if (alive) setCompetition(data);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '赛事信息加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    }
    loadCompetition();
    return () => {
      alive = false;
    };
  }, [id]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    setSubmitting(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch(`${API_BASE}/competitions/${id}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? '报名提交失败');
      setMessage(data.message ?? '报名已提交，请等待管理员审核。审核通过后，你的信息将显示在参赛选手列表中。');
      setForm(initialForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : '报名提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  const projects = competition?.events?.length ? competition.events : competition?.projects;

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Registration"
      title="赛事报名"
      description="请确认赛事信息后提交报名。提交后会进入管理员审核列表，审核通过前不会出现在参赛选手列表中。"
    >
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-lg border border-blue-100 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black text-slate-950">当前赛事</h2>
            <Link href="/competitions" className="text-sm font-bold text-blue-700">
              返回赛事列表
            </Link>
          </div>
          {loading ? (
            <p className="text-sm font-semibold text-slate-500">赛事信息加载中...</p>
          ) : competition ? (
            <div className="space-y-4 text-sm font-semibold text-slate-600">
              <Info label="赛事名称" value={competition.title} />
              <Info label="比赛时间" value={`${formatDate(competition.startDate)} - ${formatDate(competition.endDate)}`} />
              <Info label="比赛地点" value={competition.location || '地点待公布'} />
              <Info label="比赛项目" value={projects?.join(' / ') || '项目待公布'} />
              <Info label="报名截止时间" value={formatDateTime(competition.registrationEndTime)} />
              <Info label="报名状态" value={competition.registrationStatus || '待公布'} />
            </div>
          ) : (
            <p className="text-sm font-semibold text-red-500">{error || '赛事不存在'}</p>
          )}
        </section>

        <section className="rounded-lg border border-blue-100 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-950">报名表单</h2>
          {message && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
              {message}
            </div>
          )}
          {error && !loading && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
              {error}
            </div>
          )}
          <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={submitRegistration}>
            <Field label="姓名">
              <input required value={form.name} onChange={(event) => updateField('name', event.target.value)} />
            </Field>
            <Field label="学号">
              <input required value={form.studentId} onChange={(event) => updateField('studentId', event.target.value)} />
            </Field>
            <Field label="班级">
              <input required value={form.className} onChange={(event) => updateField('className', event.target.value)} />
            </Field>
            <Field label="联系电话">
              <input required value={form.phone} onChange={(event) => updateField('phone', event.target.value)} />
            </Field>
            <Field label="性别">
              <select value={form.gender} onChange={(event) => updateField('gender', event.target.value as FormState['gender'])}>
                <option value="MALE">男</option>
                <option value="FEMALE">女</option>
              </select>
            </Field>
            <Field label="参赛项目">
              <select value={form.eventName} onChange={(event) => updateField('eventName', event.target.value as FormState['eventName'])}>
                <option value="男子单打">男子单打</option>
                <option value="女子单打">女子单打</option>
              </select>
            </Field>
            <Field label="备注" wide>
              <textarea
                rows={4}
                value={form.remark}
                onChange={(event) => updateField('remark', event.target.value)}
                placeholder="可填写特殊说明，非必填"
              />
            </Field>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={submitting || !competition}
                className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-blue-700 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 md:w-auto"
              >
                {submitting ? '提交中...' : '提交报名'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </PortalFeaturePage>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-blue-50 px-4 py-3">
      <p className="text-xs font-black text-blue-700">{label}</p>
      <p className="mt-1 text-slate-800">{value}</p>
    </div>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactElement;
}) {
  return (
    <label className={`block text-sm font-bold text-slate-700 ${wide ? 'md:col-span-2' : ''}`}>
      <span>{label}</span>
      <div className="mt-2 [&>input]:h-11 [&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-blue-100 [&>input]:px-3 [&>input]:outline-none [&>input]:transition [&>input:focus]:border-blue-500 [&>select]:h-11 [&>select]:w-full [&>select]:rounded-lg [&>select]:border [&>select]:border-blue-100 [&>select]:px-3 [&>select]:outline-none [&>select:focus]:border-blue-500 [&>textarea]:w-full [&>textarea]:rounded-lg [&>textarea]:border [&>textarea]:border-blue-100 [&>textarea]:p-3 [&>textarea]:outline-none [&>textarea:focus]:border-blue-500">
        {children}
      </div>
    </label>
  );
}
