import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}

export class AiChatRequestDto {
  @IsNotEmpty()
  @ArrayNotEmpty()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}
