import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: {
    sub: string;
    username?: string | null;
    email?: string | null;
    role: string;
    status?: string;
    mustChangePassword?: boolean;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        mustChangePassword: true,
      },
    });
    if (!user) throw new UnauthorizedException();
    // A ban must take effect immediately, even for a user who is still holding
    // a previously-issued (not-yet-expired) access token. Rejecting here means
    // every subsequent request from a disabled account is refused.
    if (user.status === UserStatus.DISABLED) {
      throw new ForbiddenException('账号已被禁用');
    }
    return user;
  }
}
