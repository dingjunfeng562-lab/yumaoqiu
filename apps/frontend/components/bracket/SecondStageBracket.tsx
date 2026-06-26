'use client';

import { SecondStageCrossBracket } from './SecondStageCrossBracket';

export type SecondStageStatus = 'NOT_STARTED' | 'DRAFT' | 'CONFIRMED' | 'FINISHED' | string;
export type SecondStageRankingMode = 'TOP_6' | 'TOP_8' | string;

export type SecondStageSlot = {
  slot: string;
  sourceLabel?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  playerMembers?: string[] | null;
};

export type SecondStageMatch = {
  id?: string;
  matchNo: number;
  stageName?: string | null;
  roundName?: string | null;
  area?: string | null;
  slotInfo?: string | null;
  source1?: string | null;
  source2?: string | null;
  player1Id?: string | null;
  player2Id?: string | null;
  player1Name?: string | null;
  player2Name?: string | null;
  player1Members?: string[] | null;
  player2Members?: string[] | null;
  score?: string | null;
  winnerSide?: number | null;
  winnerId?: string | null;
  winnerName?: string | null;
  status?: string | null;
};

export type SecondStageRanking = {
  rank: number;
  playerId?: string | null;
  playerName?: string | null;
};

export type SecondStageEligibleEntrant = {
  playerId: string;
  playerName?: string | null;
  playerMembers?: string[] | null;
  group?: string | null;
  rank?: number | null;
};

export type SecondStageData = {
  status?: SecondStageStatus;
  secondStageStatus?: SecondStageStatus;
  mode?: string | null;
  secondStageMode?: string | null;
  modeText?: string | null;
  rankingMode?: SecondStageRankingMode;
  rankingModeText?: string | null;
  slotSourceText?: string | null;
  slots?: SecondStageSlot[];
  matches?: SecondStageMatch[];
  rankings?: SecondStageRanking[];
  qualifierReady?: boolean;
  eligibleEntrants?: SecondStageEligibleEntrant[];
};

const SLOT_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const STATUS_TEXT: Record<string, string> = {
  NOT_STARTED: '暂未开启',
  DRAFT: '第二阶段分组待确认',
  CONFIRMED: '已确认',
  FINISHED: '已完成',
  PENDING: '待开赛',
  LIVE: '进行中',
  FINISHED_MATCH: '已结束',
  COMPLETED: '已结束',
  CANCELLED: '已取消',
};

function normalizedStatus(data: SecondStageData) {
  return String(data.secondStageStatus ?? data.status ?? 'NOT_STARTED').toUpperCase();
}

export function SecondStageBracket({ data }: { data: SecondStageData }) {
  const status = normalizedStatus(data);
  const rankingMode = data.rankingMode ?? 'TOP_8';
  const formal = status === 'CONFIRMED' || status === 'FINISHED';
  const slots = [...(data.slots ?? [])].sort(
    (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot),
  );
  const rankings = [...(data.rankings ?? [])]
    .filter((ranking) => rankingMode !== 'TOP_6' || ranking.rank <= 6)
    .sort((a, b) => a.rank - b.rank);
  const hasPreview = slots.length > 0 || (data.matches ?? []).length > 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
      <header className="border-b border-emerald-100 bg-emerald-700 px-4 py-4 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-100/80">
              Second Stage
            </p>
            <h2 className="mt-1 text-base font-black tracking-wide sm:text-lg">
              第二阶段：小组赛排位赛
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-black sm:text-xs">
            <span className="rounded-full bg-white/15 px-2.5 py-1">{STATUS_TEXT[status] ?? status}</span>
            <span className="rounded-full bg-white/15 px-2.5 py-1">{data.rankingModeText ?? '取前8名'}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-emerald-50/90">
          <span>分组方式：{data.modeText ?? '裁判手动指定'}</span>
          <span>签位来源：{data.slotSourceText ?? '组委会手动安排'}</span>
        </div>
      </header>

      {!formal && !hasPreview ? (
        <div className="bg-emerald-50 px-4 py-6 sm:px-6">
          <p className="text-sm font-black text-emerald-900">
            {status === 'DRAFT' ? '第二阶段分组待确认' : '第二阶段暂未开启'}
          </p>
          <p className="mt-1 text-xs font-semibold text-emerald-700/75">
            后台确认 A-H 签位并生成第二阶段后，这里会自动显示完整排位赛对阵。
          </p>
        </div>
      ) : (
        <div className="space-y-5 bg-[#f7f9fd] px-4 py-4 sm:px-6 sm:py-5">
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-900">A-H 签位表</h3>
              <span className="text-xs font-bold text-slate-500">裁判手动指定</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {slots.map((slot) => (
                <div
                  key={slot.slot}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-white px-3 py-2 shadow-sm"
                >
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-700 text-xs font-black text-white">
                      {slot.slot}
                    </span>
                    {slot.sourceLabel ? (
                      <span className="text-xs font-bold text-emerald-700">{slot.sourceLabel}</span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right text-sm font-black text-slate-800">
                    {slot.playerName ?? '待定'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-black text-slate-900">排位赛交叉对阵</h3>
            <SecondStageCrossBracket matches={data.matches ?? []} rankingMode={rankingMode} variant="light" />
          </section>

          {rankingMode === 'TOP_6' ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              本项目仅取前6名，不进行第7、第8名排位赛。
            </p>
          ) : null}

          <section>
            <h3 className="mb-2 text-sm font-black text-slate-900">最终排名</h3>
            {rankings.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {rankings.map((ranking) => (
                  <div
                    key={ranking.rank}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
                  >
                    <span className="text-sm font-black text-emerald-700">第{ranking.rank}名</span>
                    <span className="min-w-0 truncate text-right text-sm font-black text-slate-900">
                      {ranking.playerName ?? '待定'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-sm font-bold text-slate-500">
                最终排名将在对应排位赛完成后自动生成。
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
