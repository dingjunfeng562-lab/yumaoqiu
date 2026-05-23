import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

export class CompetitionRegistrationEventItemDto {
  @IsString()
  @MinLength(1)
  eventId: string;

  @IsOptional()
  @IsString()
  partnerName?: string;

  @IsOptional()
  @IsString()
  partnerStudentId?: string;
}

export class SubmitCompetitionRegistrationDto {
  @IsString()
  @MinLength(1)
  studentId: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['MALE', 'FEMALE', '男', '女'])
  gender: 'MALE' | 'FEMALE' | '男' | '女';

  @IsString()
  @MinLength(2, { message: '学校名称至少 2 个字符' })
  school: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => CompetitionRegistrationEventItemDto)
  items: CompetitionRegistrationEventItemDto[];
}

export class RejectRegistrationDto {
  @IsOptional()
  @IsString()
  rejectReason?: string;
}
