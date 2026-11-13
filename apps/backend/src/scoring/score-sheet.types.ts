/** 电子比分单的结束方式。 */
export type ScoreSheetEndType = 'NORMAL' | 'FORFEIT' | 'RETIRE' | 'BLACK_CARD' | 'BOTH_FORFEIT';

export const SCORE_SHEET_END_TYPE_LABELS: Record<ScoreSheetEndType, string> = {
  NORMAL: '正常结束',
  FORFEIT: '弃权',
  RETIRE: '伤退/退赛',
  BLACK_CARD: '黑牌取消资格',
  BOTH_FORFEIT: '双方弃权',
};

export type ScoreSheetSide = {
  name: string;
  teamName: string | null;
  affiliation: string | null;
  players: Array<{ index: number; name: string; affiliation: string | null }>;
};

/**
 * 签字那一刻冻结的比分。之后比赛再被改分、重开都不影响它；比分单图片也只按它来画。
 * 时间一律存 ISO 字符串，画图时再换成北京时间。
 */
export type ScoreSheetSnapshot = {
  version: 1;
  tournament: { id: string; name: string; edition: number };
  matchId: string;
  eventLabel: string;
  roundLabel: string;
  /** 例如「1/4 决赛 · 第 3 场」；团体赛为「… · 团体第 2 场 · 第 1 项」。 */
  matchLabel: string;
  matchNo: number;
  venue: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  side1: ScoreSheetSide | null;
  side2: ScoreSheetSide | null;
  games: Array<{ gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null }>;
  side1Games: number;
  side2Games: number;
  winnerSide: 1 | 2 | null;
  endType: ScoreSheetEndType;
  endReason: string | null;
  /** 每局逐分过程：每得一分后的比分 [A, B]。弃权或后台录入的比赛没有逐分记录。 */
  points: Array<{ gameNo: number; scores: Array<[number, number]> }>;
  referee: { id: string; name: string };
};

/** 裁判端提交的签名：PNG 的 data URL。 */
export type MatchSignatureInput = {
  winnerSignature?: string;
  /** 胜方第几名选手签的字；双打由其中一人签。 */
  winnerSignerIndex?: number;
  refereeSignature?: string;
};

export type ScoreSheetRequestMeta = {
  ip?: string | null;
  userAgent?: string | null;
};

export type PreparedSignatures = {
  winner: { image: Buffer; sha256: string; signerIndex: number | null; signerName: string | null } | null;
  referee: { image: Buffer; sha256: string };
};

export type ScoreSheetFiles = {
  winnerPath: string | null;
  refereePath: string;
};

/** 结束比赛前准备好的签字：签名已校验并写到磁盘，等结束比赛的事务里落库。 */
export type ScoreSheetSigning = {
  sheetId: string;
  tournamentId: string;
  prepared: PreparedSignatures;
  files: ScoreSheetFiles;
  side1: ScoreSheetSide | null;
  side2: ScoreSheetSide | null;
};
