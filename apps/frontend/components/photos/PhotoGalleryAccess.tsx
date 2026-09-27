'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Spin } from 'antd';
import { PhotosGallery } from './PhotosGallery';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

type GalleryInfo = {
  id: string;
  name: string;
  subtitle?: string | null;
  coverImageUrl?: string | null;
  startDate: string;
  endDate: string;
  location?: string | null;
  photoCount: number;
};

function coverUrl(value?: string | null) {
  if (!value) return '/generated/competition-cover-1.png';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/api/')) return `${API_ORIGIN}${value}`;
  if (value.startsWith('/')) return value;
  return '/generated/competition-cover-1.png';
}

function dateRange(startDate: string, endDate: string) {
  const format = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN');
  };
  return `${format(startDate)} — ${format(endDate)}`;
}

export function PhotoGalleryAccess({ accessToken }: { accessToken: string }) {
  const [gallery, setGallery] = useState<GalleryInfo>();
  const [entered, setEntered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/photos/access/${encodeURIComponent(accessToken)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('该赛事图片地址不存在或已失效');
        return (await response.json()) as GalleryInfo;
      })
      .then((data) => {
        if (!cancelled) setGallery(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '赛事图片加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const cover = useMemo(() => coverUrl(gallery?.coverImageUrl), [gallery?.coverImageUrl]);

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#04163f]">
        <Spin size="large" />
      </main>
    );
  }

  if (error || !gallery) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#04163f] p-6">
        <Alert type="error" showIcon title="无法访问赛事图片" description={error || '访问地址无效'} />
      </main>
    );
  }

  if (!entered) {
    return (
      <button
        type="button"
        aria-label={`进入${gallery.name}照片墙`}
        onClick={() => setEntered(true)}
        className="group relative block min-h-dvh w-full cursor-pointer overflow-hidden bg-[#04163f] text-center text-white"
      >
        <span
          className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-[1.015]"
          style={{ backgroundImage: `url("${cover}")` }}
        />
        <span className="absolute inset-0 bg-gradient-to-t from-[#020b27]/95 via-[#03143d]/20 to-[#020b27]/25" />
        <span
          className="relative z-10 grid min-h-dvh max-w-6xl"
          style={{
            marginInline: 'auto',
            padding: '112px clamp(24px, 5vw, 48px)',
            gridTemplateRows: '1fr auto 1fr',
            justifyItems: 'center',
          }}
        >
          <span className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200" style={{ alignSelf: 'end', marginBottom: 16 }}>Tournament Gallery</span>
          <span className="block max-w-4xl font-black leading-tight drop-shadow-lg" style={{ fontSize: 'clamp(24px, 6vw, 48px)', overflowWrap: 'anywhere' }}>
            {gallery.name}
          </span>
          <span style={{ alignSelf: 'start' }}>
            {gallery.subtitle ? (
              <span className="block text-base font-semibold text-blue-50/90 sm:text-xl" style={{ marginTop: 12 }}>{gallery.subtitle}</span>
            ) : null}
            <span className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-semibold text-blue-100/90" style={{ marginTop: 20 }}>
              <span>{dateRange(gallery.startDate, gallery.endDate)}</span>
              {gallery.location ? <span>{gallery.location}</span> : null}
              <span>{gallery.photoCount} 张照片</span>
            </span>
          </span>
        </span>
        <span className="absolute inset-x-0 z-10 flex justify-center" style={{ bottom: 'max(32px, env(safe-area-inset-bottom))', paddingInline: 20 }}>
          <span className="inline-flex items-center rounded-full border border-white/35 bg-white/12 text-sm font-black backdrop-blur transition group-hover:bg-white/20" style={{ padding: '12px 20px' }}>
            点击任意位置进入照片墙
          </span>
        </span>
      </button>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f4f7fb] text-slate-950">
      <header className="gallery-header bg-gradient-to-r from-[#052163] via-[#0a5dd1] to-[#03205c] text-white">
        <div className="max-w-[1440px]" style={{ marginInline: 'auto' }}>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-200">Tournament Gallery</p>
          <h1 className="gallery-title font-black" style={{ marginTop: 8 }}>{gallery.name}</h1>
          <p className="text-sm font-semibold text-blue-100/90" style={{ marginTop: 8 }}>赛事精彩瞬间</p>
        </div>
      </header>
      <section className="mx-auto max-w-[1440px]" style={{ padding: '24px 12px' }}>
        <PhotosGallery accessToken={accessToken} />
      </section>
      <style jsx>{`
        .gallery-header {
          padding: 32px 20px;
          text-align: center;
        }
        .gallery-title {
          font-size: 36px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }
        @media (max-width: 639px) {
          .gallery-header {
            padding: 24px 20px;
          }
          .gallery-title {
            font-size: 20px;
            line-height: 1.5;
          }
        }
      `}</style>
    </main>
  );
}
