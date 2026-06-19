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
  @IsIn(['MALE', 'FEMALE', '男', '女'])
  partnerGender?: 'MALE' | 'FEMALE' | '男' | '女';

  @IsOptional()
  @IsString()
  partnerStudentId?: string;

  @IsOptional()
  @IsString()
  partnerSchool?: string;

  @IsOptional()
  @IsString()
  partnerClassName?: string;

  @IsOptional()
  @IsString()
  partnerContact?: string;

  @IsOptional()
  @IsString()
  teamName?: string;
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
  className?: string;

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

export class AdminBatchCompetitionPlayerDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['MALE', 'FEMALE', '男', '女'])
  gender: 'MALE' | 'FEMALE' | '男' | '女';

  @IsString()
  @MinLength(1)
  studentId: string;

  @IsString()
  @MinLength(1)
  school: string;

  @IsString()
  @MinLength(1)
  className: string;

  @IsString()
  @MinLength(1)
  contact: string;

  @IsOptional()
  @IsString()
  teamName?: string;

  @IsOptional()
  @IsString()
  partnerName?: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', '男', '女'])
  partnerGender?: 'MALE' | 'FEMALE' | '男' | '女';

  @IsOptional()
  @IsString()
  partnerStudentId?: string;

  @IsOptional()
  @IsString()
  partnerSchool?: string;

  @IsOptional()
  @IsString()
  partnerClassName?: string;

  @IsOptional()
  @IsString()
  partnerContact?: string;
}

export class AdminCompetitionPlayerDto extends AdminBatchCompetitionPlayerDto {
  @IsOptional()
  @IsString()
  eventId?: string;
}

export class AdminBatchCompetitionPlayersDto {
  @IsString()
  @MinLength(1)
  eventId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AdminBatchCompetitionPlayerDto)
  players: AdminBatchCompetitionPlayerDto[];
}

export class RejectRegistrationDto {
  @IsOptional()
  @IsString()
  rejectReason?: string;
}
