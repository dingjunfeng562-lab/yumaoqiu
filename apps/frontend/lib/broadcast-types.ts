export const OVERLAY_POSITIONS = [
  { value: 'top-left', label: '左上' },
  { value: 'top-center', label: '顶部居中' },
  { value: 'top-right', label: '右上' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-center', label: '底部居中' },
  { value: 'bottom-right', label: '右下' },
] as const;

export type OverlayPosition = typeof OVERLAY_POSITIONS[number]['value'];

export type OverlaySettings = {
  position: OverlayPosition;
  offsetX: number;
  offsetY: number;
  scale: number;
  fontScale: number;
  showTitle: boolean;
  showAffiliation: boolean;
  showGames: boolean;
  showGameWins: boolean;
  showServe: boolean;
  visible: boolean;
  swapSides: boolean;
  scoreDelaySeconds: number;
  connectingText: string;
};

/**
 * Camera targets. Resolution and frame rate are not here on purpose: the app
 * derives both from this phone's own camera and encoder, so anything the site
 * fixed would be wrong on most devices. The app reports the result in its
 * heartbeat, which is what the admin panel displays.
 */
export type CameraSettings = {
  /** Upper bound in kbps. 0 means no limit, and the app sizes the bitrate for
   * whatever tier it measured. */
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  facing: 'back' | 'front';
  preferExternalMic: boolean;
};

export type CameraState = {
  state: 'IDLE' | 'PREVIEW' | 'CONNECTING' | 'STREAMING' | 'RECONNECTING' | 'ERROR';
  bitrateKbps: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  zoom: number | null;
  audioSource: string | null;
  battery: number | null;
  message: string | null;
  at: string;
};

/** Camera app status. The push URL is never part of any API response. */
export type CameraInfo = {
  paired: boolean;
  online: boolean;
  lastSeenAt: string | null;
  state: CameraState | null;
  settings: CameraSettings;
  hasIngestUrl: boolean;
  ingestHost: string | null;
};

export const CAMERA_STATE_LABELS: Record<CameraState['state'], string> = {
  IDLE: '待机', PREVIEW: '预览中', CONNECTING: '连接中', STREAMING: '推流中',
  RECONNECTING: '重连中', ERROR: '异常',
};

export type OverlaySide = {
  name: string | null;
  teamName: string | null;
  players: { name: string; affiliation: string | null }[];
};

export type OverlayGame = { gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null };

export type OverlayMatch = {
  id: string;
  status: 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  pendingFinish: boolean;
  paused: boolean;
  eventTypeLabel: string;
  round: string;
  gamesToWin: number;
  side1: OverlaySide;
  side2: OverlaySide;
  games: OverlayGame[];
  currentGameNo: number | null;
  side1Games: number;
  side2Games: number;
  winnerSide: number | null;
  servingSide: 1 | 2 | null;
};

export type OverlaySnapshot = {
  broadcastId: string;
  configVersion: number;
  seq: number;
  title: string;
  tournamentName: string;
  venueName: string | null;
  settings: OverlaySettings;
  match: OverlayMatch | null;
  generatedAt: string;
};

export type BroadcastStatus = 'READY' | 'LIVE' | 'INTERRUPTED' | 'ENDED';

export const BROADCAST_STATUS_LABELS: Record<BroadcastStatus, string> = {
  READY: '待开始',
  LIVE: '直播中',
  INTERRUPTED: '暂时断流',
  ENDED: '已结束',
};

export type BroadcastSummary = {
  id: string;
  mediaMode: 'hls' | 'livekit';
  title: string;
  tournamentId: string;
  venueId: string | null;
  currentMatchId: string | null;
  enabled: boolean;
  isPublic: boolean;
  status: BroadcastStatus;
  overlaySettings: OverlaySettings;
  configVersion: number;
  playbackUrl: string | null;
  camera: CameraInfo;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  tournament: { id: string; name: string; isPublic: boolean };
  venue: { id: string; name: string } | null;
};

export type BroadcastMatchOption = {
  id: string;
  status: string;
  round: string;
  roundNo: number;
  matchNo: number;
  scheduledAt: string | null;
  venueId: string | null;
  venueName: string | null;
  eventName: string;
  side1Name: string;
  side2Name: string;
};

export type BroadcastDetail = BroadcastSummary & {
  venues: { id: string; name: string; isActive: boolean }[];
  matches: BroadcastMatchOption[];
};

export type PublicBroadcast = {
  mediaMode?: 'hls' | 'livekit';
  id: string;
  title: string;
  status: BroadcastStatus;
  playbackUrl: string | null;
  startedAt: string | null;
  endedAt: string | null;
  venueName: string | null;
  tournament: { id: string; name: string };
  currentMatch: { eventName: string; round: string; side1Name: string; side2Name: string; venueName: string | null } | null;
};
