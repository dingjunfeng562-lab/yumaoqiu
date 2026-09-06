import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateAiConfigDto {
  @IsString()
  @IsIn(['openai', 'deepseek', 'zhipu', 'qwen', 'moonshot', 'agnes', 'custom'])
  @IsOptional()
  provider?: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  modelName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  apiKey?: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  apiBase?: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  systemPrompt?: string;

  @IsNumber()
  @Min(256)
  @Max(8192)
  @IsOptional()
  maxTokens?: number;

  @IsNumber()
  @Min(0)
  @Max(2)
  @IsOptional()
  temperature?: number;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  welcomeMessage?: string;
}
