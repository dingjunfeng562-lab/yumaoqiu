'use client';

import { useMemo, useRef, useState } from 'react';
import {
  CloseOutlined,
  DragOutlined,
  EyeOutlined,
  FullscreenOutlined,
  SwapOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';

export type BracketStatus = 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED' | string;

export type BracketParticipant = {
  id: string;
  position: number;
  name: string;
  seed?: number | string | null;
  isBye?: boolean;
  affiliation?: string | null;
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
  score?: string | null;
  gamesText?: string | null;
  venueName?: string | null;
  refereeName?: string | null;
  scheduledAt?: string | null;
  detailLines?: string[];
};

export type KnockoutBracketData = {
  id: string;
  title: string;
  subtitle?: string;
  generatedAt?: string | null;
  participants: BracketParticipant[];
  matches: BracketMatch[];
};

type LayoutMatch = BracketMatch & {
  layoutKey: string;
  index: number;
};

type Point = {
  x: number;
  y: number;
};

const ROW_HEIGHT = 48;
const SLOT_HEIGHT = 34;
const PLAYER_WIDTH = 238;
const ROUND_WIDTH = 172;
const ROUND_GAP = 74;
const TOP_OFFSET = 86;
const BOARD_PADDING = 72;

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

function normalizeStatus(status: BracketStatus) {
  const text = String(status || 'PENDING').toUpperCase();
  if (text === 'LIVE' || status === '进行中') return 'LIVE';
  if (text === 'COMPLETED' || status === '已结束' || status === '已完成') return 'COMPLETED';
  if (text === 'CANCELLED' || status === '已取消') return 'CANCELLED';
  return 'PENDING';
}

function statusLabel(status: BracketStatus) {
  return STATUS_LABELS[String(status)] ?? STATUS_LABELS[normalizeStatus(status)] ?? '待开始';
}

function formatTime(value?: string | null) {
  if (!value) return '待排时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '待排时间';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildPlaceholderMatches(roundCount: number, bracketSize: number) {
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

function getPositionId(position: number) {
  return `bye-position-${position}`;
}

export function KnockoutBracket({
  data,
  allowAdminSwap = false,
}: {
  data: KnockoutBracketData;
  allowAdminSwap?: boolean;
}) {
  const baseSlots = useMemo(() => {
    const ordered = [...data.participants].sort((a, b) => a.position - b.position);
    const minSize = Math.max(
      ordered.length,
      data.matches.reduce((max, match) => Math.max(max, 2 ** match.roundNo), 2),
    );
    const bracketSize = nextPowerOfTwo(minSize);
    const slotMap = new Map(ordered.map((slot) => [slot.position, slot]));

    return Array.from({ length: bracketSize }, (_, index) => {
      const position = index + 1;
      return (
        slotMap.get(position) ?? {
          id: getPositionId(position),
          position,
          name: '— 轮空 —',
          isBye: true,
        }
      );
    });
  }, [data.matches, data.participants]);

  const [slots, setSlots] = useState(baseSlots);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<LayoutMatch | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingPan, setDraggingPan] = useState<{ pointerId: number; origin: Point; pan: Point } | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'rounds'>('tree');
  const [activeRound, setActiveRound] = useState(1);
  const [adminMode, setAdminMode] = useState(false);
  const [draggedSlot, setDraggedSlot] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const bracketSize = slots.length;
  const roundCount = roundCountFor(bracketSize);
  const boardHeight = TOP_OFFSET + bracketSize * ROW_HEIGHT + BOARD_PADDING;
  const resultX = (roundNo: number) => PLAYER_WIDTH + 60 + (roundNo - 1) * (ROUND_WIDTH + ROUND_GAP);
  const sourceX = (roundNo: number) => (roundNo === 1 ? PLAYER_WIDTH : resultX(roundNo - 1) + ROUND_WIDTH);
  const boardWidth = resultX(roundCount) + ROUND_WIDTH + BOARD_PADDING;

  const participantById = useMemo(() => {
    return new Map(slots.map((slot) => [slot.id, slot]));
  }, [slots]);

  const matches = useMemo(() => {
    const placeholders = buildPlaceholderMatches(roundCount, bracketSize);
    const byKey = new Map(placeholders.map((match) => [match.layoutKey, match]));
    for (const match of data.matches) {
      const index = Math.max(0, match.matchNo - 1);
      const key = `${match.roundNo}-${index}`;
      byKey.set(key, {
        ...match,
        index,
        layoutKey: key,
      });
    }
    return [...byKey.values()].sort((a, b) => a.roundNo - b.roundNo || a.index - b.index);
  }, [bracketSize, data.matches, roundCount]);

  const matchByRoundIndex = useMemo(() => {
    return new Map(matches.map((match) => [match.layoutKey, match]));
  }, [matches]);

  const slotIndexById = useMemo(() => {
    const map = new Map<string, number>();
    slots.forEach((slot, index) => map.set(slot.id, index));
    return map;
  }, [slots]);

  const highlightedKeys = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const slotIndex = slotIndexById.get(hoveredId);
    if (slotIndex === undefined) return new Set<string>();

    const keys = new Set<string>();
    for (let roundNo = 1; roundNo <= roundCount; roundNo += 1) {
      const index = Math.floor(slotIndex / 2 ** roundNo);
      const match = matchByRoundIndex.get(`${roundNo}-${index}`);
      if (match) {
        keys.add(match.layoutKey);
        keys.add(match.id);
      }
    }
    return keys;
  }, [hoveredId, matchByRoundIndex, roundCount, slotIndexById]);

  function yForSlot(index: number) {
    return TOP_OFFSET + index * ROW_HEIGHT + ROW_HEIGHT / 2;
  }

  function yForMatch(roundNo: number, index: number) {
    const groupSize = 2 ** roundNo;
    return TOP_OFFSET + (index * groupSize + groupSize / 2 - 0.5) * ROW_HEIGHT;
  }

  function yForSource(roundNo: number, sourceIndex: number) {
    return roundNo === 1 ? yForSlot(sourceIndex) : yForMatch(roundNo - 1, sourceIndex);
  }

  const linePaths = matches.map((match) => {
    const roundNo = match.roundNo;
    const groupSize = 2 ** roundNo;
    const firstSlotIndex = match.index * groupSize;
    const upperY = yForSource(roundNo, match.index * 2);
    const lowerY = yForSource(roundNo, match.index * 2 + 1);
    const centerY = yForMatch(roundNo, match.index);
    const startX = sourceX(roundNo);
    const endX = resultX(roundNo) - 14;
    const jointX = Math.round(startX + (endX - startX) * 0.46);
    const side1Slot = roundNo === 1 ? slots[firstSlotIndex] : null;
    const side2Slot = roundNo === 1 ? slots[firstSlotIndex + 1] : null;
    const hasFirstRoundBye =
      roundNo === 1 &&
      Boolean(side1Slot?.isBye) !== Boolean(side2Slot?.isBye);

    const path = hasFirstRoundBye
      ? `M ${startX} ${side1Slot?.isBye ? lowerY : upperY} H ${endX}`
      : `M ${startX} ${upperY} H ${jointX} M ${startX} ${lowerY} H ${jointX} M ${jointX} ${upperY} V ${lowerY} M ${jointX} ${centerY} H ${endX}`;

    return {
      key: match.layoutKey,
      match,
      path,
    };
  });

  function matchSide(match: BracketMatch, side: 1 | 2) {
    if (match.roundNo === 1) {
      const slot = slots[(match.matchNo - 1) * 2 + (side === 1 ? 0 : 1)];
      return slot ?? null;
    }
    const id = side === 1 ? match.side1Id : match.side2Id;
    return id ? participantById.get(id) ?? null : null;
  }

  function winnerFor(match: BracketMatch) {
    if (match.winnerId) return participantById.get(match.winnerId) ?? null;
    if (match.winnerSide === 1 || match.winnerSide === 2) return matchSide(match, match.winnerSide);
    return null;
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    setScale((current) => clamp(Number((current + delta).toFixed(2)), 0.65, 1.55));
  }

  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('[draggable="true"]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingPan({
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      pan,
    });
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingPan || draggingPan.pointerId !== event.pointerId) return;
    setPan({
      x: draggingPan.pan.x + event.clientX - draggingPan.origin.x,
      y: draggingPan.pan.y + event.clientY - draggingPan.origin.y,
    });
  }

  function stopPan(event: React.PointerEvent<HTMLDivElement>) {
    if (draggingPan?.pointerId === event.pointerId) setDraggingPan(null);
  }

  function resetView() {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

  function swapSlots(targetIndex: number) {
    if (draggedSlot === null || draggedSlot === targetIndex || !adminMode) return;
    setSlots((current) => {
      const next = [...current];
      [next[draggedSlot], next[targetIndex]] = [next[targetIndex], next[draggedSlot]];
      return next;
    });
    setDraggedSlot(null);
  }

  const activeMatches = matches.filter((match) => match.roundNo === activeRound);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-black text-slate-950">{data.title}</h2>
          {data.subtitle && <p className="mt-1 truncate text-xs font-semibold text-slate-500">{data.subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black transition ${
              viewMode === 'tree'
                ? 'border-slate-900 bg-slate-950 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
            }`}
            onClick={() => setViewMode('tree')}
          >
            <EyeOutlined />
            树形
          </button>
          <button
            type="button"
            className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black transition ${
              viewMode === 'rounds'
                ? 'border-slate-900 bg-slate-950 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
            }`}
            onClick={() => setViewMode('rounds')}
          >
            <FullscreenOutlined />
            轮次
          </button>
          {allowAdminSwap && (
            <button
              type="button"
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black transition ${
                adminMode
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
              }`}
              onClick={() => setAdminMode((current) => !current)}
            >
              <SwapOutlined />
              管理微调
            </button>
          )}
          <button
            type="button"
            aria-label="缩小"
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            onClick={() => setScale((current) => clamp(Number((current - 0.1).toFixed(2)), 0.65, 1.55))}
          >
            <ZoomOutOutlined />
          </button>
          <span className="w-12 text-center text-xs font-black text-slate-500">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            aria-label="放大"
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            onClick={() => setScale((current) => clamp(Number((current + 0.1).toFixed(2)), 0.65, 1.55))}
          >
            <ZoomInOutlined />
          </button>
          <button
            type="button"
            aria-label="重置视图"
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            onClick={resetView}
          >
            <DragOutlined />
          </button>
        </div>
      </div>

      {viewMode === 'tree' ? (
        <div
          ref={viewportRef}
          className="relative h-[620px] cursor-grab overflow-hidden bg-[#fbfcff] active:cursor-grabbing md:h-[720px]"
          onWheel={handleWheel}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={stopPan}
          onPointerCancel={stopPan}
        >
          <div
            className="absolute left-0 top-0"
            style={{
              width: boardWidth,
              height: boardHeight,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: '0 0',
            }}
          >
            <div className="absolute left-0 top-5 flex h-10 items-center text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              首轮签位
            </div>
            {Array.from({ length: roundCount }, (_, index) => {
              const roundNo = index + 1;
              return (
                <div
                  key={roundNo}
                  className="absolute top-5 flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-950 shadow-sm"
                  style={{ left: resultX(roundNo), width: ROUND_WIDTH }}
                >
                  {defaultRoundLabel(bracketSize, roundNo)}
                </div>
              );
            })}

            <svg className="absolute inset-0" width={boardWidth} height={boardHeight} aria-hidden>
              {linePaths.map(({ key, match, path }) => {
                const highlighted = highlightedKeys.has(key) || highlightedKeys.has(match.id);
                return (
                  <path
                    key={key}
                    d={path}
                    fill="none"
                    stroke={highlighted ? '#ef4444' : '#111827'}
                    strokeLinecap="square"
                    strokeWidth={highlighted ? 2.5 : 1.4}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>

            {slots.map((slot, index) => {
              const highlighted = hoveredId === slot.id;
              return (
                <div
                  key={`${slot.id}-${index}`}
                  className={`absolute grid items-center rounded-lg border bg-white shadow-sm transition ${
                    slot.isBye
                      ? 'border-dashed border-slate-200 text-slate-400'
                      : highlighted
                        ? 'border-red-400 ring-2 ring-red-100'
                        : 'border-slate-200 text-slate-950 hover:border-slate-400'
                  } ${adminMode && !slot.isBye ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  style={{
                    left: 0,
                    top: yForSlot(index) - SLOT_HEIGHT / 2,
                    width: PLAYER_WIDTH,
                    height: SLOT_HEIGHT,
                    gridTemplateColumns: '48px 1fr',
                  }}
                  draggable={adminMode && !slot.isBye}
                  onDragStart={() => setDraggedSlot(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => swapSlots(index)}
                  onMouseEnter={() => !slot.isBye && setHoveredId(slot.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span className="border-r border-slate-100 text-center font-mono text-xs font-black text-slate-500">
                    {index + 1}
                  </span>
                  <span className="min-w-0 truncate px-3 text-sm font-bold">
                    {slot.name}
                    {slot.seed && (
                      <sup className="ml-1 text-[10px] font-black text-slate-400">({slot.seed})</sup>
                    )}
                  </span>
                </div>
              );
            })}

            {matches.map((match) => {
              const normalized = normalizeStatus(match.status);
              const winner = winnerFor(match);
              const highlighted = highlightedKeys.has(match.layoutKey) || highlightedKeys.has(match.id);
              const isLive = normalized === 'LIVE';
              const isCompleted = normalized === 'COMPLETED';
              const cardTone = isLive
                ? 'border-red-500 bg-red-50 text-red-700 bracket-live-pulse'
                : isCompleted
                  ? 'border-slate-300 bg-slate-100 text-slate-500'
                  : 'border-slate-900 bg-white text-slate-950';

              return (
                <button
                  key={match.layoutKey}
                  type="button"
                  className={`absolute rounded-lg border px-3 py-1.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${cardTone} ${
                    highlighted ? 'ring-2 ring-red-100' : ''
                  }`}
                  style={{
                    left: resultX(match.roundNo),
                    top: yForMatch(match.roundNo, match.index) - 19,
                    width: ROUND_WIDTH,
                    minHeight: 38,
                  }}
                  onClick={() => setSelectedMatch(match)}
                >
                  <span className="flex items-center justify-between gap-2 text-[11px] font-black">
                    <span>第 {match.matchNo} 场</span>
                    <span>{statusLabel(match.status)}</span>
                  </span>
                  <span className={`mt-0.5 block truncate text-sm ${isLive ? 'font-black' : 'font-bold'}`}>
                    {isCompleted && winner ? winner.name : match.roundLabel ?? defaultRoundLabel(bracketSize, match.roundNo)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-[#fbfcff] p-4">
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {Array.from({ length: roundCount }, (_, index) => {
              const roundNo = index + 1;
              return (
                <button
                  type="button"
                  key={roundNo}
                  className={`h-9 shrink-0 rounded-lg border px-4 text-xs font-black ${
                    activeRound === roundNo
                      ? 'border-slate-950 bg-slate-950 text-white'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                  onClick={() => setActiveRound(roundNo)}
                >
                  {defaultRoundLabel(bracketSize, roundNo)}
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {activeMatches.map((match) => (
              <RoundMatchCard
                key={match.layoutKey}
                match={match}
                label={defaultRoundLabel(bracketSize, match.roundNo)}
                side1={matchSide(match, 1)}
                side2={matchSide(match, 2)}
                winner={winnerFor(match)}
                onOpen={() => setSelectedMatch(match)}
              />
            ))}
          </div>
        </div>
      )}

      {selectedMatch && (
        <MatchDetailModal
          match={selectedMatch}
          label={defaultRoundLabel(bracketSize, selectedMatch.roundNo)}
          side1={matchSide(selectedMatch, 1)}
          side2={matchSide(selectedMatch, 2)}
          winner={winnerFor(selectedMatch)}
          onClose={() => setSelectedMatch(null)}
        />
      )}
    </section>
  );
}

function RoundMatchCard({
  match,
  label,
  side1,
  side2,
  winner,
  onOpen,
}: {
  match: LayoutMatch;
  label: string;
  side1: BracketParticipant | null;
  side2: BracketParticipant | null;
  winner: BracketParticipant | null;
  onOpen: () => void;
}) {
  const normalized = normalizeStatus(match.status);
  return (
    <button
      type="button"
      className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-400 hover:shadow-md"
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm text-slate-950">{label} · 第 {match.matchNo} 场</strong>
        <span className={`text-xs font-black ${normalized === 'LIVE' ? 'text-red-600' : 'text-slate-500'}`}>
          {statusLabel(match.status)}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        <ParticipantLine participant={side1} winner={winner?.id === side1?.id} />
        <ParticipantLine participant={side2} winner={winner?.id === side2?.id} />
      </div>
      <p className="mt-3 text-xs font-semibold text-slate-500">比分：{match.gamesText || match.score || '-'}</p>
    </button>
  );
}

function ParticipantLine({
  participant,
  winner,
}: {
  participant: BracketParticipant | null;
  winner: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
      <span className={`truncate ${winner ? 'font-black text-slate-950' : 'font-semibold text-slate-600'}`}>
        {participant?.name ?? '待定'}
        {participant?.seed && <sup className="ml-1 text-[10px] text-slate-400">({participant.seed})</sup>}
      </span>
      {winner && <span className="text-xs font-black text-amber-600">胜</span>}
    </div>
  );
}

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
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <h3 className="mt-1 text-xl font-black text-slate-950">第 {match.matchNo} 场比赛详情</h3>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400"
            onClick={onClose}
          >
            <CloseOutlined />
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          <ParticipantLine participant={side1} winner={winner?.id === side1?.id} />
          <ParticipantLine participant={side2} winner={winner?.id === side2?.id} />
        </div>

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <DetailItem label="状态" value={statusLabel(match.status)} strong={normalizeStatus(match.status) === 'LIVE'} />
          <DetailItem label="比分" value={match.gamesText || match.score || '-'} />
          <DetailItem label="场地" value={match.venueName || '待排场地'} />
          <DetailItem label="时间" value={formatTime(match.scheduledAt)} />
          <DetailItem label="裁判" value={match.refereeName || '待分配'} />
          <DetailItem label="胜方" value={winner?.name || '待定'} strong={Boolean(winner)} />
        </dl>

        {match.detailLines?.length ? (
          <div className="mt-5 rounded-lg bg-slate-50 p-3">
            {match.detailLines.map((line) => (
              <p key={line} className="text-sm font-semibold text-slate-600">{line}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DetailItem({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <dt className="text-xs font-black text-slate-400">{label}</dt>
      <dd className={`mt-1 truncate ${strong ? 'font-black text-red-600' : 'font-bold text-slate-800'}`}>
        {value}
      </dd>
    </div>
  );
}
