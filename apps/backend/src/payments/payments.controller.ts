import { Controller, Get, HttpException, HttpStatus, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentLookupQueryDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

type LookupRequest = { ip?: string; headers: Record<string, string | string[] | undefined>; user?: { id?: string } };

const LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const LOOKUP_LIMIT = 30;

// 选手端接口：不经过 RolesGuard（它会按管理员赛事归属校验 :competitionId）。
@Controller('payments')
export class PaymentsController {
  private lookups = new Map<string, { count: number; resetAt: number }>();

  constructor(private paymentsService: PaymentsService) {}

  /** 公开缴费查询：姓名 + 联系方式。按 IP 限流，防止批量试探。 */
  @Get('lookup')
  lookup(@Query() query: PaymentLookupQueryDto, @Req() req: LookupRequest) {
    this.throttle(this.clientIp(req));
    return this.paymentsService.lookup(query.name, query.contact);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  myPayments(@Req() req: LookupRequest) {
    return this.paymentsService.myPayments(req.user?.id ?? '');
  }

  @Get('guest/:competitionId/:token')
  guestPayment(@Param('competitionId') competitionId: string, @Param('token') token: string) {
    return this.paymentsService.guestPayment(competitionId, token);
  }

  private clientIp(req: LookupRequest) {
    // nginx 用 $proxy_add_x_forwarded_for 追加真实来源，最后一段由 nginx 写入，不能被客户端伪造。
    const forwarded = req.headers['x-forwarded-for'];
    const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((ip) => ip.trim()).filter(Boolean);
    return chain[chain.length - 1] ?? req.ip ?? 'unknown';
  }

  private throttle(ip: string) {
    const now = Date.now();
    if (this.lookups.size > 5000) {
      for (const [key, value] of this.lookups) if (value.resetAt <= now) this.lookups.delete(key);
    }
    const entry = this.lookups.get(ip);
    if (!entry || entry.resetAt <= now) {
      this.lookups.set(ip, { count: 1, resetAt: now + LOOKUP_WINDOW_MS });
      return;
    }
    entry.count += 1;
    if (entry.count > LOOKUP_LIMIT) {
      throw new HttpException('查询过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
