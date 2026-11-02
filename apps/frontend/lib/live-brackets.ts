import type { BracketMatch, KnockoutBracketData } from '@/components/bracket/KnockoutBracket';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/**
 * `bracket:match` socket payload: one match exactly as it appears inside
 * /api/public/brackets. `match: null` means the server can't express this
 * change as a single card (e.g. second-stage matches), so refetch the
 * tournament instead.
 */
export type BracketMatchPush = {
  tournamentId: string;
  bracketId: string;
  matchId: string;
  match: BracketMatch | null;
  at?: string;
};

/** `bracket:update` socket payload (unchanged server event). */
export type BracketUpdatePush = {
  tournamentId?: string | null;
  eventId?: string | null;
  matchId?: string | null;
};

/** Public brackets, optionally only one tournament's (much smaller). */
export async function fetchPublicBrackets(tournamentId?: string | null): Promise<KnockoutBracketData[]> {
  const query = tournamentId ? `?tournamentId=${encodeURIComponent(tournamentId)}` : '';
  const res = await fetch(`${API_BASE}/public/brackets${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`获取对阵数据失败（${res.status}）`);
  const data = (await res.json()) as { brackets?: KnockoutBracketData[] };
  return data.brackets ?? [];
}

/** Replace one match card in place. Returns the same array if it isn't shown. */
export function patchBracketMatch(
  brackets: KnockoutBracketData[],
  push: BracketMatchPush,
): KnockoutBracketData[] {
  const { match } = push;
  if (!match) return brackets;
  let changed = false;
  const next = brackets.map((bracket) => {
    if (bracket.id !== push.bracketId) return bracket;
    const index = bracket.matches.findIndex((item) => item.id === push.matchId);
    if (index < 0) return bracket;
    changed = true;
    const matches = bracket.matches.slice();
    matches[index] = match;
    return { ...bracket, matches };
  });
  return changed ? next : brackets;
}

/**
 * Swap in one tournament's freshly fetched brackets, leaving the other
 * tournaments untouched and keeping the tournament where it was in the list.
 */
export function replaceTournamentBrackets(
  brackets: KnockoutBracketData[],
  tournamentId: string,
  fresh: KnockoutBracketData[],
): KnockoutBracketData[] {
  const firstIndex = brackets.findIndex((bracket) => bracket.tournamentId === tournamentId);
  const others = brackets.filter((bracket) => bracket.tournamentId !== tournamentId);
  if (firstIndex < 0) return [...others, ...fresh];
  // Everything before the first old entry belongs to other tournaments.
  return [...others.slice(0, firstIndex), ...fresh, ...others.slice(firstIndex)];
}

/**
 * Pushes that arrive while a refetch is in flight. A refetch that started
 * before a push may return the older score; re-applying the newer pushes on
 * top keeps a slow response from rolling the board back.
 */
export class BracketPatchLog {
  private seq = 0;
  private entries: Array<{ seq: number; push: BracketMatchPush }> = [];

  record(push: BracketMatchPush) {
    this.entries.push({ seq: ++this.seq, push });
  }

  /** Call when a refetch starts; pass the result to reapply/prune. */
  mark() {
    return this.seq;
  }

  reapply(brackets: KnockoutBracketData[], since: number) {
    return this.entries
      .filter((entry) => entry.seq > since)
      .reduce((acc, entry) => patchBracketMatch(acc, entry.push), brackets);
  }

  /** Drop pushes the finished refetch already reflects. */
  prune(upTo: number) {
    this.entries = this.entries.filter((entry) => entry.seq > upTo);
  }
}
