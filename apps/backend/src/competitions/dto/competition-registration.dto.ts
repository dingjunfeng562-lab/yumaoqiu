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
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CompetitionRegistrationEventItemDto {
  @IsOptional() @IsString() partnerIdentityNumber?: string;
  // 搭档年龄（没填身份证时自报）和衣服尺寸，是否收集由组别字段规则决定。
  @IsOptional() @IsInt() @Min(0) @Max(150) partnerAge?: number;
  @IsOptional() @IsString() @MaxLength(32) partnerShirtSize?: string;
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
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsString() identityNumber?: string;
  // 本人年龄（没填身份证时自报）和衣服尺寸，是否收集由组别字段规则决定。
  @IsOptional() @IsInt() @Min(0) @Max(150) age?: number;
  @IsOptional() @IsString() @MaxLength(32) shirtSize?: string;

  // 学生组 / 第三方（SOCIAL）；旧客户端不传时按学生组处理。第三方必须带 groupId。
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

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', '男', '女'])
  gender?: 'MALE' | 'FEMALE' | '男' | '女';

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
  @IsOptional() @IsString() identityNumber?: string;
  @IsOptional() @IsString() partnerIdentityNumber?: string;
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

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', '男', '女'])
  gender?: 'MALE' | 'FEMALE' | '男' | '女';

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

/** 参赛选手页批量删除报名（真删除，只删选中的项目）。 */
export class DeleteAdminPlayersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  registrationIds: string[];
}

export class RejectRegistrationDto {
  @IsOptional()
  @IsString()
  rejectReason?: string;
}
