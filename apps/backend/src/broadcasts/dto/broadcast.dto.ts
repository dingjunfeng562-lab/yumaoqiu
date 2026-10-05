import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const OVERLAY_POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const;
export type OverlayPosition = typeof OVERLAY_POSITIONS[number];

export class OverlaySettingsDto {
  @IsIn(OVERLAY_POSITIONS)
  position: OverlayPosition;

  // Margin from the chosen corner/edge, in pixels of a 1920x1080 canvas.
  @IsInt() @Min(0) @Max(600)
  offsetX: number;

  @IsInt() @Min(0) @Max(400)
  offsetY: number;

  @IsInt() @Min(50) @Max(200)
  scale: number;

  @IsInt() @Min(70) @Max(160)
  fontScale: number;

  @IsBoolean()
  showTitle: boolean;

  @IsBoolean()
  showAffiliation: boolean;

  @IsBoolean()
  showGames: boolean;

  @IsBoolean()
  showGameWins: boolean;

  @IsBoolean()
  showServe: boolean;

  @IsBoolean()
  visible: boolean;

  // Manual display swap: names, units, scores and markers swap together.
  @IsBoolean()
  swapSides: boolean;

  @IsInt() @Min(0) @Max(10)
  scoreDelaySeconds: number;

  @IsString() @MaxLength(20)
  connectingText: string;
}

export class CreateBroadcastDto {
  @IsString() @MinLength(1) @MaxLength(120)
  title: string;

  @IsString()
  tournamentId: string;

  @IsOptional() @IsString()
  venueId?: string;
}

/**
 * Camera targets pushed to the app.
 *
 * Resolution and frame rate are deliberately absent: the app picks them from
 * what the phone's camera and encoder can actually do in 16:9, because a value
 * fixed here is wrong for most phones (some cannot open 2160p, others would be
 * held back to 1080p). The app reports the choice it made in its heartbeat, so
 * the admin page still shows the real output size.
 */
export class CameraSettingsDto {
  /**
   * Upper bound on the bitrate the phone may use, in kbps. Zero means "no
   * limit": the app sizes the bitrate for the tier it measured, which is right
   * on a healthy uplink. Operators set this when the venue's uplink cannot carry
   * that tier's rate - the correct lever, since the app has no way to measure
   * the network before it starts pushing.
   */
  @IsInt() @Min(0) @Max(50000)
  videoBitrateKbps: number;

  @IsInt() @Min(64) @Max(320)
  audioBitrateKbps: number;

  @IsIn(['back', 'front'])
  facing: 'back' | 'front';

  // Prefer a wired/USB microphone (DJI Mic receiver) over the phone mic.
  @IsBoolean()
  preferExternalMic: boolean;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettingsDto = {
  videoBitrateKbps: 0, audioBitrateKbps: 128,
  facing: 'back', preferExternalMic: true,
};

/** What the app reports every few seconds. Everything is display-only. */
export class CameraHeartbeatDto {
  // CONNECTING/RECONNECTING are the phone's real transient states; without them
  // the admin page could not distinguish "working on it" from "idle".
  @IsIn(['IDLE', 'PREVIEW', 'CONNECTING', 'STREAMING', 'RECONNECTING', 'ERROR'])
  state: 'IDLE' | 'PREVIEW' | 'CONNECTING' | 'STREAMING' | 'RECONNECTING' | 'ERROR';

  @IsOptional() @IsInt() @Min(0) @Max(100000)
  bitrateKbps?: number;

  @IsOptional() @IsInt() @Min(0) @Max(240)
  fps?: number;

  @IsOptional() @IsInt() @Min(0) @Max(8000)
  width?: number;

  @IsOptional() @IsInt() @Min(0) @Max(8000)
  height?: number;

  // Current zoom as a multiple of the phone's 1x lens, e.g. 2.5.
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.1) @Max(100)
  zoom?: number;

  @IsOptional() @IsString() @MaxLength(60)
  audioSource?: string;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  battery?: number;

  @IsOptional() @IsString() @MaxLength(120)
  message?: string;
}

export class UpdateBroadcastDto {
  // Optimistic concurrency: the version the operator last loaded.
  @IsInt() @Min(1)
  configVersion: number;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  title?: string;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString()
  venueId?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString()
  currentMatchId?: string | null;

  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsBoolean()
  isPublic?: boolean;

  @IsOptional() @IsIn(['READY', 'LIVE', 'INTERRUPTED'])
  status?: 'READY' | 'LIVE' | 'INTERRUPTED';

  // Viewer playback address supplied by the cloud live provider (HLS .m3u8).
  @IsOptional() @ValidateIf((_, value) => value !== null && value !== '')
  @MaxLength(1000)
  @Matches(/^https:\/\/[^\s]+$/i, { message: '播放地址必须是 https:// 开头的网址' })
  playbackUrl?: string | null;

  // Push address incl. stream key. Write-only: never returned by any endpoint
  // except the camera app's own config call.
  @IsOptional() @ValidateIf((_, value) => value !== null && value !== '')
  @MaxLength(1000)
  @Matches(/^(rtmps?|srt):\/\/[^\s]+$/i, { message: '推流地址必须以 rtmp://、rtmps:// 或 srt:// 开头' })
  ingestUrl?: string | null;

  @IsOptional() @ValidateNested() @Type(() => CameraSettingsDto)
  cameraSettings?: CameraSettingsDto;

  @IsOptional() @ValidateNested() @Type(() => OverlaySettingsDto)
  overlaySettings?: OverlaySettingsDto;
}
