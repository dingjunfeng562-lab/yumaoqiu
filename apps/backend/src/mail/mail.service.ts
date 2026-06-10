import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * SMTP 传输层：只负责通过阿里云邮件推送（465 SSL）把邮件发出去。
 * 开关、模板、日志等业务逻辑见 EmailService。
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST');
    const user = this.configService.get<string>('MAIL_USER');
    const pass = this.configService.get<string>('MAIL_PASS');
    if (!host || !user || !pass) {
      this.logger.warn('未配置 MAIL_HOST / MAIL_USER / MAIL_PASS，邮件通知功能已禁用');
      return;
    }

    const port = Number(this.configService.get<string>('MAIL_PORT') ?? 465);
    // 阿里云邮件推送建议使用 465 SSL 端口，避免 25 端口被云服务器封禁
    const secure = this.configService.get<string>('MAIL_SECURE') !== 'false';
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    this.logger.log(`邮件服务已启用：${host}:${port}（secure=${secure}）`);
  }

  get enabled() {
    return this.transporter !== null;
  }

  /** SMTP 配置概览，仅供总管理员查看；绝不返回密码 */
  smtpInfo() {
    return {
      configured: this.enabled,
      host: this.configService.get<string>('MAIL_HOST') ?? null,
      port: Number(this.configService.get<string>('MAIL_PORT') ?? 465),
      secure: this.configService.get<string>('MAIL_SECURE') !== 'false',
      from: this.configService.get<string>('MAIL_FROM') ?? this.configService.get<string>('MAIL_USER') ?? null,
      fromName: this.configService.get<string>('MAIL_FROM_NAME') ?? '羽动云赛',
    };
  }

  async sendMail(options: { to: string; subject: string; html: string; text?: string }) {
    if (!this.transporter) {
      throw new ServiceUnavailableException('邮件服务未配置，请先在环境变量中设置 MAIL_HOST / MAIL_USER / MAIL_PASS');
    }
    const user = this.configService.get<string>('MAIL_USER') ?? '';
    const from = this.configService.get<string>('MAIL_FROM') ?? user;
    const fromName = this.configService.get<string>('MAIL_FROM_NAME') ?? '羽动云赛';
    return this.transporter.sendMail({
      from: `"${fromName}" <${from}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }
}
