'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { SecondStageBracket, type SecondStageData } from './SecondStageBracket';

// ─────────────────────────────────────────────────────────────────────
// Types — kept compatible with previous callers
// ─────────────────────────────────────────────────────────────────────

export type BracketStatus = 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED' | string;

export type BracketParticipant = {
  id: string;
  position: number;
  name: string;
  seed?: number | string | null;
  isBye?: boolean;
  affiliation?: string | null;
  teamName?: string | null;
  members?: string[];
};

export type BracketGroup = {
  code: string;
  label: string;
  members: BracketParticipant[];
};

export type BracketMatchEvent = {
  id: string;
  type: string;
  typeLabel: string;
  side?: 1 | 2 | number | null;
  sideLabel?: string | null;
  note?: string | null;
  createdAt?: string | null;
  text?: string | null;
};

export type BracketMatch = {
  id: string;
  roundNo: number;
  roundLabel?: string;
  matchNo: number;
  status: BracketStatus;
  side1Id?: string | null;
  side2Id?: string | null;
  winnerId?: string | null;
  winnerSide?: 1 | 2 | number | null;
  forfeitedSide?: 1 | 2 | number | null;
  forfeitKind?: 'normal' | 'retire' | 'black_card' | null;
  forfeitLabel?: '弃权' | '退赛' | '黑牌取消资格' | null;
  forfeitReason?: string | null;
  score?: string | null;
  gamesText?: string | null;
  venueName?: string | null;
  refereeName?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMinutes?: number | null;
  matchPaused?: boolean;
  pausedAt?: string | null;
  courtDisplayState?: {
    side1CourtSide: 'left' | 'right';
    side2CourtSide: 'left' | 'right';
    swapCount: number;
  } | null;
  actualDurationSeconds?: number | null;
  latestEvents?: BracketMatchEvent[];
  detailLines?: string[];
};

// 第二阶段「对阵骨架」：GROUP_PLUS_KNOCKOUT_STD 小组赛出线前，按组数×出线数预排的
// 淘汰赛对阵树（签位为「X组第N名」占位）。出线后真实签表生成、此字段为空。
export type KnockoutSkeleton = {
  bracketSize: number;
  participants: { id: string; position: number; name: string; isBye: boolean }[];
  matches: {
    id: string;
    round: string;
    roundNo: number;
    matchNo: number;
    side1Id: string | null;
    side2Id: string | null;
    status: string;
    winnerSide: number | null;
  }[];
};

export type KnockoutBracketData = {
  id: string;
  tournamentId?: string;
  tournamentName?: string;
  groupLabel?: string;
  title: string;
  subtitle?: string;
  generatedAt?: string | null;
  participants: BracketParticipant[];
  groups?: BracketGroup[];
  matches: BracketMatch[];
  knockoutSkeleton?: KnockoutSkeleton | null;
  secondStage?: SecondStageData | null;
};

type LayoutMatch = BracketMatch & {
  layoutKey: string;
  index: number; // 0-based position within its round
};

// ─────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────

const CARD_WIDTH = 188;
const CARD_HEIGHT = 52;
const PAIR_GAP = 14; // vertical gap between two participants of the same pair
const COL_GAP = 96;
const TOP_OFFSET = 56;
const BOARD_PADDING = 28;
const CHAMPION_WIDTH = 240;
const CHAMPION_HEIGHT = 96;

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待开始',
  LIVE: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  未开始: '待开始',
  进行中: '进行中',
  已结束: '已完成',
  已完成: '已完成',
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function nextPowerOfTwo(value: number) {
  let size = 1;
  while (size < value) size *= 2;
  return Math.max(size, 2);
}

function roundCountFor(slotCount: number) {
  return Math.max(1, Math.ceil(Math.log2(slotCount)));
}

function incomingSlotsForRound(bracketSize: number, roundNo: number) {
  return Math.max(2, bracketSize / 2 ** (roundNo - 1));
}

function defaultRoundLabel(bracketSize: number, roundNo: number) {
  const incoming = incomingSlotsForRound(bracketSize, roundNo);
  if (incoming === 2) return '决赛';
  if (incoming === 4) return '半决赛';
  if (incoming === 8) return '1/4 决赛';
  if (incoming === 16) return '1/8 决赛';
  if (incoming === 32) return '1/16 决赛';
  return `${incoming} 强赛`;
}

function isGroupStageMatch(match: Pick<BracketMatch, 'roundNo'>) {
  return match.roundNo <= 0;
}

function roundLabelForMatch(match: Pick<BracketMatch, 'roundNo' | 'roundLabel'>, bracketSize: number) {
  if (match.roundLabel) return match.roundLabel;
  return isGroupStageMatch(match) ? '小组赛' : defaultRoundLabel(bracketSize, match.roundNo);
}

function normalizeStatus(status: BracketStatus): 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED' {
  const text = String(status || 'PENDING').toUpperCase();
  if (text === 'LIVE' || status === '进行中') return 'LIVE';
  if (text === 'COMPLETED' || status === '已结束' || status === '已完成') return 'COMPLETED';
  if (text === 'CANCELLED' || status === '已取消') return 'CANCELLED';
  return 'PENDING';
}

function statusText(status: BracketStatus) {
  return STATUS_LABELS[String(status)] ?? STATUS_LABELS[normalizeStatus(status)] ?? '待开始';
}

function formatTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatActualDuration(
  startedAt?: string | null,
  finishedAt?: string | null,
  actualDurationSeconds?: number | null,
  matchPaused?: boolean,
) {
  if (!startedAt) return '—';
  let seconds: number;
  if (typeof actualDurationSeconds === 'number') {
    seconds = Math.max(0, Math.floor(actualDurationSeconds));
  } else {
    const start = new Date(startedAt).getTime();
    if (Number.isNaN(start)) return '—';
    const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
    seconds = Math.max(0, Math.floor((end - start) / 1000));
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const suffix = finishedAt ? '' : matchPaused ? '（暂停中）' : '（进行中）';
  return `${m}分${s.toString().padStart(2, '0')}秒${suffix}`;
}

function matchEventText(event?: BracketMatchEvent | null) {
  if (!event) return '';
  return event.text || (event.sideLabel ? `${event.sideLabel} · ${event.typeLabel}` : event.typeLabel);
}

function rowHeightFor(bracketSize: number) {
  // rowHeight = vertical pitch between two SLOTS in column 0 (one team box each)
  // We need at least CARD_HEIGHT + PAIR_GAP/2 per slot so paired teams sit close
  // and adjacent pairs have breathing room.
  if (bracketSize <= 8) return 78;
  if (bracketSize <= 16) return 70;
  return 62;
}

function buildPlaceholderMatches(roundCount: number, bracketSize: number): LayoutMatch[] {
  const matches: LayoutMatch[] = [];
  for (let roundNo = 1; roundNo <= roundCount; roundNo += 1) {
    const count = bracketSize / 2 ** roundNo;
    for (let index = 0; index < count; index += 1) {
      matches.push({
        id: `placeholder-${roundNo}-${index + 1}`,
        layoutKey: `${roundNo}-${index}`,
        roundNo,
        matchNo: index + 1,
        index,
        status: 'PENDING',
      });
    }
  }
  return matches;
}

function parseScores(text?: string | null): { a?: number; b?: number } {
  if (!text) return {};
  // Accept "21:14", "21:14 / 21:18" — take last game
  const last = text.split(/[/,]/).map((s) => s.trim()).filter(Boolean).pop();
  if (!last) return {};
  const match = last.match(/^(\d+)\s*[:：-]\s*(\d+)/);
  if (!match) return {};
  return { a: Number(match[1]), b: Number(match[2]) };
}

function useBracketZoomGestures(
  ref: RefObject<HTMLDivElement | null>,
  setZoom: Dispatch<SetStateAction<number>>,
  zoomLimits: { min: number; max: number },
) {
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clamp = (value: number) =>
      Math.min(zoomLimits.max, Math.max(zoomLimits.min, Math.round(value * 100) / 100));

    function onWheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const delta = -event.deltaY * 0.0025;
      setZoom((current) => clamp(current + delta));
    }

    function distanceBetween(touches: TouchList) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 2) return;
      pinchRef.current = { distance: distanceBetween(event.touches), zoom: 0 };
      setZoom((current) => {
        if (pinchRef.current) pinchRef.current.zoom = current;
        return current;
      });
    }

    function onTouchMove(event: TouchEvent) {
      if (event.touches.length !== 2 || !pinchRef.current) return;
      event.preventDefault();
      const next = distanceBetween(event.touches);
      const ratio = next / pinchRef.current.distance;
      setZoom(clamp(pinchRef.current.zoom * ratio));
    }

    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) pinchRef.current = null;
    }

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [ref, setZoom, zoomLimits.max, zoomLimits.min]);
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

export function KnockoutBracket({
  data,
  allowAdminSwap = false,
}: {
  data: KnockoutBracketData;
  allowAdminSwap?: boolean;
}) {
  const groupStageInputMatches = useMemo(
    () => data.matches.filter((match) => isGroupStageMatch(match)),
    [data.matches],
  );
  const bracketInputMatches = useMemo(
    () => data.matches.filter((match) => !isGroupStageMatch(match)),
    [data.matches],
  );
  const hasGroupStageMatches = groupStageInputMatches.length > 0;
  const hasBracketMatches = bracketInputMatches.length > 0;
  const canShowTree = hasBracketMatches && !hasGroupStageMatches;
  const groupRosters = data.groups ?? [];

  // 第二阶段对阵骨架：小组赛出线前（尚无真实淘汰赛场次）按预排骨架渲染一棵独立对阵树，
  // 签位为「X组第N名」占位。作为独立卡片渲染，与小组赛名次解析互不干扰。
  const skeletonData: KnockoutBracketData | null =
    data.knockoutSkeleton && !hasBracketMatches && data.knockoutSkeleton.matches.length
      ? {
          id: `${data.id}-skeleton`,
          title: `${data.groupLabel ?? '第二阶段'}对阵（出线前预排）`,
          subtitle: '签位为「X组第N名」，小组赛出线后自动替换为真实选手',
          participants: data.knockoutSkeleton.participants.map((p) => ({
            id: p.id,
            position: p.position,
            name: p.name,
            isBye: p.isBye,
          })),
          matches: data.knockoutSkeleton.matches
            .filter((m) => m.round !== 'BRONZE')
            .map((m) => ({
              id: m.id,
              roundNo: m.roundNo,
              matchNo: m.matchNo,
              status: m.status,
              side1Id: m.side1Id,
              side2Id: m.side2Id,
              winnerSide: m.winnerSide,
            })),
        }
      : null;

  // Slots = ordered participants padded to next power of two with byes
  const baseSlots = useMemo(() => {
    const ordered = [...data.participants].sort((a, b) => a.position - b.position);
    const minSize = Math.max(
      ordered.length,
      bracketInputMatches.reduce((max, match) => Math.max(max, 2 ** match.roundNo), 2),
    );
    const bracketSize = nextPowerOfTwo(minSize);
    const slotMap = new Map(ordered.map((slot) => [slot.position, slot]));
    return Array.from({ length: bracketSize }, (_, index) => {
      const position = index + 1;
      return (
        slotMap.get(position) ?? {
          id: `bye-position-${position}`,
          position,
          name: '— 轮空 —',
          isBye: true,
        }
      );
    });
  }, [bracketInputMatches, data.participants]);

  const [slots, setSlots] = useState(baseSlots);
  const [hoveredParticipantId, setHoveredParticipantId] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<LayoutMatch | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'rounds'>('rounds');
  const [activeRound, setActiveRound] = useState(1);
  const [adminMode, setAdminMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const treeRef = useRef<HTMLDivElement | null>(null);

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 1.6;
  const ZOOM_STEP = 0.1;
  const clampZoom = (value: number) =>
    Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
  const adjustZoom = (delta: number) => setZoom((current) => clampZoom(current + delta));

  // Reset slots when underlying data changes
  useEffect(() => {
    setSlots(baseSlots);
  }, [baseSlots]);

  // Switch default view based on viewport once on mount. Group stages are list-first.
  useEffect(() => {
    if (!canShowTree) {
      setViewMode('rounds');
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      setViewMode('tree');
    }
  }, [canShowTree]);

  const bracketSize = slots.length;
  const roundCount = roundCountFor(bracketSize);
  const rowHeight = rowHeightFor(bracketSize);
  // rowHeight is the pitch per SLOT (column-0 team box). Column 0 has bracketSize
  // slots; subsequent columns have winner cards whose vertical pitch doubles each round.
  const totalH = TOP_OFFSET + bracketSize * rowHeight + BOARD_PADDING;
  const colStride = CARD_WIDTH + COL_GAP;

  const matches = useMemo(() => {
    if (!hasBracketMatches) return [];
    const placeholders = hasGroupStageMatches ? [] : buildPlaceholderMatches(roundCount, bracketSize);
    const byKey = new Map(placeholders.map((match) => [match.layoutKey, match]));
    for (const match of bracketInputMatches) {
      const index = Math.max(0, match.matchNo - 1);
      const key = `${match.roundNo}-${index}`;
      byKey.set(key, { ...match, index, layoutKey: key });
    }
    return [...byKey.values()].sort((a, b) => a.roundNo - b.roundNo || a.index - b.index);
  }, [bracketInputMatches, bracketSize, hasBracketMatches, hasGroupStageMatches, roundCount]);

  const groupMatches = useMemo(
    () =>
      groupStageInputMatches
        .map((match, index) => ({
          ...match,
          index,
          layoutKey: `group-${match.roundLabel ?? match.roundNo}-${match.matchNo}-${index}`,
        }))
        .sort((a, b) => {
          const labelA = a.roundLabel ?? '';
          const labelB = b.roundLabel ?? '';
          return labelA.localeCompare(labelB, 'zh-CN') || a.matchNo - b.matchNo || a.index - b.index;
        }),
    [groupStageInputMatches],
  );

  const roundTabs = useMemo(() => {
    if (!hasBracketMatches) return [];
    if (hasGroupStageMatches) {
      return [...new Set(bracketInputMatches.map((match) => match.roundNo))].sort((a, b) => a - b);
    }
    return Array.from({ length: roundCount }, (_, index) => index + 1);
  }, [bracketInputMatches, hasBracketMatches, hasGroupStageMatches, roundCount]);

  useEffect(() => {
    if (!roundTabs.length) return;
    if (!roundTabs.includes(activeRound)) setActiveRound(roundTabs[0]);
  }, [activeRound, roundTabs]);

  const matchByKey = useMemo(() => new Map(matches.map((m) => [m.layoutKey, m])), [matches]);

  const participantById = useMemo(() => new Map(slots.map((slot) => [slot.id, slot])), [slots]);

  const slotIndexById = useMemo(() => {
    const map = new Map<string, number>();
    slots.forEach((slot, index) => map.set(slot.id, index));
    return map;
  }, [slots]);

  // ── Find the path of matches a participant is on, given the slot they started in
  const highlightedKeys = useMemo(() => {
    if (!hoveredParticipantId) return new Set<string>();
    const slotIndex = slotIndexById.get(hoveredParticipantId);
    if (slotIndex === undefined) return new Set<string>();
    const keys = new Set<string>();
    for (let r = 1; r <= roundCount; r += 1) {
      const idx = Math.floor(slotIndex / 2 ** r);
      keys.add(`${r}-${idx}`);
    }
    return keys;
  }, [hoveredParticipantId, roundCount, slotIndexById]);

  function sideFor(match: BracketMatch, side: 1 | 2): BracketParticipant | null {
    if (!hasGroupStageMatches && match.roundNo === 1) {
      return slots[(match.matchNo - 1) * 2 + (side === 1 ? 0 : 1)] ?? null;
    }
    const id = side === 1 ? match.side1Id : match.side2Id;
    return id ? participantById.get(id) ?? null : null;
  }

  function winnerFor(match: BracketMatch): BracketParticipant | null {
    if (match.winnerId) return participantById.get(match.winnerId) ?? null;
    if (match.winnerSide === 1 || match.winnerSide === 2) return sideFor(match, match.winnerSide);
    return null;
  }

  // ── Position helpers (tree view)
  // Column 0 = participants column, columns 1..roundCount = winner-card columns.
  function xForCol(col: number) {
    return col * colStride;
  }
  function xForRound(roundNo: number) {
    // round R's winner card sits in column R (column 0 is the participants column)
    return roundNo * colStride;
  }
  function yForSlot(slotIndex: number) {
    return TOP_OFFSET + (slotIndex + 0.5) * rowHeight - CARD_HEIGHT / 2;
  }
  function yForMatch(roundNo: number, index: number) {
    // Each round-R match groups 2^R consecutive slots; its winner card centers on
    // the midpoint of those slot centers.
    const centerY = TOP_OFFSET + (2 * index + 1) * 2 ** (roundNo - 1) * rowHeight;
    return centerY - CARD_HEIGHT / 2;
  }

  // ── Stats for header
  const totalMatches = data.matches.length;
  const liveCount = data.matches.filter((m) => normalizeStatus(m.status) === 'LIVE').length;
  const completedCount = data.matches.filter((m) => normalizeStatus(m.status) === 'COMPLETED').length;

  // ── Admin swap
  const [draggedSlot, setDraggedSlot] = useState<number | null>(null);
  function swapSlots(targetIndex: number) {
    if (draggedSlot === null || draggedSlot === targetIndex || !adminMode) return;
    setSlots((current) => {
      const next = [...current];
      [next[draggedSlot], next[targetIndex]] = [next[targetIndex], next[draggedSlot]];
      return next;
    });
    setDraggedSlot(null);
  }

  return (
    <div className="space-y-4 sm:space-y-5">
    <section className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="border-b border-blue-100 bg-gradient-to-r from-[#052163] via-[#0a5dd1] to-[#03205c] px-4 py-4 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-black tracking-wide sm:text-lg">{data.title}</h2>
            {data.subtitle ? (
              <p className="mt-1 truncate text-[11px] font-semibold text-blue-100/85 sm:text-xs">
                {data.subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-100/90 sm:text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              {totalMatches} 场比赛
            </span>
            {liveCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/85 px-2.5 py-1 text-white">
                <span className="bracket-live-pulse h-1.5 w-1.5 rounded-full bg-white" />
                {liveCount} 进行中
              </span>
            ) : null}
            {completedCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                {completedCount} 已完成
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-white/10 p-0.5 backdrop-blur">
            {(
              [
                { key: 'rounds', label: '轮次列表' },
                ...(canShowTree ? [{ key: 'tree', label: '树形对阵' } as const] : []),
              ] as const
            ).map((tab) => {
              const active = viewMode === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setViewMode(tab.key)}
                  className={`h-7 rounded-md px-3 text-[11px] font-black transition sm:h-8 sm:text-xs ${
                    active
                      ? 'bg-white text-[#03205c] shadow-sm'
                      : 'text-blue-50/85 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {allowAdminSwap ? (
            <button
              type="button"
              onClick={() => setAdminMode((v) => !v)}
              className={`h-7 rounded-md px-3 text-[11px] font-black transition sm:h-8 sm:text-xs ${
                adminMode
                  ? 'bg-amber-300 text-[#03205c]'
                  : 'bg-white/10 text-blue-50/85 hover:bg-white/15 hover:text-white'
              }`}
            >
              {adminMode ? '退出微调' : '管理微调'}
            </button>
          ) : null}

          <div className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white/10 p-0.5 text-[11px] font-black text-blue-50/90 backdrop-blur sm:text-xs">
            <button
              type="button"
              onClick={() => adjustZoom(-ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN + 0.001}
              aria-label="缩小"
              className="h-7 w-7 rounded-md transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              aria-label="重置缩放"
              className="h-7 min-w-12 rounded-md px-2 text-center tabular-nums transition hover:bg-white/15 sm:h-8"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => adjustZoom(ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX - 0.001}
              aria-label="放大"
              className="h-7 w-7 rounded-md transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
            >
              +
            </button>
          </div>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────── */}
      {groupMatches.length ? (
        <GroupStageView
          matches={groupMatches}
          groups={groupRosters}
          bracketSize={bracketSize}
          sideFor={sideFor}
          winnerFor={winnerFor}
          onOpenMatch={(m) => setSelectedMatch(m)}
          onHoverParticipant={setHoveredParticipantId}
          hoveredParticipantId={hoveredParticipantId}
        />
      ) : null}

      {hasBracketMatches ? viewMode === 'tree' && canShowTree ? (
        <TreeView
          treeRef={treeRef}
          totalH={totalH}
          roundCount={roundCount}
          bracketSize={bracketSize}
          matches={matches}
          matchByKey={matchByKey}
          colStride={colStride}
          xForCol={xForCol}
          xForRound={xForRound}
          yForSlot={yForSlot}
          yForMatch={yForMatch}
          sideFor={sideFor}
          winnerFor={winnerFor}
          highlightedKeys={highlightedKeys}
          onHoverParticipant={setHoveredParticipantId}
          onOpenMatch={(m) => setSelectedMatch(m)}
          adminMode={adminMode}
          slots={slots}
          slotIndexById={slotIndexById}
          onDragSlot={setDraggedSlot}
          onDropSlot={swapSlots}
          zoom={zoom}
          setZoom={setZoom}
          zoomLimits={{ min: ZOOM_MIN, max: ZOOM_MAX }}
        />
      ) : (
        <RoundsView
          roundNos={roundTabs}
          bracketSize={bracketSize}
          matches={matches}
          activeRound={activeRound}
          onChangeRound={setActiveRound}
          sideFor={sideFor}
          winnerFor={winnerFor}
          onOpenMatch={(m) => setSelectedMatch(m)}
          onHoverParticipant={setHoveredParticipantId}
          highlightedKeys={highlightedKeys}
          zoom={zoom}
          setZoom={setZoom}
          zoomLimits={{ min: ZOOM_MIN, max: ZOOM_MAX }}
        />
      ) : null}

      {selectedMatch ? (
        <MatchDetailModal
          match={selectedMatch}
          label={roundLabelForMatch(selectedMatch, bracketSize)}
          side1={sideFor(selectedMatch, 1)}
          side2={sideFor(selectedMatch, 2)}
          winner={winnerFor(selectedMatch)}
          onClose={() => setSelectedMatch(null)}
        />
      ) : null}
    </section>
    {skeletonData ? <KnockoutBracket data={skeletonData} /> : null}
    {data.secondStage ? <SecondStageBracket data={data.secondStage} /> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tree view (desktop-first, horizontally scrollable)
// ─────────────────────────────────────────────────────────────────────

function TreeView({
  treeRef,
  totalH,
  roundCount,
  bracketSize,
  matches,
  matchByKey,
  colStride,
  xForCol,
  xForRound,
  yForSlot,
  yForMatch,
  sideFor,
  winnerFor,
  highlightedKeys,
  onHoverParticipant,
  onOpenMatch,
  adminMode,
  slots,
  slotIndexById,
  onDragSlot,
  onDropSlot,
  zoom,
  setZoom,
  zoomLimits,
}: {
  treeRef: React.RefObject<HTMLDivElement | null>;
  totalH: number;
  roundCount: number;
  bracketSize: number;
  matches: LayoutMatch[];
  matchByKey: Map<string, LayoutMatch>;
  colStride: number;
  xForCol: (c: number) => number;
  xForRound: (r: number) => number;
  yForSlot: (s: number) => number;
  yForMatch: (r: number, i: number) => number;
  sideFor: (match: BracketMatch, side: 1 | 2) => BracketParticipant | null;
  winnerFor: (match: BracketMatch) => BracketParticipant | null;
  highlightedKeys: Set<string>;
  onHoverParticipant: (id: string | null) => void;
  onOpenMatch: (m: LayoutMatch) => void;
  adminMode: boolean;
  slots: BracketParticipant[];
  slotIndexById: Map<string, number>;
  onDragSlot: (idx: number | null) => void;
  onDropSlot: (targetIdx: number) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  zoomLimits: { min: number; max: number };
}) {
  // Columns: 1 (participants) + roundCount (winner cols). The FINAL winner card
  // is itself the champion card — no extra column after it.
  const boardW = roundCount * colStride + CHAMPION_WIDTH + BOARD_PADDING;

  // Build SVG connectors:
  //   Round 1: pair of slots -> winner card (column 1)
  //   Round r>1: two parent winner cards -> winner card (column r)
  type Connector = { key: string; d: string; highlight: boolean; label?: string; labelX?: number; labelY?: number };
  const connectors: Connector[] = [];
  const radius = 8;

  for (const m of matches) {
    const r = m.roundNo;
    const endX = xForRound(r);
    const yMid = yForMatch(r, m.index) + CARD_HEIGHT / 2;
    let startX: number;
    let yA: number;
    let yB: number;
    let parentKeys: [string, string] | null = null;

    if (r === 1) {
      const slotA = m.index * 2;
      const slotB = m.index * 2 + 1;
      startX = xForCol(0) + CARD_WIDTH;
      yA = yForSlot(slotA) + CARD_HEIGHT / 2;
      yB = yForSlot(slotB) + CARD_HEIGHT / 2;
    } else {
      const parentA = matchByKey.get(`${r - 1}-${m.index * 2}`);
      const parentB = matchByKey.get(`${r - 1}-${m.index * 2 + 1}`);
      if (!parentA || !parentB) continue;
      startX = xForRound(r - 1) + CARD_WIDTH;
      yA = yForMatch(r - 1, parentA.index) + CARD_HEIGHT / 2;
      yB = yForMatch(r - 1, parentB.index) + CARD_HEIGHT / 2;
      parentKeys = [parentA.layoutKey, parentB.layoutKey];
    }

    const midX = startX + (endX - startX) / 2;
    const d = [
      // top stub
      `M ${startX} ${yA}`,
      `L ${midX - radius} ${yA}`,
      `Q ${midX} ${yA} ${midX} ${yA + radius}`,
      `L ${midX} ${yMid}`,
      `L ${endX} ${yMid}`,
      // bottom stub
      `M ${startX} ${yB}`,
      `L ${midX - radius} ${yB}`,
      `Q ${midX} ${yB} ${midX} ${yB - radius}`,
      `L ${midX} ${yMid}`,
    ].join(' ');

    const highlight =
      highlightedKeys.has(m.layoutKey) ||
      (parentKeys ? parentKeys.some((k) => highlightedKeys.has(k)) : false);

    // Match label sits on the horizontal segment from midX to endX
    const label = m.roundLabel ?? defaultRoundLabel(bracketSize, r);
    const labelX = midX + (endX - midX) / 2;
    const labelY = yMid - 6;

    connectors.push({ key: `c-${r}-${m.index}`, d, highlight, label, labelX, labelY });
  }

  // (No separate champion column — the final winner card serves as the champion display.)

  useBracketZoomGestures(treeRef, setZoom, zoomLimits);

  return (
    <div
      ref={treeRef}
      className="relative overflow-x-auto overflow-y-auto bg-[radial-gradient(circle_at_top,#f5f8ff,#eef3fb_60%,#e5edf8)] [scrollbar-width:thin] [touch-action:pan-x_pan-y]"
      style={{ maxHeight: 720 }}
    >
      <div
        style={{
          width: (boardW + BOARD_PADDING * 2) * zoom,
          height: (totalH + BOARD_PADDING * 2) * zoom,
        }}
      >
      <div
        className="relative origin-top-left"
        style={{
          width: boardW,
          height: totalH,
          padding: BOARD_PADDING,
          transform: `scale(${zoom})`,
        }}
      >
        {/* Column header chips: 八强赛 / 半决赛 / 决赛(冠军) */}
        {Array.from({ length: roundCount + 1 }, (_, col) => {
          const isFirst = col === 0;
          const isFinalCol = col === roundCount;
          const r = isFirst ? 1 : col;
          const headerLabel = isFirst
            ? `${bracketSize} 强赛`
            : isFinalCol
              ? '决赛 · 冠军'
              : defaultRoundLabel(bracketSize, r);
          const count = isFirst ? bracketSize : bracketSize / 2 ** r;
          const width = isFinalCol ? CHAMPION_WIDTH : CARD_WIDTH;
          return (
            <div
              key={`hdr-${col}`}
              className={`absolute flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-black shadow-sm backdrop-blur ${
                isFinalCol
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-blue-100 bg-white/95 text-[#03205c]'
              }`}
              style={{ left: xForCol(col) + BOARD_PADDING, top: 8, width }}
            >
              {isFinalCol ? (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                  <path d="M5 4h14v2a4 4 0 0 1-4 4h-.07A4 4 0 0 1 13 13.86V16h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.14A4 4 0 0 1 9.07 10H9a4 4 0 0 1-4-4V4zm2 2v.5A2.5 2.5 0 0 0 9 8.95V6H7zm10 0h-2v2.95A2.5 2.5 0 0 0 17 6.5V6z" />
                </svg>
              ) : null}
              <span>{headerLabel}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                  isFinalCol ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'
                }`}
              >
                {count}
              </span>
            </div>
          );
        })}

        {/* Connectors + labels */}
        <svg
          className="pointer-events-none absolute"
          style={{ left: BOARD_PADDING, top: BOARD_PADDING, width: boardW, height: totalH }}
          aria-hidden
        >
          {connectors.map((c) => (
            <path
              key={c.key}
              d={c.d}
              fill="none"
              stroke={c.highlight ? '#f59e0b' : '#94a3b8'}
              strokeWidth={c.highlight ? 2.2 : 1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Connector labels (rendered as HTML for crisp text) */}
        {connectors
          .filter((c) => c.label && c.labelX !== undefined && c.labelY !== undefined)
          .map((c) => (
            <div
              key={`label-${c.key}`}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-black text-slate-500 shadow-sm ring-1 ring-blue-100"
              style={{ left: (c.labelX ?? 0) + BOARD_PADDING, top: (c.labelY ?? 0) + BOARD_PADDING }}
            >
              {c.label}
            </div>
          ))}

        {/* Column 0: participant boxes */}
        {slots.map((slot, s) => (
          <div
            key={`slot-${s}`}
            className="absolute"
            style={{
              left: xForCol(0) + BOARD_PADDING,
              top: yForSlot(s) + BOARD_PADDING,
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
            }}
          >
            <ParticipantBox
              participant={slot}
              slotIndex={s}
              adminMode={adminMode}
              onDragSlot={onDragSlot}
              onDropSlot={onDropSlot}
              onHoverParticipant={onHoverParticipant}
              highlighted={!!highlightedKeys.size && (() => {
                // any match this slot feeds into is highlighted?
                for (let r = 1; r <= roundCount; r += 1) {
                  if (highlightedKeys.has(`${r}-${Math.floor(s / 2 ** r)}`)) return true;
                }
                return false;
              })()}
            />
          </div>
        ))}

        {/* Columns 1..roundCount: winner cards (final card is itself the champion display) */}
        {matches.map((m) => {
          const winner = winnerFor(m);
          const side1 = sideFor(m, 1);
          const side2 = sideFor(m, 2);
          const highlighted = highlightedKeys.has(m.layoutKey);
          const isFinal = m.roundNo === roundCount && m.index === 0;
          const w = isFinal ? CHAMPION_WIDTH : CARD_WIDTH;
          const h = isFinal ? CHAMPION_HEIGHT : CARD_HEIGHT;
          // Recenter the bigger final card on the same vertical midpoint as a normal card
          const baseTop = yForMatch(m.roundNo, m.index);
          const top = isFinal ? baseTop + CARD_HEIGHT / 2 - h / 2 : baseTop;
          return (
            <div
              key={m.layoutKey}
              className="absolute"
              style={{
                left: xForRound(m.roundNo) + BOARD_PADDING,
                top: top + BOARD_PADDING,
                width: w,
                height: h,
              }}
            >
              <WinnerCard
                match={m}
                winner={winner}
                side1={side1}
                side2={side2}
                highlight={highlighted}
                isFinal={isFinal}
                onOpen={() => onOpenMatch(m)}
                onHoverParticipant={onHoverParticipant}
              />
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tree-view subcomponents — single-team cards
// ─────────────────────────────────────────────────────────────────────

function ParticipantBox({
  participant,
  slotIndex,
  adminMode,
  onDragSlot,
  onDropSlot,
  onHoverParticipant,
  highlighted,
}: {
  participant: BracketParticipant;
  slotIndex: number;
  adminMode: boolean;
  onDragSlot: (idx: number | null) => void;
  onDropSlot: (targetIdx: number) => void;
  onHoverParticipant: (id: string | null) => void;
  highlighted: boolean;
}) {
  const bye = participant.isBye;
  const draggable = adminMode && !bye;
  return (
    <div
      className={`flex h-full w-full items-center justify-center gap-2 rounded-lg border bg-white px-2.5 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        bye
          ? 'border-dashed border-slate-200 bg-slate-50/60'
          : highlighted
            ? 'border-amber-300 ring-2 ring-amber-200'
            : 'border-blue-100'
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={draggable}
      onDragStart={() => draggable && onDragSlot(slotIndex)}
      onDragOver={(event) => {
        if (draggable) event.preventDefault();
      }}
      onDrop={() => {
        if (draggable) onDropSlot(slotIndex);
      }}
      onMouseEnter={() => !bye && onHoverParticipant(participant.id)}
      onMouseLeave={() => onHoverParticipant(null)}
    >
      {participant.seed ? (
        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-[#03205c] px-1 text-[10px] font-black text-white">
          {participant.seed}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col items-center justify-center leading-tight">
        <span
          className={`truncate text-center text-[13px] ${
            bye
              ? 'font-semibold italic text-slate-400'
              : 'font-bold text-slate-700'
          }`}
        >
          {participant.name}
        </span>
        {participant.teamName && participant.members?.length ? (
          <span className="truncate text-center text-[10px] font-semibold text-slate-400">
            {participant.members.join(' / ')}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function WinnerCard({
  match,
  winner,
  side1,
  side2,
  highlight,
  isFinal = false,
  onOpen,
  onHoverParticipant,
}: {
  match: LayoutMatch;
  winner: BracketParticipant | null;
  side1: BracketParticipant | null;
  side2: BracketParticipant | null;
  highlight: boolean;
  isFinal?: boolean;
  onOpen: () => void;
  onHoverParticipant: (id: string | null) => void;
}) {
  const status = normalizeStatus(match.status);
  const isLive = status === 'LIVE';
  const isPaused = isLive && Boolean(match.matchPaused);
  const isDone = status === 'COMPLETED';
  const isPlaceholder = match.id.startsWith('placeholder-');
  const forfeitedSide = match.forfeitedSide === 1 || match.forfeitedSide === 2 ? match.forfeitedSide : null;
  const bothForfeited = match.forfeitedSide === 0;
  const isForfeit = forfeitedSide !== null || bothForfeited;

  // What name to show in the winner card
  let displayName = '待定';
  let displayParticipant: BracketParticipant | null = null;
  if (winner) {
    displayName = winner.name;
    displayParticipant = winner;
  } else if (bothForfeited) {
    displayName = '双方弃权';
  } else if (forfeitedSide) {
    // The OTHER side advances by walkover
    const advancer = forfeitedSide === 1 ? side2 : side1;
    if (advancer) {
      displayName = advancer.name;
      displayParticipant = advancer;
    }
  }

  // Champion-style tone for the final-round card when it has a winner
  const tone = isFinal && (winner || (isForfeit && displayParticipant))
    ? 'border-amber-300 bg-gradient-to-br from-amber-50 via-white to-amber-100 ring-1 ring-amber-200'
    : bothForfeited
      ? 'border-red-200 bg-red-50/60'
      : isPaused
        ? 'border-amber-300 bg-amber-50/60 ring-1 ring-amber-200'
        : isLive
        ? 'border-red-200 bg-red-50/40 ring-1 ring-red-100'
        : winner || (isForfeit && displayParticipant)
          ? 'border-amber-200 bg-white'
          : isDone
            ? 'border-amber-200 bg-amber-50/40'
            : isFinal
              ? 'border-dashed border-amber-200 bg-amber-50/30'
              : 'border-blue-100 bg-white';

  if (isFinal) {
    // Champion-display layout: stacked, large name, "冠军" eyebrow
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`group relative flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 px-4 text-center shadow-md transition hover:-translate-y-0.5 hover:shadow-lg ${tone} ${
          highlight ? 'ring-2 ring-amber-300 ring-offset-1 ring-offset-white' : ''
        }`}
        onMouseEnter={() => displayParticipant && onHoverParticipant(displayParticipant.id)}
        onMouseLeave={() => onHoverParticipant(null)}
      >
        <span className="flex items-center gap-1 text-[10px] font-black tracking-[0.22em] text-amber-600">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden>
            <path d="M5 4h14v2a4 4 0 0 1-4 4h-.07A4 4 0 0 1 13 13.86V16h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.14A4 4 0 0 1 9.07 10H9a4 4 0 0 1-4-4V4z" />
          </svg>
          冠　军
        </span>
        <span
          className={`flex max-w-full items-center gap-1.5 truncate text-xl font-black sm:text-2xl ${
            bothForfeited
              ? 'text-red-500 line-through decoration-red-300'
              : winner || displayParticipant
                ? 'text-[#03205c]'
                : 'italic text-slate-400'
          }`}
        >
          {displayParticipant?.seed ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-[#03205c] px-1 text-[10px] font-black text-white">
              {displayParticipant.seed}
            </span>
          ) : null}
          {displayName}
        </span>
        {displayParticipant?.teamName && displayParticipant.members?.length ? (
          <span className="max-w-full truncate text-[11px] font-semibold text-slate-500">
            {displayParticipant.members.join(' / ')}
          </span>
        ) : null}
        {/* Status / forfeit badge */}
        {bothForfeited ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-black text-red-700">双方弃权</span>
        ) : isForfeit ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">晋级</span>
        ) : isLive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black text-white">
            <span className="bracket-live-pulse h-1 w-1 rounded-full bg-white" />
            直播中
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative flex h-full w-full items-center justify-center gap-2 rounded-lg border px-2.5 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${tone} ${
        highlight ? 'ring-2 ring-amber-300 ring-offset-1 ring-offset-white' : ''
      } ${isPlaceholder && !winner ? 'opacity-70' : ''}`}
      onMouseEnter={() => displayParticipant && onHoverParticipant(displayParticipant.id)}
      onMouseLeave={() => onHoverParticipant(null)}
    >
      <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
        {displayParticipant?.seed ? (
          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-[#03205c] px-1 text-[10px] font-black text-white">
            {displayParticipant.seed}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-col items-center justify-center leading-tight">
          <span
            className={`truncate text-center text-[13px] ${
              bothForfeited
                ? 'font-semibold text-red-500 line-through decoration-red-300'
                : winner || displayParticipant
                  ? 'font-black text-[#03205c]'
                  : 'font-semibold italic text-slate-400'
            }`}
          >
            {displayName}
          </span>
          {displayParticipant?.teamName && displayParticipant.members?.length ? (
            <span className="truncate text-center text-[10px] font-semibold text-slate-400">
              {displayParticipant.members.join(' / ')}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {bothForfeited ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-700">双方弃权</span>
        ) : isForfeit ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-700">晋级</span>
        ) : isLive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-black text-white">
            <span className="bracket-live-pulse h-1 w-1 rounded-full bg-white" />
            直播中
          </span>
        ) : winner ? (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-amber-500" fill="currentColor" aria-hidden>
            <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" />
          </svg>
        ) : null}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Group stage view
// ─────────────────────────────────────────────────────────────────────

function GroupStageView({
  matches,
  groups,
  bracketSize,
  sideFor,
  winnerFor,
  onOpenMatch,
  onHoverParticipant,
  hoveredParticipantId,
}: {
  matches: LayoutMatch[];
  groups: BracketGroup[];
  bracketSize: number;
  sideFor: (match: BracketMatch, side: 1 | 2) => BracketParticipant | null;
  winnerFor: (match: BracketMatch) => BracketParticipant | null;
  onOpenMatch: (m: LayoutMatch) => void;
  onHoverParticipant: (id: string | null) => void;
  hoveredParticipantId: string | null;
}) {
  const matchGroups = useMemo(() => {
    const result: Array<{ key: string; title: string; matches: LayoutMatch[] }> = [];
    for (const match of matches) {
      const title = roundLabelForMatch(match, bracketSize);
      const key = `${match.roundNo}-${title}`;
      const group = result.find((item) => item.key === key);
      if (group) group.matches.push(match);
      else result.push({ key, title, matches: [match] });
    }
    return result;
  }, [bracketSize, matches]);

  return (
    <div className="border-b border-blue-100 bg-[#f7f9fd] px-4 py-4 sm:px-6 sm:py-5">
      <div className="space-y-4">
        {groups.length ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-[#03205c]">分组名单</h3>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">
                {groups.length} 组
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {groups.map((group) => (
                <article key={group.code} className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-blue-50 bg-blue-50/55 px-4 py-3">
                    <h4 className="text-sm font-black text-[#03205c]">{group.label}</h4>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-blue-700">
                      {group.members.length} 人
                    </span>
                  </div>
                  <div className="divide-y divide-blue-50">
                    {group.members.map((member, index) => (
                      <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-100 text-[11px] font-black text-slate-500">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {member.seed ? (
                              <span className="shrink-0 rounded bg-[#03205c] px-1.5 py-0.5 text-[10px] font-black text-white">
                                {member.seed}
                              </span>
                            ) : null}
                            <p className="truncate text-sm font-black text-slate-800">{member.name}</p>
                          </div>
                          {member.teamName && member.members?.length ? (
                            <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
                              {member.members.join(' / ')}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {matchGroups.map((group) => (
          <section key={group.key} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-[#03205c]">{group.title}</h3>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">
                {group.matches.length} 场
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.matches.map((match) => {
                const highlighted =
                  Boolean(hoveredParticipantId) &&
                  (match.side1Id === hoveredParticipantId || match.side2Id === hoveredParticipantId);
                return (
                  <MatchCard
                    key={match.layoutKey}
                    match={match}
                    side1={sideFor(match, 1)}
                    side2={sideFor(match, 2)}
                    winner={winnerFor(match)}
                    highlight={highlighted}
                    variant="list"
                    onOpen={() => onOpenMatch(match)}
                    onHoverParticipant={onHoverParticipant}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Rounds view (mobile-first list)
// ─────────────────────────────────────────────────────────────────────

function RoundsView({
  roundNos,
  bracketSize,
  matches,
  activeRound,
  onChangeRound,
  sideFor,
  winnerFor,
  onOpenMatch,
  onHoverParticipant,
  highlightedKeys,
  zoom,
  setZoom,
  zoomLimits,
}: {
  roundNos: number[];
  bracketSize: number;
  matches: LayoutMatch[];
  activeRound: number;
  onChangeRound: (r: number) => void;
  sideFor: (match: BracketMatch, side: 1 | 2) => BracketParticipant | null;
  winnerFor: (match: BracketMatch) => BracketParticipant | null;
  onOpenMatch: (m: LayoutMatch) => void;
  onHoverParticipant: (id: string | null) => void;
  highlightedKeys: Set<string>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  zoomLimits: { min: number; max: number };
}) {
  const activeMatches = matches.filter((m) => m.roundNo === activeRound);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  useBracketZoomGestures(viewportRef, setZoom, zoomLimits);

  return (
    <div className="bg-[#f7f9fd] px-4 py-4 sm:px-6 sm:py-5">
      <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {roundNos.map((r) => {
          const roundMatches = matches.filter((m) => m.roundNo === r);
          const count = roundMatches.length || bracketSize / 2 ** r;
          const active = activeRound === r;
          const label = roundMatches[0]
            ? roundLabelForMatch(roundMatches[0], bracketSize)
            : defaultRoundLabel(bracketSize, r);
          return (
            <button
              key={r}
              type="button"
              onClick={() => onChangeRound(r)}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-black transition ${
                active
                  ? 'border-[#0a5dd1] bg-[#0a5dd1] text-white shadow-sm'
                  : 'border-blue-100 bg-white text-slate-600 hover:border-blue-300 hover:text-[#0a5dd1]'
              }`}
            >
              <span>{label}</span>
              <span
                className={`rounded-full px-1.5 text-[10px] ${
                  active ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-700'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        ref={viewportRef}
        className="overflow-auto [scrollbar-width:thin] [touch-action:pan-x_pan-y]"
        style={{ maxHeight: 640 }}
      >
        <div style={{ zoom }}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {activeMatches.map((m) => (
            <MatchCard
              key={m.layoutKey}
              match={m}
              side1={sideFor(m, 1)}
              side2={sideFor(m, 2)}
              winner={winnerFor(m)}
              highlight={highlightedKeys.has(m.layoutKey)}
              variant="list"
              onOpen={() => onOpenMatch(m)}
              onHoverParticipant={onHoverParticipant}
            />
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Match card
// ─────────────────────────────────────────────────────────────────────

function MatchCard({
  match,
  side1,
  side2,
  winner,
  highlight,
  variant = 'tree',
  onOpen,
  onHoverParticipant,
  adminMode = false,
  slotIndex1 = null,
  slotIndex2 = null,
  onDragSlot,
  onDropSlot,
}: {
  match: LayoutMatch;
  side1: BracketParticipant | null;
  side2: BracketParticipant | null;
  winner: BracketParticipant | null;
  highlight: boolean;
  variant?: 'tree' | 'list';
  onOpen: () => void;
  onHoverParticipant: (id: string | null) => void;
  adminMode?: boolean;
  slotIndex1?: number | null;
  slotIndex2?: number | null;
  onDragSlot?: (idx: number | null) => void;
  onDropSlot?: (targetIdx: number) => void;
}) {
  const status = normalizeStatus(match.status);
  const isLive = status === 'LIVE';
  const isPaused = isLive && Boolean(match.matchPaused);
  const isDone = status === 'COMPLETED';
  const isPending = status === 'PENDING';
  const forfeitedSide = match.forfeitedSide === 1 || match.forfeitedSide === 2 ? match.forfeitedSide : null;
  const bothForfeited = match.forfeitedSide === 0;
  const isForfeit = forfeitedSide !== null || bothForfeited;
  const scores = parseScores(match.gamesText || match.score);
  const isPlaceholder = match.id.startsWith('placeholder-');
  const time = formatTime(match.scheduledAt);
  const venueName = match.venueName?.trim();
  const refereeName = match.refereeName?.trim();
  const latestEvent = match.latestEvents?.[0] ?? null;
  const latestEventTime = formatTime(latestEvent?.createdAt);

  const tone = isForfeit
    ? 'border-red-200 bg-red-50/40'
    : isPaused
      ? 'border-amber-300 bg-amber-50/60 ring-1 ring-amber-200'
      : isLive
      ? 'border-red-200 bg-red-50/40 ring-1 ring-red-100'
      : isDone
        ? 'border-amber-200 bg-amber-50/40'
        : 'border-blue-100 bg-white';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative flex h-full w-full flex-col rounded-xl border text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${tone} ${
        highlight ? 'ring-2 ring-amber-300 ring-offset-1 ring-offset-white' : ''
      } ${isPlaceholder ? 'opacity-65' : ''}`}
    >
      {/* Top row: round label + status */}
      <div className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-1.5">
        <span className="truncate text-[10px] font-black uppercase tracking-wider text-slate-400">
          第 {match.matchNo} 场
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${
            isForfeit
              ? 'bg-red-100 text-red-700'
              : isPaused
                ? 'bg-amber-500 text-white'
                : isLive
                ? 'bg-red-500 text-white'
                : isDone
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-500'
          }`}
        >
          {isLive && !isPaused && !isForfeit ? <span className="bracket-live-pulse h-1.5 w-1.5 rounded-full bg-white" /> : null}
          {bothForfeited ? '双方弃权' : isForfeit ? '弃权' : isPaused ? '比赛暂停' : statusText(match.status)}
        </span>
      </div>

      {latestEvent ? (
        <div className="flex items-center justify-between gap-2 border-b border-black/5 bg-white/70 px-3 py-1.5 text-[10px] font-black text-emerald-700">
          <span className="truncate">{matchEventText(latestEvent)}</span>
          <span className="shrink-0 text-emerald-600/80">{latestEventTime ?? '刚刚记录'}</span>
        </div>
      ) : null}

      {/* Sides */}
      <div className="flex flex-1 flex-col gap-1 p-1">
        <SideRow
          participant={side1}
          score={isForfeit ? undefined : scores.a}
          isWinner={winner?.id === side1?.id && !!winner}
          dim={!!winner && winner.id !== side1?.id}
          forfeited={forfeitedSide === 1 || bothForfeited}
          walkover={forfeitedSide === 2}
          onHover={onHoverParticipant}
          adminMode={adminMode}
          slotIndex={slotIndex1}
          onDragSlot={onDragSlot}
          onDropSlot={onDropSlot}
        />
        <SideRow
          participant={side2}
          score={isForfeit ? undefined : scores.b}
          isWinner={winner?.id === side2?.id && !!winner}
          dim={!!winner && winner.id !== side2?.id}
          forfeited={forfeitedSide === 2 || bothForfeited}
          walkover={forfeitedSide === 1}
          onHover={onHoverParticipant}
          adminMode={adminMode}
          slotIndex={slotIndex2}
          onDragSlot={onDragSlot}
          onDropSlot={onDropSlot}
        />
      </div>

      {/* Footer (only in list variant or when meta exists) */}
      {variant === 'list' && (venueName || time) ? (
        <div className="flex items-center justify-between gap-2 border-t border-black/5 px-3 py-1.5 text-[10px] font-bold text-slate-500">
          <span className="truncate">{venueName ?? '待排场地'}</span>
          <span>{time ?? '待排时间'}</span>
        </div>
      ) : null}
      {variant === 'list' && refereeName ? (
        <div className="flex items-center gap-1.5 border-t border-black/5 px-3 py-1.5 text-[10px] font-bold">
          <span className="shrink-0 text-slate-400">本场裁判</span>
          <span className="truncate font-black text-[#0a5dd1]">{refereeName}</span>
        </div>
      ) : null}
    </button>
  );
}

function SideRow({
  participant,
  score,
  isWinner,
  dim,
  forfeited = false,
  walkover = false,
  onHover,
  adminMode,
  slotIndex,
  onDragSlot,
  onDropSlot,
}: {
  participant: BracketParticipant | null;
  score?: number;
  isWinner: boolean;
  dim: boolean;
  forfeited?: boolean;
  walkover?: boolean;
  onHover: (id: string | null) => void;
  adminMode: boolean;
  slotIndex: number | null;
  onDragSlot?: (idx: number | null) => void;
  onDropSlot?: (targetIdx: number) => void;
}) {
  const bye = !participant || participant.isBye;
  const draggable = adminMode && !bye && slotIndex !== null;

  return (
    <div
      className={`flex flex-1 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 ${
        forfeited
          ? 'bg-red-50/70 line-through decoration-red-300/70'
          : isWinner
            ? 'bg-amber-50/70'
            : 'bg-slate-50/60'
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={draggable}
      onDragStart={() => draggable && onDragSlot?.(slotIndex)}
      onDragOver={(event) => {
        if (draggable) event.preventDefault();
      }}
      onDrop={() => {
        if (draggable && slotIndex !== null) onDropSlot?.(slotIndex);
      }}
      onMouseEnter={() => participant && !bye && onHover(participant.id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
        {participant?.seed ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-[#03205c] px-1 text-[10px] font-black text-white">
            {participant.seed}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-col items-center justify-center leading-tight">
          <span
            className={`truncate text-center text-sm ${
              bye
                ? 'font-semibold italic text-slate-300'
                : forfeited
                  ? 'font-semibold text-red-500'
                  : isWinner
                    ? 'font-black text-[#03205c]'
                    : dim
                      ? 'font-semibold text-slate-400'
                      : 'font-bold text-slate-700'
            }`}
          >
            {participant?.name ?? '待定'}
          </span>
          {participant?.teamName && participant.members?.length ? (
            <span className="truncate text-center text-[10px] font-semibold text-slate-400">
              {participant.members.join(' / ')}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        {forfeited ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-black text-red-700 no-underline">
            弃权
          </span>
        ) : walkover ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">
            晋级
          </span>
        ) : isWinner ? (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-amber-500" fill="currentColor" aria-hidden>
            <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" />
          </svg>
        ) : null}
        {typeof score === 'number' ? (
          <span
            className={`tabular-nums text-sm ${
              isWinner ? 'font-black text-[#03205c]' : 'font-bold text-slate-500'
            }`}
          >
            {score}
          </span>
        ) : null}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────

function MatchDetailModal({
  match,
  label,
  side1,
  side2,
  winner,
  onClose,
}: {
  match: LayoutMatch;
  label: string;
  side1: BracketParticipant | null;
  side2: BracketParticipant | null;
  winner: BracketParticipant | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const status = normalizeStatus(match.status);
  const isLive = status === 'LIVE';
  const isPaused = isLive && Boolean(match.matchPaused);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#02133b]/55 backdrop-blur-sm p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 bg-gradient-to-r from-[#052163] via-[#0a5dd1] to-[#03205c] px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-100/85">
              {label}
            </p>
            <h3 className="mt-1 text-lg font-black">第 {match.matchNo} 场比赛详情</h3>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/30 text-white transition hover:bg-white/10"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="space-y-4 px-5 py-5">
          <div className="flex flex-col gap-2 rounded-xl border border-blue-100 bg-blue-50/30 p-2">
            <ModalSide
              participant={side1}
              winner={!!winner && winner.id === side1?.id}
              score={match.forfeitedSide ? undefined : parseScores(match.gamesText || match.score).a}
              forfeited={match.forfeitedSide === 1}
            />
            <ModalSide
              participant={side2}
              winner={!!winner && winner.id === side2?.id}
              score={match.forfeitedSide ? undefined : parseScores(match.gamesText || match.score).b}
              forfeited={match.forfeitedSide === 2}
            />
          </div>

          <dl className="grid grid-cols-2 gap-2.5 text-sm">
            <ModalFact
              label="状态"
              value={match.forfeitedSide ? (match.forfeitLabel ?? '弃权') : isPaused ? '比赛暂停' : statusText(match.status)}
              highlight={isLive || !!match.forfeitedSide}
              highlightTone={isPaused ? 'amber' : 'red'}
            />
            <ModalFact
              label="比分"
              value={match.forfeitedSide ? 'WO' : match.gamesText || match.score || '—'}
              mono
            />
            <ModalFact label="场地" value={match.venueName || '待排场地'} />
            <ModalFact label="时间" value={formatTime(match.scheduledAt) ?? '待排时间'} />
            <ModalFact label="裁判" value={match.refereeName || '待分配'} />
            <ModalFact label="胜方" value={winner?.name || '待定'} highlight={!!winner} highlightTone="amber" />
            <ModalFact label="预估时长" value={match.durationMinutes ? `${match.durationMinutes}分钟` : '—'} />
            <ModalFact
              label="实际用时"
              value={formatActualDuration(match.startedAt, match.finishedAt, match.actualDurationSeconds, match.matchPaused)}
            />
          </dl>

          {match.latestEvents?.length ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700/70">裁判记录</p>
              <div className="mt-2 space-y-1.5">
                {match.latestEvents.map((event) => (
                  <p key={event.id} className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                    <span className="truncate">{matchEventText(event)}</span>
                    <span className="shrink-0 font-black text-emerald-700">{formatTime(event.createdAt) ?? '刚刚记录'}</span>
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {match.forfeitedSide ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
              <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden>
                <path fillRule="evenodd" d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM9 7a1 1 0 1 1 2 0v4a1 1 0 1 1-2 0V7zm1 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" clipRule="evenodd" />
              </svg>
              <div className="min-w-0">
                <p className="text-xs font-black text-red-700">
                  {match.forfeitedSide === 1 ? side1?.name : side2?.name} {match.forfeitLabel ?? '弃权'}
                </p>
                {match.forfeitReason ? (
                  <p className="mt-0.5 text-xs font-semibold text-red-600/80">{match.forfeitReason}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {match.detailLines?.length ? (
            <div className="rounded-xl bg-blue-50/60 p-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-blue-700/70">子场次明细</p>
              <div className="mt-2 space-y-1.5">
                {match.detailLines.map((line) => (
                  <p key={line} className="text-xs font-semibold text-slate-600">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModalSide({
  participant,
  winner,
  score,
  forfeited = false,
}: {
  participant: BracketParticipant | null;
  winner: boolean;
  score?: number;
  forfeited?: boolean;
}) {
  const bye = !participant || participant.isBye;
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${
        forfeited ? 'bg-red-50/80' : winner ? 'bg-amber-50/80' : 'bg-white'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {participant?.seed ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-[#03205c] px-1 text-[10px] font-black text-white">
            {participant.seed}
          </span>
        ) : null}
        <span className="min-w-0">
          <span
            className={`block truncate text-sm ${
              bye
                ? 'italic text-slate-300'
                : forfeited
                  ? 'font-semibold text-red-500 line-through decoration-red-300'
                  : winner
                    ? 'font-black text-[#03205c]'
                    : 'font-bold text-slate-700'
            }`}
          >
            {participant?.name ?? '待定'}
          </span>
          {participant?.teamName && participant.members?.length ? (
            <span className="block truncate text-[11px] font-semibold text-slate-400">
              {participant.members.join(' / ')}
            </span>
          ) : null}
          {participant?.affiliation ? (
            <span className="block truncate text-[11px] font-semibold text-slate-400">
              {participant.affiliation}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {forfeited ? (
          <span className="inline-flex h-5 items-center rounded bg-red-500 px-1.5 text-[10px] font-black text-white">
            弃权
          </span>
        ) : winner ? (
          <span className="inline-flex h-5 items-center rounded bg-amber-400 px-1.5 text-[10px] font-black text-white">
            {score === undefined ? '晋级' : '胜'}
          </span>
        ) : null}
        {typeof score === 'number' ? (
          <span className={`text-lg tabular-nums ${winner ? 'font-black text-[#03205c]' : 'font-bold text-slate-500'}`}>
            {score}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function ModalFact({
  label,
  value,
  highlight = false,
  highlightTone = 'amber',
  mono = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  highlightTone?: 'amber' | 'red';
  mono?: boolean;
}) {
  const toneClass = highlight
    ? highlightTone === 'red'
      ? 'text-red-600'
      : 'text-amber-700'
    : 'text-slate-800';
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2">
      <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm font-black ${toneClass} ${mono ? 'tabular-nums' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
