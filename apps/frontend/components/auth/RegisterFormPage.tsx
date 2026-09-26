'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LoadingOutlined,
  UserOutlined,
  MailOutlined,
  LockOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { Alert, Button, ConfigProvider, Form, Input } from 'antd';

type CheckState = 'idle' | 'checking' | 'valid' | 'invalid';
type CheckField = 'inviteCode' | 'username' | 'email';

type FieldCheck = {
  state: CheckState;
  message: string;
};

type FormValues = {
  inviteCode: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type SubmitMessage = {
  type: 'error' | 'success';
  text: string;
};

type StrengthLevel = {
  score: number;
  label: string;
  color: string;
  width: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const usernamePattern = /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_-]{1,19}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const invitePattern = /^YZY-\d{4}-[A-Z0-9]{6}$/;
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[^\s一-龥]{8,32}$/;
const emptyCheck: FieldCheck = { state: 'idle', message: '' };
const strengthLabels = ['—', '太弱', '较弱', '一般', '良好', '强'] as const;
const strengthColors = ['#E5E9E7', '#B91C1C', '#D97706', '#CA8A04', '#0A4D3C', '#047857'] as const;
const strengthWidths = ['0%', '20%', '40%', '60%', '80%', '100%'] as const;

const manrope = { className: 'font-sans' };
const jetbrainsMono = { className: 'font-mono' };

function passwordStrength(password: string): StrengthLevel {
  if (!password) {
    return {
      score: 0,
      label: strengthLabels[0],
      color: strengthColors[0],
      width: strengthWidths[0],
    };
  }

  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (password.length >= 12) score += 1;

  return {
    score,
    label: strengthLabels[score],
    color: strengthColors[score],
    width: strengthWidths[score],
  };
}

export default function RegisterFormPage() {
  const router = useRouter();
  const [form] = Form.useForm<FormValues>();
  const [checks, setChecks] = useState<Record<CheckField, FieldCheck>>({
    inviteCode: emptyCheck,
    username: emptyCheck,
    email: emptyCheck,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<SubmitMessage | null>(null);

  const inviteCode = Form.useWatch('inviteCode', form) ?? '';
  const username = Form.useWatch('username', form) ?? '';
  const email = Form.useWatch('email', form) ?? '';
  const password = Form.useWatch('password', form) ?? '';
  const confirmPassword = Form.useWatch('confirmPassword', form) ?? '';

  const strength = useMemo(() => passwordStrength(password), [password]);
  const canSubmit =
    checks.inviteCode.state === 'valid' &&
    checks.username.state === 'valid' &&
    checks.email.state === 'valid' &&
    passwordPattern.test(password) &&
    password.length > 0 &&
    password === confirmPassword &&
    !submitting;

  function clearSubmitMessage() {
    if (submitMessage) setSubmitMessage(null);
  }

  function resetCheck(field: CheckField) {
    setChecks((prev) => {
      if (prev[field].state === 'idle' && !prev[field].message) return prev;
      return { ...prev, [field]: emptyCheck };
    });
  }

  function localValidation(field: CheckField, value: string) {
    if (!value) return field === 'email' ? '请输入邮箱' : `请输入${field === 'inviteCode' ? '邀请码' : '用户名'}`;
    if (field === 'inviteCode' && !invitePattern.test(value)) return '格式示例：YZY-2026-XXXXXX';
    if (field === 'username' && !usernamePattern.test(value)) return '2-20 位中文、字母、数字、下划线或连字符，首字符需为中文或字母';
    if (field === 'email' && !emailPattern.test(value)) return '邮箱格式不正确';
    return '';
  }

  async function runCheck(field: CheckField) {
    try {
      await form.validateFields([field]);
    } catch {
      setChecks((prev) => ({ ...prev, [field]: emptyCheck }));
      return false;
    }

    const value = String(form.getFieldValue(field) ?? '').trim();
    const localError = localValidation(field, value);
    if (localError) {
      setChecks((prev) => ({ ...prev, [field]: emptyCheck }));
      return false;
    }

    const endpoint =
      field === 'inviteCode' ? 'check-invite' : field === 'username' ? 'check-username' : 'check-email';
    const body =
      field === 'inviteCode'
        ? { inviteCode: value }
        : field === 'username'
          ? { username: value }
          : { email: value };

    setChecks((prev) => ({ ...prev, [field]: { state: 'checking', message: '校验中...' } }));

    try {
      const res = await fetch(`${API_BASE}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      const available = Boolean(data.available);

      setChecks((prev) => ({
        ...prev,
        [field]: {
          state: available ? 'valid' : 'invalid',
          message: data.message ?? (available ? '可用' : '不可用'),
        },
      }));

      return available;
    } catch {
      setChecks((prev) => ({ ...prev, [field]: { state: 'invalid', message: '校验失败，请稍后重试' } }));
      return false;
    }
  }

  async function handleFinish(values: FormValues) {
    const availability = await Promise.all(
      (['inviteCode', 'username', 'email'] as CheckField[]).map((field) =>
        checks[field].state === 'valid' ? true : runCheck(field),
      ),
    );

    if (!availability.every(Boolean)) return;

    setSubmitting(true);
    setSubmitMessage(null);

    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteCode: values.inviteCode.trim(),
          username: values.username.trim(),
          email: values.email.trim(),
          password: values.password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? '注册失败');

      setSubmitMessage({ type: 'success', text: '注册成功，请登录。' });
      form.resetFields();
      setChecks({ inviteCode: emptyCheck, username: emptyCheck, email: emptyCheck });
      window.setTimeout(() => router.push('/login'), 800);
    } catch (error) {
      setSubmitMessage({ type: 'error', text: error instanceof Error ? error.message : '注册失败' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
          controlHeight: 44,
          colorBorder: '#d9d9d9',
          colorText: '#1f2937',
          colorTextPlaceholder: '#9ca3af',
        },
      }}
    >
      <main className={`modern-login-page ${manrope.className}`}>
        {/* 背景装饰 */}
        <div className="modern-login-bg">
          <div className="modern-login-bg__gradient modern-login-bg__gradient--1" />
          <div className="modern-login-bg__gradient modern-login-bg__gradient--2" />
          <div className="modern-login-bg__grid" />
        </div>

        {/* 返回登录按钮 */}
        <Link href="/login" className="modern-login-back">
          <ArrowLeftOutlined />
          <span>返回登录</span>
        </Link>

        {/* 注册卡片 */}
        <div className="modern-register-container">
          <section className="modern-register-card">
            {/* Logo 和品牌 */}
            <div className="modern-login-header">
              <div className="modern-login-logo">
                <Image
                  src="/logo.png"
                  alt="校园羽毛球赛事系统"
                  width={80}
                  height={80}
                  className="modern-login-logo__img"
                  priority
                />
              </div>
              <h1 className="modern-login-title">创建新账号</h1>
              <p className="modern-login-subtitle">使用邀请码注册校园羽毛球赛事系统</p>
            </div>

            {/* 提交消息 */}
            {submitMessage ? (
              <Alert
                showIcon
                type={submitMessage.type}
                message={submitMessage.text}
                className="modern-login-alert"
              />
            ) : null}

            {/* 注册表单 */}
            <Form<FormValues>
              form={form}
              layout="vertical"
              requiredMark={false}
              autoComplete="off"
              className="modern-register-form"
              onFinish={handleFinish}
            >
              {/* 邀请码 */}
              <Form.Item<FormValues>
                name="inviteCode"
                label="邀请码"
                normalize={(value) => (typeof value === 'string' ? value.toUpperCase() : value)}
                rules={[
                  { required: true, message: '请输入邀请码' },
                  { pattern: invitePattern, message: '格式示例：YZY-2026-XXXXXX' },
                ]}
              >
                <Input
                  prefix={<SafetyOutlined />}
                  placeholder="请输入邀请码 (如: YZY-2026-XXXXXX)"
                  autoComplete="off"
                  size="large"
                  className={`modern-login-input ${jetbrainsMono.className}`}
                  onChange={() => {
                    clearSubmitMessage();
                    resetCheck('inviteCode');
                  }}
                  onBlur={() => void runCheck('inviteCode')}
                />
              </Form.Item>
              <StatusText check={checks.inviteCode} />

              {/* 用户名 */}
              <Form.Item<FormValues>
                name="username"
                label="用户名"
                extra={<FieldTip>2-20位，支持中文、字母、数字、下划线或连字符</FieldTip>}
                rules={[
                  { required: true, message: '请输入用户名' },
                  {
                    pattern: usernamePattern,
                    message: '用户名格式：2-20位，以中文或字母开头'
                  },
                ]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder="请设置用户名"
                  autoComplete="username"
                  size="large"
                  className="modern-login-input"
                  onChange={() => {
                    clearSubmitMessage();
                    resetCheck('username');
                  }}
                  onBlur={() => void runCheck('username')}
                />
              </Form.Item>
              <StatusText check={checks.username} />

              {/* 邮箱 */}
              <Form.Item<FormValues>
                name="email"
                label="邮箱地址"
                rules={[
                  { required: true, message: '请输入邮箱地址' },
                  { pattern: emailPattern, message: '邮箱格式不正确' },
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  placeholder="请输入邮箱地址"
                  autoComplete="email"
                  size="large"
                  className="modern-login-input"
                  onChange={() => {
                    clearSubmitMessage();
                    resetCheck('email');
                  }}
                  onBlur={() => void runCheck('email')}
                />
              </Form.Item>
              <StatusText check={checks.email} />

              {/* 密码 */}
              <Form.Item<FormValues>
                name="password"
                label="登录密码"
                extra={
                  <>
                    <PasswordStrengthMeter strength={strength} />
                    <FieldTip>8-32位，必须包含大写字母、小写字母和数字</FieldTip>
                  </>
                }
                rules={[
                  { required: true, message: '请输入密码' },
                  {
                    pattern: passwordPattern,
                    message: '密码需包含大写字母、小写字母和数字'
                  },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="请设置登录密码"
                  autoComplete="new-password"
                  size="large"
                  className="modern-login-input"
                  iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                  onChange={clearSubmitMessage}
                />
              </Form.Item>

              {/* 确认密码 */}
              <Form.Item<FormValues>
                name="confirmPassword"
                label="确认密码"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请再次输入密码' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('两次输入的密码不一致'));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="请再次输入密码"
                  autoComplete="new-password"
                  size="large"
                  className="modern-login-input"
                  iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                  onChange={clearSubmitMessage}
                />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                disabled={!canSubmit}
                size="large"
                block
                className="modern-login-submit"
                icon={!submitting ? <ArrowRightOutlined /> : undefined}
              >
                {submitting ? '注册中...' : '立即注册'}
              </Button>
            </Form>

            {/* 底部链接 */}
            <div className="modern-login-footer">
              <span className="modern-login-footer__text">已有账号？</span>
              <Link href="/login" className="modern-login-footer__link">
                立即登录
              </Link>
            </div>
          </section>

          {/* 右侧信息面板 */}
          <aside className="modern-login-info">
            <div className="modern-login-info__content">
              <div className="modern-login-info__icon">
                <svg viewBox="0 0 64 64" fill="none">
                  <path
                    d="M32 8L40 16L32 24M32 20L24 28L32 36"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                  <circle cx="32" cy="32" r="3" fill="currentColor" />
                </svg>
              </div>
              <h2 className="modern-login-info__title">邀请注册说明</h2>
              <p className="modern-login-info__desc">
                为确保系统安全和用户质量，我们采用邀请码注册制度
              </p>
              <ul className="modern-login-info__features">
                <li>
                  <span className="modern-login-info__check">1</span>
                  <span>向管理员申请邀请码</span>
                </li>
                <li>
                  <span className="modern-login-info__check">2</span>
                  <span>填写注册信息</span>
                </li>
                <li>
                  <span className="modern-login-info__check">3</span>
                  <span>完成账号注册</span>
                </li>
                <li>
                  <span className="modern-login-info__check">4</span>
                  <span>登录使用系统</span>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </ConfigProvider>
  );
}

function FieldTip({ children }: { children: React.ReactNode }) {
  return <p className="modern-register-field-tip">{children}</p>;
}

function PasswordStrengthMeter({ strength }: { strength: StrengthLevel }) {
  return (
    <div className="modern-register-strength">
      <div className="modern-register-strength__track">
        <div
          className="modern-register-strength__fill"
          style={{ width: strength.width, backgroundColor: strength.color }}
        />
      </div>
      <span className="modern-register-strength__label" style={{ color: strength.color }}>
        密码强度: {strength.label}
      </span>
    </div>
  );
}

function StatusText({ check }: { check: FieldCheck }) {
  if (!check.message) return null;

  const statusClass =
    check.state === 'checking'
      ? 'modern-register-status--checking'
      : check.state === 'valid'
        ? 'modern-register-status--valid'
        : 'modern-register-status--invalid';

  return (
    <p className={`modern-register-status ${statusClass}`}>
      {check.state === 'checking' ? <LoadingOutlined className="modern-register-status__icon" spin /> : null}
      <span>{check.message}</span>
    </p>
  );
}
