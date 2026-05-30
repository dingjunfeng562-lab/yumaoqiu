import { Controller, Post, Body, Get, Delete, Param, UseGuards, Patch, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { Role, UserStatus } from '@prisma/client';
import {
  CheckEmailDto,
  CheckInviteDto,
  CheckUsernameDto,
  CreateInviteCodeDto,
  CreateUserDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  UpdateUserStatusDto,
} from './dto/auth.dto';

type RequestWithUser = {
  user: {
    id: string;
    username?: string | null;
    email?: string | null;
    role: Role;
    status: UserStatus;
    mustChangePassword?: boolean;
  };
};

@Controller(['auth', 'v1/auth'])
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('check-username')
  checkUsername(@Body() dto: CheckUsernameDto) {
    return this.authService.checkUsername(dto);
  }

  @Post('check-email')
  checkEmail(@Body() dto: CheckEmailDto) {
    return this.authService.checkEmail(dto);
  }

  @Post('check-invite')
  checkInvite(@Body() dto: CheckInviteDto) {
    return this.authService.checkInvite(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: RequestWithUser) {
    return this.authService.getMe(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  changePassword(@Req() req: RequestWithUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.id, dto.currentPassword, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post('users/admin')
  createAdmin(@Body() dto: CreateUserDto) {
    return this.authService.createAdmin(dto.username, dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post('users/referee')
  createReferee(@Body() dto: CreateUserDto) {
    return this.authService.createReferee(dto.username, dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post('users/player')
  createPlayer(@Body() dto: CreateUserDto) {
    return this.authService.createPlayer(dto.username, dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post('users/photographer')
  createPhotographer(@Body() dto: CreateUserDto) {
    return this.authService.createPhotographer(dto.username, dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post('users/:id/reset-password')
  resetUserPassword(@Param('id') id: string) {
    return this.authService.resetUserPassword(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Patch('users/:id/status')
  updateUserStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.authService.updateUserStatus(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Get('users')
  listUsers() {
    return this.authService.listUsers();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.authService.deleteUser(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Get('invite-codes')
  listInviteCodes() {
    return this.authService.listInviteCodes();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post('invite-codes')
  createInviteCode(@Body() dto: CreateInviteCodeDto) {
    return this.authService.createInviteCode(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Patch('invite-codes/:id')
  updateInviteCode(@Param('id') id: string, @Body('isEnabled') isEnabled: boolean) {
    return this.authService.updateInviteCode(id, Boolean(isEnabled));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Delete('invite-codes/:id')
  deleteInviteCode(@Param('id') id: string) {
    return this.authService.deleteInviteCode(id);
  }
}
