import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

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
  partnerCollege?: string;

  @IsOptional()
  @IsString()
  partnerMajorGrade?: string;

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
  // 学校组/社会组；旧客户端不传时按学校组处理。
  @IsOptional()
  @IsIn(['SCHOOL', 'SOCIAL'])
  entrantType?: 'SCHOOL' | 'SOCIAL';

  // 赛事报名码；赛事配置了报名码时必填，服务端会再次校验。
  @IsOptional()
  @IsString()
  registrationCode?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  college?: string;

  @IsOptional()
  @IsString()
  majorGrade?: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['MALE', 'FEMALE', '男', '女'])
  gender: 'MALE' | 'FEMALE' | '男' | '女';

  @IsString()
  @MinLength(1)
  school: string;

  @IsOptional()
  @IsString()
  className?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  guestEmail?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CompetitionRegistrationEventItemDto)
  items: CompetitionRegistrationEventItemDto[];
}

export class PublicCompetitionRegistrationDto extends SubmitCompetitionRegistrationDto {}

export class AdminBatchCompetitionPlayerDto {
  // 兼容旧导入：social=true 等同 entrantType=SOCIAL；新代码优先 entrantType。
  @IsOptional()
  @IsBoolean()
  social?: boolean;

  @IsOptional()
  @IsIn(['SCHOOL', 'SOCIAL'])
  entrantType?: 'SCHOOL' | 'SOCIAL';

  // Excel 行号，仅用于错误提示。
  @IsOptional()
  @IsInt()
  @Min(1)
  row?: number;

  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['MALE', 'FEMALE', '男', '女'])
  gender: 'MALE' | 'FEMALE' | '男' | '女';

  // 学生必填由服务端按赛事字段规则校验。
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  college?: string;

  @IsOptional()
  @IsString()
  majorGrade?: string;

  @IsString()
  @MinLength(1)
  school: string;

  @IsOptional()
  @IsString()
  className?: string;

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
  partnerCollege?: string;

  @IsOptional()
  @IsString()
  partnerMajorGrade?: string;

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

export class AdminCompetitionLibraryPlayerDto {
  @IsString()
  @MinLength(1)
  eventId: string;

  @IsString()
  @MinLength(1)
  player1Id: string;

  @IsOptional()
  @IsString()
  player2Id?: string;

  @IsOptional()
  @IsString()
  teamName?: string;
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
