'use client';

import { useRef } from 'react';
import { splitSearchMatch } from '@/lib/search-text';

/** 前台通用搜索框：放大镜图标 + 清空按钮。字号 16px，避免 iOS 聚焦时自动放大页面。 */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
        aria-hidden
      >
        <circle cx="11" cy="11" r="6.5" />
        <path strokeLinecap="round" d="M16 16l4 4" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-xl border border-blue-100 bg-white pl-11 pr-11 text-base font-semibold text-slate-800 shadow-sm outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4" aria-hidden>
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** 把 text 里命中 query 的部分高亮。 */
export function HighlightText({
  text,
  query,
  markClassName = 'rounded-sm bg-amber-200 px-0.5 text-slate-900',
}: {
  text: string;
  query: string;
  markClassName?: string;
}) {
  const parts = query ? splitSearchMatch(text, query) : null;
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.before}
      <mark className={markClassName}>{parts.match}</mark>
      {parts.after}
    </>
  );
}

/** 把搜索词写进当前网址（不新增历史记录），刷新或转发链接时保留。 */
export function replaceSearchParam(key: string, value: string) {
  const url = new URL(window.location.href);
  const trimmed = value.trim();
  if (trimmed) url.searchParams.set(key, trimmed);
  else url.searchParams.delete(key);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
