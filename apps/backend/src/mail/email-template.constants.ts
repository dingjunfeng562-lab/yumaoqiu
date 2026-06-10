export const EMAIL_TEMPLATE_KEYS = [
  'registration_submitted',
  'registration_approved',
  'registration_rejected',
  'match_reminder',
  'match_result',
  'custom',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}

/** 模板正文/主题中可用的占位符（渲染时统一做 HTML 转义） */
export type EmailTemplateVars = {
  name?: string;
  eventTitle?: string;
  eventTime?: string;
  eventLocation?: string;
  eventGroup?: string;
  rejectReason?: string;
  sendTime?: string;
};

export type EmailTemplateDefault = {
  name: string;
  subject: string;
  body: string;
  /** 模板全局开关默认值 */
  enabled: boolean;
  /** 新赛事初始化时该邮件的默认开关 */
  defaultEventEnabled: boolean;
  /** 预留模板（暂未接入业务触发） */
  reserved?: boolean;
};

const INFO_CARD = `
<div style="background:#f7faff;border:1px solid #dbeafe;border-radius:12px;padding:18px 20px;margin:24px 0;">
  <p style="margin:0 0 10px;font-size:15px;"><strong>赛事名称：</strong>{{eventTitle}}</p>
  <p style="margin:0 0 10px;font-size:15px;"><strong>比赛时间：</strong>{{eventTime}}</p>
  <p style="margin:0 0 10px;font-size:15px;"><strong>比赛地点：</strong>{{eventLocation}}</p>
  <p style="margin:0;font-size:15px;"><strong>参赛项目：</strong>{{eventGroup}}</p>
</div>`;

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateDefault> = {
  registration_submitted: {
    name: '报名提交成功通知',
    subject: '【羽动云赛】报名提交成功，等待审核',
    enabled: true,
    defaultEventEnabled: false,
    body: `
<p style="font-size:16px;line-height:1.8;margin:0 0 16px;">亲爱的 <strong>{{name}}</strong> 同学：</p>
<p style="font-size:16px;line-height:1.8;margin:0 0 20px;">
  你好！你报名的赛事 <strong>{{eventTitle}}</strong> 已提交成功，正在等待管理员审核。
</p>
${INFO_CARD}
<p style="font-size:15px;line-height:1.8;margin:0 0 16px;color:#333;">
  审核结果将另行通知，请耐心等待。审核期间如需修改报名信息，请在平台「我的报名」中查看处理。
</p>
<p style="font-size:15px;line-height:1.8;margin:0;color:#333;">感谢你对本次赛事的支持！</p>`,
  },
  registration_approved: {
    name: '报名审核通过通知',
    subject: '【羽动云赛】报名审核通过通知',
    enabled: true,
    defaultEventEnabled: true,
    body: `
<p style="font-size:16px;line-height:1.8;margin:0 0 16px;">亲爱的 <strong>{{name}}</strong> 同学：</p>
<p style="font-size:16px;line-height:1.8;margin:0 0 20px;">
  你好！你报名的赛事 <strong>{{eventTitle}}</strong> 已通过管理员审核，恭喜你成功获得参赛资格。
</p>
${INFO_CARD}
<p style="font-size:15px;line-height:1.8;margin:0 0 16px;color:#333;">
  请你提前关注比赛安排，按时到达比赛现场，并按照工作人员指引完成签到。
  如后续赛程、分组或对阵信息有调整，请以平台公告和现场通知为准。
</p>
<div style="text-align:center;margin:30px 0;">
  <div style="display:inline-block;background:#1f7aff;color:#ffffff;padding:12px 28px;border-radius:999px;font-size:15px;font-weight:600;">
    审核已通过
  </div>
</div>
<p style="font-size:15px;line-height:1.8;margin:0;color:#333;">感谢你对本次赛事的支持，期待你在赛场上展现风采！</p>`,
  },
  registration_rejected: {
    name: '报名审核未通过通知',
    subject: '【羽动云赛】报名审核结果通知',
    enabled: true,
    defaultEventEnabled: true,
    body: `
<p style="font-size:16px;line-height:1.8;margin:0 0 16px;">亲爱的 <strong>{{name}}</strong> 同学：</p>
<p style="font-size:16px;line-height:1.8;margin:0 0 20px;">
  你好！很遗憾，你报名的赛事 <strong>{{eventTitle}}</strong> 未通过管理员审核。
</p>
<div style="background:#fff7f5;border:1px solid #fecaca;border-radius:12px;padding:18px 20px;margin:24px 0;">
  <p style="margin:0;font-size:15px;"><strong>未通过原因：</strong>{{rejectReason}}</p>
</div>
<p style="font-size:15px;line-height:1.8;margin:0 0 16px;color:#333;">
  如对审核结果有疑问，或希望修改信息后重新报名，请在报名开放期间登录平台重新提交，或联系赛事组委会。
</p>
<p style="font-size:15px;line-height:1.8;margin:0;color:#333;">感谢你对本次赛事的关注与支持！</p>`,
  },
  match_reminder: {
    name: '赛前提醒通知',
    subject: '【羽动云赛】比赛即将开始，请做好准备',
    enabled: true,
    defaultEventEnabled: false,
    body: `
<p style="font-size:16px;line-height:1.8;margin:0 0 16px;">亲爱的 <strong>{{name}}</strong> 同学：</p>
<p style="font-size:16px;line-height:1.8;margin:0 0 20px;">
  你报名参加的赛事 <strong>{{eventTitle}}</strong> 即将开始，请提前做好参赛准备。
</p>
${INFO_CARD}
<p style="font-size:15px;line-height:1.8;margin:0 0 16px;color:#333;">
  请合理安排出行时间，提前到达比赛场地完成签到，并携带好球拍等个人装备。
  具体赛程、分组与对阵信息请以平台公告和现场通知为准。
</p>
<p style="font-size:15px;line-height:1.8;margin:0;color:#333;">预祝你比赛顺利，取得好成绩！</p>`,
  },
  match_result: {
    name: '比赛结果/获奖通知（预留）',
    subject: '【羽动云赛】比赛结果通知',
    enabled: false,
    defaultEventEnabled: false,
    reserved: true,
    body: `
<p style="font-size:16px;line-height:1.8;margin:0 0 16px;">亲爱的 <strong>{{name}}</strong> 同学：</p>
<p style="font-size:16px;line-height:1.8;margin:0;">
  你参加的赛事 <strong>{{eventTitle}}</strong> 比赛结果已公布，请登录平台查看详情。
</p>`,
  },
  custom: {
    name: '自定义通知（预留）',
    subject: '【羽动云赛】赛事通知',
    enabled: false,
    defaultEventEnabled: false,
    reserved: true,
    body: `
<p style="font-size:16px;line-height:1.8;margin:0 0 16px;">亲爱的 <strong>{{name}}</strong> 同学：</p>
<p style="font-size:16px;line-height:1.8;margin:0;">这是一条来自 <strong>{{eventTitle}}</strong> 组委会的通知。</p>`,
  },
};

/** 模板预览时使用的示例数据 */
export const SAMPLE_TEMPLATE_VARS: Required<EmailTemplateVars> = {
  name: '张三',
  eventTitle: '2026 年校园羽毛球公开赛',
  eventTime: '2026年6月20日 至 2026年6月21日',
  eventLocation: '大学体育馆',
  eventGroup: '男子单打、混合双打',
  rejectReason: '报名信息不完整，请补充学号后重新提交',
  sendTime: '2026年6月10日 12:00',
};
