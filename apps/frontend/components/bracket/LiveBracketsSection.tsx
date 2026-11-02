'use client';

import { useLiveBrackets } from '@/lib/use-live-brackets';
import { KnockoutBracket, type KnockoutBracketData } from './KnockoutBracket';

// Live wrapper around the bracket section: keeps the server-rendered
// brackets as initial state. Live score ticks patch the affected match in
// place (bracket:match), and advances / forfeits / clears refetch only this
// tournament, so everything updates without a page reload (see useLiveBrackets).
export function LiveBracketsSection({
  tournamentId,
  initialBrackets,
}: {
  tournamentId: string;
  initialBrackets: KnockoutBracketData[];
}) {
  const { brackets: allBrackets } = useLiveBrackets(initialBrackets, { tournamentId });
  const brackets = allBrackets.filter((bracket) => bracket.tournamentId === tournamentId);

  if (!brackets.length) {
    return (
      <div className="rounded-xl border border-dashed border-blue-200 bg-white px-5 py-8 text-center shadow-sm sm:py-10">
        <p className="text-sm font-black text-slate-700">该赛事未发布对阵表</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          报名截止并完成抽签后,这里会自动展示完整的淘汰赛签表。
        </p>
      </div>
    );
  }

  return (
    <>
      {brackets.map((bracket) => (
        <KnockoutBracket key={bracket.id} data={bracket} />
      ))}
    </>
  );
}
