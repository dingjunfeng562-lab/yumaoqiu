'use client';

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { isRichAnnouncementContent, sanitizeAnnouncementHtml } from '@/lib/announcement-html';
import { DEFAULT_MAINTENANCE_TITLE } from '@/lib/maintenance';
import styles from './MaintenanceView.module.css';

type MaintenanceViewProps = {
  title?: string;
  content?: string;
  startedAt?: string | null;
  expectedEndAt?: string | null;
  // 服务器时间 - 本机时间，倒计时按服务器时间走，本机时钟不准也不影响。
  clockOffsetMs?: number;
  // 后台预览：嵌在弹窗里，不铺满全屏。
  embedded?: boolean;
  // 已检测到维护结束，正在回到原页面。
  restoring?: boolean;
};

const pad = (value: number) => String(value).padStart(2, '0');

function formatTime(value?: string | null) {
  if (!value) return null;
  const time = dayjs(value);
  return time.isValid() ? time.format('YYYY年M月D日 HH:mm') : null;
}

export function MaintenanceView({
  title,
  content,
  startedAt,
  expectedEndAt,
  clockOffsetMs = 0,
  embedded = false,
  restoring = false,
}: MaintenanceViewProps) {
  // 时间和倒计时只在浏览器里算：服务端是 UTC，直接渲染会和用户时区对不上（水合报错）。
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now() + clockOffsetMs);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [clockOffsetMs]);

  const html = useMemo(() => {
    if (!content?.trim()) return null;
    return isRichAnnouncementContent(content) ? sanitizeAnnouncementHtml(content) : null;
  }, [content]);

  const endMs = expectedEndAt ? new Date(expectedEndAt).getTime() : NaN;
  const startMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const hasEnd = Number.isFinite(endMs);
  const remaining = now !== null && hasEnd ? Math.max(0, endMs - now) : null;
  const overdue = remaining === 0;
  const progress = now !== null && hasEnd && Number.isFinite(startMs) && endMs > startMs
    ? Math.min(100, Math.max(0, ((now - startMs) / (endMs - startMs)) * 100))
    : null;

  const totalSeconds = remaining !== null ? Math.floor(remaining / 1000) : 0;
  const units = [
    { label: '天', value: Math.floor(totalSeconds / 86400) },
    { label: '时', value: Math.floor((totalSeconds % 86400) / 3600) },
    { label: '分', value: Math.floor((totalSeconds % 3600) / 60) },
    { label: '秒', value: totalSeconds % 60 },
  ];
  // 不足一天时不显示"天"。
  const visibleUnits = units[0].value > 0 ? units : units.slice(1);

  const startText = now !== null ? formatTime(startedAt) : null;
  const endText = now !== null ? formatTime(expectedEndAt) : null;

  return (
    <div className={`${styles.screen}${embedded ? ` ${styles.embedded}` : ''}`} role="main">
      <div className={styles.courtLines} aria-hidden />
      <section className={styles.card} aria-live="polite">
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.brandLogo} src="/logo-mark.png" alt="" />
          <span className={styles.brandName}>羽动云赛</span>
        </div>

        <span className={`${styles.badge}${restoring ? ` ${styles.badgeRestoring}` : ''}`}>
          <span className={styles.dot} />
          {restoring ? '维护已结束，正在恢复…' : '全服维护中'}
        </span>
        <h1 className={styles.title}>{title?.trim() || DEFAULT_MAINTENANCE_TITLE}</h1>

        {html !== null ? (
          <div className={styles.content} dangerouslySetInnerHTML={{ __html: html }} />
        ) : content?.trim() ? (
          <div className={`${styles.content} ${styles.plain}`}>{content}</div>
        ) : (
          <div className={styles.content}>
            为了给大家提供更稳定的服务，平台正在进行系统维护，期间暂停报名、编排等全部功能。给您带来不便，敬请谅解。
          </div>
        )}

        <div className={styles.times}>
          <div className={styles.timeItem}>
            <div className={styles.timeLabel}>维护开始时间</div>
            <div className={styles.timeValue}>{startText ?? (startedAt ? '—' : '刚刚开始')}</div>
          </div>
          <div className={styles.timeItem}>
            <div className={styles.timeLabel}>预计恢复时间</div>
            <div className={styles.timeValue}>{endText ?? (expectedEndAt ? '—' : '待定')}</div>
          </div>
        </div>

        <div className={styles.countdown}>
          {!hasEnd ? (
            <div className={styles.countdownNote}>恢复时间待定，维护完成后将第一时间恢复</div>
          ) : overdue ? (
            <div className={styles.countdownNote}>已到预计恢复时间，正在做最后检查，请稍候</div>
          ) : (
            <>
              <div className={styles.countdownLabel}>距离预计恢复还有</div>
              <div className={styles.countdownDigits}>
                {visibleUnits.map((unit) => (
                  <span className={styles.unit} key={unit.label}>
                    <span className={styles.digit}>{remaining === null ? '--' : pad(unit.value)}</span>
                    <span className={styles.unitLabel}>{unit.label}</span>
                  </span>
                ))}
              </div>
            </>
          )}
          {progress !== null ? (
            <div className={styles.progress} aria-hidden>
              <div className={styles.progressBar} style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>

        <div className={styles.footnote}>维护结束后本页会自动恢复，无需手动刷新</div>
      </section>
    </div>
  );
}
