import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CameraHeartbeatDto } from './broadcast.dto';

export class EnableMulticameraDto {
  @IsInt() @Min(1) @Max(6) cameraCount: number;
}
export class SharedCameraCodeDto {
  @IsOptional() @IsBoolean() rotate?: boolean;
}
export class LiveCommandDto {
  @IsInt() @Min(0) sequence: number;
}
export class SelectCameraDto extends LiveCommandDto {
  @IsString() @MinLength(1) @MaxLength(191) cameraId: string;
}
export class RedeemCameraDto {
  @IsString() @MinLength(32) @MaxLength(128) code: string;
  @IsString() @MinLength(16) @MaxLength(120) deviceId: string;
}
export class LiveHeartbeatDto extends CameraHeartbeatDto {
  @IsOptional() @IsIn(['WIFI', 'CELLULAR', 'ETHERNET', 'OFFLINE', 'OTHER']) networkType?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60000) rttMs?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) packetLoss?: number;
  @IsOptional() @IsNumber() @Min(-160) @Max(0) audioLevelDb?: number;
  @IsOptional() @IsIn(['DISABLED', 'INTERNAL_MIC', 'USB_EXTERNAL', 'ERROR']) audioStatus?: string;
  @IsOptional() @IsIn(['NORMAL', 'WARM', 'HOT', 'CRITICAL']) thermal?: string;
}
export class GrantDirectorDto {
  @IsString() @MinLength(1) @MaxLength(191) userId: string;
  @IsBoolean() canAudio: boolean;
}
