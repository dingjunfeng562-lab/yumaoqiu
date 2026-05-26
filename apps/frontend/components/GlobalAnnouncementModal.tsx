'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CloseOutlined,
  MessageOutlined,
  NotificationOutlined,
} from '@ant-design/icons';

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

const typeMeta: Record<string, { label: string; className: string }> = {
  normal: { label: '普通公告', className: 'global-announcement-modal__tag--normal' },
  event: { label: '赛事公告', className: 'global-announcement-modal__tag--event' },
  maintenance: { label: '系统维护', className: 'global-announcement-modal__tag--maintenance' },
  urgent: { label: '紧急通知', className: 'global-announcement-modal__tag--urgent' },
};

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function shouldShowAnnouncement(announcement: ActiveAnnouncement) {
  // During SSR / pre-hydration we cannot read localStorage, so suppress by
  // default. The client will flip it back on once the per-id cache has been
  // checked, which avoids the brief "flash" of a dismissed popup.
  if (typeof window === 'undefined') return false;

  if (window.localStorage.getItem(`announcement_closed_date_${announcement.id}`) === todayKey()) {
    return false;
  }

  if (announcement.frequency === 'once') {
    return window.localStorage.getItem(`announcement_closed_${announcement.id}`) !== '1';
  }

  return true;
}

function recordAnnouncementClosed(announcement: ActiveAnnouncement, muteToday: boolean) {
  if (typeof window === 'undefined') return;

  if (announcement.frequency === 'once') {
    window.localStorage.setItem(`announcement_closed_${announcement.id}`, '1');
  }

  // once_per_day always blocks today; the checkbox is honored for any
  // frequency so the user can suppress an every-visit notice for the day too.
  if (announcement.frequency === 'once_per_day' || muteToday) {
    window.localStorage.setItem(`announcement_closed_date_${announcement.id}`, todayKey());
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

  const activeType = useMemo(() => {
    if (!announcement) return typeMeta.normal;
    return typeMeta[announcement.type] ?? typeMeta.normal;
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

  const primaryText = announcement.primaryButtonText?.trim() || '立即查看';
  const secondaryText = announcement.secondaryButtonText?.trim() || '稍后再说';
  const canClose = announcement.closable !== false;

  return (
    <div
      className="global-announcement-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-announcement-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div className="global-announcement-modal__backdrop" />
      <section
        className="global-announcement-modal__panel"
        style={{
          position: 'relative',
          width: 'min(calc(100vw - 32px), 392px)',
          maxHeight: 'min(92vh, 680px)',
          overflow: 'hidden auto',
        }}
      >
        {canClose ? (
          <button className="global-announcement-modal__close" type="button" aria-label="关闭公告" onClick={closeModal}>
            <CloseOutlined />
          </button>
        ) : null}

        <div className="global-announcement-modal__hero" aria-hidden="true">
          <span className="global-announcement-modal__hero-ring" />
          <NotificationOutlined className="global-announcement-modal__hero-icon" />
          <MessageOutlined className="global-announcement-modal__hero-bubble" />
        </div>

        <span className={`global-announcement-modal__tag ${activeType.className}`}>{activeType.label}</span>

        <div className="global-announcement-modal__heading">
          <span />
          <h2 id="global-announcement-title">{announcement.title}</h2>
          <span />
        </div>

        <div className="global-announcement-modal__content">{announcement.content}</div>

        <div className="global-announcement-modal__actions">
          <button className="global-announcement-modal__primary" type="button" onClick={handlePrimary}>
            {primaryText}
          </button>
          {canClose ? (
            <button className="global-announcement-modal__secondary" type="button" onClick={closeModal}>
              {secondaryText}
            </button>
          ) : null}
        </div>

        {canClose ? (
          <label className="global-announcement-modal__today">
            <input type="checkbox" checked={muteToday} onChange={(event) => setMuteToday(event.target.checked)} />
            <span>今日不再提示</span>
          </label>
        ) : null}
      </section>
    </div>
  );
}
