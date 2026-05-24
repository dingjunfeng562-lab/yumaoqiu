import type { KnockoutBracketData } from '@/components/bracket/KnockoutBracket';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type BracketsResponse = {
  brackets?: KnockoutBracketData[];
};

export async function getBracketList(): Promise<KnockoutBracketData[]> {
  try {
    const res = await fetch(`${API_BASE}/public/brackets`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as BracketsResponse;
    return data.brackets ?? [];
  } catch {
    return [];
  }
}
