'use client';

import Image from 'next/image';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CloseOutlined,
  DownOutlined,
  PauseOutlined,
  RightOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
};

type PublicAiSettings = {
  enabled: boolean;
  welcomeMessage: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const FALLBACK_WELCOME = '你好！我是羽动云赛的 AI 小助手，有什么关于赛事的问题可以问我哦。';

async function readApiError(response: Response) {
  const payload = await response.json().catch(() => null);
  const message = payload?.message;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return response.statusText || '请求失败';
}

export function AiShuttleChat() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: FALLBACK_WELCOME },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Track which thinking sections are expanded
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set());

  const toggleThinking = (index: number) => {
    setExpandedThinking((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  useEffect(() => {
    if (!API_BASE) return;

    let cancelled = false;
    fetch(`${API_BASE}/ai-chat/settings`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        return response.json() as Promise<PublicAiSettings>;
      })
      .then((settings) => {
        if (cancelled) return;
        const nextWelcome = settings.welcomeMessage || FALLBACK_WELCOME;
        setEnabled(settings.enabled);
        setMessages((prev) =>
          prev.length === 1 && prev[0]?.role === 'assistant'
            ? [{ role: 'assistant', content: nextWelcome }]
            : prev,
        );
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll on new content
  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, open, loading]);

  const canSend = useMemo(
    () => Boolean(API_BASE && enabled && input.trim() && !loading),
    [enabled, input, loading],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  // Cancel ongoing stream on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!canSend || !API_BASE) return;

      const userMessage: ChatMessage = { role: 'user', content: input.trim() };
      const historyMessages = [
        ...messages,
        userMessage,
      ];
      setMessages(historyMessages);
      setInput('');
      setLoading(true);

      // Add a placeholder assistant message for streaming
      const assistantIndex = historyMessages.length;
      setMessages((prev) => [...prev, { role: 'assistant', content: '', thinking: '' }]);

      const abortController = new AbortController();
      abortRef.current = abortController;

      const chatHistory = historyMessages
        .filter((m, i) => !(i === 0 && m.role === 'assistant'))
        .slice(-24)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        const response = await fetch(`${API_BASE}/ai-chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: chatHistory }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let thinkingText = '';
        let contentText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'thinking' && parsed.text) {
                thinkingText += parsed.text;
              } else if (parsed.type === 'content' && parsed.text) {
                contentText += parsed.text;
              } else if (parsed.type === 'error' && parsed.text) {
                contentText = parsed.text;
              }
            } catch {
              // skip non-JSON
            }

            // Update the assistant message in place
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.length - 1;
              if (next[idx]?.role === 'assistant') {
                next[idx] = {
                  role: 'assistant',
                  content: contentText,
                  thinking: thinkingText,
                };
              }
              return next;
            });
          }
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        const errorMsg = error instanceof Error ? error.message : 'AI 服务连接异常，请稍后再试。';
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.length - 1;
          if (next[idx]?.role === 'assistant') {
            next[idx] = { role: 'assistant', content: errorMsg };
          }
          return next;
        });
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [canSend, input, messages, API_BASE],
  );

  const disabledText = !API_BASE
    ? 'AI 服务地址未配置。'
    : settingsLoaded
      ? 'AI 助手暂未开放。'
      : 'AI 助手加载中。';

  return (
    <>
      {open ? (
        <section className="ai-chat-window fixed bottom-24 right-3 z-[70] flex h-[min(560px,calc(100vh-132px))] w-[calc(100vw-24px)] max-w-[380px] flex-col overflow-hidden rounded-2xl border border-cyan-100/40 bg-white text-slate-900 shadow-[0_26px_70px_rgba(2,8,23,0.38)] md:right-24 md:top-[calc(50%-280px)] md:bottom-auto">
          {/* Header */}
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-gradient-to-r from-[#0c4da2] via-[#147bd1] to-[#f59e0b] px-4 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/16 ring-1 ring-white/28">
                <Image
                  src="/generated/logo-badminton.svg"
                  alt=""
                  width={54}
                  height={38}
                  className="h-7 w-10 object-contain"
                />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-black">羽毛球 AI</h2>
                <p className="truncate text-[11px] font-semibold text-white/78">
                  {loading ? '正在回复...' : enabled ? '在线' : '未开放'}
                </p>
              </div>
            </div>
            <button
              type="button"
              title="关闭"
              aria-label="关闭 AI 聊天"
              onClick={() => setOpen(false)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/86 transition hover:bg-white/16 hover:text-white"
            >
              <CloseOutlined style={{ fontSize: 14 }} />
            </button>
          </header>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="ai-chat-messages flex-1 space-y-3 overflow-y-auto bg-[linear-gradient(180deg,#f8fbff,#eef7ff)] px-4 py-4"
          >
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex items-start gap-2 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {/* Avatar */}
                {message.role === 'assistant' ? (
                  <span className="ai-avatar grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white ring-1 ring-sky-200 overflow-hidden">
                    <Image
                      src="/logo.png"
                      alt=""
                      width={32}
                      height={32}
                      className="h-full w-full object-contain"
                    />
                  </span>
                ) : (
                  <span className="ai-avatar grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1167d8] text-white shadow-sm">
                    <UserOutlined style={{ fontSize: 15 }} />
                  </span>
                )}

                {message.role === 'assistant' ? (
                  <div className="max-w-[82%] min-w-0">
                    {/* Thinking section — collapsible */}
                    {message.thinking ? (
                      <div className="mb-2">
                        <button
                          type="button"
                          onClick={() => toggleThinking(index)}
                          className="ai-thinking-toggle inline-flex items-center gap-1.5 rounded-lg border border-amber-200/60 bg-amber-50/70 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100/70"
                        >
                          {expandedThinking.has(index) ? (
                            <DownOutlined style={{ fontSize: 9 }} />
                          ) : (
                            <RightOutlined style={{ fontSize: 9 }} />
                          )}
                          <span>思考过程</span>
                          {message.content && (
                            <span className="text-amber-500">+</span>
                          )}
                        </button>
                        {expandedThinking.has(index) && (
                          <div className="ai-thinking-content mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-amber-200/50 bg-amber-50/50 px-3 py-2 text-xs leading-5 text-amber-900/80">
                            {message.thinking}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* Content bubble */}
                    <div className="ai-bubble-assistant whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-sky-100 bg-white px-3.5 py-2.5 text-sm leading-6 shadow-sm text-slate-800">
                      {message.content || (
                        <span className="ai-typing-cursor inline-block h-4 w-1.5 animate-pulse rounded-sm bg-sky-400 align-middle" />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="ai-bubble-user max-w-[78%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[#1167d8] px-3.5 py-2.5 text-sm leading-6 text-white shadow-sm">
                    {message.content}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={(e) => submit(e)} className="shrink-0 border-t border-slate-200 bg-white p-3">
            {!enabled || !API_BASE ? (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                {disabledText}
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={loading || !enabled || !API_BASE}
                rows={1}
                maxLength={1000}
                placeholder="问问赛事、报名、赛程..."
                className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              {loading ? (
                <button
                  type="button"
                  title="停止回答"
                  aria-label="停止 AI 回答"
                  onClick={stopGeneration}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500 text-white shadow-[0_10px_22px_rgba(217,119,6,0.3)] transition hover:bg-amber-600"
                >
                  <PauseOutlined style={{ fontSize: 16 }} />
                </button>
              ) : (
                <button
                  type="submit"
                  title="发送"
                  aria-label="发送消息"
                  disabled={!canSend}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0c63d4] text-white shadow-[0_10px_22px_rgba(12,99,212,0.26)] transition hover:bg-[#074da8] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                >
                  <SendOutlined style={{ fontSize: 14 }} />
                </button>
              )}
            </div>
          </form>
        </section>
      ) : null}

      {/* Floating shuttlecock button */}
      <button
        type="button"
        title="打开羽毛球 AI"
        aria-label="打开羽毛球 AI"
        onClick={() => setOpen((prev) => !prev)}
        className="ai-shuttle-button fixed bottom-24 right-4 z-[71] grid h-[72px] w-[72px] place-items-center rounded-full border border-cyan-100/50 bg-[radial-gradient(circle_at_35%_22%,rgba(255,255,255,0.92),rgba(125,211,252,0.36)_35%,rgba(12,77,162,0.9)_72%)] shadow-[0_18px_44px_rgba(14,165,233,0.42)] ring-4 ring-white/12 transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-amber-300/50 md:top-1/2 md:bottom-auto md:-translate-y-1/2"
      >
        <Image
          src="/generated/shuttlecock-glow.svg"
          alt=""
          width={104}
          height={68}
          className="h-16 w-24 max-w-none -translate-x-1 translate-y-0.5 object-contain"
        />
        <span className="absolute right-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-amber-300 px-1 text-[10px] font-black leading-none text-[#06245f] ring-2 ring-white">
          AI
        </span>
        <span className="absolute -left-1 bottom-1 grid h-7 w-7 place-items-center rounded-full bg-white text-[#0c63d4] shadow-md">
          <SendOutlined style={{ fontSize: 13 }} />
        </span>
      </button>
    </>
  );
}
