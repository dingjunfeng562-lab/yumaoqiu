import { TournamentStatus } from '@prisma/client';

export const COMPETITION_ORDER_MODES = ['REGISTRATION_FIRST', 'START_DATE_DESC', 'START_DATE_ASC'] as const;
export type CompetitionOrderMode = typeof COMPETITION_ORDER_MODES[number];

type PublicCompetitionOrder = {
  mode: CompetitionOrderMode;
  orderedIds: string[];
};

export function orderPublicCompetitions<T extends { id: string; status: TournamentStatus; startDate: Date }>(
  competitions: T[],
  { mode, orderedIds }: PublicCompetitionOrder,
) {
  const ranks = new Map(orderedIds.map((id, index) => [id, index]));
  return [...competitions].sort((a, b) => {
    const manual = (ranks.get(a.id) ?? orderedIds.length) - (ranks.get(b.id) ?? orderedIds.length);
    if (manual) return manual;
    if (mode === 'REGISTRATION_FIRST') {
      const registration = Number(b.status === TournamentStatus.REGISTRATION_OPEN) -
        Number(a.status === TournamentStatus.REGISTRATION_OPEN);
      if (registration) return registration;
    }
    const byStart = a.startDate.getTime() - b.startDate.getTime();
    return mode === 'START_DATE_ASC' ? byStart : -byStart;
  });
}
