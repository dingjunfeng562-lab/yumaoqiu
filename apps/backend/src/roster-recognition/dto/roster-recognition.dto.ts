import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRosterRecognitionDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // 留空表示恢复内置默认提示词。
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  prompt?: string;
}
