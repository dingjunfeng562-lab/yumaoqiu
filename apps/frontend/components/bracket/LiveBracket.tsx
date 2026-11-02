'use client';

import { useLiveBrackets } from '@/lib/use-live-brackets';
import { KnockoutBracket, type KnockoutBracketData } from './KnockoutBracket';

// Single-bracket live wrapper. Used by the bracket detail page so winner
// advances / forfeits / clears (and live score ticks) re-render the bracket
// without a manual reload. Score ticks patch the one match in place; other
// changes refetch only this bracket's tournament (see useLiveBrackets).
export function LiveBracket({ initial }: { initial: KnockoutBracketData }) {
  const { brackets } = useLiveBrackets([initial], { tournamentId: initial.tournamentId ?? null });
  const bracket = brackets.find((item) => item.id === initial.id) ?? initial;

  return <KnockoutBracket data={bracket} />;
}
