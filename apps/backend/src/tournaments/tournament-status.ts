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

export function effectiveTournamentStatus(tournament: TournamentTiming, now = new Date()): TournamentStatus {
  const timedStatus = deriveTournamentStatusByTime(tournament, now);
  return statusRank(tournament.status) >= statusRank(timedStatus) ? tournament.status : timedStatus;
}

function statusRank(status: TournamentStatus) {
  return STATUS_ORDER.indexOf(status);
}
