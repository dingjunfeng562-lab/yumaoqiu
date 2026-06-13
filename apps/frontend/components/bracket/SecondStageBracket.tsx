'use client';

export type SecondStageStatus = 'NOT_STARTED' | 'DRAFT' | 'CONFIRMED' | 'FINISHED' | string;
export type SecondStageRankingMode = 'TOP_6' | 'TOP_8' | string;

export type SecondStageSlot = {
  slot: string;
  playerId?: string | null;
  playerName?: string | null;
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

function matchStatusText(status?: string | null) {
  const key = String(status ?? 'PENDING').toUpperCase();
  if (key === 'FINISHED') return STATUS_TEXT.FINISHED_MATCH;
  return STATUS_TEXT[key] ?? status ?? '待开赛';
}

function sideLabel(source?: string | null, name?: string | null) {
  const cleanName = name?.trim();
  const cleanSource = source?.trim();
  if (!cleanName && !cleanSource) return '待定';
  if (!cleanName) return cleanSource;
  if (!cleanSource || cleanSource === cleanName) return cleanName;
  return `${cleanSource} ${cleanName}`;
}

function scoreText(score?: string | null) {
  if (!score) return '未录入';
  return score.replace(/\s*[:：]\s*/g, ' : ');
}

function groupedMatches(data: SecondStageData) {
  const matches = [...(data.matches ?? [])].sort((a, b) => a.matchNo - b.matchNo);
  const rankingMode = data.rankingMode ?? 'TOP_8';
  const groups = [
    { title: '前8初始赛', matches: matches.filter((m) => m.matchNo >= 1 && m.matchNo <= 4) },
    { title: '1—4名争夺区', matches: matches.filter((m) => m.matchNo >= 5 && m.matchNo <= 8) },
    {
      title: rankingMode === 'TOP_6' ? '5—6名争夺区' : '5—8名争夺区',
      matches: matches.filter((m) => m.matchNo >= 9),
    },
  ];
  return groups.filter((group) => group.matches.length > 0);
}

function rankingHint(matchNo: number, rankingMode?: SecondStageRankingMode) {
  if (matchNo === 7) return '胜者为第1名，负者为第2名';
  if (matchNo === 8) return '胜者为第3名，负者为第4名';
  if (matchNo === 11) return '胜者为第5名，负者为第6名';
  if (rankingMode !== 'TOP_6' && matchNo === 12) return '胜者为第7名，负者为第8名';
  return null;
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

      {!formal ? (
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
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-xs font-black text-white">
                    {slot.slot}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right text-sm font-black text-slate-800">
                    {slot.playerName ?? '待定'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {groupedMatches(data).map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-sm font-black text-slate-900">{group.title}</h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {group.matches.map((match) => {
                  const hint = rankingHint(match.matchNo, rankingMode);
                  return (
                    <article
                      key={match.id ?? match.matchNo}
                      className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-slate-500">
                            第{match.matchNo}场｜{match.roundName ?? group.title}
                            {match.slotInfo ? `｜${match.slotInfo}` : ''}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] font-bold text-emerald-700">
                            {match.area ?? group.title}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">
                          {matchStatusText(match.status)}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-black text-slate-900">
                          {sideLabel(match.source1, match.player1Name)}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">
                          vs
                        </span>
                        <span className="min-w-0 truncate text-right text-sm font-black text-slate-900">
                          {sideLabel(match.source2, match.player2Name)}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-600">
                        <span>比分：{scoreText(match.score)}</span>
                        <span>胜者：{match.winnerName ?? '待定'}</span>
                      </div>
                      {hint ? (
                        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                          {hint}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

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
