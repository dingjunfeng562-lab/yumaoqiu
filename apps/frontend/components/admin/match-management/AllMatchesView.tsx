'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { io, type Socket } from 'socket.io-client';
import { Button, Card, Checkbox, DatePicker, Empty, Input, Segmented, Select, Spin, Typography, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import {
  ALL_PAGE_SIZES,
  DEFAULT_ALL_QUERY,
  STATUS_TABS,
  allMatchesSearchParams,
  hasAllMatchesFilters,
  isActiveTournament,
  sortTournaments,
  type AllDatePreset,
  type AllMatchesQuery,
  type AllMatchesResponse,
  type MMAllMatch,
  type MMMatch,
  type MMTournament,
  type StatusTab,
} from '@/lib/match-management';
import { MatchList } from './MatchList';
import { StatusTabs } from './MatchToolbar';

const { Text, Link } = Typography;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');
/** 现场记分时广播很密：收到第一条后最多等这么久刷新一次（节流，不会被连续广播一直往后推）。 */
const LIVE_REFRESH_MS = 3000;

const ZERO_COUNTS = Object.fromEntries(STATUS_TABS.map((tab) => [tab.key, 0])) as Record<StatusTab, number>;

const DATE_PRESETS: Array<{ value: AllDatePreset; label: string }> = [
  { value: 'ALL', label: '全部日期' },
  { value: 'TODAY', label: '今天' },
  { value: 'TOMORROW', label: '明天' },
  { value: 'CUSTOM', label: '选日期' },
];

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * 裁判员对局管理「全部场次」：不用先选赛事，能管的所有赛事的场次放在一张表里（后端分页）。
 * 筛选条件由页面保管（切到「按赛事」再切回来还在）；点「管理」交给页面打开处理面板，点赛事名进入该赛事。
 */
export function AllMatchesView({
  token,
  query,
  onQueryChange,
  tournaments,
  showOwner,
  now,
  reloadSignal,
  onOpen,
  onRelease,
  releasingId,
  onEnterTournament,
  onRemoteChange,
}: {
  token?: string;
  query: AllMatchesQuery;
  onQueryChange: (next: AllMatchesQuery) => void;
  /** 能管的赛事（管理员只有自己的），用来列赛事筛选、显示创建账号、过滤实时广播。 */
  tournaments: MMTournament[];
  showOwner: boolean;
  now: number;
  /** 页面改了东西（保存、解除裁判、点刷新）后加一，这里重新拉一次。 */
  reloadSignal: number;
  onOpen: (match: MMAllMatch) => void;
  onRelease: (match: MMAllMatch) => void;
  releasingId: string | null;
  onEnterTournament: (tournamentId: string) => void;
  /** 收到某个赛事的比分 / 签表广播（页面据此刷新正开着的处理面板）。 */
  onRemoteChange?: (tournamentId: string) => void;
}) {
  const [data, setData] = useState<AllMatchesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [keywordInput, setKeywordInput] = useState(query.keyword);
  const requestIdRef = useRef(0);
  const liveTimer = useRef<number | null>(null);
  const remoteRef = useRef(onRemoteChange);
  useEffect(() => {
    remoteRef.current = onRemoteChange;
  }, [onRemoteChange]);

  const set = useCallback((patch: Partial<AllMatchesQuery>) => {
    // 改了筛选条件回到第 1 页；只翻页时保留其它条件。
    onQueryChange({ ...query, page: 1, ...patch });
  }, [onQueryChange, query]);

  // 搜索框停顿 400ms 再查，打字时不一直请求。
  useEffect(() => {
    if (keywordInput === query.keyword) return;
    const timer = window.setTimeout(() => set({ keyword: keywordInput }), 400);
    return () => window.clearTimeout(timer);
  }, [keywordInput, query.keyword, set]);

  const load = useCallback(async () => {
    if (!token) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const result = await apiFetch<AllMatchesResponse>(
        `/match-management/matches?${allMatchesSearchParams(query, Date.now())}`,
        { token, cache: 'no-store' },
      );
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (error) {
      if (requestId === requestIdRef.current) message.error(errorText(error, '加载场次失败'));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [token, query]);

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, reloadSignal]);

  useEffect(() => {
    const onFocus = () => void loadRef.current();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // 实时：能管的赛事有比分 / 签表变化就刷新当前这一页（节流 3 秒）。
  const scopeIds = useMemo(() => {
    const list = query.tournaments.length
      ? tournaments.filter((tournament) => query.tournaments.includes(tournament.id))
      : tournaments.filter((tournament) => !query.activeOnly || isActiveTournament(tournament));
    return new Set(list.map((tournament) => tournament.id));
  }, [tournaments, query.tournaments, query.activeOnly]);
  const scopeRef = useRef(scopeIds);
  useEffect(() => {
    scopeRef.current = scopeIds;
  }, [scopeIds]);

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['polling', 'websocket'],
      withCredentials: true,
    });
    // 这 3 秒里有变化的赛事，到点一起通知页面（刷新开着的处理面板）。
    const changed = new Set<string>();
    const onChange = (payload?: {
      tournamentId?: string | null;
      event?: { tournament?: { id?: string } | null } | null;
    }) => {
      const tournamentId = payload?.tournamentId ?? payload?.event?.tournament?.id ?? null;
      if (!tournamentId || !scopeRef.current.has(tournamentId)) return;
      changed.add(tournamentId);
      if (liveTimer.current) return;
      liveTimer.current = window.setTimeout(() => {
        liveTimer.current = null;
        for (const id of changed) remoteRef.current?.(id);
        changed.clear();
        void loadRef.current();
      }, LIVE_REFRESH_MS);
    };
    socket.on('bracket:update', onChange);
    socket.on('scoreboard:update', onChange);
    return () => {
      socket.off('bracket:update', onChange);
      socket.off('scoreboard:update', onChange);
      socket.disconnect();
      if (liveTimer.current) window.clearTimeout(liveTimer.current);
      liveTimer.current = null;
    };
  }, [token]);

  const ownerOf = useMemo(() => new Map(tournaments.map((tournament) => [tournament.id, tournament.owner ?? null])), [tournaments]);
  const tournamentOptions = useMemo(
    () => sortTournaments(tournaments.filter((tournament) => !query.activeOnly || isActiveTournament(tournament)), now)
      .map((tournament) => ({
        value: tournament.id,
        label: showOwner && tournament.owner ? `${tournament.name}（${tournament.owner}）` : tournament.name,
      })),
    [tournaments, query.activeOnly, showOwner, now],
  );

  const items = useMemo(() => data?.items ?? [], [data]);
  const find = (matchId: string) => items.find((item) => item.id === matchId);
  const clearFilters = () => {
    setKeywordInput('');
    onQueryChange({ ...DEFAULT_ALL_QUERY, tab: query.tab, activeOnly: query.activeOnly, pageSize: query.pageSize });
  };

  const today = dayjs().format('YYYY-MM-DD');
  const range = query.customRange ? [dayjs(query.customRange[0]), dayjs(query.customRange[1])] as const : null;

  return (
    <>
      <div style={{ marginTop: 16, background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: '12px 16px' }}>
        <StatusTabs counts={data?.counts ?? ZERO_COUNTS} value={query.tab} onChange={(tab) => set({ tab })} />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜选手 / 单位 / 队伍 / 裁判 / 场地 / 项目 / 赛事"
            style={{ width: 'min(320px, 100%)' }}
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="赛事（默认全部）"
            style={{ minWidth: 180, maxWidth: 360 }}
            value={query.tournaments}
            options={tournamentOptions}
            optionFilterProp="label"
            notFoundContent="没有赛事"
            onChange={(value) => set({ tournaments: value })}
          />
          <Segmented
            value={query.datePreset}
            options={DATE_PRESETS}
            onChange={(value) => {
              const preset = value as AllDatePreset;
              set({ datePreset: preset, customRange: preset === 'CUSTOM' ? query.customRange ?? [today, today] : query.customRange });
            }}
          />
          {query.datePreset === 'CUSTOM' ? (
            <DatePicker.RangePicker
              allowClear={false}
              placeholder={['开始日期', '结束日期']}
              value={range ? [range[0], range[1]] : null}
              onChange={(value) => {
                if (value?.[0] && value?.[1]) set({ customRange: [value[0].format('YYYY-MM-DD'), value[1].format('YYYY-MM-DD')] });
              }}
            />
          ) : null}
          <Checkbox
            checked={query.activeOnly}
            onChange={(event) => {
              const activeOnly = event.target.checked;
              // 勾上时把已选的、已结束的赛事去掉（不然选了也看不到）。
              const keep = activeOnly
                ? query.tournaments.filter((id) => {
                  const tournament = tournaments.find((item) => item.id === id);
                  return tournament ? isActiveTournament(tournament) : false;
                })
                : query.tournaments;
              set({ activeOnly, tournaments: keep });
            }}
          >
            只看未结束的赛事
          </Checkbox>
          {hasAllMatchesFilters(query) ? <Button size="small" type="link" onClick={clearFilters}>清空筛选</Button> : null}
          <Text type="secondary" style={{ marginLeft: 'auto', fontSize: 12 }}>
            {loading ? <Spin size="small" style={{ marginRight: 6 }} /> : null}
            共 {data?.total ?? 0} 场
          </Text>
        </div>
      </div>

      {!data && loading ? (
        <div style={{ padding: 64, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : data && !items.length ? (
        <Card style={{ marginTop: 16 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={hasAllMatchesFilters(query) || query.tab !== 'ALL'
              ? '没有符合条件的场次'
              : query.activeOnly ? '未结束的赛事里还没有场次（可以去掉「只看未结束的赛事」看全部）' : '还没有场次'}
          >
            {hasAllMatchesFilters(query) ? <Button onClick={clearFilters}>清空筛选</Button> : null}
          </Empty>
        </Card>
      ) : data ? (
        <MatchList
          matches={items}
          now={now}
          loading={loading}
          projectOf={(match: MMMatch) => (match as MMAllMatch).projectLabel}
          tournamentOf={(match: MMMatch) => {
            const item = match as MMAllMatch;
            const owner = showOwner && item.tournamentId ? ownerOf.get(item.tournamentId) : null;
            return (
              <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                <Link
                  style={{ fontSize: 12 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (item.tournamentId) onEnterTournament(item.tournamentId);
                  }}
                >
                  {item.tournamentName || '—'}
                </Link>
                {owner ? <div><Text type="secondary" style={{ fontSize: 11 }}>{owner}</Text></div> : null}
              </div>
            );
          }}
          onOpen={(matchId) => {
            const item = find(matchId);
            if (item) onOpen(item);
          }}
          onRelease={(matchId) => {
            const item = find(matchId);
            if (item) onRelease(item);
          }}
          releasingId={releasingId}
          pagination={{
            current: data.page,
            pageSize: query.pageSize,
            total: data.total,
            showSizeChanger: true,
            pageSizeOptions: ALL_PAGE_SIZES,
            showTotal: (total) => `共 ${total} 场`,
            locale: { items_per_page: '条/页' },
            style: { paddingInline: 16 },
            onChange: (page, pageSize) => onQueryChange({ ...query, page: pageSize !== query.pageSize ? 1 : page, pageSize }),
          }}
        />
      ) : null}
    </>
  );
}
