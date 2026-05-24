const ROUND_LABELS: Record<string, string> = {
  F: '决赛',
  SF: '半决赛',
  QF: '1/4 决赛',
  R1: '1/8 决赛',
  R2: '1/16 决赛',
  R3: '1/32 决赛',
  BRONZE: '季军赛',
};

export function roundCn(round: string): string {
  return ROUND_LABELS[round] ?? round;
}
