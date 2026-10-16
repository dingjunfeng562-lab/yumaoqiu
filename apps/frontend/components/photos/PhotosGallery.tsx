'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigProvider, Empty, FloatButton, Image, Modal, Popover, Spin, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import { AppstoreOutlined, ArrowDownOutlined, ArrowUpOutlined, BarsOutlined, DownloadOutlined, EyeOutlined, PauseCircleOutlined, PlayCircleOutlined, SettingOutlined, ShareAltOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { galleryMessages, type GalleryLanguage } from './galleryMessages';
import styles from './PhotosGallery.module.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');
const PAGE_SIZE = 30;
type PhotoSort = 'POPULAR' | 'DOWNLOADS' | 'LATEST';
type Layout = 'immersive' | 'masonry' | 'grid' | 'timeline';
type Category = 'ALL' | 'PLAYER' | 'MATCH' | 'AWARD';
type PhotoItem = {
  id: string; category: Exclude<Category, 'ALL'>; seq: number;
  url: string; thumbUrl: string; downloadUrl: string;
  width: number; height: number; uploadedAt: string; viewCount: number; downloadCount: number;
};
type PhotoPage = { total: number; page: number; stats?: { viewCount: number; downloadCount: number }; items: PhotoItem[] };
const locales = { 'zh-CN': zhCN, 'zh-TW': zhTW, en: enUS };
const layoutIcons = { immersive: <BarsOutlined />, masonry: <AppstoreOutlined />, grid: <AppstoreOutlined />, timeline: <UnorderedListOutlined /> };
function fullUrl(path: string) { return `${API_ORIGIN}${path}`; }
function dateKey(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function PhotosGallery({ accessToken, language = 'zh-CN', onLanguageChange }: {
  accessToken: string; language?: GalleryLanguage; onLanguageChange?: (language: GalleryLanguage) => void;
}) {
  const t = galleryMessages[language];
  const [category, setCategory] = useState<Category>('ALL');
  const [sort, setSort] = useState<PhotoSort>('LATEST');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [layout, setLayout] = useState<Layout>('masonry');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ viewCount: 0, downloadCount: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const wallRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const requestKeyRef = useRef(0);
  const countedThumbIdsRef = useRef(new Set<string>());

  const loadPage = useCallback(async (targetPage: number, replace: boolean) => {
    if (!accessToken || loadingRef.current) return;
    const key = ++requestKeyRef.current;
    loadingRef.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({ accessToken, sort, direction, page: String(targetPage), pageSize: String(PAGE_SIZE) });
      if (category !== 'ALL') params.set('category', category);
      const response = await fetch(`${API_BASE}/photos?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Photo request failed');
      const data = await response.json() as PhotoPage;
      if (key !== requestKeyRef.current) return;
      setTotal(data.total);
      setStats({ viewCount: data.stats?.viewCount ?? 0, downloadCount: data.stats?.downloadCount ?? 0 });
      setPage(data.page);
      if (replace) countedThumbIdsRef.current.clear();
      setPhotos(previous => replace ? data.items : [...previous, ...data.items.filter(item => !previous.some(photo => photo.id === item.id))]);
    } catch {
      if (key === requestKeyRef.current) setFailed(true);
    } finally {
      if (key === requestKeyRef.current) { loadingRef.current = false; setLoading(false); }
    }
  }, [accessToken, category, sort, direction]);

  useEffect(() => {
    requestKeyRef.current += 1;
    loadingRef.current = false;
    // Reset the remote collection and its preview together when the query changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhotos([]);
    setTotal(0); setStats({ viewCount: 0, downloadCount: 0 }); setPage(1);
    setPreviewVisible(false); setPlaying(false); setPreviewIndex(0);
    countedThumbIdsRef.current.clear();
    void loadPage(1, true);
    return () => { requestKeyRef.current += 1; loadingRef.current = false; };
  }, [loadPage]);

  useEffect(() => {
    const node = wallRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || failed || previewVisible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingRef.current && photos.length < total) void loadPage(page + 1, false);
    }, { rootMargin: '300px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [photos.length, total, page, loadPage, failed, previewVisible, layout, containerWidth]);

  useEffect(() => {
    if (!playing || !previewVisible || failed) return;
    const timer = window.setTimeout(() => {
      if (previewIndex < photos.length - 1) setPreviewIndex(index => index + 1);
      else if (photos.length < total) void loadPage(page + 1, false);
      else setPlaying(false);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [playing, previewVisible, previewIndex, photos.length, total, page, loadPage, failed]);

  // Reserve exact image space before loading; keep API order in the DOM.
  const masonry = useMemo(() => {
    const columns = containerWidth > 1024 ? 4 : containerWidth > 640 ? 3 : 2;
    const gap = containerWidth > 640 ? 10 : 4;
    const width = Math.max(0, (containerWidth - gap * (columns - 1)) / columns);
    const heights = Array<number>(columns).fill(0);
    const positions = photos.map(photo => {
      const column = heights.indexOf(Math.min(...heights));
      const height = width * (photo.width > 0 && photo.height > 0 ? photo.height / photo.width : 3 / 4) + 58;
      const position = { left: column * (width + gap), top: heights[column], width };
      heights[column] += height + gap;
      return position;
    });
    return { positions, height: Math.max(0, ...heights) };
  }, [containerWidth, photos]);

  const timeline = useMemo(() => {
    const groups = new Map<string, { item: PhotoItem; index: number }[]>();
    photos.forEach((item, index) => {
      const key = dateKey(item.uploadedAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ item, index });
    });
    return [...groups];
  }, [photos]);

  function incrementLocalStat(id: string, key: 'viewCount' | 'downloadCount') {
    setPhotos(previous => previous.map(photo => photo.id === id ? { ...photo, [key]: photo[key] + 1 } : photo));
    setStats(previous => ({ ...previous, [key]: previous[key] + 1 }));
  }
  function openPreview(index: number) {
    setPreviewIndex(index); setPreviewVisible(true);
    if (photos[index]) incrementLocalStat(photos[index].id, 'viewCount');
  }
  function downloadPhoto(item: PhotoItem) {
    incrementLocalStat(item.id, 'downloadCount');
    const anchor = document.createElement('a');
    anchor.href = fullUrl(item.downloadUrl);
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  }
  function changeSort(next: PhotoSort) {
    setSort(next);
    if (layout === 'timeline' && next !== 'LATEST') setLayout('masonry');
  }
  async function shareGallery() {
    try {
      if (navigator.share) await navigator.share({ title: document.title, url: window.location.href });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(window.location.href); message.success(t.copied); }
      else setShareOpen(true);
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setShareOpen(true);
    }
  }
  function renderCard(item: PhotoItem, index: number) {
    return (
      <article key={item.id} className={`${styles.card} photo-card`} data-photo-id={item.id}
        style={layout === 'masonry' ? { position: 'absolute', ...masonry.positions[index] } : undefined}>
        <button type="button" className={`${styles.media} photo-media`} aria-label={`${t.preview} ${index + 1}`}
          style={{ aspectRatio: layout === 'grid' ? '1' : `${item.width || 4} / ${item.height || 3}` }} onClick={() => openPreview(index)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="photo-thumbnail" src={fullUrl(item.thumbUrl)} alt={`${t[item.category]} ${item.seq}`}
            width={item.width || undefined} height={item.height || undefined} loading="lazy" decoding="async"
            onLoad={() => {
              if (countedThumbIdsRef.current.has(item.id)) return;
              countedThumbIdsRef.current.add(item.id); incrementLocalStat(item.id, 'viewCount');
            }} />
        </button>
        <div className={styles.footer}>
          <div className={styles.actions}>
            <button type="button" onClick={() => openPreview(index)} aria-label={`${t.preview} ${index + 1}`} title={t.views}>
              <EyeOutlined /><span className={styles.actionLabel}>{t.views}</span><span>{item.viewCount.toLocaleString(language)}</span>
            </button>
            <button type="button" onClick={() => downloadPhoto(item)} aria-label={`${t.download} ${index + 1}`} title={t.download}>
              <DownloadOutlined /><span className={styles.actionLabel}>{t.download}</span><span>{item.downloadCount.toLocaleString(language)}</span>
            </button>
          </div>
          <time dateTime={item.uploadedAt}>{new Date(item.uploadedAt).toLocaleString(language, {
            timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
          })}</time>
        </div>
      </article>
    );
  }

  const settings = (
    <div className={styles.settings}>
      <button type="button" className={styles.movieButton} aria-label={t.movie} disabled={!photos.length} onClick={() => {
        setSettingsOpen(false); openPreview(0); setPlaying(true);
      }}><PlayCircleOutlined /> {t.movie}</button>
      <fieldset><legend>{t.layout}</legend>
        {(['immersive', 'masonry', 'grid', 'timeline'] as Layout[]).map(value => (
          <label key={value}><input type="radio" name="gallery-layout" aria-label={t[value]} value={value} checked={layout === value}
            onChange={() => { setLayout(value); if (value === 'timeline') setSort('LATEST'); setSettingsOpen(false); }} />
            {layoutIcons[value]}<span>{t[value]}</span></label>
        ))}
      </fieldset>
      <fieldset><legend>{t.order}</legend>
        {(['asc', 'desc'] as const).map(value => (
          <label key={value}><input type="radio" name="gallery-order" aria-label={t[value]} checked={direction === value}
            onChange={() => { setDirection(value); setSettingsOpen(false); }} />
            {value === 'asc' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}<span>{t[value]}</span></label>
        ))}
      </fieldset>
      <fieldset><legend>{t.language}</legend>
        {([['zh-CN', '简体'], ['zh-TW', '繁體'], ['en', 'English']] as const).map(([value, label]) => (
          <label key={value}><input type="radio" name="gallery-language" checked={language === value}
            onChange={() => onLanguageChange?.(value)} /><span>{label}</span></label>
        ))}
      </fieldset>
    </div>
  );

  return (
    <ConfigProvider locale={locales[language]}>
      <div className={styles.gallery} lang={language}>
        <div className={styles.toolbar}>
          <div className={styles.topbar}>
            <div className={styles.tabs} aria-label={t.order}>
              {([['LATEST', t.photos], ['POPULAR', t.popular], ['DOWNLOADS', t.downloads]] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={sort === value} onClick={() => changeSort(value)}>{label}</button>
              ))}
            </div>
            <button type="button" className={styles.iconButton} aria-label={t.share} onClick={() => void shareGallery()}><ShareAltOutlined /></button>
            <Popover content={settings} trigger="click" placement="bottomRight" open={settingsOpen} onOpenChange={setSettingsOpen}>
              <button type="button" className={styles.iconButton} aria-label={t.settings} aria-expanded={settingsOpen}
                onKeyDown={event => { if (event.key === 'Escape') setSettingsOpen(false); }}><SettingOutlined /></button>
            </Popover>
          </div>
          <div className={styles.categories}>
            {(['ALL', 'PLAYER', 'MATCH', 'AWARD'] as Category[]).map(value => (
              <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}>
                {value === 'ALL' ? t.all : t[value]}
              </button>
            ))}
          </div>
          <div className={styles.summary}><span><EyeOutlined /> {stats.viewCount.toLocaleString(language)} {t.views}</span>
            <span><DownloadOutlined /> {stats.downloadCount.toLocaleString(language)} {t.download}</span>
            {layout === 'timeline' && <span>{t.timelineHint}</span>}
          </div>
        </div>
        <Image.PreviewGroup styles={{ popup: { mask: { backgroundColor: 'rgba(0, 0, 0, 0.96)' } } }}
          items={photos.map(photo => fullUrl(photo.url))} preview={{
          open: previewVisible, current: previewIndex,
          onOpenChange: open => { setPreviewVisible(open); if (!open) setPlaying(false); },
          onChange: index => { setPreviewIndex(index); if (photos[index]) incrementLocalStat(photos[index].id, 'viewCount'); },
          actionsRender: original => <div className={styles.previewActions}>
            <div className={styles.previewButtons}>
              <button type="button" onClick={() => setPlaying(value => !value)} aria-label={playing ? t.pause : t.play}>
                {playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />} {playing ? t.pause : t.play}
              </button>
              <button type="button" onClick={() => { if (photos[previewIndex]) downloadPhoto(photos[previewIndex]); }}><DownloadOutlined /> {t.download}</button>
              {failed && <button type="button" onClick={() => void loadPage(page + 1, false)}>{t.retry}</button>}
            </div>{original}
          </div>,
        }}>
          <div ref={wallRef} className={styles.wall}>
            {layout === 'timeline' ? timeline.map(([date, entries]) => (
              <section className={styles.timelineGroup} key={date}>
                <h2>{date}</h2><div className={styles.timelineGrid}>{entries.map(({ item, index }) => renderCard(item, index))}</div>
              </section>
            )) : <div className={`${styles[layout]} photo-grid`} data-layout={layout}
              style={layout === 'masonry' ? { height: masonry.height } : undefined}>{photos.map(renderCard)}</div>}
          </div>
        </Image.PreviewGroup>
        {!photos.length && !loading && !failed && <Empty description={t.empty} className={styles.empty} />}
        <div ref={sentinelRef} style={{ height: 1 }} />
        <div className={styles.status} aria-live="polite">
          {loading ? <Spin /> : failed ? <><span>{t.error}</span><button type="button" onClick={() => void loadPage(photos.length ? page + 1 : 1, !photos.length)}>{t.retry}</button></>
            : photos.length > 0 && (photos.length >= total ? t.end : <button type="button" onClick={() => void loadPage(page + 1, false)}>{t.more}</button>)}
        </div>
        <FloatButton.BackTop tooltip={t.top} visibilityHeight={500} />
        <Modal open={shareOpen} title={t.share} footer={null} onCancel={() => setShareOpen(false)}>
          <p>{t.shareHint}</p><input className={styles.shareInput} readOnly aria-label={t.copy}
            value={shareOpen ? window.location.href : ''} onFocus={event => event.target.select()} />
        </Modal>
      </div>
    </ConfigProvider>
  );
}
