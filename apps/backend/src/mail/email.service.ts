import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EmailLogStatus, EventType, Prisma, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_KEYS,
  EmailTemplateKey,
  EmailTemplateVars,
  SAMPLE_TEMPLATE_VARS,
  isEmailTemplateKey,
} from './email-template.constants';
import { UpdateEventEmailSettingsDto, UpdateTemplateDto } from './dto/email.dto';

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const DEFAULT_REMIND_BEFORE_MINUTES = 1440;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type TournamentBrief = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  location: string | null;
};

type RegistrationNotificationParams = {
  templateKey: 'registration_submitted' | 'registration_approved' | 'registration_rejected';
  tournamentId: string;
  to?: string | null;
  playerName: string;
  eventNames: string[];
  rejectReason?: string | null;
};

type GateResult =
  | { ok: true; template: { key: string; name: string; subject: string; body: string } }
  | { ok: false; reason: string };

type EmailLogInput = {
  tournamentId?: string | null;
  templateKey: string;
  recipient?: string | null;
  subject?: string | null;
  status: EmailLogStatus;
  reason?: string | null;
  trigger?: 'auto' | 'manual';
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  // ---------------- 全局设置 ----------------

  async getGlobalSettings() {
    const row = await this.prisma.emailGlobalSetting.upsert({
      where: { id: 'global' },
      update: {},
      create: { id: 'global' },
    });
    return {
      enabled: row.enabled,
      smtp: this.mailService.smtpInfo(),
    };
  }

  async updateGlobalSettings(enabled: boolean) {
    await this.prisma.emailGlobalSetting.upsert({
      where: { id: 'global' },
      update: { enabled },
      create: { id: 'global', enabled },
    });
    return this.getGlobalSettings();
  }

  // ---------------- 模板管理 ----------------

  async listTemplates() {
    await this.ensureTemplates();
    const rows = await this.prisma.emailTemplate.findMany();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return EMAIL_TEMPLATE_KEYS.map((key) => {
      const row = byKey.get(key)!;
      return this.toTemplateView(row);
    });
  }

  async updateTemplate(key: string, dto: UpdateTemplateDto) {
    const templateKey = this.normalizeTemplateKey(key);
    await this.ensureTemplates();
    const row = await this.prisma.emailTemplate.update({
      where: { key: templateKey },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() || DEFAULT_EMAIL_TEMPLATES[templateKey].name } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject.trim() || DEFAULT_EMAIL_TEMPLATES[templateKey].subject } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
    return this.toTemplateView(row);
  }

  async resetTemplate(key: string) {
    const templateKey = this.normalizeTemplateKey(key);
    const defaults = DEFAULT_EMAIL_TEMPLATES[templateKey];
    const row = await this.prisma.emailTemplate.upsert({
      where: { key: templateKey },
      update: {
        name: defaults.name,
        subject: defaults.subject,
        body: defaults.body,
        enabled: defaults.enabled,
      },
      create: {
        key: templateKey,
        name: defaults.name,
        subject: defaults.subject,
        body: defaults.body,
        enabled: defaults.enabled,
      },
    });
    return this.toTemplateView(row);
  }

  async previewTemplate(key: string) {
    const templateKey = this.normalizeTemplateKey(key);
    const template = await this.getTemplate(templateKey);
    return {
      key: templateKey,
      name: template.name,
      subject: this.renderText(template.subject, SAMPLE_TEMPLATE_VARS),
      html: this.wrapLayout(template.name, this.renderHtml(template.body, SAMPLE_TEMPLATE_VARS)),
    };
  }

  // ---------------- 赛事邮件开关 ----------------

  async listEventSettings() {
    const tournaments = await this.prisma.tournament.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        location: true,
        isPublished: true,
        emailSettings: true,
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });
    return tournaments.map((tournament) => ({
      id: tournament.id,
      name: tournament.name,
      startDate: tournament.startDate.toISOString(),
      endDate: tournament.endDate.toISOString(),
      location: tournament.location,
      isPublished: tournament.isPublished,
      settings: this.mergeEventSettings(tournament, tournament.emailSettings),
    }));
  }

  async getEventSettings(tournamentId: string) {
    const tournament = await this.findTournament(tournamentId);
    const rows = await this.prisma.eventEmailSetting.findMany({
      where: { tournamentId },
    });
    return {
      tournament: {
        id: tournament.id,
        name: tournament.name,
        startDate: tournament.startDate.toISOString(),
        endDate: tournament.endDate.toISOString(),
        location: tournament.location,
      },
      settings: this.mergeEventSettings(tournament, rows),
    };
  }

  async updateEventSettings(tournamentId: string, dto: UpdateEventEmailSettingsDto) {
    const tournament = await this.findTournament(tournamentId);

    for (const key of EMAIL_TEMPLATE_KEYS) {
      const item = dto[key];
      if (!item) continue;

      if (key === 'match_reminder') {
        const existing = await this.prisma.eventEmailSetting.findUnique({
          where: { tournamentId_templateKey: { tournamentId, templateKey: key } },
        });
        const remindBeforeMinutes =
          item.remindBeforeMinutes ?? existing?.remindBeforeMinutes ?? DEFAULT_REMIND_BEFORE_MINUTES;
        const scheduledSendTime = new Date(
          tournament.startDate.getTime() - remindBeforeMinutes * 60_000,
        );
        await this.prisma.eventEmailSetting.upsert({
          where: { tournamentId_templateKey: { tournamentId, templateKey: key } },
          update: { enabled: item.enabled, remindBeforeMinutes, scheduledSendTime },
          create: {
            tournamentId,
            templateKey: key,
            enabled: item.enabled,
            remindBeforeMinutes,
            scheduledSendTime,
          },
        });
      } else {
        await this.prisma.eventEmailSetting.upsert({
          where: { tournamentId_templateKey: { tournamentId, templateKey: key } },
          update: { enabled: item.enabled },
          create: { tournamentId, templateKey: key, enabled: item.enabled },
        });
      }
    }

    return this.getEventSettings(tournamentId);
  }

  // ---------------- 日志 ----------------

  async listLogs(filters: {
    tournamentId?: string;
    status?: string;
    templateKey?: string;
    take?: number;
  }) {
    const status = filters.status?.toUpperCase();
    if (status && !Object.values(EmailLogStatus).includes(status as EmailLogStatus)) {
      throw new BadRequestException('日志状态筛选有误');
    }
    const take = Math.min(Math.max(filters.take ?? 200, 1), 500);
    const logs = await this.prisma.emailLog.findMany({
      where: {
        ...(filters.tournamentId ? { tournamentId: filters.tournamentId } : {}),
        ...(status ? { status: status as EmailLogStatus } : {}),
        ...(filters.templateKey ? { templateKey: filters.templateKey } : {}),
      },
      include: {
        tournament: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return logs.map((log) => ({
      id: log.id,
      tournamentId: log.tournamentId,
      tournamentName: log.tournament?.name ?? null,
      templateKey: log.templateKey,
      templateName: isEmailTemplateKey(log.templateKey)
        ? DEFAULT_EMAIL_TEMPLATES[log.templateKey].name
        : log.templateKey,
      recipient: log.recipient,
      subject: log.subject,
      status: log.status,
      reason: log.reason,
      trigger: log.trigger,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  // ---------------- 测试邮件 ----------------

  async sendTest(to: string, subject?: string, content?: string) {
    const finalSubject = subject?.trim() || '【羽动云赛】邮件服务测试';
    const html = this.wrapLayout(
      '邮件服务测试',
      `<p style="font-size:15px;line-height:1.8;margin:0;">${this.escapeHtml(
        content?.trim() || '这是一封测试邮件，说明阿里云邮件推送（SMTP 465 SSL）配置成功。',
      )}</p>`,
    );
    try {
      const info = await this.mailService.sendMail({ to, subject: finalSubject, html });
      await this.writeLog({
        templateKey: 'test',
        recipient: to,
        subject: finalSubject,
        status: EmailLogStatus.SENT,
        trigger: 'manual',
      });
      return { message: '测试邮件已发送', messageId: info.messageId };
    } catch (error) {
      await this.writeLog({
        templateKey: 'test',
        recipient: to,
        subject: finalSubject,
        status: EmailLogStatus.FAILED,
        reason: this.errorMessage(error),
        trigger: 'manual',
      });
      throw error;
    }
  }

  // ---------------- 报名相关通知（业务触发，永不抛错） ----------------

  async sendRegistrationNotification(params: RegistrationNotificationParams) {
    try {
      const tournament = await this.prisma.tournament.findUnique({
        where: { id: params.tournamentId },
        select: { id: true, name: true, startDate: true, endDate: true, location: true },
      });
      if (!tournament) return;

      const gate = await this.resolveGate(params.tournamentId, params.templateKey);
      if (!gate.ok) {
        await this.writeLog({
          tournamentId: params.tournamentId,
          templateKey: params.templateKey,
          recipient: params.to?.trim() || null,
          status: EmailLogStatus.SKIPPED,
          reason: gate.reason,
        });
        return;
      }

      const to = params.to?.trim() ?? '';
      if (!to || !EMAIL_PATTERN.test(to)) {
        await this.writeLog({
          tournamentId: params.tournamentId,
          templateKey: params.templateKey,
          recipient: to || null,
          status: EmailLogStatus.SKIPPED,
          reason: '收件人邮箱为空或格式不正确',
        });
        return;
      }

      const vars = this.buildVars(tournament, params.playerName, params.eventNames, params.rejectReason);
      const subject = this.renderText(gate.template.subject, vars);
      const html = this.wrapLayout(gate.template.name, this.renderHtml(gate.template.body, vars));

      try {
        await this.mailService.sendMail({ to, subject, html, text: this.toPlainText(html) });
        await this.writeLog({
          tournamentId: params.tournamentId,
          templateKey: params.templateKey,
          recipient: to,
          subject,
          status: EmailLogStatus.SENT,
        });
      } catch (error) {
        await this.writeLog({
          tournamentId: params.tournamentId,
          templateKey: params.templateKey,
          recipient: to,
          subject,
          status: EmailLogStatus.FAILED,
          reason: this.errorMessage(error),
        });
      }
    } catch (error) {
      this.logger.error(`报名通知邮件处理失败：${this.errorMessage(error)}`);
    }
  }

  // ---------------- 赛前提醒 ----------------

  /**
   * 给赛事所有审核通过的报名选手发送赛前提醒。
   * 已成功收到过该赛事赛前提醒的邮箱默认跳过，防止重复打扰。
   */
  async sendReminderForTournament(tournamentId: string, trigger: 'auto' | 'manual') {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true, startDate: true, endDate: true, location: true },
    });
    if (!tournament) {
      if (trigger === 'manual') throw new NotFoundException('赛事不存在');
      return { total: 0, success: 0, failed: 0, skipped: 0 };
    }

    // 手动发送由总管理员显式触发，不检查赛事级开关；自动发送由扫描任务保证开关已开启
    const gate = await this.resolveGate(tournamentId, 'match_reminder', { skipEventCheck: true });
    if (!gate.ok) {
      await this.writeLog({
        tournamentId,
        templateKey: 'match_reminder',
        status: EmailLogStatus.SKIPPED,
        reason: gate.reason,
        trigger,
      });
      if (trigger === 'manual') throw new BadRequestException(gate.reason);
      return { total: 0, success: 0, failed: 0, skipped: 1 };
    }

    const registrations = await this.prisma.competitionRegistration.findMany({
      where: { competitionId: tournamentId, status: RegistrationStatus.APPROVED },
      include: {
        user: { select: { email: true } },
        eventItems: { include: { event: { select: { type: true } } } },
      },
    });

    const sentLogs = await this.prisma.emailLog.findMany({
      where: { tournamentId, templateKey: 'match_reminder', status: EmailLogStatus.SENT },
      select: { recipient: true },
    });
    const alreadySent = new Set(
      sentLogs.map((log) => log.recipient?.toLowerCase()).filter(Boolean) as string[],
    );

    let success = 0;
    let failed = 0;
    let skipped = 0;
    const seen = new Set<string>();

    for (const registration of registrations) {
      const email = registration.user.email?.trim() ?? '';
      const emailKey = email.toLowerCase();
      if (!email || !EMAIL_PATTERN.test(email)) {
        skipped += 1;
        await this.writeLog({
          tournamentId,
          templateKey: 'match_reminder',
          recipient: email || null,
          status: EmailLogStatus.SKIPPED,
          reason: '收件人邮箱为空或格式不正确',
          trigger,
        });
        continue;
      }
      if (seen.has(emailKey) || alreadySent.has(emailKey)) {
        skipped += 1;
        continue;
      }
      seen.add(emailKey);

      const eventNames = registration.eventItems.map((item) => EVENT_TYPE_LABELS[item.event.type]);
      const vars = this.buildVars(tournament, registration.name, eventNames);
      const subject = this.renderText(gate.template.subject, vars);
      const html = this.wrapLayout(gate.template.name, this.renderHtml(gate.template.body, vars));

      try {
        await this.mailService.sendMail({ to: email, subject, html, text: this.toPlainText(html) });
        success += 1;
        await this.writeLog({
          tournamentId,
          templateKey: 'match_reminder',
          recipient: email,
          subject,
          status: EmailLogStatus.SENT,
          trigger,
        });
      } catch (error) {
        failed += 1;
        await this.writeLog({
          tournamentId,
          templateKey: 'match_reminder',
          recipient: email,
          subject,
          status: EmailLogStatus.FAILED,
          reason: this.errorMessage(error),
          trigger,
        });
      }
    }

    const now = new Date();
    await this.prisma.eventEmailSetting.upsert({
      where: { tournamentId_templateKey: { tournamentId, templateKey: 'match_reminder' } },
      update:
        trigger === 'auto'
          ? { autoSent: true, lastSentAt: now }
          : { manualSendCount: { increment: 1 }, lastSentAt: now },
      create: {
        tournamentId,
        templateKey: 'match_reminder',
        enabled: trigger === 'auto',
        remindBeforeMinutes: DEFAULT_REMIND_BEFORE_MINUTES,
        autoSent: trigger === 'auto',
        lastSentAt: now,
        manualSendCount: trigger === 'manual' ? 1 : 0,
      },
    });

    return { total: registrations.length, success, failed, skipped };
  }

  // ---------------- 内部工具 ----------------

  /** 发送前的统一门控：SMTP → 全局开关 → 模板开关 → 赛事开关 */
  private async resolveGate(
    tournamentId: string,
    templateKey: EmailTemplateKey,
    opts: { skipEventCheck?: boolean } = {},
  ): Promise<GateResult> {
    if (!this.mailService.enabled) {
      return { ok: false, reason: 'SMTP 未配置' };
    }
    const global = await this.prisma.emailGlobalSetting.findUnique({ where: { id: 'global' } });
    if (global && !global.enabled) {
      return { ok: false, reason: '全局邮件功能已关闭' };
    }
    const template = await this.getTemplate(templateKey);
    if (!template.enabled) {
      return { ok: false, reason: `邮件模板「${template.name}」已关闭` };
    }
    if (!opts.skipEventCheck) {
      const setting = await this.prisma.eventEmailSetting.findUnique({
        where: { tournamentId_templateKey: { tournamentId, templateKey } },
      });
      const enabled = setting?.enabled ?? DEFAULT_EMAIL_TEMPLATES[templateKey].defaultEventEnabled;
      if (!enabled) {
        return { ok: false, reason: `当前赛事未开启${template.name}` };
      }
    }
    return { ok: true, template };
  }

  private async getTemplate(key: EmailTemplateKey) {
    const existing = await this.prisma.emailTemplate.findUnique({ where: { key } });
    if (existing) return existing;
    const defaults = DEFAULT_EMAIL_TEMPLATES[key];
    return this.prisma.emailTemplate.upsert({
      where: { key },
      update: {},
      create: {
        key,
        name: defaults.name,
        subject: defaults.subject,
        body: defaults.body,
        enabled: defaults.enabled,
      },
    });
  }

  private async ensureTemplates() {
    const rows = await this.prisma.emailTemplate.findMany({ select: { key: true } });
    const existing = new Set(rows.map((row) => row.key));
    const missing = EMAIL_TEMPLATE_KEYS.filter((key) => !existing.has(key));
    if (!missing.length) return;
    await this.prisma.emailTemplate.createMany({
      data: missing.map((key) => ({
        key,
        name: DEFAULT_EMAIL_TEMPLATES[key].name,
        subject: DEFAULT_EMAIL_TEMPLATES[key].subject,
        body: DEFAULT_EMAIL_TEMPLATES[key].body,
        enabled: DEFAULT_EMAIL_TEMPLATES[key].enabled,
      })),
      skipDuplicates: true,
    });
  }

  private normalizeTemplateKey(key: string): EmailTemplateKey {
    if (!isEmailTemplateKey(key)) {
      throw new BadRequestException('邮件模板不存在');
    }
    return key;
  }

  private toTemplateView(row: {
    key: string;
    name: string;
    subject: string;
    body: string;
    enabled: boolean;
    updatedAt: Date;
  }) {
    const key = row.key as EmailTemplateKey;
    return {
      key: row.key,
      name: row.name,
      subject: row.subject,
      body: row.body,
      enabled: row.enabled,
      reserved: DEFAULT_EMAIL_TEMPLATES[key]?.reserved ?? false,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mergeEventSettings(
    tournament: { startDate: Date },
    rows: Prisma.EventEmailSettingGetPayload<Record<string, never>>[],
  ) {
    const byKey = new Map(rows.map((row) => [row.templateKey, row]));
    const result: Record<string, unknown> = {};
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const row = byKey.get(key);
      const remindBeforeMinutes =
        key === 'match_reminder'
          ? row?.remindBeforeMinutes ?? DEFAULT_REMIND_BEFORE_MINUTES
          : row?.remindBeforeMinutes ?? null;
      result[key] = {
        templateKey: key,
        templateName: DEFAULT_EMAIL_TEMPLATES[key].name,
        reserved: DEFAULT_EMAIL_TEMPLATES[key].reserved ?? false,
        enabled: row?.enabled ?? DEFAULT_EMAIL_TEMPLATES[key].defaultEventEnabled,
        remindBeforeMinutes,
        scheduledSendTime:
          key === 'match_reminder'
            ? new Date(
                tournament.startDate.getTime() - (remindBeforeMinutes ?? DEFAULT_REMIND_BEFORE_MINUTES) * 60_000,
              ).toISOString()
            : null,
        autoSent: row?.autoSent ?? false,
        lastSentAt: row?.lastSentAt?.toISOString() ?? null,
        manualSendCount: row?.manualSendCount ?? 0,
      };
    }
    return result;
  }

  private async findTournament(tournamentId: string): Promise<TournamentBrief> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true, startDate: true, endDate: true, location: true },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');
    return tournament;
  }

  private buildVars(
    tournament: TournamentBrief,
    playerName: string,
    eventNames: string[],
    rejectReason?: string | null,
  ): EmailTemplateVars {
    return {
      name: playerName,
      eventTitle: tournament.name || '羽毛球赛事',
      eventTime: this.formatTimeRange(tournament.startDate, tournament.endDate),
      eventLocation: tournament.location?.trim() || '请以平台公告为准',
      eventGroup: eventNames.join('、') || '请以报名信息为准',
      rejectReason: rejectReason?.trim() || '未填写原因',
      sendTime: this.formatDateTime(new Date()),
    };
  }

  private formatTimeRange(startDate: Date, endDate: Date) {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const start = formatter.format(startDate);
    const end = formatter.format(endDate);
    return start === end ? start : `${start} 至 ${end}`;
  }

  private formatDateTime(date: Date) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private renderText(text: string, vars: EmailTemplateVars) {
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
      const value = (vars as Record<string, string | undefined>)[key];
      return value ?? '';
    });
  }

  private renderHtml(html: string, vars: EmailTemplateVars) {
    return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
      const value = (vars as Record<string, string | undefined>)[key];
      return value !== undefined ? this.escapeHtml(value) : '';
    });
  }

  private wrapLayout(title: string, bodyHtml: string) {
    return `
<div style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,'Microsoft YaHei',sans-serif;color:#222;">
  <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8ecf3;">
      <div style="background:linear-gradient(135deg,#1f7aff,#20c997);padding:28px 32px;color:#ffffff;">
        <h1 style="margin:0;font-size:24px;font-weight:700;">${this.escapeHtml(title)}</h1>
        <p style="margin:8px 0 0;font-size:14px;opacity:.95;">羽动云赛 · 羽毛球赛事管理平台</p>
      </div>
      <div style="padding:32px;">
        ${bodyHtml}
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e8ecf3;">
        <p style="margin:0 0 6px;font-size:13px;color:#64748b;">羽动云赛 · 羽毛球赛事管理平台</p>
        <p style="margin:0;font-size:12px;color:#94a3b8;">本邮件由系统自动发送，请勿直接回复。</p>
      </div>
    </div>
  </div>
</div>`;
  }

  private toPlainText(html: string) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  private async writeLog(input: EmailLogInput) {
    try {
      await this.prisma.emailLog.create({
        data: {
          tournamentId: input.tournamentId ?? null,
          templateKey: input.templateKey,
          recipient: input.recipient ?? null,
          subject: input.subject ?? null,
          status: input.status,
          reason: input.reason?.slice(0, 500) ?? null,
          trigger: input.trigger ?? 'auto',
        },
      });
    } catch (error) {
      this.logger.error(`写入邮件日志失败：${this.errorMessage(error)}`);
    }
  }
}
