import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Alert, Button, Empty, Modal, Switch, message } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { scheduleGroupLabel, type ScheduleMatch } from '@/lib/court-schedule';
import styles from './court-schedule-board.module.css';

type Venue = { id: string; name: string; isActive: boolean };
type Props = {
  tournamentId: string; token: string; version: string; days: string[]; venues: Venue[];
  matches: ScheduleMatch[]; gap: number; dailyStart: string;
  /** 服务端下发的「上一步可撤回操作」：本人最近一次调场，且排程板没被改动过。 */
  undoable?: { operationId: string; version: string } | null;
  refresh: () => Promise<void>;
};
type Destination = { targetMatchId: string } | { venueId: string; scheduledAt: string };
type Selection = { matchId: string; version: string };
type ScheduleConflict = { type: string; matchIds: string[]; message: string };
type ScheduleApiError = Error & { status?: number; response?: { code?: string; conflicts?: ScheduleConflict[] } };
const dragType = 'application/x-court-schedule';
const editable = (m: ScheduleMatch) => m.status === 'PENDING' && !m.startedAt && !m.isBye;
const complete = (m: ScheduleMatch) => Boolean(m.venueId && m.scheduledAt);
const local = (iso: string) => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0,16);
const keyFor = (venue: string, time: string) => venue + '|' + time;

export function CourtScheduleBoard(p: Props) {
  const [dayChoice, setDay] = useState('all');
  const container = useRef<HTMLElement>(null);
  const [columns, setColumns] = useState(6);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => setColumns(Math.max(1, Math.floor((el.clientWidth - 62) / 150)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [extraTime, setExtraTime] = useState('');
  const [chosen, setChosen] = useState<Selection | null>(null);
  const [over, setOver] = useState('');
  const [busy, setBusy] = useState(false);
  const posting = useRef(false);
  const drag = useRef<Selection | null>(null);
  const undo = p.undoable ?? null;
  const [outside, setOutside] = useState(false);
  const [error, setError] = useState('');
  const base = '/tournaments/' + encodeURIComponent(p.tournamentId) + '/schedule-board';
  const matches = p.matches.filter(m => !m.isBye);
  const pool = matches.filter(m => !complete(m));
  const days = [...new Set([...p.days, ...matches.flatMap(m => m.scheduledAt ? [local(m.scheduledAt).slice(0,10)] : [])])].sort();
  const scheduled = matches.filter(complete);
  const usedDays = [...new Set(scheduled.map(m => local(m.scheduledAt!).slice(0,10)))].sort();
  const visibleDays = days.includes(dayChoice) ? [dayChoice] : usedDays.length ? usedDays : days.slice(0,1);
  const cells = new Map<string, ScheduleMatch[]>();
  const timesByDay = new Map<string, Set<string>>();
  const occupied = new Map<string, Array<{ start: number; end: number }>>();
  for (const m of matches) {
    if (!complete(m) || m.status === 'CANCELLED') continue;
    const list = occupied.get(m.venueId!) ?? [];
    const start = Date.parse(m.scheduledAt!);
    list.push({ start, end: start + (m.durationMinutes + p.gap) * 60000 });
    occupied.set(m.venueId!, list);
  }
  for (const m of scheduled) {
    const stamp = local(m.scheduledAt!), day = stamp.slice(0,10), time = stamp.slice(11), key = keyFor(m.venueId!, stamp);
    const minutes = timesByDay.get(day) ?? new Set<string>();
    timesByDay.set(day, minutes);
    cells.set(key, [...(cells.get(key) ?? []), m]);
    minutes.add(time);
    const next = local(new Date(Date.parse(m.scheduledAt!) + (m.durationMinutes + p.gap) * 60000).toISOString());
    if (next.startsWith(day + 'T')) minutes.add(next.slice(11));
  }
  const courts = p.venues.filter(v => v.isActive || scheduled.some(m => m.venueId === v.id));
  const courtGroups: Venue[][] = [];
  for (let i = 0; i < courts.length; i += columns) courtGroups.push(courts.slice(i, i + columns));

  async function submitUndo() {
    if (!undo || undo.version !== p.version || posting.current) return;
    posting.current = true; setBusy(true); setError('');
    try {
      await apiFetch(base + '/' + encodeURIComponent(undo.operationId) + '/undo', {
        token: p.token, method: 'POST',
      });
      setChosen(null); setOutside(false);
      message.success('已撤回上一步');
    } catch (e) { setError(e instanceof Error ? e.message : '撤回失败，请刷新后重试'); }
    finally {
      try { await p.refresh(); } finally { posting.current = false; setBusy(false); }
    }
  }
  async function move(source: Selection, dest: Destination, confirmConflicts = false) {
    if ('targetMatchId' in dest && source.matchId === dest.targetMatchId) { setChosen(null); return; }
    if (posting.current) return;
    posting.current = true; setBusy(true); setError('');
    const body = { ...source, ...dest, allowOutsideGroup: outside, ...(confirmConflicts ? { confirmConflicts: true } : {}) };
    try {
      const result = await apiFetch<{ operationId?: string; version: string; count: number }>(base, {
        token: p.token, method: 'POST', body: JSON.stringify(body),
      });
      setChosen(null); setOutside(false);
      message.success('已更新 ' + result.count + ' 场比赛');
      await p.refresh();
    } catch (e) {
      const failure = e as ScheduleApiError;
      const conflicts = failure.response?.conflicts;
      if (failure.status === 409 && failure.response?.code === 'SCHEDULE_CONFLICT_CONFIRMATION_REQUIRED' && conflicts?.length && !confirmConflicts) {
        Modal.confirm({
          title: '调整后存在排程冲突，仍要保存吗？',
          okText: '确认仍然调换', cancelText: '返回调整', okButtonProps: { danger: true },
          content: <div>{conflicts.map((item, index) => <div key={`${item.type}-${index}`} style={{ marginTop: index ? 8 : 0 }}>{item.message}</div>)}</div>,
          onOk: async () => { await move(source, dest, true); },
        });
      } else {
        setChosen(null);
        setError(failure.message || '保存失败，请刷新后重试');
      }
    } finally {
      posting.current = false; setBusy(false);
    }
  }
  function dropEvents(dest: Destination, key: string) {
    return {
      onDragOver(e: DragEvent) {
        if (!drag.current || busy) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(key);
      },
      onDrop(e: DragEvent) {
        e.preventDefault(); setOver('');
        const source = drag.current; drag.current = null;
        if (source && !busy) move(source, dest);
      },
    };
  }
  const canUndo = Boolean(undo && undo.version === p.version && !busy);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      event.preventDefault();
      void submitUndo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  function card(m: ScheduleMatch) {
    const canMove = editable(m) && !busy;
    const status = m.status === 'LIVE' || (m.startedAt && m.status === 'PENDING') ? '比赛中' : m.status === 'COMPLETED' ? '已结束' : m.status === 'CANCELLED' ? '已取消' : m.scheduleLocked ? '人工固定' : complete(m) ? '待赛' : '待排';
    const dest = { targetMatchId: m.id };
    const sides = m.teamMatchId ? [m.team1Name, m.team2Name] : [m.side1?.name, m.side2?.name];
    const end = m.scheduledAt && local(new Date(Date.parse(m.scheduledAt) + m.durationMinutes * 60000).toISOString()).slice(11);
    return <button type="button" key={m.id} className={styles.match} disabled={!canMove} data-over={over === m.id}
      aria-pressed={chosen?.matchId === m.id} draggable={canMove} {...dropEvents(dest,m.id)}
      onDragStart={e => {
        drag.current = { matchId: m.id, version: p.version };
        e.dataTransfer.setData(dragType, m.id); e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => { drag.current = null; setOver(''); }}
      onClick={() => chosen ? move(chosen,dest) : setChosen({ matchId:m.id, version:p.version })}>
      <span className={styles.meta}>{[m.groupName,m.eventTypeLabel].filter(Boolean).join(' · ')}</span>
      <span className={styles.round}>{scheduleGroupLabel(m)} · 第{m.matchNo}场</span>
      <span className={styles.sides}>{sides.map((name, i) => <strong key={i}><small>{i ? '乙' : '甲'}</small><span>{name ?? m.placeholderNames?.[i] ?? '待定'}</span></strong>)}</span>
      <span className={styles.cardFoot}><time>{m.scheduledAt ? local(m.scheduledAt).slice(11)+'–'+end : m.durationMinutes+' 分钟'}</time><em data-status={status}>{status}</em></span>
      {m.teamMatchId && canMove && <small>联动本对阵未开始子项</small>}
    </button>;
  }
  return <section ref={container} className={styles.board} aria-label="场地排程板" aria-busy={busy}>
    <div className={styles.controls}>
      <label>比赛日 <select value={days.includes(dayChoice) ? dayChoice : 'all'} onChange={e => {setDay(e.target.value);setExtraTime('');}}>
        <option value="all">全部比赛日</option>{days.map(d => <option key={d}>{d}</option>)}</select></label>
      <label>自选时段 <input type="time" value={extraTime} onChange={e => setExtraTime(e.target.value)} /></label>
      <label><Switch size="small" checked={outside} onChange={setOutside} disabled={busy} /> 允许本次临时借场或改期</label>
      {chosen && <Button size="small" onClick={() => setChosen(null)}>取消选择</Button>}
      <Button
        size="small"
        icon={<UndoOutlined />}
        disabled={!canUndo}
        loading={busy}
        title={undo && undo.version === p.version ? '撤回上一步（Ctrl+Z）' : '暂无可撤回的操作，或排程板已被其他改动更新'}
        onClick={() => void submitUndo()}
      >
        撤回上一步
      </Button>
    </div>
    <div role="status" className={styles.hint}>{busy ? '正在同步赛程…' : chosen ? '已选中比赛，点目标卡片互换，或点空位调场。' : '拖到空位调场，拖到另一张卡片互换，松手即保存。手机可依次点选。'}</div>
    {error && <Alert type="error" showIcon title={error} closable onClose={() => setError('')} />}
    {(!visibleDays.length || !courts.length) && <Empty description={courts.length ? '暂无比赛日期' : '暂无启用场地'} />}
    {visibleDays.map(day => {
      const minutes = new Set(timesByDay.get(day));
      minutes.add(p.dailyStart.slice(0,5));
      if (extraTime) minutes.add(extraTime);
      return <section className={styles.day} key={day} aria-label={day}>
        <h2>{day}<span>{courts.length} 片场地 · {scheduled.filter(m => local(m.scheduledAt!).startsWith(day+'T')).length} 场比赛</span></h2>
        {courtGroups.map(group => <table key={group[0].id} aria-label={day+' '+group.map(c => c.name).join('、')}>
          <colgroup><col style={{width:54}}/>{group.map(v=><col key={v.id}/>)}</colgroup>
          <thead><tr><th>时间</th>{group.map(v => <th key={v.id}>{v.name}{!v.isActive && '（停用）'}</th>)}</tr></thead>
      <tbody>{[...minutes].sort().map(t => <tr key={t}><th scope="row">{t}</th>{group.map(v => {
        const key = keyFor(v.id,day+'T'+t), items = cells.get(key);
        const scheduledAt = day+'T'+t+':00+08:00', stamp = Date.parse(scheduledAt);
        const taken = occupied.get(v.id)?.some(x => x.start < stamp && x.end > stamp);
        const dest = { venueId:v.id, scheduledAt };
        return <td key={v.id}>{items ? items.map(card) : taken || !v.isActive ? <span className={styles.hint}>{taken ? '占用中' : '停用'}</span> :
          <button type="button" className={styles.slot} data-over={over === key} aria-label={v.name+' '+t+' 空位'} disabled={busy}
            {...dropEvents(dest,key)} onClick={() => chosen ? move(chosen,dest) : message.info('请先选择要移动的比赛')}>空位</button>}</td>;
      })}</tr>)}</tbody></table>)}</section>;
    })}
    <h4>待排场次 · {pool.length}</h4>
    {pool.length > 0 && <div className={styles.pool}>{pool.map(card)}</div>}
  </section>;
}
