'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Alert, Button, Drawer, Empty, Input, Modal, Popconfirm, Select, Space, Spin, message } from 'antd';
import { CheckCircleFilled, ExportOutlined, FullscreenOutlined, ReloadOutlined } from '@ant-design/icons';
import { io } from 'socket.io-client';
import { apiFetch } from '@/lib/api';
import { clock, dateKey, EVENT_LABELS, matchScore, matchState, type CheckInBoardData, type CheckInMatch } from './types';
import styles from './check-in.module.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const LEGEND = [['waiting', '未签到'], ['partial', '单方签到'], ['ready', '双方到齐'], ['live', '比赛中'], ['finished', '已结束'], ['forfeit', '弃权']];
const errorText = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试';
// 工作人员页收到推送 0.6 秒内刷新。观众页人多，每得一分一次的比分推送最多 5 秒刷新一次（线上出口带宽有限）；
// 签到、晋级推送仍 0.6 秒内刷新。
const FAST_REFRESH_MS = 600;
const PUBLIC_SCORE_REFRESH_MS = 5000;

/**
 * 带超时的请求信号。不用 AbortSignal.any / AbortSignal.timeout：iOS 17.4 以前的 Safari 和微信里没有，
 * 观众页会一直停在「加载中」。
 */
function timeoutSignal(parent: AbortSignal | null, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const follow = () => controller.abort();
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', follow);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => { window.clearTimeout(timer); parent?.removeEventListener('abort', follow); },
  };
}

export function CheckInBoard({ tournamentId, token, staff = false, canForfeit = false }: { tournamentId: string; token?: string; staff?: boolean; canForfeit?: boolean }) {
  const [data, setData] = useState<CheckInBoardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [updated, setUpdated] = useState('');
  const [date, setDate] = useState('');
  const [project, setProject] = useState('ALL');
  const [keyword, setKeyword] = useState('');
  const [scale, setScale] = useState(75);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [forfeitTarget, setForfeitTarget] = useState<CheckInMatch | null>(null);
  const [forfeitSide, setForfeitSide] = useState<'1' | '2' | 'both'>();
  const [forfeitReason, setForfeitReason] = useState('');
  const savingRef = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const matchesRef = useRef(new Set<string>());

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const stored = Number(localStorage.getItem('match-check-in-scale'));
        if (stored >= 50 && stored <= 125) setScale(stored);
      } catch { /* storage may be unavailable */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const changeScale = (value: number) => {
    const next = Math.min(125, Math.max(50, value));
    setScale(next);
    try { localStorage.setItem('match-check-in-scale', String(next)); } catch { /* optional preference */ }
  };

  const refresh = useCallback(async () => {
    if (staff && !token) return;
    const request = ++seq.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout = timeoutSignal(abort.signal, 12000);
    const signal = timeout.signal;
    try {
      const path = staff ? `/check-in/tournaments/${encodeURIComponent(tournamentId)}` : `/public/tournaments/${encodeURIComponent(tournamentId)}/check-in`;
      let next: CheckInBoardData;
      if (staff) {
        next = await apiFetch<CheckInBoardData>(path, { token, cache: 'no-store', signal, redirectOnForbidden: false });
      } else {
        const response = await fetch(`${API}${path}`, { cache: 'no-store', signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (request === seq.current && (response.status === 403 || response.status === 404)) setData(null);
          throw new Error(body?.message ?? '暂时无法获取赛程');
        }
        next = await response.json();
      }
      if (request !== seq.current || abort.signal.aborted) return;
      matchesRef.current = new Set(next.matches.map((m) => m.id));
      setData(next);
      setUpdated(next.generatedAt);
      setError('');
      setDate((current) => {
        if (current) return current;
        const today = dateKey(new Date());
        const dates = [...new Set(next.matches.flatMap((m) => m.scheduledAt ? [dateKey(m.scheduledAt)] : []))].sort();
        return dates.includes(today) ? today : dates.find((d) => d > today) ?? dates[dates.length - 1] ?? today;
      });
    } catch (reason) {
      if (!abort.signal.aborted && request === seq.current) {
        if (reason && typeof reason === 'object' && 'status' in reason && [401, 403, 404].includes(Number(reason.status))) setData(null);
        setError(timeout.timedOut() || (reason instanceof Error && reason.name === 'TimeoutError') ? '连接超时，正在重试' : errorText(reason));
      }
    } finally {
      timeout.clear();
      if (request === seq.current && !abort.signal.aborted) setLoading(false);
    }
  }, [staff, token, tournamentId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const focus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      window.clearTimeout(initial);
      controller.current?.abort();
      window.clearInterval(poll);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [refresh]);

  useEffect(() => {
    const socket = io(`${API.replace(/\/api\/?$/, '')}/scores`, { transports: ['polling', 'websocket'], withCredentials: true });
    let timer: number | undefined;
    let dueAt = 0;
    const schedule = (delay: number) => (payload?: { tournamentId?: string; matchId?: string; id?: string; event?: { tournamentId?: string; tournament?: { id?: string } } }) => {
      const id = payload?.tournamentId ?? payload?.event?.tournamentId ?? payload?.event?.tournament?.id;
      const matchId = payload?.matchId ?? payload?.id;
      if (id ? id !== tournamentId : matchId && !matchesRef.current.has(matchId)) return;
      // Throttle, do not postpone indefinitely while several courts are scoring;
      // a faster event (check-in, bracket) pulls a pending slow refresh forward.
      const due = Date.now() + delay;
      if (timer !== undefined) {
        if (dueAt <= due) return;
        window.clearTimeout(timer);
      }
      dueAt = due;
      timer = window.setTimeout(() => { timer = undefined; void refresh(); }, delay);
    };
    socket.on('connect', () => { setConnected(true); void refresh(); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('check-in:update', schedule(FAST_REFRESH_MS));
    socket.on('scoreboard:update', schedule(staff ? FAST_REFRESH_MS : PUBLIC_SCORE_REFRESH_MS));
    socket.on('bracket:update', schedule(FAST_REFRESH_MS));
    return () => { socket.disconnect(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [refresh, staff, tournamentId]);

  const today = dateKey(new Date());
  const dates = useMemo(() => [...new Set([today, ...(data?.matches.flatMap((m) => m.scheduledAt ? [dateKey(m.scheduledAt)] : []) ?? [])])].sort(), [data, today]);
  const filtered = useMemo(() => (data?.matches ?? []).filter((m) =>
    (project === 'ALL' || m.eventType === project) &&
    (!keyword.trim() || [m.matchNo, m.round, m.side1.name, m.side2.name, m.side1.teamName, m.side2.teamName].join(' ').toLowerCase().includes(keyword.trim().toLowerCase())),
  ), [data, keyword, project]);
  const sections = useMemo(() => {
    const groups = new Map<string, CheckInMatch[]>();
    for (const match of filtered) {
      const key = match.scheduledAt ? dateKey(match.scheduledAt) : 'UNSCHEDULED';
      if (date !== 'ALL' && key !== date && key !== 'UNSCHEDULED') continue;
      groups.set(key, [...(groups.get(key) ?? []), match]);
    }
    return [...groups].sort(([a], [b]) => a === 'UNSCHEDULED' ? 1 : b === 'UNSCHEDULED' ? -1 : a.localeCompare(b));
  }, [filtered, date]);
  const venues = useMemo(() => {
    if (!data) return [];
    const list = data.venues.filter((v) => v.isActive || data.matches.some((m) => m.venueId === v.id));
    if (data.matches.some((m) => !m.venueId || !data.venues.some((v) => v.id === m.venueId))) {
      return [...list, { id: 'UNASSIGNED', name: '待分配场地', isActive: true }];
    }
    return list;
  }, [data]);
  const selected = data?.matches.find((m) => m.id === selectedId);
  const currentForfeitTarget = data?.matches.find((m) => m.id === forfeitTarget?.id);
  const forfeitTargetChanged = !!forfeitTarget && (!currentForfeitTarget?.canCheckIn ||
    currentForfeitTarget.side1.key !== forfeitTarget.side1.key || currentForfeitTarget.side2.key !== forfeitTarget.side2.key);
  const submitForfeit = async () => {
    if (!forfeitTarget || !forfeitSide || !token || !canForfeit || savingRef.current || forfeitTargetChanged || error) return;
    savingRef.current = true;
    setSaving(true);
    const timeout = timeoutSignal(null, 12000);
    try {
      // Recheck the pairing after the confirmation dialog has been open.
      const latest = await apiFetch<CheckInBoardData>(`/check-in/tournaments/${encodeURIComponent(tournamentId)}`, {
        token, cache: 'no-store', redirectOnForbidden: false, signal: timeout.signal,
      });
      const match = latest.matches.find((m) => m.id === forfeitTarget.id);
      if (!match?.canCheckIn || match.side1.key !== forfeitTarget.side1.key || match.side2.key !== forfeitTarget.side2.key) {
        throw new Error('比赛状态或对阵选手已变更，请关闭弹窗后重新选择');
      }
      await apiFetch(`/matches/${encodeURIComponent(forfeitTarget.id)}/${forfeitSide === 'both' ? 'forfeit-both' : 'forfeit'}`, {
        method: 'POST', token, redirectOnForbidden: false,
        body: JSON.stringify({ ...(forfeitSide === 'both' ? {} : { side: Number(forfeitSide) }), reason: forfeitReason.trim() || undefined }),
      });
      message.success(forfeitSide === 'both' ? '已登记双方弃权，本场作废' : '已登记弃权，对方获胜');
      setForfeitTarget(null);
    } catch (reason) { message.error(timeout.timedOut() ? '连接超时，请重试' : errorText(reason)); }
    finally { timeout.clear(); await refresh(); savingRef.current = false; setSaving(false); }
  };
  const setCheckIn = async (side: '1' | '2' | 'both', checked: boolean) => {
    if (!selected || !token || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await apiFetch(`/check-in/matches/${encodeURIComponent(selected.id)}`, {
        method: 'PUT', token, redirectOnForbidden: false,
        body: JSON.stringify({ side, checked, side1Key: selected.side1.key, side2Key: selected.side2.key }),
      });
      message.success(checked ? '签到成功' : '已撤销签到');
    } catch (reason) { message.error(errorText(reason)); }
    finally { await refresh(); savingRef.current = false; setSaving(false); }
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { message.warning('当前浏览器不支持全屏，请使用浏览器全屏功能'); }
  };
  const renderCard = (match: CheckInMatch) => {
    const state = matchState(match);
    const content = <>
      <div className={styles.cardTop}><strong>{String(match.matchNo).padStart(3, '0')} · {EVENT_LABELS[match.eventType] ?? '比赛'}</strong><time>{match.scheduledAt ? clock(match.scheduledAt) : '时间待定'}</time></div>
      <div className={styles.round} title={match.round}>{match.round || '待定轮次'}</div>
      <div className={styles.player} title={`${match.side1.teamName ?? ''} ${match.side1.name}`}><span className={styles.sideMark}>甲</span>{match.side1.name}{match.side1.checkedAt && <CheckCircleFilled className={styles.check} />}</div>
      <div className={styles.player} title={`${match.side2.teamName ?? ''} ${match.side2.name}`}><span className={styles.sideMark}>乙</span>{match.side2.name}{match.side2.checkedAt && <CheckCircleFilled className={styles.check} />}</div>
      <div className={styles.cardBottom}><span className={styles.badge}>{state.label}</span><strong>{matchScore(match)}</strong></div>
    </>;
    const props = { className: `${styles.card} ${styles[state.key]}`, 'data-match-id': match.id, 'data-state': state.key };
    return staff ? <button key={match.id} {...props} type="button" onClick={() => setSelectedId(match.id)} aria-label={`第${match.matchNo}场，${match.side1.name} 对 ${match.side2.name}，${state.label}，打开签到`}>{content}</button>
      : <article key={match.id} {...props}>{content}</article>;
  };

  return <div ref={root} className={`${styles.root} ${staff ? styles.staff : styles.public}`} style={{ '--card-scale': scale / 100, '--court-count': Math.max(venues.length, 1) } as CSSProperties}>
    <header className={styles.header}>
      <div className={styles.heading}><span className={styles.brand}>羽动云赛</span><h1>{data?.tournament.name ?? (loading ? '加载中…' : '赛事对阵')}</h1>{staff && <span className={styles.staffTag}>签到管理</span>}</div>
      <Space wrap size={8}>
        <span className={`${styles.sync} ${error ? styles.syncError : ''}`} title={updated ? `最近更新 ${clock(updated)}` : '正在连接'}><i />{error ? '同步失败' : connected ? '实时同步' : '定时同步'}</span>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()} aria-label="刷新赛程" />
        {staff && data?.tournament.publicAvailable && <Button icon={<ExportOutlined />} href={`/match-check-in/${encodeURIComponent(tournamentId)}`} target="_blank" rel="noopener noreferrer">观众页面</Button>}
        <Button icon={<FullscreenOutlined />} onClick={() => void fullscreen()}>全屏</Button>
      </Space>
    </header>
    <div className={styles.toolbar}>
      <Space wrap>
        <Select aria-label="比赛日期" value={date || today} onChange={setDate} style={{ minWidth: 180 }} options={[{ value: 'ALL', label: '全部日期（按天分组）' }, ...dates.map((d) => ({ value: d, label: d === today ? `今天 · ${d.slice(5)}` : d }))]} />
        <Select aria-label="比赛项目" value={project} onChange={setProject} style={{ minWidth: 120 }} options={[{ value: 'ALL', label: '全部项目' }, ...Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label }))]} />
        {staff && <Input aria-label="搜索比赛" placeholder="姓名、队名、场次" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 190 }} />}
      </Space>
      <label className={styles.scale}>卡片大小<button type="button" onClick={() => changeScale(scale - 5)} aria-label="缩小卡片">−</button><input aria-label="卡片大小" type="range" min="50" max="125" step="5" value={scale} onChange={(e) => changeScale(Number(e.target.value))} /><output>{scale}%</output><button type="button" onClick={() => changeScale(scale + 5)} aria-label="放大卡片">＋</button></label>
    </div>
    <div className={styles.legend}><span>{sections.reduce((sum, [, matches]) => sum + matches.length, 0)} 场 · {venues.length} 个场地分区</span>{LEGEND.map(([key, label]) => <span key={key}><i className={styles[key]} />{label}</span>)}{staff && <small>点击对局卡片办理签到</small>}</div>
    {error && <Alert type="warning" showIcon title={error} description={data ? '当前为上次同步的数据，正在重试。同步恢复前暂停签到操作。' : undefined} />}
    {staff && data && !data.tournament.publicAvailable && <Alert type="info" showIcon title="赛事尚未公开，当前仅工作人员可见。" />}
    <main className={styles.scroll} aria-label="按场地排列的比赛" tabIndex={0}>
      {loading && !data ? <div className={styles.empty}><Spin description="正在加载赛程" /></div> : !sections.length ? <div className={styles.empty}><Empty description={error ? '暂无可用赛程' : '当前日期或筛选条件下没有比赛'} /></div> : sections.map(([day, matches]) => <section key={day} className={styles.day}>
        <div className={styles.dayTitle}>{day === 'UNSCHEDULED' ? '时间待定' : day === today ? `今天 · ${day}` : day}<span>{matches.length} 场{day === 'UNSCHEDULED' ? ' · 安排时间后自动归入对应日期' : ''}</span></div>
        <div className={styles.courts}>{venues.map((venue) => {
          const courtMatches = matches.filter((m) => venue.id === 'UNASSIGNED' ? !m.venueId || !data?.venues.some((v) => v.id === m.venueId) : m.venueId === venue.id);
          return <section key={venue.id} className={styles.court}><div className={styles.courtTitle}><strong>{venue.name}</strong><span>{courtMatches.length} 场</span></div><div className={styles.cards}>{courtMatches.map(renderCard)}{!courtMatches.length && <p className={styles.noMatches}>暂无比赛</p>}</div></section>;
        })}</div>
      </section>)}
    </main>
    {staff && <Drawer title={selected ? `第 ${selected.matchNo} 场 · 签到管理` : '比赛已变更'} open={!!selectedId} onClose={() => { if (!saving) setSelectedId(null); }} size={460} getContainer={() => root.current ?? document.body}>
      {!selected ? <Empty description="该场比赛已被删除或重新编排，请关闭后重新选择" /> : <>
        <p>{EVENT_LABELS[selected.eventType]} · {selected.round}</p>
        <p>{selected.scheduledAt ? `${dateKey(selected.scheduledAt)} ${clock(selected.scheduledAt)}` : '时间待定'} · {data?.venues.find((v) => v.id === selected.venueId)?.name ?? '待分配场地'}</p>
        <Alert showIcon type={selected.canCheckIn ? 'info' : 'warning'} title={matchState(selected).label} description={!selected.canCheckIn ? '仅双方选手已确定且尚未开赛的场次可以办理签到。' : undefined} />
        {([1, 2] as const).map((side) => {
          const item = side === 1 ? selected.side1 : selected.side2;
          return <section key={side} className={styles.signSide}><div className={styles.signTitle}>{side === 1 ? '甲方' : '乙方'}<span>{item.checkedAt ? '✓ 已签到' : '未签到'}</span></div><h2>{item.name}</h2>{item.teamName && <p>{item.teamName}</p>}
            {item.checkedAt ? <><p>签到时间 {dateKey(item.checkedAt)} {clock(item.checkedAt)}</p><Popconfirm title="确认撤销本方签到？" onConfirm={() => setCheckIn(String(side) as '1' | '2', false)} disabled={saving || !selected.canCheckIn || !!error}><Button disabled={saving || !selected.canCheckIn || !!error}>撤销签到</Button></Popconfirm></>
              : <Button type="primary" block loading={saving} disabled={!selected.canCheckIn || !!error} onClick={() => void setCheckIn(String(side) as '1' | '2', true)}>{side === 1 ? '甲方' : '乙方'}签到</Button>}
          </section>;
        })}
        <Button type="primary" block size="large" loading={saving} disabled={!selected.canCheckIn || (!!selected.side1.checkedAt && !!selected.side2.checkedAt) || !!error} onClick={() => void setCheckIn('both', true)}>双方签到</Button>
        <Button danger block style={{ marginTop: 12 }} disabled={saving || !canForfeit || !selected.canCheckIn || !!error} onClick={() => { setForfeitTarget(selected); setForfeitSide(undefined); setForfeitReason(''); }}>弃权处理</Button>
        {!canForfeit && <p className={styles.hint}>弃权处理需要裁判分配权限。</p>}
        <p className={styles.hint}>双打请确认本方两名选手均已到齐。签到结果自动同步到观众页面，比赛开始和结束状态由裁判端同步。</p>
      </>}
    </Drawer>}
    {staff && <Modal title="弃权处理" open={!!forfeitTarget} okText="确认弃权" cancelText="取消" confirmLoading={saving}
      okButtonProps={{ danger: true, disabled: !forfeitSide || !canForfeit || forfeitTargetChanged || !!error }}
      cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}
      getContainer={() => root.current ?? document.body} onCancel={() => { if (!saving) setForfeitTarget(null); }} onOk={() => void submitForfeit()}>
      {forfeitTarget && <>
        <p>第 {forfeitTarget.matchNo} 场 · {forfeitTarget.side1.name} 对 {forfeitTarget.side2.name}</p>
        <Select aria-label="弃权方" placeholder="请选择弃权方" value={forfeitSide} disabled={saving} onChange={setForfeitSide} style={{ width: '100%', marginBottom: 16 }} options={[
          { value: '1', label: `甲方弃权 · ${forfeitTarget.side1.name}` },
          { value: '2', label: `乙方弃权 · ${forfeitTarget.side2.name}` },
          { value: 'both', label: '双方弃权' },
        ]} />
        <Input.TextArea aria-label="弃权原因" placeholder="弃权原因（选填，例如未到场）" value={forfeitReason} onChange={(e) => setForfeitReason(e.target.value)} maxLength={191} showCount rows={2} disabled={saving} style={{ marginBottom: 24 }} />
        <Alert showIcon type="warning" title={forfeitSide === 'both' ? '双方弃权，本场作废，无人获胜' : forfeitSide ? `${forfeitSide === '1' ? '乙' : '甲'}方获胜：${forfeitSide === '1' ? forfeitTarget.side2.name : forfeitTarget.side1.name}` : '请核实弃权方后再确认'} description="确认后立即结束本场，并同步裁判端、观众页及后续晋级；签到页不能撤销此结果。" />
        {forfeitTargetChanged && <Alert type="error" title="比赛状态或对阵选手已变更，请关闭弹窗后重新选择。" style={{ marginTop: 12 }} />}
        {error && <Alert type="error" title="赛程同步失败，恢复后才能提交弃权。" style={{ marginTop: 12 }} />}
      </>}
    </Modal>}
  </div>;
}
