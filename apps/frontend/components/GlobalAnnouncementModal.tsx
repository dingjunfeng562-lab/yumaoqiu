'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isRichAnnouncementContent, sanitizeAnnouncementHtml } from '@/lib/announcement-html';

export type ActiveAnnouncement = {
  id: string;
  title: string;
  content: string;
  type: 'normal' | 'event' | 'maintenance' | 'urgent' | string;
  displayMode: 'popup' | 'banner' | string;
  scope: 'global' | 'home' | string;
  frequency: 'every_visit' | 'once_per_day' | 'once' | string;
  closable: boolean;
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
function cacheSuffix(announcement: ActiveAnnouncement) {
  return announcement.updatedAt ? `${announcement.id}_${announcement.updatedAt}` : announcement.id;
}

function shouldShowAnnouncement(announcement: ActiveAnnouncement) {
  // During SSR / pre-hydration we cannot read localStorage, so suppress by
  // default. The client will flip it back on once the per-id cache has been
  // checked, which avoids the brief "flash" of a dismissed popup.
  if (typeof window === 'undefined') return false;

  const suffix = cacheSuffix(announcement);

  if (announcement.frequency === 'once') {
    return window.localStorage.getItem(`announcement_closed_${suffix}`) !== '1';
  }

  if (announcement.frequency === 'once_per_day') {
    return window.localStorage.getItem(`announcement_closed_date_${suffix}`) !== todayKey();
  }

  // every_visit: only the user-driven "今日不再提示" suppression applies.
  return window.localStorage.getItem(`announcement_closed_date_${suffix}`) !== todayKey();
}

function recordAnnouncementClosed(announcement: ActiveAnnouncement, muteToday: boolean) {
  if (typeof window === 'undefined') return;
  const suffix = cacheSuffix(announcement);

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
  const [announcement, setAnnouncement] = useState<ActiveAnnouncement | null>(initialAnnouncement ?? null);
  // Always start closed: shouldShowAnnouncement reads localStorage which is
  // only available on the client, so we open the modal after hydration once
  // the per-announcement cache has been consulted.
  const [open, setOpen] = useState(false);
  const [muteToday, setMuteToday] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 后台富文本编辑器产出 HTML；渲染前再过一次白名单过滤（后端保存时已过滤一次）。
  // 旧的纯文本公告保持原有 pre-wrap 渲染。
  const richHtml = useMemo(() => {
    if (!announcement || !isRichAnnouncementContent(announcement.content)) return null;
    return sanitizeAnnouncementHtml(announcement.content);
  }, [announcement]);

  const applyAnnouncement = useCallback((next: ActiveAnnouncement | null) => {
    setAnnouncement(next);
    setOpen(Boolean(next && shouldShowAnnouncement(next)));
  }, []);

  const loadActiveAnnouncement = useCallback(async () => {
    if (!API_BASE) return;

    try {
      const res = await fetch(`${API_BASE}/announcements/active`, {
        cache: 'no-store',
      });
      if (!res.ok) return;

      const next = (await res.json()) as ActiveAnnouncement | null;
      applyAnnouncement(next);
    } catch {
      // The site must still render if the public announcement endpoint is temporarily unavailable.
    }
  }, [applyAnnouncement]);

  const closeModal = useCallback(() => {
    if (announcement) {
      recordAnnouncementClosed(announcement, muteToday);
    }
    setOpen(false);
  }, [announcement, muteToday]);

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

  useEffect(() => {
    if (initialAnnouncement) {
      setOpen(shouldShowAnnouncement(initialAnnouncement));
    }
    void loadActiveAnnouncement();
  }, [initialAnnouncement, loadActiveAnnouncement]);

  // 弹窗打开后滚动条复位到顶部（内容区是唯一的滑动窗口）。
  useEffect(() => {
    if (!open) return;
    const el = contentRef.current;
    if (el) el.scrollTop = 0;
  }, [open, announcement?.content]);

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
    if (!open || announcement?.closable === false) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeModal();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [announcement?.closable, closeModal, open]);

  if (!announcement || !open) return null;

  const hasLink = Boolean(announcement.primaryButtonLink);
  const primaryText =
    announcement.primaryButtonText?.trim() || (hasLink ? '立即查看' : '记得下滑哟！');
  const secondaryText = announcement.secondaryButtonText?.trim() || '关闭';
  const canClose = announcement.closable !== false;
  const noticeTitle = NOTICE_TITLES[announcement.type] ?? NOTICE_TITLES.normal;

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
