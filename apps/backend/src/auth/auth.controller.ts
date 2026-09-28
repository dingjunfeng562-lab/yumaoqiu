import { Controller, Post, Body, Get, Delete, Param, UseGuards, Patch, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { Role, UserStatus } from '@prisma/client';
import {
  BatchDeleteUsersDto,
  CheckEmailDto,
  CheckInviteDto,
  CheckUsernameDto,
  CreateInviteCodeDto,
  CreateUserDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  RenameDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
  UpdateInviteQuotaDto,
  SetUserPermissionsDto,
} from './dto/auth.dto';
import { DEFAULT_PERMISSIONS, PERMISSION_OPTIONS } from './permissions';

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

  @UseGuards(JwtAuthGuard)
  @Patch('me/name')
  renameSelf(@Req() req: RequestWithUser, @Body() dto: RenameDto) {
    return this.authService.renameSelf(req.user.id, dto.name);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ROOT)
  @Post('users/root')
  createRoot(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    return this.authService.createRoot(dto.username, dto.email, dto.password, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ROOT)
  @Post('users/admin')
  createAdmin(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    return this.authService.createAdmin(dto.username, dto.email, dto.password, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Post('users/referee')
  createReferee(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    return this.authService.createReferee(dto.username, dto.email, dto.password, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Post('users/player')
  createPlayer(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    return this.authService.createPlayer(dto.username, dto.email, dto.password, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Post('users/photographer')
  createPhotographer(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    return this.authService.createPhotographer(dto.username, dto.email, dto.password, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Post('users/:id/reset-password')
  resetUserPassword(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.authService.resetUserPassword(id, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Patch('users/:id/status')
  updateUserStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() req: RequestWithUser,
  ) {
    return this.authService.updateUserStatus(id, dto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Patch('users/:id/name')
  renameUser(@Param('id') id: string, @Body() dto: RenameDto, @Req() req: RequestWithUser) {
    return this.authService.renameUser(id, dto.name, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ROOT)
  @Patch('users/:id/role')
  updateUserRole(
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
    @Req() req: RequestWithUser,
  ) {
    return this.authService.updateUserRole(id, dto.role, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Get('users')
  listUsers(@Req() req: RequestWithUser) {
    return this.authService.listUsers(req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Delete('users')
  deleteUsers(@Body() dto: BatchDeleteUsersDto, @Req() req: RequestWithUser) {
    return this.authService.deleteUsers(dto.ids, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Delete('users/:id')
  deleteUser(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.authService.deleteUser(id, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Get('invite-codes')
  listInviteCodes(@Req() req: RequestWithUser) {
    return this.authService.listInviteCodes(req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Post('invite-codes')
  createInviteCode(@Body() dto: CreateInviteCodeDto, @Req() req: RequestWithUser) {
    return this.authService.createInviteCode(dto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Patch('invite-codes/:id')
  updateInviteCode(@Param('id') id: string, @Body('isEnabled') isEnabled: boolean, @Req() req: RequestWithUser) {
    return this.authService.updateInviteCode(id, Boolean(isEnabled), req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Delete('invite-codes/:id')
  deleteInviteCode(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.authService.deleteInviteCode(id, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.ROOT)
  @Get('invite-quota')
  getInviteQuota(@Req() req: RequestWithUser) {
    return this.authService.getInviteQuota(req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ROOT)
  @Patch('users/:id/invite-quota')
  updateInviteQuota(@Param('id') id: string, @Body() dto: UpdateInviteQuotaDto, @Req() req: RequestWithUser) {
    return this.authService.updateInviteQuota(id, dto.limit, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ROOT)
  @Get('permission-options')
  permissionOptions() {
    return { options: PERMISSION_OPTIONS, defaults: DEFAULT_PERMISSIONS };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ROOT)
  @Get('users/:id/permissions')
  getUserPermissions(@Param('id') id: string) {
    return this.authService.getUserPermissions(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ROOT)
  @Patch('users/:id/permissions')
  setUserPermissions(@Param('id') id: string, @Body() dto: SetUserPermissionsDto) {
    return this.authService.setUserPermissions(id, dto.permissions);
  }

}
