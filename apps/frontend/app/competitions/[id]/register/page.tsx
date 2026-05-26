'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type EventType = 'MENS_SINGLES' | 'WOMENS_SINGLES' | 'MENS_DOUBLES' | 'WOMENS_DOUBLES' | 'MIXED_DOUBLES';

type EventOption = {
  id: string;
  type: EventType;
  label: string;
  isDouble: boolean;
};

const DOUBLE_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  'MENS_DOUBLES',
  'WOMENS_DOUBLES',
  'MIXED_DOUBLES',
]);

function isDoubleOption(option: EventOption | undefined): boolean {
  if (!option) return false;
  if (typeof option.isDouble === 'boolean') return option.isDouble;
  return DOUBLE_EVENT_TYPES.has(option.type);
}

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
  eventOptions?: EventOption[];
};

type ExistingRegistration = {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  statusLabel: string;
  rejectReason?: string | null;
  studentId: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  school?: string | null;
  className?: string | null;
  phone?: string;
  remark?: string;
  items: Array<{
    eventId: string;
    eventName: string;
    partnerName?: string | null;
    partnerStudentId?: string | null;
    teamName?: string | null;
  }>;
};

type ItemState = {
  eventId: string;
  partnerName: string;
  partnerStudentId: string;
  teamName: string;
};

type FormState = {
  studentId: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  school: string;
  className: string;
  contact: string;
  remark: string;
  items: ItemState[];
};

const initialForm: FormState = {
  studentId: '',
  name: '',
  gender: 'MALE',
  school: '',
  className: '',
  contact: '',
  remark: '',
  items: [{ eventId: '', partnerName: '', partnerStudentId: '', teamName: '' }],
};

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

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
  const router = useRouter();
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [existing, setExisting] = useState<ExistingRegistration | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [router, status]);

  useEffect(() => {
    if (!id || !token) return;
    let alive = true;
    async function loadData() {
      setLoading(true);
      setError('');
      try {
        const [competitionRes, registrationRes] = await Promise.all([
          fetch(`${API_BASE}/competitions/${id}`, { cache: 'no-store' }),
          fetch(`${API_BASE}/competitions/${id}/registration/me`, {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        if (!competitionRes.ok) throw new Error('赛事信息加载失败');
        const competitionData = (await parseJsonSafe<Competition>(competitionRes)) as Competition;
        const registrationData = registrationRes.ok
          ? await parseJsonSafe<ExistingRegistration>(registrationRes)
          : null;
        if (!alive) return;
        setCompetition(competitionData);
        setExisting(registrationData);
        if (registrationData) {
          setForm({
            studentId: registrationData.studentId,
            name: registrationData.name,
            gender: registrationData.gender,
            school: registrationData.school ?? '',
            className: registrationData.className ?? '',
            contact: registrationData.phone ?? '',
            remark: registrationData.remark ?? '',
            items: registrationData.items.length
              ? registrationData.items.map((item) => ({
                  eventId: item.eventId,
                  partnerName: item.partnerName ?? '',
                  partnerStudentId: item.partnerStudentId ?? '',
                  teamName: item.teamName ?? '',
                }))
              : initialForm.items,
          });
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '赛事信息加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    }
    loadData();
    return () => {
      alive = false;
    };
  }, [id, token]);

  const eventOptions = competition?.eventOptions ?? [];
  const selectedEventIds = useMemo(() => form.items.map((item) => item.eventId).filter(Boolean), [form.items]);
  const existingLocked = existing?.status === 'pending' || existing?.status === 'approved';

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateItem(index: number, patch: Partial<ItemState>) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  }

  function addItem() {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { eventId: '', partnerName: '', partnerStudentId: '', teamName: '' }],
    }));
  }

  function removeItem(index: number) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function submitRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !token) return;
    setSubmitting(true);
    setMessage('');
    setError('');
    try {
      const payload = {
        studentId: form.studentId,
        name: form.name,
        gender: form.gender,
        school: form.school.trim(),
        className: form.className.trim() || undefined,
        contact: form.contact,
        remark: form.remark,
        items: form.items.map((item) => ({
          eventId: item.eventId,
          partnerName: item.partnerName || undefined,
          partnerStudentId: item.partnerStudentId || undefined,
          teamName: item.teamName || undefined,
        })),
      };
      const res = await fetch(`${API_BASE}/competitions/${id}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? '报名提交失败');
      setMessage(data.message ?? '报名已提交，请等待管理员审核。');
      setExisting(data.registration ?? null);
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
      description="登录后的普通用户可提交一次报名，待审核或已通过状态下不能重复提交，被驳回后可修改并重新提交。"
    >
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3 sm:mb-5">
            <h2 className="text-lg font-black text-slate-950 sm:text-xl">当前赛事</h2>
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
              {existing ? <Info label="我的报名状态" value={existing.statusLabel} /> : null}
            </div>
          ) : (
            <p className="text-sm font-semibold text-red-500">{error || '赛事不存在'}</p>
          )}
        </section>

        <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-black text-slate-950 sm:text-xl">报名表单</h2>
          {message && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
              {message}
            </div>
          )}
          {existing?.rejectReason ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
              驳回原因：{existing.rejectReason}
            </div>
          ) : null}
          {error && !loading && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
              {error}
            </div>
          )}
          <form className="mt-5 grid gap-4" onSubmit={submitRegistration}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="学号">
                <input required disabled={existingLocked} value={form.studentId} onChange={(event) => updateField('studentId', event.target.value)} />
              </Field>
              <Field label="姓名">
                <input required disabled={existingLocked} value={form.name} onChange={(event) => updateField('name', event.target.value)} />
              </Field>
              <Field label="性别">
                <select disabled={existingLocked} value={form.gender} onChange={(event) => updateField('gender', event.target.value as FormState['gender'])}>
                  <option value="MALE">男</option>
                  <option value="FEMALE">女</option>
                </select>
              </Field>
              <Field label="学校(完整名称)" wide>
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  disabled={existingLocked}
                  value={form.school}
                  onChange={(event) => updateField('school', event.target.value)}
                  placeholder="例如:武汉大学、华中科技大学经济学院"
                />
              </Field>
              <Field label="学院班级" wide>
                <input
                  maxLength={120}
                  disabled={existingLocked}
                  value={form.className}
                  onChange={(event) => updateField('className', event.target.value)}
                  placeholder="例如:健康产业学院社会体育2班"
                />
              </Field>
              <Field label="联系方式">
                <input value={form.contact} onChange={(event) => updateField('contact', event.target.value)} />
              </Field>
              <Field label="备注" wide>
                <textarea rows={3} value={form.remark} onChange={(event) => updateField('remark', event.target.value)} placeholder="可填写特殊说明，非必填" />
              </Field>
            </div>

            <div className="space-y-4 rounded-lg border border-blue-100 bg-blue-50/40 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900">报名项目</h3>
                <button
                  type="button"
                  onClick={addItem}
                  disabled={form.items.length >= 2 || existingLocked}
                  className="tappable inline-flex h-10 min-h-[44px] items-center rounded-lg border border-blue-200 px-3 text-sm font-black text-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  新增项目
                </button>
              </div>
              {form.items.map((item, index) => {
                const selectedOption = eventOptions.find((option) => option.id === item.eventId);
                const isDouble = isDoubleOption(selectedOption);
                return (
                  <div key={`${index}-${item.eventId}`} className="grid gap-4 rounded-lg border border-white bg-white p-4 md:grid-cols-2">
                    <Field label={`项目 ${index + 1}`}>
                      <select
                        required
                        disabled={existingLocked}
                        value={item.eventId}
                        onChange={(event) => updateItem(index, { eventId: event.target.value, partnerName: '', partnerStudentId: '', teamName: '' })}
                      >
                        <option value="">请选择项目</option>
                        {eventOptions.map((option) => (
                          <option
                            key={option.id}
                            value={option.id}
                            disabled={selectedEventIds.includes(option.id) && option.id !== item.eventId}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="flex items-end justify-end">
                      {form.items.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          disabled={existingLocked}
                          className="tappable inline-flex h-11 min-h-[44px] w-full items-center justify-center rounded-lg border border-red-200 px-3 text-sm font-black text-red-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 md:w-auto"
                        >
                          删除该项目
                        </button>
                      ) : null}
                    </div>
                    {selectedOption ? (
                      isDouble ? (
                        <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                          <p className="mb-3 text-sm font-black text-blue-800">
                            双打项目 · 请填写队伍名称与搭档信息（共 2 人参赛）
                          </p>
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label="队伍名称" wide>
                              <input
                                required
                                maxLength={60}
                                disabled={existingLocked}
                                value={item.teamName}
                                onChange={(event) => updateItem(index, { teamName: event.target.value })}
                                placeholder="例如：极速搭档、AOE 战队"
                              />
                            </Field>
                            <Field label="搭档姓名">
                              <input
                                required
                                disabled={existingLocked}
                                value={item.partnerName}
                                onChange={(event) => updateItem(index, { partnerName: event.target.value })}
                                placeholder="请填写搭档姓名"
                              />
                            </Field>
                            <Field label="搭档学号">
                              <input
                                required
                                disabled={existingLocked}
                                value={item.partnerStudentId}
                                onChange={(event) => updateItem(index, { partnerStudentId: event.target.value })}
                                placeholder="请填写搭档学号"
                              />
                            </Field>
                          </div>
                        </div>
                      ) : (
                        <p className="md:col-span-2 text-xs font-bold text-slate-500">
                          单打项目 · 仅需填写本人信息
                        </p>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={submitting || !competition || existingLocked}
                className="tappable inline-flex h-12 min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-700 px-5 text-base font-black text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 md:h-11 md:w-auto md:text-sm"
              >
                {existing?.status === 'rejected' ? (submitting ? '重新提交中...' : '重新提交报名') : submitting ? '提交中...' : '提交报名'}
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
  children: React.ReactNode;
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
