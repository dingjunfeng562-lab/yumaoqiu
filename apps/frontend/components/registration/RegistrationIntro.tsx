'use client';

import { isRichAnnouncementContent, sanitizeAnnouncementHtml } from '@/lib/announcement-html';
import { uploadUrl, yuan } from '@/lib/payments';
import { DynamicIslandButton } from './DynamicIslandButton';

export type RegistrationIntroInfo = {
  title: string;
  subtitle?: string | null;
  coverImageUrl?: string | null;
  organizer?: string | null;
  description?: string | null;
  registrationNotice?: string | null;
  startDate: string;
  endDate: string;
  location?: string | null;
  registrationStatus?: string;
  registrationOpen?: boolean;
  registrationEndTime?: string | null;
  entrantTypeLabel: string;
  maxRegistrationEvents?: number;
  needsRegistrationReview?: boolean;
  payment?: { singlesFee: number; doublesFee: number } | null;
  events: Array<{ id: string; label: string; isDouble: boolean }>;
  /** 多个组别收费不同时显示的报名费说明。 */
  feeNote?: string;
  /** 项目区块标题，默认「{entrantTypeLabel}项目」。 */
  eventsTitle?: string;
};

function formatDate(value?: string | null) {
  if (!value) return '待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(value?: string | null) {
  if (!value) return '待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function feeText(info: RegistrationIntroInfo) {
  if (info.feeNote) return info.feeNote;
  if (!info.payment) return '免费';
  const { singlesFee, doublesFee } = info.payment;
  const parts = [];
  if (info.events.some((event) => !event.isDouble)) parts.push(singlesFee > 0 ? `单打 ${yuan(singlesFee)}/人` : '单打免费');
  if (info.events.some((event) => event.isDouble)) parts.push(doublesFee > 0 ? `双打 ${yuan(doublesFee)}/对` : '双打免费');
  return parts.join(' · ') || '免费';
}

/** 扫码/输入报名码后的第一屏：先看赛事简介，再点底部「灵动岛」进入选择组别。 */
export function RegistrationIntro({ info, onStart }: { info: RegistrationIntroInfo; onStart: () => void }) {
  const description = (info.description ?? '').trim();
  const richDescription = description && isRichAnnouncementContent(description) ? sanitizeAnnouncementHtml(description) : null;
  const notice = (info.registrationNotice ?? '').trim();
  const cover = uploadUrl(info.coverImageUrl) || '/generated/competition-cover-1.png';
  const open = info.registrationOpen !== false;

  return (
    <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6">
      <article className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
        <div className="relative aspect-[16/9] bg-cover bg-center" style={{ backgroundImage: `url("${cover}")` }}>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#02133b]/85 via-[#02133b]/35 to-transparent" />
          <div className="absolute left-4 top-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white shadow-sm">{info.entrantTypeLabel}</span>
            <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-black text-blue-700 shadow-sm">{info.registrationStatus ?? '报名状态待定'}</span>
          </div>
          <div className="absolute bottom-4 left-4 right-4">
            <h2 className="text-xl font-black leading-tight text-white sm:text-3xl">{info.title}</h2>
            {info.subtitle ? <p className="mt-1.5 text-xs font-semibold text-blue-50/90 sm:text-sm">{info.subtitle}</p> : null}
          </div>
        </div>
      </article>

      <section className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-lg font-black text-slate-900">赛事信息</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <Fact label="比赛时间">{formatDate(info.startDate)} - {formatDate(info.endDate)}</Fact>
          <Fact label="比赛地点">{info.location || '地点待公布'}</Fact>
          {info.organizer ? <Fact label="主办单位">{info.organizer}</Fact> : null}
          <Fact label="报名截止">{formatDateTime(info.registrationEndTime)}</Fact>
          <Fact label="报名规则">每人最多报名 {info.maxRegistrationEvents ?? 1} 个项目</Fact>
          <Fact label="审核方式">{info.needsRegistrationReview ? '提交后由组委会审核' : '提交后自动通过'}</Fact>
          <Fact label="报名费">
            <span className={info.payment || info.feeNote ? 'font-black text-amber-600' : ''}>{feeText(info)}</span>
          </Fact>
        </dl>
        {info.payment || info.feeNote ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
            {info.needsRegistrationReview
              ? '报名审核通过后再缴费，可在首页「报名查询」查看收款方式和缴费状态。'
              : '提交报名后会直接进入缴费页面，按页面上的收款方式转账即可。'}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-lg font-black text-slate-900">赛事简介</h3>
        {richDescription ? (
          <div
            className="rich-public-content mt-4 text-sm font-medium leading-7 text-slate-700"
            dangerouslySetInnerHTML={{ __html: richDescription }}
          />
        ) : (
          <div className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-700">
            {description || <span className="text-slate-400">暂无简介。</span>}
          </div>
        )}
      </section>

      {notice ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm sm:p-6">
          <h3 className="text-lg font-black text-amber-900">报名须知</h3>
          <div className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-amber-900/90">{notice}</div>
        </section>
      ) : null}

      <section className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-lg font-black text-slate-900">{info.eventsTitle ?? `${info.entrantTypeLabel}项目`}</h3>
        {info.events.length ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {info.events.map((event) => (
              <li key={event.id} className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                {event.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm font-semibold text-slate-500">项目待公布</p>
        )}
      </section>

      {/* 给悬浮按钮留出位置，避免遮住最后一段内容 */}
      <div className="h-24" aria-hidden />

      <DynamicIslandButton
        title={open ? '立即报名' : info.registrationStatus ?? '暂未开放报名'}
        subtitle={open ? `${info.entrantTypeLabel} · 截止 ${formatDateTime(info.registrationEndTime)} · ${feeText(info)}` : '当前不能提交报名'}
        disabled={!open}
        onPress={onStart}
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-blue-50 pb-3 last:border-b-0 last:pb-0">
      <dt className="shrink-0 text-xs font-bold text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-semibold text-slate-700">{children}</dd>
    </div>
  );
}
