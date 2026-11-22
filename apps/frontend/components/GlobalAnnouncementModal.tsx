'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { isRichAnnouncementContent, sanitizeAnnouncementHtml } from '@/lib/announcement-html';
import { useRoleAnnouncements } from './RoleAnnouncementsProvider';

export type ActiveAnnouncement = {
  id: string;
  title: string;
  content: string;
  type: 'normal' | 'event' | 'maintenance' | 'urgent' | string;
  displayMode: 'popup' | 'banner' | string;
  scope: 'global' | 'home' | string;
  frequency: 'every_visit' | 'once_per_day' | 'once' | string;
  closable: boolean;
  targetRole?: string | null;
  primaryButtonText?: string | null;
  primaryButtonLink?: string | null;
  secondaryButtonText?: string | null;
  updatedAt?: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL;

// 内容区顶部的红色大标题（仿 timidc.cn 官方公告），按公告类型取文案。
const NOTICE_TITLES: Record<string, string> = {
  normal: '官方公告',
  event: '赛事公告',
  maintenance: '维护公告',
  urgent: '紧急通知',
};

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Cache keys include updatedAt so an admin edit (any field, including
// frequency / content) invalidates a user's previously-closed state and the
// popup re-shows. Without this, switching frequency in the admin panel
// silently does nothing for anyone who already dismissed the prior version.
function cacheSuffix(announcement: ActiveAnnouncement, userId?: string) {
  const version = announcement.updatedAt ? `${announcement.id}_${announcement.updatedAt}` : announcement.id;
  return announcement.targetRole ? `${userId}_${version}` : version;
}

function shouldShowAnnouncement(announcement: ActiveAnnouncement, userId?: string) {
  // During SSR / pre-hydration we cannot read localStorage, so suppress by
  // default. The client will flip it back on once the per-id cache has been
  // checked, which avoids the brief "flash" of a dismissed popup.
  if (typeof window === 'undefined') return false;

  const suffix = cacheSuffix(announcement, userId);

  if (announcement.frequency === 'once') {
    return window.localStorage.getItem(`announcement_closed_${suffix}`) !== '1';
  }

  if (announcement.frequency === 'once_per_day') {
    return window.localStorage.getItem(`announcement_closed_date_${suffix}`) !== todayKey();
  }

  // every_visit: only the user-driven "今日不再提示" suppression applies.
  return window.localStorage.getItem(`announcement_closed_date_${suffix}`) !== todayKey();
}

function recordAnnouncementClosed(announcement: ActiveAnnouncement, muteToday: boolean, userId?: string) {
  if (typeof window === 'undefined') return;
  const suffix = cacheSuffix(announcement, userId);

  if (announcement.frequency === 'once') {
    window.localStorage.setItem(`announcement_closed_${suffix}`, '1');
    return;
  }

  if (announcement.frequency === 'once_per_day') {
    window.localStorage.setItem(`announcement_closed_date_${suffix}`, todayKey());
    return;
  }

  // every_visit: respect the user's "今日不再提示" choice but otherwise let
  // the popup reappear on the next visit.
  if (muteToday) {
    window.localStorage.setItem(`announcement_closed_date_${suffix}`, todayKey());
  }
}

export function GlobalAnnouncementModal({ initialAnnouncement }: { initialAnnouncement?: ActiveAnnouncement | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const isHome = pathname === '/home';
  const { data: session, status } = useSession();
  const userId = session?.user.id;
  const roleAnnouncements = useRoleAnnouncements();
  const [publicPopup, setPublicPopup] = useState<ActiveAnnouncement | null>(initialAnnouncement ?? null);
  const [publicBanner, setPublicBanner] = useState<ActiveAnnouncement | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [previewBanner, setPreviewBanner] = useState<string>();
  const [muteToday, setMuteToday] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const canDisplay = (item: ActiveAnnouncement) =>
    hydrated && (item.scope === 'global' || isHome)
    && !dismissed.includes(cacheSuffix(item, userId))
    && shouldShowAnnouncement(item, userId);
  const banner = roleAnnouncements.find((item) => item.displayMode === 'banner' && canDisplay(item))
    ?? (publicBanner && canDisplay(publicBanner) ? publicBanner : null);
  const announcement = banner && previewBanner === cacheSuffix(banner, userId) ? banner
    : roleAnnouncements.find((item) => item.displayMode === 'popup' && canDisplay(item))
      ?? (publicPopup && canDisplay(publicPopup) ? publicPopup : null);

  // 后台富文本编辑器产出 HTML；渲染前再过一次白名单过滤（后端保存时已过滤一次）。
  // 旧的纯文本公告保持原有 pre-wrap 渲染。
  const richHtml = useMemo(() => {
    if (!announcement || !isRichAnnouncementContent(announcement.content)) return null;
    return sanitizeAnnouncementHtml(announcement.content);
  }, [announcement]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!API_BASE) return;

    const controller = new AbortController();
    async function load(mode: 'popup' | 'banner', apply: (item: ActiveAnnouncement | null) => void) {
      try {
        const res = await fetch(`${API_BASE}/announcements/active?scope=${isHome ? 'home' : 'global'}&mode=${mode}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) return;
        const item = (await res.json()) as ActiveAnnouncement | null;
        if (!controller.signal.aborted) apply(item?.displayMode === mode ? item : null);
      } catch {
        // Announcements are optional while the endpoint is unavailable.
      }
    }
    void load('popup', setPublicPopup);
    void load('banner', setPublicBanner);
    return () => controller.abort();
  }, [isHome]);

  const dismiss = useCallback((item: ActiveAnnouncement, mute: boolean) => {
    recordAnnouncementClosed(item, mute, userId);
    setDismissed((current) => [...current, cacheSuffix(item, userId)]);
  }, [userId]);

  const closeModal = useCallback(() => {
    if (announcement) dismiss(announcement, muteToday);
    setPreviewBanner(undefined);
    setMuteToday(false);
  }, [announcement, dismiss, muteToday]);

  const handlePrimary = useCallback(() => {
    if (!announcement?.primaryButtonLink) {
      closeModal();
      return;
    }

    closeModal();
    if (announcement.primaryButtonLink.startsWith('/')) {
      router.push(announcement.primaryButtonLink);
      return;
    }
    window.location.href = announcement.primaryButtonLink;
  }, [announcement, closeModal, router]);

  // 弹窗打开后滚动条复位到顶部（内容区是唯一的滑动窗口）。
  useEffect(() => {
    const el = contentRef.current;
    if (el) el.scrollTop = 0;
  }, [announcement?.id, announcement?.content]);

  const scrollContentDown = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ top: el.clientHeight * 0.8, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, []);

  // 蓝色主按钮：配置了链接则跳转；否则为"记得下滑哟！"——未滑到底先下滑，到底后关闭。
  const handleBlue = useCallback(() => {
    if (announcement?.primaryButtonLink) {
      handlePrimary();
      return;
    }
    const el = contentRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 8) {
      scrollContentDown();
      return;
    }
    closeModal();
  }, [announcement?.primaryButtonLink, closeModal, handlePrimary, scrollContentDown]);

  useEffect(() => {
    if (!announcement || announcement.closable === false) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeModal();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [announcement, closeModal]);

  if (status === 'loading') return null;
  const bannerElement = banner ? (
    <aside aria-label={banner.targetRole ? '定向通知' : '公告'} className="fixed inset-x-3 top-3 z-[1100] mx-auto flex max-w-3xl items-center gap-3 rounded-lg border border-sky-500 bg-slate-950 px-4 py-3 text-sm text-white shadow-lg">
      <div className="min-w-0 flex-1 truncate font-semibold">{banner.title}</div>
      {banner.primaryButtonLink ? (
        <Link href={banner.primaryButtonLink} className="shrink-0 rounded px-2 py-1 font-semibold text-sky-200 hover:bg-white/10" onClick={() => dismiss(banner, false)}>
          {banner.primaryButtonText?.trim() || '查看通知'}
        </Link>
      ) : (
        <button type="button" className="shrink-0 rounded px-2 py-1 font-semibold text-sky-200 hover:bg-white/10" onClick={() => setPreviewBanner(cacheSuffix(banner, userId))}>查看通知</button>
      )}
      {banner.closable !== false && (
        <button type="button" className="shrink-0 rounded px-2 py-1 text-xl leading-none hover:bg-white/10" aria-label="关闭横幅" onClick={() => dismiss(banner, false)}>×</button>
      )}
    </aside>
  ) : null;
  if (!announcement) return bannerElement;

  const hasLink = Boolean(announcement.primaryButtonLink);
  const primaryText =
    announcement.primaryButtonText?.trim() || (hasLink ? '立即查看' : '记得下滑哟！');
  const secondaryText = announcement.secondaryButtonText?.trim() || '关闭';
  const canClose = announcement.closable !== false;
  const noticeTitle = announcement.targetRole ? '定向通知' : NOTICE_TITLES[announcement.type] ?? NOTICE_TITLES.normal;

  return (
    <div
      className="global-announcement-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-announcement-title"
    >
      <div
        className="global-announcement-modal__backdrop"
        onClick={canClose ? closeModal : undefined}
      />
      <section className="global-announcement-modal__panel">
        <header className="global-announcement-modal__head">
          <h2 id="global-announcement-title">{announcement.title}</h2>
          {canClose ? (
            <button
              className="global-announcement-modal__close"
              type="button"
              aria-label="关闭公告"
              onClick={closeModal}
            >
              ×
            </button>
          ) : null}
        </header>

        <div ref={contentRef} className="global-announcement-modal__body">
          <div className="global-announcement-modal__notice-title">{noticeTitle}</div>
          {richHtml !== null ? (
            <div
              className="global-announcement-modal__content global-announcement-modal__content--rich"
              dangerouslySetInnerHTML={{ __html: richHtml }}
            />
          ) : (
            <div className="global-announcement-modal__content">{announcement.content}</div>
          )}
        </div>

        <footer className="global-announcement-modal__foot">
          {canClose ? (
            <button className="global-announcement-modal__secondary" type="button" onClick={closeModal}>
              {secondaryText}
            </button>
          ) : null}
          <button className="global-announcement-modal__primary" type="button" onClick={handleBlue}>
            {primaryText}
          </button>
        </footer>

        {canClose && announcement.frequency === 'every_visit' ? (
          <label className="global-announcement-modal__today">
            <input
              type="checkbox"
              checked={muteToday}
              onChange={(event) => setMuteToday(event.target.checked)}
            />
            <span>今日不再提示</span>
          </label>
        ) : null}
      </section>
    </div>
  );
}
