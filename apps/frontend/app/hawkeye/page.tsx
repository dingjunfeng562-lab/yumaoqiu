'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Status = 'checking' | 'online' | 'offline' | 'setup_required' | 'check_failed';

type HawkeyeStatusResponse = {
  online?: boolean;
  configured?: boolean;
  publicUrl?: string;
  message?: string;
  status?: string;
};

const statusText: Record<Status, string> = {
  checking: '检测中',
  online: '已连接',
  offline: '未启动',
  setup_required: '需要配置',
  check_failed: '检测失败',
};

export default function HawkeyePage() {
  const [status, setStatus] = useState<Status>('checking');
  const [publicUrl, setPublicUrl] = useState('');
  const [message, setMessage] = useState('');
  const openHawkeye = useCallback((url: string) => {
    window.location.href = url;
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/hawkeye-status', { cache: 'no-store' });
      if (res.status === 401) {
        setMessage('请先登录后再使用鹰眼系统，正在跳转登录页...');
        window.location.assign('/login?redirect=/hawkeye');
        return false;
      }
      if (!res.ok) {
        throw new Error('hawkeye status request failed');
      }
      const data = (await res.json()) as HawkeyeStatusResponse;
      const nextUrl = data.publicUrl || '';

      setPublicUrl(nextUrl);
      setMessage(data.message || '');

      if (!data.configured) {
        setStatus('setup_required');
        return false;
      }

      if (data.online && nextUrl) {
        setStatus('online');
        openHawkeye(nextUrl);
        return true;
      }

      setStatus('offline');
      return false;
    } catch {
      setMessage('无法连接鹰眼状态接口。');
      setStatus('check_failed');
      return false;
    }
  }, [openHawkeye]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await checkStatus();
    })();

    return () => {
      cancelled = true;
    };
  }, [checkStatus]);

  const refreshStatus = useCallback(async () => {
    setStatus('checking');
    await checkStatus();
  }, [checkStatus]);

  return (
    <div className="flex min-h-screen flex-col bg-[#04163f] text-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-white/5 px-6 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-300/30">
            ⊕
          </span>
          <h1 className="truncate text-lg font-black tracking-wide">鹰眼系统</h1>
          <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
            {statusText[status]}
          </span>
        </div>
        <Link href="/" className="rounded-lg border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-semibold text-blue-100 transition hover:bg-white/10">
          返回首页
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <section className="w-full max-w-2xl text-center">
          <div className="mx-auto mb-8 grid h-24 w-24 place-items-center rounded-full bg-emerald-500/10 ring-2 ring-emerald-400/20">
            <span className="text-5xl text-emerald-300">◎</span>
          </div>

          <h2 className="mb-4 text-3xl font-black text-white">羽毛球视频鹰眼分析系统</h2>
          <p className="mb-8 text-base leading-7 text-blue-100/70">
            连接 Good-Badminton 的 Gradio 分析服务后，可从这里进入视频分析后台。
          </p>

          {message && (
            <p className="mx-auto mb-6 max-w-xl rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-blue-100/70">
              {message}
            </p>
          )}

          <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
            {publicUrl && status !== 'setup_required' && (
              <button
                onClick={() => openHawkeye(publicUrl)}
                className="inline-flex h-12 items-center justify-center rounded-full bg-emerald-500 px-8 text-sm font-black text-white shadow-[0_12px_28px_rgba(16,185,129,0.34)] transition duration-300 hover:scale-105"
              >
                打开鹰眼系统
              </button>
            )}
            <button
              onClick={refreshStatus}
              disabled={status === 'checking'}
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/15 bg-white/[0.08] px-8 text-sm font-black text-blue-50 transition duration-300 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === 'checking' ? '正在检测...' : '重新检测服务'}
            </button>
          </div>

          <div className="mx-auto grid max-w-xl gap-4 text-left sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/5 p-5">
              <h3 className="mb-2 text-sm font-bold text-white">线上部署</h3>
              <p className="text-xs leading-6 text-blue-100/55">
                将 Gradio 单独部署成服务，并设置 <code className="text-emerald-300">HAWKEYE_PUBLIC_URL</code> 指向公网地址。
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-5">
              <h3 className="mb-2 text-sm font-bold text-white">自托管部署</h3>
              <p className="text-xs leading-6 text-blue-100/55">
                在服务器上设置 <code className="text-emerald-300">HAWKEYE_AUTOSTART=true</code>、<code className="text-emerald-300">HAWKEYE_DIR</code> 和 <code className="text-emerald-300">HAWKEYE_PYTHON</code>。
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
