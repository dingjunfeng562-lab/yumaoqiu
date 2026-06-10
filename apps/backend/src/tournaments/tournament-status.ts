import { TournamentStatus } from '@prisma/client';

type TournamentTiming = {
  status: TournamentStatus;
  registrationStartDate: Date | null;
  registrationEndDate: Date | null;
  startDate: Date;
  endDate: Date;
};

const STATUS_ORDER: TournamentStatus[] = [
  TournamentStatus.REGISTRATION_NOT_STARTED,
  TournamentStatus.REGISTRATION_OPEN,
  TournamentStatus.REGISTRATION_CLOSED,
  TournamentStatus.ONGOING,
  TournamentStatus.FINISHED,
];

export function deriveTournamentStatusByTime(
  tournament: Omit<TournamentTiming, 'status'>,
  now = new Date(),
): TournamentStatus {
  if (tournament.endDate <= now) return TournamentStatus.FINISHED;
  if (tournament.startDate <= now) return TournamentStatus.ONGOING;
  if (tournament.registrationEndDate && tournament.registrationEndDate <= now) {
    return TournamentStatus.REGISTRATION_CLOSED;
  }
  if (tournament.registrationStartDate && tournament.registrationStartDate <= now) {
    return TournamentStatus.REGISTRATION_OPEN;
  }
  return TournamentStatus.REGISTRATION_NOT_STARTED;
}

// The tournament status stored in the database is the single source of truth
// across admin, public, and big-screen views. Time-based auto-advance was
// previously merged in here, but it competed with the SUPER_ADMIN override on
// 赛事配置 — a manual change wouldn't propagate to the public side when the
// time-derived status outranked it. Use deriveTournamentStatusByTime directly
// if a caller specifically needs a wall-clock-derived value.
export function effectiveTournamentStatus(tournament: TournamentTiming, _now: Date = new Date()): TournamentStatus {
  void _now;
  return tournament.status;
}

// Kept exported for callers that explicitly want rank comparison semantics.
export function statusRank(status: TournamentStatus) {
  return STATUS_ORDER.indexOf(status);
}
