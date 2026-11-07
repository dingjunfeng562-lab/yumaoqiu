'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { matchesSearch } from '@/lib/search-text';
import { HighlightText, SearchBox } from './SearchBox';
import { API_BASE, formatDate, type PublicCompetition } from './types';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * 「切换赛事」按钮 + 弹层（手机底部弹出，电脑居中）。
 * 弹层里可按赛事名搜索；选中后跳到该赛事的同一类页面（赛事主页 / 比分直播 / 赛事简介）。
 */
export function TournamentSwitcher({
  currentId,
  target = 'detail',
}: {
  currentId: string;
  target?: 'detail' | 'live' | 'intro';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [competitions, setCompetitions] = useState<PublicCompetition[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');

  const load = async () => {
    setLoadState('loading');
    try {
      const res = await fetch(`${API_BASE}/competitions`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setCompetitions((await res.json()) as PublicCompetition[]);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  };

  const openSheet = () => {
    setOpen(true);
    setQuery('');
    if (loadState === 'idle' || loadState === 'error') void load();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const keyword = query.trim();
  const visible = useMemo(
    () => competitions.filter((competition) => matchesSearch(competition.title, keyword)),
    [competitions, keyword],
  );

  const choose = (id: string) => {
    setOpen(false);
    if (id === currentId) return;
    router.push(target === 'detail' ? `/competitions/${id}` : `/competitions/${id}/${target}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="tappable inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3.5 text-xs font-black text-white transition hover:bg-white/20 sm:h-10 sm:px-4 sm:text-sm"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h12l-3-3M17 17H5l3 3" />
        </svg>
        切换赛事
      </button>

      {/* 挂到 body 上：按钮所在的页头区块有自己的层叠上下文（relative z-10），
          不挂出去的话弹层会被站点顶栏和底部导航盖住。 */}
      {open ? createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="切换赛事">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 cursor-default bg-slate-950/50 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <div className="safe-pb relative flex max-h-[82dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-[#f5f8ff] text-slate-900 shadow-2xl sm:max-h-[78vh] sm:max-w-lg sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-blue-100 bg-white px-4 py-3">
              <h2 className="text-base font-black">切换赛事</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5" aria-hidden>
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="border-b border-blue-100 bg-white px-4 pb-3 pt-3">
              <SearchBox value={query} onChange={setQuery} label="搜索赛事" placeholder="输入赛事名称搜索…" autoFocus />
            </div>
            <div className="min-h-[200px] flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              {loadState === 'loading' || loadState === 'idle' ? (
                <p className="py-10 text-center text-sm font-semibold text-slate-400">正在加载赛事…</p>
              ) : loadState === 'error' ? (
                <div className="py-10 text-center">
                  <p className="text-sm font-semibold text-slate-500">赛事列表加载失败</p>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-3 inline-flex h-10 items-center rounded-lg border border-blue-200 px-4 text-sm font-black text-blue-700 hover:bg-blue-50"
                  >
                    重新加载
                  </button>
                </div>
              ) : visible.length ? (
                <ul className="space-y-2">
                  {visible.map((competition) => {
                    const current = competition.id === currentId;
                    return (
                      <li key={competition.id}>
                        <button
                          type="button"
                          onClick={() => choose(competition.id)}
                          className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                            current
                              ? 'border-blue-400 bg-blue-50'
                              : 'border-blue-100 bg-white hover:border-blue-300 hover:bg-blue-50/50'
                          }`}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0 text-[15px] font-black leading-snug text-slate-900">
                              <HighlightText text={competition.title} query={keyword} />
                            </span>
                            {current ? (
                              <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-black text-white">当前</span>
                            ) : competition.status === 'ONGOING' ? (
                              <span className="shrink-0 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-black text-white">进行中</span>
                            ) : null}
                          </span>
                          <span className="mt-1 block text-xs font-semibold text-slate-500">
                            {formatDate(competition.startDate)} - {formatDate(competition.endDate)}
                            {competition.location ? ` · ${competition.location}` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="py-10 text-center text-sm font-semibold text-slate-500">
                  {keyword ? `没有找到包含「${keyword}」的赛事` : '暂无公开赛事'}
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
