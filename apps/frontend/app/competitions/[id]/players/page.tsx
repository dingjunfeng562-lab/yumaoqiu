'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type EventType = 'MENS_SINGLES' | 'WOMENS_SINGLES' | 'MENS_DOUBLES' | 'WOMENS_DOUBLES' | 'MIXED_DOUBLES';
type EventGroupKey = 'mensSingles' | 'womensSingles' | 'mensDoubles' | 'womensDoubles' | 'mixedDoubles';

const EVENT_GROUPS: Array<{ type: EventType; key: EventGroupKey; fallbackTitle: string }> = [
  { type: 'MENS_SINGLES', key: 'mensSingles', fallbackTitle: '男子单打' },
  { type: 'WOMENS_SINGLES', key: 'womensSingles', fallbackTitle: '女子单打' },
  { type: 'MENS_DOUBLES', key: 'mensDoubles', fallbackTitle: '男子双打' },
  { type: 'WOMENS_DOUBLES', key: 'womensDoubles', fallbackTitle: '女子双打' },
  { type: 'MIXED_DOUBLES', key: 'mixedDoubles', fallbackTitle: '混合双打' },
];

type EventOption = {
  id: string;
  type: EventType;
  label: string;
  isDouble: boolean;
  entrantType?: 'SCHOOL' | 'SOCIAL';
  groupLabel?: string | null;
};

type Competition = {
  id: string;
  title: string;
  location?: string | null;
  /** REGISTRATION_NOT_STARTED | REGISTRATION_OPEN | REGISTRATION_CLOSED | ONGOING | FINISHED */
  status?: string;
  eventOptions?: EventOption[];
};

// 公开名单只有姓名、性别、单位和打码后的联系方式（后端接口也只返回这几项）。
// 单位：学生组是学校，第三方是报名时填的单位。
type Partner = {
  name: string;
  genderLabel?: string;
  unit?: string;
  phone?: string;
};

type Player = {
  id: string;
  name: string;
  primaryName?: string;
  partner?: Partner | null;
  unit?: string;
  phone?: string;
  genderLabel?: string;
  eventId?: string;
  eventType?: string;
  eventName: string;
};

const DOUBLES_TYPES = new Set<string>(['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES']);

// 左栏固定在屏幕上时离顶部的距离（px）。
const PIN_TOP = 12;

type PinMode = 'static' | 'fixed' | 'bottom';
type PinState = { mode: PinMode; left: number; width: number; height: number };

type PlayersResponse = {
  players: Player[];
  eventGroups?: Array<{ eventId: string; label: string; players: Player[] }>;
  groups: Record<EventGroupKey, Player[]>;
};

// 一个项目的名单；shown 是按搜索词过滤后的部分（没搜索时等于 players）。
type EventList = {
  id: string;
  title: string;
  isDoubles: boolean;
  players: Player[];
  shown: Player[];
};

// 左栏的一个组别。label 是完整组别名；name 是冒号前的短名（「小学组」），detail 是冒号后的说明（出生日期范围等）。
type GroupList = {
  key: string;
  label: string;
  name: string;
  detail: string;
  events: EventList[];
};

type Person = { name: string; genderLabel?: string; unit?: string; phone?: string };

function splitGroupLabel(label: string) {
  const match = label.match(/^(.+?)[：:]\s*(.+)$/);
  return match ? { name: match[1].trim(), detail: match[2].trim() } : { name: label, detail: '' };
}

// 项目名：去掉 label 里的「组别 · 」前缀，只留「男子单打」这类项目名。
function eventTitle(option: EventOption, fallback: string) {
  const label = option.label?.trim() ?? '';
  const group = option.groupLabel?.trim() ?? '';
  if (group && label.startsWith(group)) {
    return label.slice(group.length).replace(/^\s*[·•・]\s*/, '').trim() || fallback;
  }
  return label || fallback;
}

function buildGroups(competition: Competition | null, data: PlayersResponse | null): GroupList[] {
  const options = competition?.eventOptions ?? [];
  if (options.length) {
    const groups = new Map<string, GroupList>();
    for (const option of options) {
      const base = EVENT_GROUPS.find((item) => item.type === option.type);
      if (!base) continue;
      const key = option.groupLabel?.trim() ?? '';
      let group = groups.get(key);
      if (!group) {
        group = { key, label: key, ...splitGroupLabel(key), events: [] };
        groups.set(key, group);
      }
      const players = data?.eventGroups?.find((item) => item.eventId === option.id)?.players
        ?? (data?.players ?? []).filter((player) => player.eventId === option.id);
      group.events.push({
        id: option.id,
        title: eventTitle(option, base.fallbackTitle),
        isDoubles: option.isDouble ?? DOUBLES_TYPES.has(option.type),
        players,
        shown: players,
      });
    }
    return [...groups.values()];
  }

  // 赛事没有配置项目选项时（老数据），按五个固定项目分。
  if (!data) return [];
  return [{
    key: '',
    label: '',
    name: '',
    detail: '',
    events: EVENT_GROUPS.map((group) => {
      const players = data.groups?.[group.key] ?? [];
      return { id: group.type, title: group.fallbackTitle, isDoubles: DOUBLES_TYPES.has(group.type), players, shown: players };
    }),
  }];
}

function playerMatches(player: Player, q: string) {
  return [player.primaryName, player.name, player.unit, player.phone, player.partner?.name, player.partner?.unit, player.partner?.phone]
    .some((value) => value?.toLowerCase().includes(q));
}

function entryPeople(player: Player): Person[] {
  const first = { name: player.primaryName || player.name, genderLabel: player.genderLabel, unit: player.unit, phone: player.phone };
  if (!player.partner) return [first];
  return [
    first,
    { name: player.partner.name, genderLabel: player.partner.genderLabel, unit: player.partner.unit || player.unit, phone: player.partner.phone },
  ];
}

function countLabel(event: EventList) {
  return `${event.players.length} ${event.isDoubles ? '队' : '人'}`;
}

export default function CompetitionPlayersPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [data, setData] = useState<PlayersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [pin, setPin] = useState<PinState>({ mode: 'static', left: 0, width: 0, height: 0 });
  const layoutRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    async function loadPlayers() {
      setLoading(true);
      setError('');
      try {
        const [competitionRes, playersRes] = await Promise.all([
          fetch(`${API_BASE}/competitions/${id}`, { cache: 'no-store' }),
          fetch(`${API_BASE}/competitions/${id}/players`, { cache: 'no-store' }),
        ]);
        if (!competitionRes.ok || !playersRes.ok) throw new Error('选手列表加载失败');
        const [competitionData, playersData] = await Promise.all([
          competitionRes.json(),
          playersRes.json(),
        ]);
        if (!alive) return;
        setCompetition(competitionData);
        setData(playersData);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '选手列表加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    }
    loadPlayers();
    return () => {
      alive = false;
    };
  }, [id]);

  const groups = useMemo(() => buildGroups(competition, data), [competition, data]);
  const q = query.trim().toLowerCase();
  const shownGroups = useMemo(
    () => (q
      ? groups.map((group) => ({
        ...group,
        events: group.events.map((event) => ({ ...event, shown: event.players.filter((player) => playerMatches(player, q)) })),
      }))
      : groups),
    [groups, q],
  );

  const allEvents = shownGroups.flatMap((group) => group.events.map((event) => ({ group, event })));
  const totalEntries = allEvents.reduce((sum, item) => sum + item.event.players.length, 0);
  const matchedEntries = allEvents.reduce((sum, item) => sum + item.event.shown.length, 0);
  const matchedEvents = allEvents.filter((item) => item.event.shown.length > 0).length;
  // 选中的项目；没选过（或选中的不存在）时取第一个有人的项目。
  const active = allEvents.find((item) => item.event.id === selectedEventId)
    ?? allEvents.find((item) => item.event.shown.length > 0)
    ?? allEvents[0]
    ?? null;
  const registrationOpen = competition?.status === 'REGISTRATION_OPEN';
  const showLayout = totalEntries > 0 && Boolean(active);

  // 左栏固定：名单翻过屏幕顶部后，把左栏钉在屏幕上方；名单到底时左栏跟着名单底部走。
  // 不能用 CSS sticky：globals.css 给 html 和 body 都设了 overflow-x: hidden，sticky 不会生效
  //（站点顶栏也因此不固定）。做法同 LiveMatchBoard：按滚动位置切换成 fixed。
  useEffect(() => {
    const rail = railRef.current;
    const aside = asideRef.current;
    if (!showLayout || !rail || !aside) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = rail.getBoundingClientRect();
      const height = aside.offsetHeight;
      const mode: PinMode = box.top >= PIN_TOP ? 'static' : box.bottom - height < PIN_TOP ? 'bottom' : 'fixed';
      setPin((prev) => (
        prev.mode === mode && prev.left === box.left && prev.width === box.width && prev.height === height
          ? prev
          : { mode, left: box.left, width: box.width, height }
      ));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(rail);
    observer.observe(aside);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [showLayout]);

  // 搜索时如果当前项目里没有匹配的人，自动跳到第一个有匹配的项目。
  function handleQueryChange(value: string) {
    setQuery(value);
    const nextQ = value.trim().toLowerCase();
    if (!nextQ) return;
    if (active?.event.players.some((player) => playerMatches(player, nextQ))) return;
    const hit = groups.flatMap((group) => group.events).find((event) => event.players.some((player) => playerMatches(player, nextQ)));
    if (hit) setSelectedEventId(hit.id);
  }

  // 切换项目后，如果页面已经往下翻过名单，滚回名单顶部。
  // 先同步换好名单再滚动：反过来的话，换名单时浏览器的滚动锚定会把位置又挪走。
  function selectEvent(eventId: string) {
    flushSync(() => setSelectedEventId(eventId));
    const layout = layoutRef.current;
    if (!layout) return;
    const top = layout.getBoundingClientRect().top;
    // 全站 html 设了 scroll-behavior: smooth；名单已经换了，直接跳回去，不播放长距离滚动动画。
    if (top < PIN_TOP) window.scrollTo({ top: window.scrollY + top - PIN_TOP, behavior: 'instant' });
  }

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Players"
      title="参赛选手列表"
      description="这里只展示当前赛事中已通过管理员审核的报名人员，待审核和已驳回报名不会出现在这里。"
      back={{ href: `/competitions/${id}`, label: '赛事主页' }}
    >
      <div className="mb-4 flex flex-col gap-4 sm:mb-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-black text-slate-950 sm:text-2xl">{competition?.title ?? '赛事选手'}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {competition?.location || '地点待公布'}
          </p>
        </div>
        {registrationOpen ? (
          <div className="flex gap-3">
            <Link
              href={`/competitions/${id}/register`}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-amber-400 px-4 text-sm font-black text-white"
            >
              立即报名
            </Link>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-lg border border-blue-100 bg-white p-8 text-sm font-semibold text-slate-500 shadow-sm">
          选手列表加载中...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-sm font-bold text-red-600">
          {error}
        </div>
      ) : totalEntries > 0 && active ? (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:items-center sm:gap-4">
            <label className="relative block w-full sm:max-w-sm">
              <span className="sr-only">搜索选手</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                aria-hidden
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="M20 20l-4-4" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="搜索姓名、单位或手机尾号"
                className="h-11 w-full rounded-lg border border-blue-100 bg-white pl-10 pr-3 text-base font-semibold text-slate-900 shadow-sm placeholder:font-medium placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            {q ? (
              <p className="text-sm font-bold text-slate-600">
                {matchedEntries > 0 ? (
                  <>
                    找到 <span className="text-amber-600">{matchedEntries}</span> 条，分布在 {matchedEvents} 个项目
                  </>
                ) : (
                  <>没有找到「{query.trim()}」</>
                )}
              </p>
            ) : null}
          </div>

          <div ref={layoutRef} className="flex items-start gap-3 sm:gap-5">
            {/* rail 占住左栏的位置；左栏 fixed 后，rail 保持原来的宽高，名单不会跳动 */}
            <div
              ref={railRef}
              className="relative w-[6.75rem] shrink-0 self-stretch md:w-56"
              style={pin.mode === 'static' ? undefined : { minHeight: pin.height }}
            >
              <aside
                ref={asideRef}
                style={
                  pin.mode === 'fixed'
                    ? { position: 'fixed', top: PIN_TOP, left: pin.left, width: pin.width }
                    : pin.mode === 'bottom'
                      ? { position: 'absolute', bottom: 0, left: 0, right: 0 }
                      : undefined
                }
                className="z-10 max-h-[calc(100dvh-118px)] overflow-y-auto overscroll-contain rounded-lg border border-blue-100 bg-white py-1 shadow-sm lg:max-h-[calc(100dvh-24px)]"
              >
                <nav aria-label="组别与项目">
                  {shownGroups.map((group, groupIndex) => {
                    const groupName = group.name || (shownGroups.length > 1 ? '其他项目' : '');
                    const divider = groupIndex > 0 ? 'border-t border-blue-50' : '';
                    // 只有一个项目的组别合成一项：组别名 + 小字项目名。
                    if (groupName && group.events.length === 1) {
                      const event = group.events[0];
                      return (
                        <div key={group.key} className={divider}>
                          <SideButton
                            label={groupName}
                            sub={event.title}
                            detail={group.detail}
                            count={q ? event.shown.length : event.players.length}
                            searching={Boolean(q)}
                            active={active.event.id === event.id}
                            onClick={() => selectEvent(event.id)}
                          />
                        </div>
                      );
                    }
                    return (
                      <div key={group.key} className={divider}>
                        {groupName ? (
                          <div className="px-2.5 pb-1 pt-3 sm:px-4">
                            <p className="break-words text-[13px] font-black leading-5 text-slate-900 sm:text-sm">{groupName}</p>
                            {group.detail ? (
                              <p className="mt-0.5 hidden text-[11px] font-semibold leading-4 text-slate-400 md:block">{group.detail}</p>
                            ) : null}
                          </div>
                        ) : null}
                        {group.events.map((event) => (
                          <SideButton
                            key={event.id}
                            label={event.title}
                            count={q ? event.shown.length : event.players.length}
                            searching={Boolean(q)}
                            active={active.event.id === event.id}
                            indent={Boolean(groupName)}
                            onClick={() => selectEvent(event.id)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </nav>
              </aside>
            </div>

            <EventPanel group={active.group} event={active.event} query={query.trim()} q={q} />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-blue-100 bg-white p-10 text-center shadow-sm">
          <h3 className="text-xl font-black text-slate-950">暂无已通过审核的参赛选手。</h3>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            报名通过管理员审核后，会按组别和项目显示在这里。
          </p>
        </div>
      )}
    </PortalFeaturePage>
  );
}

function SideButton({
  label,
  sub,
  detail,
  count,
  searching,
  active,
  indent,
  onClick,
}: {
  label: string;
  sub?: string;
  detail?: string;
  count: number;
  searching: boolean;
  active: boolean;
  indent?: boolean;
  onClick: () => void;
}) {
  const dim = count === 0 && !active;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`tappable flex w-full items-start justify-between gap-1.5 border-l-[3px] py-2.5 pr-2.5 text-left transition sm:pr-4 ${
        indent ? 'pl-3.5 sm:pl-6' : 'pl-2.5 sm:pl-4'
      } ${active ? 'border-blue-600 bg-blue-50' : 'border-transparent hover:bg-slate-50'}`}
    >
      <span className={`min-w-0 ${dim ? 'opacity-50' : ''}`}>
        <span
          className={`block break-words leading-5 ${indent ? 'text-[13px] font-bold sm:text-sm' : 'text-[13px] font-black sm:text-sm'} ${
            active ? 'text-blue-800' : 'text-slate-800'
          }`}
        >
          {label}
        </span>
        {sub ? <span className="mt-0.5 block text-[11px] font-semibold leading-4 text-slate-500 sm:text-xs">{sub}</span> : null}
        {detail ? <span className="mt-0.5 hidden text-[11px] font-semibold leading-4 text-slate-400 md:block">{detail}</span> : null}
      </span>
      <span
        className={`shrink-0 text-[11px] font-black tabular-nums leading-5 sm:text-xs ${
          searching && count > 0 ? 'rounded bg-amber-100 px-1 text-amber-700' : active ? 'text-blue-700' : 'text-slate-400'
        } ${dim ? 'opacity-50' : ''}`}
      >
        {count}
      </span>
    </button>
  );
}

function EventPanel({ group, event, query, q }: { group: GroupList; event: EventList; query: string; q: string }) {
  const entries = event.shown.map((player) => ({ player, index: event.players.indexOf(player) + 1 }));
  return (
    <section className="min-w-0 flex-1 overflow-hidden rounded-lg border border-blue-100 bg-white shadow-sm">
      <div className="border-b border-blue-50 bg-blue-50 px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-base font-black text-blue-900 sm:text-lg">{event.title}</h3>
          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-black text-blue-700">
            {q ? `${event.shown.length} / ${countLabel(event)}` : countLabel(event)}
          </span>
        </div>
        {group.label ? (
          <p className="mt-1 break-words text-xs font-semibold leading-5 text-blue-900/60 sm:text-sm">{group.label}</p>
        ) : null}
      </div>

      {event.players.length === 0 ? (
        <p className="p-4 text-sm font-semibold text-slate-500 sm:p-6">该项目暂无已通过审核的参赛选手。</p>
      ) : entries.length === 0 ? (
        <p className="p-4 text-sm font-semibold text-slate-500 sm:p-6">该项目里没有找到「{query}」。</p>
      ) : (
        <>
          {/* 手机：每人（每队）一行卡片，姓名+性别一行，单位、联系方式小字 */}
          <ol className="md:hidden">
            {entries.map(({ player, index }) => (
              <li
                key={player.id}
                className={`flex gap-2.5 px-3 py-2.5 ${event.isDoubles ? 'border-t-2 border-blue-100' : 'border-t border-blue-50'} first:border-t-0`}
              >
                <span className="w-6 shrink-0 pt-0.5 text-right text-xs font-bold tabular-nums text-slate-400">{index}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  {entryPeople(player).map((person, i) => (
                    <PersonLines key={i} person={person} q={q} />
                  ))}
                </div>
              </li>
            ))}
          </ol>

          {/* 电脑：表格；双打每队两行，序号跨两行，搭档行浅色底 */}
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="text-xs font-black text-slate-500">
              <tr>
                <th className="w-16 whitespace-nowrap px-4 py-3 text-center">序号</th>
                <th className="whitespace-nowrap px-4 py-3">姓名</th>
                <th className="whitespace-nowrap px-4 py-3">性别</th>
                <th className="whitespace-nowrap px-4 py-3">单位</th>
                <th className="whitespace-nowrap px-4 py-3">联系方式</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ player, index }) => {
                const people = entryPeople(player);
                return (
                  <Fragment key={player.id}>
                    {people.map((person, i) => (
                      <tr
                        key={i}
                        className={
                          i > 0
                            ? 'border-t border-blue-50/60 bg-blue-50/30'
                            : event.isDoubles
                              ? 'border-t-2 border-blue-100'
                              : 'border-t border-blue-50'
                        }
                      >
                        {i === 0 ? (
                          <td rowSpan={people.length} className="bg-white px-4 py-3.5 text-center font-bold tabular-nums text-slate-400">
                            {index}
                          </td>
                        ) : null}
                        <td className="whitespace-nowrap px-4 py-3.5 font-bold text-slate-900">
                          <Highlight text={person.name} q={q} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">{person.genderLabel ?? '-'}</td>
                        <td className="px-4 py-3.5 font-semibold text-slate-700">
                          <Highlight text={person.unit || '-'} q={q} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-slate-600">
                          <Highlight text={person.phone || '-'} q={q} />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function PersonLines({ person, q }: { person: Person; q: string }) {
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[15px] font-bold text-slate-900">
          <Highlight text={person.name} q={q} />
        </span>
        {person.genderLabel ? <span className="text-xs font-semibold text-slate-500">{person.genderLabel}</span> : null}
      </p>
      <p className="mt-0.5 break-words text-xs font-semibold leading-5 text-slate-600">
        <Highlight text={person.unit || '-'} q={q} />
      </p>
      {person.phone ? (
        <p className="text-xs tabular-nums leading-5 text-slate-400">
          <Highlight text={person.phone} q={q} />
        </p>
      ) : null}
    </div>
  );
}

// 把搜索词在文本里标黄。
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(q);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-amber-200 px-0.5 text-inherit">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}
