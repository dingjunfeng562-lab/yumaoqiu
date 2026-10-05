'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, Image, Segmented, Spin, Typography, message } from 'antd';
import { DownloadOutlined, EyeOutlined } from '@ant-design/icons';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');
const PAGE_SIZE = 30;
type PhotoSort = 'POPULAR' | 'DOWNLOADS' | 'LATEST';
const SORT_OPTIONS: { label: string; value: PhotoSort }[] = [
  { label: '热门排行', value: 'POPULAR' },
  { label: '下载最多', value: 'DOWNLOADS' },
  { label: '最新上传', value: 'LATEST' },
];

type PhotoItem = {
  id: string;
  category: 'PLAYER' | 'MATCH' | 'AWARD';
  seq: number;
  url: string;
  thumbUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  uploadedAt: string;
  viewCount: number;
  downloadCount: number;
};

type PhotoPage = {
  total: number;
  page: number;
  pageSize: number;
  stats?: {
    viewCount: number;
    downloadCount: number;
  };
  items: PhotoItem[];
};

const CATEGORY_OPTIONS = [
  { label: '全部', value: 'ALL' },
  { label: '选手照', value: 'PLAYER' },
  { label: '现场照', value: 'MATCH' },
  { label: '颁奖照', value: 'AWARD' },
] as const;

const CATEGORY_FILE_LABEL: Record<PhotoItem['category'], string> = {
  PLAYER: '选手照',
  MATCH: '现场照',
  AWARD: '颁奖照',
};

function fullUrl(path: string) {
  return `${API_ORIGIN}${path}`;
}

function formatDateTime(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN', { hour12: false });
}

export function PhotosGallery({ accessToken }: { accessToken: string }) {
  const [category, setCategory] = useState<string>('ALL');
  const [sort, setSort] = useState<PhotoSort>('POPULAR');
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [photoStats, setPhotoStats] = useState({ viewCount: 0, downloadCount: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const totalStats = {
    views: photoStats.viewCount,
    downloads: photoStats.downloadCount,
  };

  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const requestKeyRef = useRef(0);
  const countedThumbIdsRef = useRef<Set<string>>(new Set());

  const loadPage = useCallback(
    async (targetPage: number, replace: boolean) => {
      if (!accessToken || loadingRef.current) return;
      const requestKey = ++requestKeyRef.current;
      loadingRef.current = true;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          accessToken,
          sort,
          page: String(targetPage),
          pageSize: String(PAGE_SIZE),
        });
        if (category !== 'ALL') params.set('category', category);
        const res = await fetch(`${API_BASE}/photos?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('加载失败');
        const data = (await res.json()) as PhotoPage;
        if (requestKey !== requestKeyRef.current) return;
        setTotal(data.total);
        setPhotoStats({
          viewCount: data.stats?.viewCount ?? 0,
          downloadCount: data.stats?.downloadCount ?? 0,
        });
        setPage(data.page);
        if (replace) countedThumbIdsRef.current.clear();
        setPhotos((prev) => (replace ? data.items : [...prev, ...data.items]));
      } catch {
        if (requestKey === requestKeyRef.current) message.error('图片加载失败');
      } finally {
        if (requestKey === requestKeyRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [accessToken, category, sort],
  );

  // Start from page one when the category, ordering, or access address changes.
  useEffect(() => {
    if (!accessToken) return;
    // Cancel any in-flight request so a fast filter/tab switch cannot block the new load.
    requestKeyRef.current += 1;
    loadingRef.current = false;
    setPhotos([]);
    setTotal(0);
    setPhotoStats({ viewCount: 0, downloadCount: 0 });
    countedThumbIdsRef.current.clear();
    setPage(1);
    setPreviewVisible(false);
    setPreviewIndex(0);
    void loadPage(1, true);
    return () => {
      requestKeyRef.current += 1;
      loadingRef.current = false;
    };
  }, [accessToken, category, sort, loadPage]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current && photos.length < total) {
          void loadPage(page + 1, false);
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [photos.length, total, page, loadPage]);

  function incrementLocalStat(photoId: string, key: 'viewCount' | 'downloadCount') {
    setPhotos((prev) =>
      prev.map((photo) =>
        photo.id === photoId ? { ...photo, [key]: (photo[key] ?? 0) + 1 } : photo,
      ),
    );
    setPhotoStats((prev) => ({ ...prev, [key]: prev[key] + 1 }));
  }

  function openPreview(index: number) {
    const item = photos[index];
    if (item) incrementLocalStat(item.id, 'viewCount');
    setPreviewIndex(index);
    setPreviewVisible(true);
  }

  function countThumbView(photoId: string) {
    if (countedThumbIdsRef.current.has(photoId)) return;
    countedThumbIdsRef.current.add(photoId);
    incrementLocalStat(photoId, 'viewCount');
  }

  function downloadPhoto(item: PhotoItem) {
    // Go through the download endpoint, not the raw /uploads URL: the server
    // streams the high-res watermarked version with a 赛事名-分类-序号.ext filename.
    incrementLocalStat(item.id, 'downloadCount');
    const a = document.createElement('a');
    a.href = fullUrl(item.downloadUrl);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          options={CATEGORY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          value={category}
          onChange={(v) => setCategory(String(v))}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Segmented<PhotoSort>
          aria-label="照片排序"
          options={SORT_OPTIONS}
          value={sort}
          onChange={setSort}
        />
      </div>

      {photos.length > 0 && (
        <div style={{ marginBottom: 16, color: '#64748b', fontSize: 13 }}>
          <EyeOutlined /> {totalStats.views.toLocaleString()} 浏览
          &nbsp;&nbsp;
          <DownloadOutlined /> {totalStats.downloads.toLocaleString()} 下载
        </div>
      )}

      {photos.length === 0 && !loading ? (
        <Empty description="该分类下暂无图片" style={{ padding: 48 }} />
      ) : (
        <Image.PreviewGroup
          items={photos.map((p) => fullUrl(p.url))}
          preview={{
            visible: previewVisible,
            current: previewIndex,
            onVisibleChange: (v) => setPreviewVisible(v),
            onChange: (c) => {
              setPreviewIndex(c);
              const item = photos[c];
              if (item) incrementLocalStat(item.id, 'viewCount');
            },
          }}
        >
          <div className="photo-grid">
            {photos.map((item, index) => (
              <div
                key={item.id}
                className="photo-card"
                style={{
                  borderRadius: 10,
                  overflow: 'hidden',
                  position: 'relative',
                  background: '#fff',
                  boxShadow: '0 4px 16px rgba(15,30,80,0.08)',
                }}
              >
                <div className="photo-media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="photo-thumbnail-backdrop"
                  src={fullUrl(item.thumbUrl)}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="photo-thumbnail"
                  src={fullUrl(item.thumbUrl)}
                  alt={CATEGORY_FILE_LABEL[item.category]}
                  width={item.width || undefined}
                  height={item.height || undefined}
                  loading="lazy"
                  decoding="async"
                  onLoad={() => countThumbView(item.id)}
                  onClick={() => openPreview(index)}
                />
                <div className="photo-overlay">
                  <button
                    type="button"
                    className="photo-overlay-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      openPreview(index);
                    }}
                  >
                    <EyeOutlined /> 查看大图
                  </button>
                  <button
                    type="button"
                    className="photo-overlay-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadPhoto(item);
                    }}
                  >
                    <DownloadOutlined /> 下载
                  </button>
                </div>
                </div>
                <div style={{ padding: '6px 8px' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDateTime(item.uploadedAt)}
                  </Typography.Text>
                  <span
                    style={{
                      marginLeft: 12,
                      color: '#94a3b8',
                      fontSize: 11,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>
                      <EyeOutlined /> 浏览 {item.viewCount}
                    </span>
                    <span>
                      <DownloadOutlined /> 下载 {item.downloadCount}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Image.PreviewGroup>
      )}

      <div ref={sentinelRef} style={{ height: 1 }} />
      {loading && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      )}
      {!loading && photos.length > 0 && photos.length >= total && (
        <div style={{ textAlign: 'center', padding: 16, color: '#94a3b8' }}>已加载全部图片</div>
      )}

      <style jsx>{`
        .photo-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          align-items: start;
          gap: 12px;
        }
        .photo-card {
          min-width: 0;
        }
        .photo-media {
          position: relative;
          overflow: hidden;
          aspect-ratio: 4 / 3;
          background: #e8eef5;
        }
        .photo-thumbnail-backdrop,
        .photo-thumbnail {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
        }
        .photo-thumbnail-backdrop {
          object-fit: cover;
          filter: blur(14px);
          opacity: 0.48;
          transform: scale(1.12);
        }
        .photo-thumbnail {
          position: relative;
          object-fit: contain;
          object-position: center;
          cursor: zoom-in;
          z-index: 1;
        }
        .photo-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          background: rgba(2, 12, 42, 0.45);
          opacity: 0;
          transition: opacity 0.2s ease;
          z-index: 2;
        }
        .photo-media:hover .photo-overlay {
          opacity: 1;
        }
        .photo-overlay-btn {
          border: 1px solid rgba(255, 255, 255, 0.7);
          background: rgba(255, 255, 255, 0.15);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 10px;
          border-radius: 8px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .photo-overlay-btn:hover {
          background: rgba(255, 255, 255, 0.28);
        }
        @media (max-width: 640px) {
          .photo-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          .photo-card {
            border-radius: 8px !important;
          }
          .photo-overlay-btn {
            font-size: 11px;
            padding: 5px 7px;
            border-radius: 7px;
          }
        }
      `}</style>
    </div>
  );
}
