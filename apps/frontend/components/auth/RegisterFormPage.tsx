'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRightOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LoadingOutlined,
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
          colorPrimary: '#0A4D3C',
          borderRadius: 8,
          controlHeight: 44,
          colorBorder: '#E5E9E7',
          colorText: '#1A2E2A',
          colorTextPlaceholder: '#B8C2BF',
        },
      }}
    >
      <main className={`register-page ${manrope.className}`}>
        <div className="register-page__grid" />
        <div className="register-page__glow register-page__glow--top" />
        <div className="register-page__glow register-page__glow--bottom" />

        <section className="register-card">
          <div className="register-brand">
            <div className="register-brand__mark" aria-hidden="true">
              <svg viewBox="0 0 40 40" className="register-brand__svg" fill="none">
                <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1.5" />
                <path d="M14 12L26 28" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                <path d="M26 12L14 28" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                <circle cx="20" cy="20" r="3" fill="#C9A961" />
              </svg>
            </div>
            <span className="register-brand__name">校园羽毛球赛事系统</span>
          </div>

          <header className="register-hero">
            <span className={`register-badge ${jetbrainsMono.className}`}>
              <span className="register-badge__dot" />
              邀请注册
            </span>
            <h1 className="register-title">创建新账号</h1>
            <p className="register-subtitle">请使用邀请码完成注册</p>
          </header>

          {submitMessage ? (
            <Alert
              showIcon={false}
              type={submitMessage.type}
              message={submitMessage.text}
              className="register-alert"
            />
          ) : null}

          <Form<FormValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            autoComplete="off"
            className="register-form"
            onFinish={handleFinish}
          >
            <Form.Item<FormValues>
              name="inviteCode"
              label={<FieldLabel label="邀请码" />}
              normalize={(value) => (typeof value === 'string' ? value.toUpperCase() : value)}
              rules={[
                { required: true, message: '请输入邀请码' },
                { pattern: invitePattern, message: '格式示例：YZY-2026-XXXXXX' },
              ]}
            >
              <Input
                placeholder="请输入邀请码"
                autoComplete="off"
                className={`register-input register-input--mono ${jetbrainsMono.className}`}
                onChange={() => {
                  clearSubmitMessage();
                  resetCheck('inviteCode');
                }}
                onBlur={() => void runCheck('inviteCode')}
              />
            </Form.Item>
            <StatusText check={checks.inviteCode} />

            <Form.Item<FormValues>
              name="username"
              label={<FieldLabel label="用户名" hint="2-20 位" />}
              extra={<FieldTip>支持中文、字母、数字、下划线或连字符，首字符需为中文或字母</FieldTip>}
              rules={[
                { required: true, message: '请输入用户名' },
                { pattern: usernamePattern, message: '2-20 位中文、字母、数字、下划线或连字符，首字符需为中文或字母' },
              ]}
            >
              <Input
                placeholder="设置一个登录用户名"
                autoComplete="username"
                className="register-input"
                onChange={() => {
                  clearSubmitMessage();
                  resetCheck('username');
                }}
                onBlur={() => void runCheck('username')}
              />
            </Form.Item>
            <StatusText check={checks.username} />

            <Form.Item<FormValues>
              name="email"
              label={<FieldLabel label="邮箱" />}
              rules={[
                { required: true, message: '请输入邮箱' },
                { pattern: emailPattern, message: '邮箱格式不正确' },
              ]}
            >
              <Input
                placeholder="name@example.com"
                autoComplete="email"
                className="register-input"
                onChange={() => {
                  clearSubmitMessage();
                  resetCheck('email');
                }}
                onBlur={() => void runCheck('email')}
              />
            </Form.Item>
            <StatusText check={checks.email} />

            <Form.Item<FormValues>
              name="password"
              label={<FieldLabel label="密码" hint="8-32 位" />}
              extra={
                <>
                  <PasswordStrengthMeter strength={strength} monoClassName={jetbrainsMono.className} />
                  <FieldTip>必须同时包含大写字母、小写字母和数字</FieldTip>
                </>
              }
              rules={[
                { required: true, message: '请输入密码' },
                { pattern: passwordPattern, message: '8-32 位，需同时包含大写字母、小写字母和数字' },
              ]}
            >
              <Input.Password
                placeholder="设置登录密码"
                autoComplete="new-password"
                className="register-input"
                iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                onChange={clearSubmitMessage}
              />
            </Form.Item>

            <Form.Item<FormValues>
              name="confirmPassword"
              label={<FieldLabel label="确认密码" />}
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
                placeholder="再次输入密码"
                autoComplete="new-password"
                className="register-input"
                iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                onChange={clearSubmitMessage}
              />
            </Form.Item>

            <div className="register-submit-wrap">
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                aria-disabled={!canSubmit}
                className="register-submit-button"
              >
                <span>立即注册</span>
                {!submitting ? <ArrowRightOutlined className="register-submit-button__icon" /> : null}
              </Button>
            </div>
          </Form>

          <footer className="register-footer">
            <span>已有账号?</span>
            <Link href="/login" className="register-footer__link">
              立即登录
            </Link>
          </footer>
        </section>
      </main>
    </ConfigProvider>
  );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="register-label-row">
      <span className="register-label-row__text">{label}</span>
      {hint ? <span className="register-label-row__hint">{hint}</span> : null}
    </span>
  );
}

function FieldTip({ children }: { children: React.ReactNode }) {
  return <p className="register-field-tip">{children}</p>;
}

function PasswordStrengthMeter({
  strength,
  monoClassName,
}: {
  strength: StrengthLevel;
  monoClassName: string;
}) {
  return (
    <div className="register-strength">
      <div className="register-strength__track" aria-hidden="true">
        <div
          className="register-strength__fill"
          style={{ width: strength.width, backgroundColor: strength.color }}
        />
      </div>
      <span className={`register-strength__label ${monoClassName}`} style={{ color: strength.color }}>
        {strength.label}
      </span>
    </div>
  );
}

function StatusText({ check }: { check: FieldCheck }) {
  if (!check.message) return null;

  return (
    <p className={`register-status register-status--${check.state}`}>
      {check.state === 'checking' ? <LoadingOutlined className="register-status__icon" spin /> : null}
      <span>{check.message}</span>
    </p>
  );
}
