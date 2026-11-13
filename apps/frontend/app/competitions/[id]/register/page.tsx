'use client';

import Link from 'next/link';
import GroupRegistrationForm, { GroupPicker } from '@/components/registration/GroupRegistrationForm';
import type { RegistrationGroupInfo } from '@/lib/registration-groups';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { RegistrationIntro, type RegistrationIntroInfo } from '@/components/registration/RegistrationIntro';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type EventType = 'MENS_SINGLES' | 'WOMENS_SINGLES' | 'MENS_DOUBLES' | 'WOMENS_DOUBLES' | 'MIXED_DOUBLES';

type EventOption = {
  id: string;
  type: EventType;
  label: string;
  isDouble: boolean;
  entrantType?: 'SCHOOL' | 'SOCIAL';
  groupLabel?: string | null;
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
  maxRegistrationEvents?: number;
  allowCrossEventRegistration?: boolean;
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
  college?: string | null;
  majorGrade?: string | null;
  className?: string | null;
  phone?: string;
  remark?: string;
  items: Array<{
    eventId: string;
    eventName: string;
    partnerName?: string | null;
    partnerGender?: 'MALE' | 'FEMALE' | null;
    partnerStudentId?: string | null;
    partnerSchool?: string | null;
    partnerClassName?: string | null;
    partnerContact?: string | null;
    teamName?: string | null;
  }>;
};

type ItemState = {
  eventId: string;
  partnerName: string;
  partnerGender: 'MALE' | 'FEMALE' | '';
  partnerStudentId: string;
  partnerSchool: string;
  partnerClassName: string;
  partnerContact: string;
  teamName: string;
};

type FormState = {
  studentId: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  school: string;
  college: string;
  majorGrade: string;
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
  college: '',
  majorGrade: '',
  className: '',
  contact: '',
  remark: '',
  items: [{ eventId: '', partnerName: '', partnerGender: '', partnerStudentId: '', partnerSchool: '', partnerClassName: '', partnerContact: '', teamName: '' }],
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

function genderOptionsForPrimary(option?: EventOption) {
  if (option?.type === 'MENS_SINGLES' || option?.type === 'MENS_DOUBLES') return [{ value: 'MALE', label: '男' }];
  if (option?.type === 'WOMENS_SINGLES' || option?.type === 'WOMENS_DOUBLES') return [{ value: 'FEMALE', label: '女' }];
  return [
    { value: 'MALE', label: '男' },
    { value: 'FEMALE', label: '女' },
  ];
}

function genderOptionsForPartner(option: EventOption | undefined, primaryGender: FormState['gender']) {
  if (option?.type === 'MENS_DOUBLES') return [{ value: 'MALE', label: '男' }];
  if (option?.type === 'WOMENS_DOUBLES') return [{ value: 'FEMALE', label: '女' }];
  if (option?.type === 'MIXED_DOUBLES') {
    return primaryGender === 'MALE'
      ? [{ value: 'FEMALE', label: '女' }]
      : [{ value: 'MALE', label: '男' }];
  }
  return [
    { value: 'MALE', label: '男' },
    { value: 'FEMALE', label: '女' },
  ];
}

/** 用后端返回的报名记录回填表单：进入页面时，以及提交/追加成功后显示实际登记的内容。 */
function formFromRegistration(registration: ExistingRegistration): FormState {
  return {
    studentId: registration.studentId,
    name: registration.name,
    gender: registration.gender,
    school: registration.school ?? '',
    college: registration.college ?? registration.className ?? '',
    majorGrade: registration.majorGrade ?? '',
    className: registration.className ?? '',
    contact: registration.phone ?? '',
    remark: registration.remark ?? '',
    items: registration.items.length
      ? registration.items.map((item) => ({
          eventId: item.eventId,
          partnerName: item.partnerName ?? '',
          partnerGender: item.partnerGender ?? '',
          partnerStudentId: item.partnerStudentId ?? '',
          partnerSchool: item.partnerSchool ?? '',
          partnerClassName: item.partnerClassName ?? '',
          partnerContact: item.partnerContact ?? '',
          teamName: item.teamName ?? '',
        }))
      : initialForm.items,
  };
}

/** 报名码对应赛事里开放报名的一个组别。 */
type CodeGroup = Pick<RegistrationGroupInfo, 'groupId' | 'groupName' | 'fieldTemplate' | 'groupFields' | 'ageRule' | 'ageRuleLabel' | 'events' | 'payment' | 'maxEntrants' | 'remaining'>;

type RegistrationCodeInfo = RegistrationIntroInfo & Partial<RegistrationGroupInfo> & {
  tournamentId: string;
  // 一个赛事一个报名码：扫码后在这些组别里选；扫旧的组别码时预选该组。
  groups?: CodeGroup[];
  preselectedGroupId?: string | null;
  entrantType: 'SCHOOL' | 'SOCIAL';
  loginRequired: boolean;
  fieldRules?: {
    SCHOOL?: { studentId?: string; college?: string; majorGrade?: string };
  };
  events: Array<{ id: string; type: string; label: string; isDouble: boolean }>;
};

/** 免审核且本组别收费时，报名一提交就是已通过状态，直接进入缴费页。 */
function paymentPageAfterSubmit(
  competitionId: string,
  codeInfo: { payment?: unknown },
  registrationStatus: string | undefined,
  guestToken?: string | null,
) {
  if (!codeInfo.payment || registrationStatus !== 'approved') return null;
  return `/competitions/${competitionId}/payment${guestToken ? `?token=${encodeURIComponent(guestToken)}` : ''}`;
}

/** 简介页按「一个赛事多个组别」展示：组别数、全部项目、各组收费说明。 */
function introInfo(info: RegistrationCodeInfo): RegistrationIntroInfo {
  const groups = info.groups ?? [];
  if (!groups.length) return info;
  if (groups.length === 1) {
    return { ...info, entrantTypeLabel: groups[0].groupName, events: groups[0].events, payment: groups[0].payment ?? null };
  }
  return {
    ...info,
    entrantTypeLabel: `共 ${groups.length} 个组别`,
    eventsTitle: '比赛项目',
    events: groups.flatMap((group) => group.events),
    payment: null,
    feeNote: groups.some((group) => group.payment) ? '按组别收费，选择组别后查看' : undefined,
  };
}

export default function CompetitionRegisterPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [code, setCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [info, setInfo] = useState<RegistrationCodeInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState('');
  // 报名码通过后先看赛事简介，点底部「立即报名」才进入选择组别。
  const [started, setStarted] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);

  // 扫二维码进入时链接里已带报名码：直接校验，第一屏就是赛事简介。
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('code') ?? '';
    if (!value) return;
    void Promise.resolve().then(() => {
      setCodeInput(value);
      return verifyCode(value);
    });
  }, []);

  async function verifyCode(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      setCodeError('请输入报名码');
      return;
    }
    setChecking(true);
    setCodeError('');
    setInfo(null);
    try {
      const response = await fetch(`${API_BASE}/competitions/registration-code/${encodeURIComponent(normalized)}`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? '报名码无效');
      const next = data as RegistrationCodeInfo;
      setInfo(next);
      // 只有一个组别时不用选；扫旧的组别码时预选该组。
      setGroupId(next.preselectedGroupId ?? (next.groups?.length === 1 ? next.groups[0].groupId : null));
      setCode(normalized);
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : '报名码校验失败');
    } finally {
      setChecking(false);
    }
  }

  if (!info) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4">
        <section className="w-full rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
          {id ? (
            <Link
              href={`/competitions/${id}`}
              title="返回赛事主页"
              className="-ml-1 mb-3 inline-flex h-9 items-center gap-1 rounded-lg px-1 text-sm font-black text-blue-700 transition hover:text-blue-900"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-4 w-4" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 5l-7 7 7 7" />
              </svg>
              返回上一级
            </Link>
          ) : null}
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Registration Code</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">输入赛事报名码</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            报名码由组委会提供，一个赛事一个报名码，输入后选择组别报名。
          </p>
          <div className="mt-5 flex gap-2">
            <input
              className="h-11 min-w-0 flex-1 rounded-lg border border-blue-100 px-3 text-sm font-bold uppercase outline-none focus:border-blue-500"
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
              placeholder="例如 YD7K2M9Q"
              maxLength={16}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void verifyCode(codeInput);
              }}
            />
            <button
              type="button"
              disabled={checking}
              onClick={() => void verifyCode(codeInput)}
              className="inline-flex h-11 items-center rounded-lg bg-blue-700 px-4 text-sm font-black text-white disabled:bg-slate-300"
            >
              {checking ? '校验中…' : '验证'}
            </button>
          </div>
          {codeError ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{codeError}</p>
          ) : null}
          {info ? null : (
            <p className="mt-4 text-xs font-semibold text-slate-400">
              赛事：{id ? `当前赛事 ${id}` : '请通过组委会分享的链接进入'}
            </p>
          )}
        </section>
      </main>
    );
  }

  if (!started) {
    return (
      <PortalFeaturePage
        activeHref="/competitions"
        eyebrow="Registration"
        title={info.title}
        description="先了解赛事简介和报名须知，准备好后点击底部「立即报名」。"
        back={{ href: `/competitions/${id ?? info.tournamentId}`, label: '赛事主页' }}
      >
        <RegistrationIntro
          info={introInfo(info)}
          onStart={() => {
            setStarted(true);
            window.scrollTo({ top: 0 });
          }}
        />
      </PortalFeaturePage>
    );
  }

  if (info.groups?.length) {
    const groups = info.groups;
    const group = groups.find((item) => item.groupId === groupId);
    if (!group) {
      return <PortalFeaturePage activeHref="/competitions" eyebrow="Registration" title={info.title} description="请选择要报名的组别，再填写报名信息。" back={{ href: `/competitions/${info.tournamentId}`, label: '赛事主页' }}>
        <GroupPicker groups={groups} onPick={setGroupId} />
      </PortalFeaturePage>;
    }
    const groupInfo: RegistrationGroupInfo = {
      ...group,
      tournamentId: info.tournamentId,
      title: info.title,
      maxRegistrationEvents: info.maxRegistrationEvents,
      registrationOpen: info.registrationOpen,
    };
    return <PortalFeaturePage activeHref="/competitions" eyebrow="Registration" title={`${info.title} · ${group.groupName}`} description={group.ageRuleLabel || '按组别规则填写报名信息'} back={{ href: `/competitions/${info.tournamentId}`, label: '赛事主页' }}>
      <GroupRegistrationForm key={group.groupId} info={groupInfo} registrationCode={code} onBack={groups.length > 1 ? () => setGroupId(null) : undefined} />
    </PortalFeaturePage>;
  }

  // 没有组别记录的旧赛事只剩学生组报名码（默认社会组已取消）。
  return <SchoolRegisterPage registrationCode={code} codeInfo={info} />;
}

function SchoolRegisterPage({
  registrationCode,
  codeInfo,
}: {
  registrationCode: string;
  codeInfo: RegistrationCodeInfo;
}) {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [existing, setExisting] = useState<ExistingRegistration | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'events' | 'details'>('events');
  const messageRef = useRef<HTMLDivElement>(null);

  // 提交按钮在表单底部，结果提示在顶部；提交后把提示滚到可见位置（手机上尤其需要）。
  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [message]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    async function loadData() {
      setLoading(true);
      setError('');
      try {
        // 未登录时走游客通道：不查询「我的报名」，只加载赛事信息。
        const [competitionRes, registrationRes] = await Promise.all([
          fetch(`${API_BASE}/competitions/${id}`, { cache: 'no-store' }),
          token
            ? fetch(`${API_BASE}/competitions/${id}/registration/me`, {
                cache: 'no-store',
                headers: { Authorization: `Bearer ${token}` },
              })
            : Promise.resolve(null),
        ]);
        if (!competitionRes.ok) throw new Error('赛事信息加载失败');
        const competitionData = (await parseJsonSafe<Competition>(competitionRes)) as Competition;
        const registrationData = registrationRes?.ok
          ? await parseJsonSafe<ExistingRegistration>(registrationRes)
          : null;
        if (!alive) return;
        setCompetition(competitionData);
        setExisting(registrationData);
        if (registrationData) {
          setStep('details');
          setForm(formFromRegistration(registrationData));
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

  const schoolFieldRules = codeInfo.fieldRules?.SCHOOL ?? {};
  const studentIdHidden = schoolFieldRules.studentId === 'hidden';
  const studentIdRequired = !studentIdHidden && schoolFieldRules.studentId !== 'optional';
  const collegeHidden = schoolFieldRules.college === 'hidden';
  const collegeRequired = !collegeHidden && schoolFieldRules.college !== 'optional';
  const majorGradeHidden = schoolFieldRules.majorGrade === 'hidden';
  const majorGradeRequired = !majorGradeHidden && schoolFieldRules.majorGrade === 'required';
  const eventOptions = (competition?.eventOptions ?? []).filter(
    (option) => !option.entrantType || option.entrantType === 'SCHOOL',
  );
  const selectedEventIds = useMemo(() => form.items.map((item) => item.eventId).filter(Boolean), [form.items]);
  const existingLocked = existing?.status === 'pending';
  const existingApproved = existing?.status === 'approved';
  const existingApprovedEventIds = useMemo(
    () => existing?.status === 'approved' ? existing.items.map((item) => item.eventId) : [],
    [existing],
  );
  const selectedOptions = useMemo(
    () => form.items.map((item) => eventOptions.find((option) => option.id === item.eventId)),
    [eventOptions, form.items],
  );
  const firstSelectedOption = selectedOptions.find(Boolean);
  const hasDoubleSelection = selectedOptions.some((option) => isDoubleOption(option));
  const hasNewEventSelection = form.items.some((item) => item.eventId && !existingApprovedEventIds.includes(item.eventId));
  const maxSelectableEvents = competition?.allowCrossEventRegistration ? competition.maxRegistrationEvents ?? 2 : 1;
  const currentStep = existingLocked ? 'details' : step;
  const canContinueToDetails = form.items.length > 0 && form.items.every((item) => Boolean(item.eventId));

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
      items: [...prev.items, { eventId: '', partnerName: '', partnerGender: '', partnerStudentId: '', partnerSchool: '', partnerClassName: '', partnerContact: '', teamName: '' }],
    }));
  }

  function removeItem(index: number) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function goToDetails() {
    setError('');
    setForm((prev) => {
      const option = eventOptions.find((item) => item.id === prev.items[0]?.eventId);
      const primaryOptions = genderOptionsForPrimary(option);
      const nextGender = primaryOptions.some((item) => item.value === prev.gender)
        ? prev.gender
        : primaryOptions[0].value as FormState['gender'];
      return {
        ...prev,
        gender: nextGender,
        items: prev.items.map((item) => {
          const itemOption = eventOptions.find((current) => current.id === item.eventId);
          const partnerOptions = genderOptionsForPartner(itemOption, nextGender);
          const partnerGender = partnerOptions.some((current) => current.value === item.partnerGender)
            ? item.partnerGender
            : (isDoubleOption(itemOption) ? partnerOptions[0].value as ItemState['partnerGender'] : '');
          return { ...item, partnerGender };
        }),
      };
    });
    setStep('details');
  }

  async function submitRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    setSubmitting(true);
    setMessage('');
    setError('');
    try {
      const payload = {
        entrantType: 'SCHOOL',
        registrationCode,
        studentId: studentIdHidden ? undefined : form.studentId,
        college: collegeHidden ? undefined : (form.college.trim() || form.className.trim() || undefined),
        majorGrade: majorGradeHidden ? undefined : form.majorGrade.trim() || undefined,
        name: form.name,
        gender: form.gender,
        school: form.school.trim(),
        className: [form.college.trim() || form.className.trim(), form.majorGrade.trim()].filter(Boolean).join(' ') || undefined,
        contact: form.contact,
        remark: form.remark,
        items: form.items.map((item) => ({
          eventId: item.eventId,
          partnerName: item.partnerName || undefined,
          partnerGender: item.partnerGender || undefined,
          partnerStudentId: item.partnerStudentId || undefined,
          partnerSchool: item.partnerSchool || undefined,
          partnerClassName: item.partnerClassName || undefined,
          partnerContact: item.partnerContact || undefined,
          teamName: item.teamName || undefined,
        })),
      };
      // 已登录：绑定账号提交；未登录：走游客通道，凭报名码提交（不关联账号）。
      const endpoint = token
        ? `${API_BASE}/competitions/${id}/register`
        : `${API_BASE}/competitions/${id}/public-register`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? '报名提交失败');
      const paymentPage = paymentPageAfterSubmit(id, codeInfo, data.registration?.status, data.guestToken);
      if (paymentPage) {
        router.push(paymentPage);
        return;
      }
      setMessage(
        codeInfo.payment && data.registration?.status === 'pending'
          ? `${data.message ?? '报名已提交，请等待管理员审核。'}审核通过后请到首页「报名查询」缴费。`
          : data.message ?? '报名已提交，请等待管理员审核。',
      );
      setExisting(data.registration ?? null);
      // 追加时后端返回的是整份报名（含之前报的项目），表单跟着显示实际登记的全部项目。
      if (data.registration) setForm(formFromRegistration(data.registration));
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
      description="先选择报名组别，再填写基本信息。待审核时不能修改，报名通过后可继续追加新的报名项目。"
      back={{ href: `/competitions/${id}`, label: '赛事主页' }}
    >
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3 sm:mb-5">
            <h2 className="text-lg font-black text-slate-950 sm:text-xl">当前赛事</h2>
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

        {/* 手机上从赛事简介点「立即报名」后，第一眼就是选择组别 */}
        <section className="order-first rounded-lg border border-blue-100 bg-white p-4 shadow-sm sm:p-6 lg:order-none">
          <h2 className="text-lg font-black text-slate-950 sm:text-xl">报名表单</h2>
          {message && (
            <div ref={messageRef} className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
              {message}
              {codeInfo.payment ? (
                <Link href="/registration-query" className="ml-2 text-blue-700 underline">去报名查询</Link>
              ) : null}
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
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-1 text-sm font-black">
              <span className={`rounded-md px-3 py-2 text-center ${currentStep === 'events' ? 'bg-blue-700 text-white' : 'text-slate-500'}`}>
                1 选择组别
              </span>
              <span className={`rounded-md px-3 py-2 text-center ${currentStep === 'details' ? 'bg-blue-700 text-white' : 'text-slate-500'}`}>
                2 基本信息
              </span>
            </div>

            {currentStep === 'events' ? (
              <div className="space-y-4 rounded-lg border border-blue-100 bg-blue-50/40 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-black text-slate-900">选择报名组别/项目</h3>
                  <button
                    type="button"
                    onClick={addItem}
                    disabled={form.items.length >= maxSelectableEvents || existingLocked}
                    className="tappable inline-flex h-10 min-h-[44px] items-center rounded-lg border border-blue-200 px-3 text-sm font-black text-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                  >
                    新增项目
                  </button>
                </div>
                {!existing && maxSelectableEvents > 1 ? (
                  <p className="text-xs font-bold leading-5 text-slate-500">
                    本赛事每人最多报 {maxSelectableEvents} 个项目。已报过名、想再兼报的：只选新项目提交即可，姓名和联系方式要与第一次报名时一致。
                  </p>
                ) : null}
                {form.items.map((item, index) => (
                  <div key={`${index}-${item.eventId}`} className="grid gap-4 rounded-lg border border-white bg-white p-4 md:grid-cols-[1fr_auto]">
                    <Field label={`组别/项目 ${index + 1}`}>
                      <select
                        required
                        disabled={existingLocked}
                        value={item.eventId}
                        onChange={(event) => updateItem(index, { eventId: event.target.value, partnerName: '', partnerStudentId: '', partnerClassName: '', teamName: '' })}
                      >
                        <option value="">请选择组别/项目</option>
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
                    <div className="flex items-end">
                      {form.items.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          disabled={existingLocked}
                          className="tappable inline-flex h-11 min-h-[44px] w-full items-center justify-center rounded-lg border border-red-200 px-3 text-sm font-black text-red-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 md:w-auto"
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={!canContinueToDetails || !competition}
                  onClick={goToDetails}
                  className="tappable inline-flex h-12 min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-700 px-5 text-base font-black text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  下一步，填写基本信息
                </button>
              </div>
            ) : (
              <>
                {!hasDoubleSelection ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="姓名">
                      <input required disabled={existingLocked} value={form.name} onChange={(event) => updateField('name', event.target.value)} />
                    </Field>
                    <Field label="性别">
                      <select disabled={existingLocked} value={form.gender} onChange={(event) => updateField('gender', event.target.value as FormState['gender'])}>
                        {genderOptionsForPrimary(firstSelectedOption).map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </Field>
                    {!studentIdHidden ? (
                      <Field label={studentIdRequired ? '学号' : '学号（选填）'}>
                        <input required={studentIdRequired} disabled={existingLocked} value={form.studentId} onChange={(event) => updateField('studentId', event.target.value)} />
                      </Field>
                    ) : null}
                    <Field label="学校">
                      <input
                        required
                        minLength={1}
                        maxLength={120}
                        disabled={existingLocked}
                        value={form.school}
                        onChange={(event) => updateField('school', event.target.value)}
                        placeholder="例如:武汉大学"
                      />
                    </Field>
                    {!collegeHidden ? (
                      <Field label={collegeRequired ? '学院' : '学院（选填）'}>
                        <input
                          required={collegeRequired}
                          maxLength={120}
                          disabled={existingLocked}
                          value={form.college}
                          onChange={(event) => updateField('college', event.target.value)}
                          placeholder="例如:健康产业学院"
                        />
                      </Field>
                    ) : null}
                    {!majorGradeHidden ? (
                      <Field label={majorGradeRequired ? '年级专业' : '年级专业（选填）'}>
                        <input
                          required={majorGradeRequired}
                          maxLength={120}
                          disabled={existingLocked}
                          value={form.majorGrade}
                          onChange={(event) => updateField('majorGrade', event.target.value)}
                          placeholder="例如:25级社会体育2班"
                        />
                      </Field>
                    ) : null}
                    <Field label="联系方式">
                      <input required value={form.contact} onChange={(event) => updateField('contact', event.target.value)} />
                    </Field>
                  </div>
                ) : null}

                <div className="space-y-4 rounded-lg border border-blue-100 bg-blue-50/40 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900">已选组别/项目</h3>
                <button
                  type="button"
                  onClick={() => setStep('events')}
                  disabled={existingLocked}
                  className="tappable inline-flex h-10 min-h-[44px] items-center rounded-lg border border-blue-200 px-3 text-sm font-black text-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  返回修改
                </button>
              </div>
              {form.items.map((item, index) => {
                const selectedOption = eventOptions.find((option) => option.id === item.eventId);
                const isDouble = isDoubleOption(selectedOption);
                return (
                  <div key={`${index}-${item.eventId}`} className="grid gap-4 rounded-lg border border-white bg-white p-4 md:grid-cols-2">
                    <div className="md:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-black text-slate-800">
                      项目 {index + 1}：{selectedOption?.label ?? '未选择'}
                    </div>
                    {selectedOption ? (
                      isDouble ? (
                        <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                          <p className="mb-3 text-sm font-black text-blue-800">
                            双打项目 · 请按顺序填写队伍与两名队员信息
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
                            <Field label="姓名">
                              <input required disabled={existingLocked} value={form.name} onChange={(event) => updateField('name', event.target.value)} />
                            </Field>
                            <Field label="性别">
                              <select disabled={existingLocked} value={form.gender} onChange={(event) => {
                                const nextGender = event.target.value as FormState['gender'];
                                updateField('gender', nextGender);
                                updateItem(index, { partnerGender: genderOptionsForPartner(selectedOption, nextGender)[0].value as ItemState['partnerGender'] });
                              }}>
                                {genderOptionsForPrimary(selectedOption).map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </Field>
                            {!studentIdHidden ? (
                              <Field label={studentIdRequired ? '学号' : '学号（选填）'}>
                                <input required={studentIdRequired} disabled={existingLocked} value={form.studentId} onChange={(event) => updateField('studentId', event.target.value)} />
                              </Field>
                            ) : null}
                            <Field label="学校">
                              <input
                                required
                                minLength={1}
                                maxLength={120}
                                disabled={existingLocked}
                                value={form.school}
                                onChange={(event) => updateField('school', event.target.value)}
                                placeholder="例如:武汉大学"
                              />
                            </Field>
                            {!collegeHidden ? (
                              <Field label={collegeRequired ? '学院' : '学院（选填）'}>
                                <input
                                  required={collegeRequired}
                                  maxLength={120}
                                  disabled={existingLocked}
                                  value={form.college}
                                  onChange={(event) => updateField('college', event.target.value)}
                                  placeholder="例如:健康产业学院"
                                />
                              </Field>
                            ) : null}
                            {!majorGradeHidden ? (
                              <Field label={majorGradeRequired ? '年级专业' : '年级专业（选填）'}>
                                <input
                                  required={majorGradeRequired}
                                  maxLength={120}
                                  disabled={existingLocked}
                                  value={form.majorGrade}
                                  onChange={(event) => updateField('majorGrade', event.target.value)}
                                  placeholder="例如:25级社会体育2班"
                                />
                              </Field>
                            ) : null}
                            <Field label="联系方式">
                              <input required value={form.contact} onChange={(event) => updateField('contact', event.target.value)} />
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
                            <Field label="搭档性别">
                              <select
                                required
                                disabled={existingLocked}
                                value={item.partnerGender}
                                onChange={(event) => updateItem(index, { partnerGender: event.target.value as ItemState['partnerGender'] })}
                              >
                                {genderOptionsForPartner(selectedOption, form.gender).map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </Field>
                            {!studentIdHidden ? (
                              <Field label={studentIdRequired ? '搭档学号' : '搭档学号（选填）'}>
                                <input
                                  required={studentIdRequired}
                                  disabled={existingLocked}
                                  value={item.partnerStudentId}
                                  onChange={(event) => updateItem(index, { partnerStudentId: event.target.value })}
                                  placeholder="请填写搭档学号"
                                />
                              </Field>
                            ) : null}
                            <Field label="搭档学校">
                              <input
                                required
                                minLength={2}
                                maxLength={120}
                                disabled={existingLocked}
                                value={item.partnerSchool}
                                onChange={(event) => updateItem(index, { partnerSchool: event.target.value })}
                                placeholder="例如:武汉大学"
                              />
                            </Field>
                            <Field label="搭档学院班级">
                              <input
                                required
                                maxLength={120}
                                disabled={existingLocked}
                                value={item.partnerClassName}
                                onChange={(event) => updateItem(index, { partnerClassName: event.target.value })}
                                placeholder="例如:健康产业学院社会体育2班"
                              />
                            </Field>
                            <Field label="搭档联系方式">
                              <input
                                required
                                disabled={existingLocked}
                                value={item.partnerContact}
                                onChange={(event) => updateItem(index, { partnerContact: event.target.value })}
                                placeholder="请填写搭档联系方式"
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
                    disabled={submitting || !competition || existingLocked || (existingApproved && !hasNewEventSelection)}
                    className="tappable inline-flex h-12 min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-700 px-5 text-base font-black text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 md:h-11 md:w-auto md:text-sm"
                  >
                    {existingApproved
                      ? submitting
                        ? '追加提交中...'
                        : '追加报名'
                      : existing?.status === 'rejected'
                        ? submitting ? '重新提交中...' : '重新提交报名'
                        : submitting ? '提交中...' : '提交报名'}
                  </button>
                  {existingApproved && !hasNewEventSelection ? (
                    <p className="mt-2 text-xs font-bold text-slate-400">请选择新的报名项目后再提交。</p>
                  ) : null}
                </div>
              </>
            )}
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
