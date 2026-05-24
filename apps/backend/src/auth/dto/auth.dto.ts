import {
  IsEmail,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{3,19}$/;
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[^\s\u4e00-\u9fa5]{8,32}$/;
export const INVITE_CODE_PATTERN = /^YZY-\d{4}-[A-Z0-9]{6}$/;

export class LoginDto {
  @IsIn(['username', 'email'])
  loginType: 'username' | 'email';

  @IsString()
  @Length(1, 254)
  identifier: string;

  @IsString()
  @MinLength(1)
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(1)
  refreshToken: string;
}

export class RegisterDto {
  @IsString()
  @Matches(INVITE_CODE_PATTERN, { message: '邀请码格式不正确' })
  inviteCode: string;

  @IsString()
  @Matches(USERNAME_PATTERN, { message: '用户名需为 4-20 位字母、数字或下划线，且首字符为字母' })
  username: string;

  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @Matches(PASSWORD_PATTERN, { message: '密码需为 8-32 位，并同时包含大写字母、小写字母和数字，且不能包含空格或中文' })
  password: string;
}

export class CreateUserDto {
  @IsString()
  @Matches(USERNAME_PATTERN, { message: '用户名需为 4-20 位字母、数字或下划线，且首字符为字母' })
  username: string;

  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @Matches(PASSWORD_PATTERN, { message: '密码需为 8-32 位，并同时包含大写字母、小写字母和数字，且不能包含空格或中文' })
  password: string;
}

export class ResetUserPasswordDto {
  @IsString()
  @Matches(PASSWORD_PATTERN, { message: '密码需为 8-32 位，并同时包含大写字母、小写字母和数字，且不能包含空格或中文' })
  newPassword: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @IsString()
  @Matches(PASSWORD_PATTERN, { message: '密码需为 8-32 位，并同时包含大写字母、小写字母和数字，且不能包含空格或中文' })
  newPassword: string;
}

export class CreateInviteCodeDto {
  @IsIn(['ADMIN', 'REFEREE', 'PLAYER'])
  role: 'ADMIN' | 'REFEREE' | 'PLAYER';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses: number;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'DISABLED'])
  status: 'ACTIVE' | 'DISABLED';
}

export class CheckUsernameDto {
  @IsString()
  @Length(1, 20)
  username: string;
}

export class CheckEmailDto {
  @IsString()
  @Length(1, 254)
  email: string;
}

export class CheckInviteDto {
  @IsString()
  @Length(1, 32)
  inviteCode: string;
}
