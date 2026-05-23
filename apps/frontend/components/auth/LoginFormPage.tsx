'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSession, signIn } from 'next-auth/react';
import { JetBrains_Mono, Manrope } from 'next/font/google';
import { ArrowRightOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, ConfigProvider, Form, Input } from 'antd';

type LoginType = 'username' | 'email';

type FormValues = {
  identifier: string;
  password: string;
  remember?: boolean;
};

const usernamePattern = /^[A-Za-z][A-Za-z0-9_]{3,19}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
});

function destinationForRole(role?: string | null) {
  if (role === 'REFEREE') return '/referee/my-matches';
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return '/admin';
  if (role === 'PLAYER') return '/my-registrations';
  return '/';
}

function safeRedirect(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  if (value.startsWith('/login')) return null;
  return value;
}

export default function LoginFormPage() {
  return (
    <Suspense fallback={<main className="register-page" />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form] = Form.useForm<FormValues>();
  const [loginType, setLoginType] = useState<LoginType>('username');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onFinish = async (values: FormValues) => {
    setLoading(true);
    setError('');
    const res = await signIn('credentials', {
      loginType,
      identifier: values.identifier.trim(),
      password: values.password,
      rememberMe: values.remember ? 'true' : 'false',
      redirect: false,
    });
    setLoading(false);

    if (res?.error) {
      setError((res as { code?: string }).code === 'locked' ? '账号已锁定,请稍后再试' : '账号或密码错误');
      return;
    }

    const session = await getSession();
    router.replace(safeRedirect(searchParams.get('redirect')) ?? destinationForRole(session?.user?.role));
  };

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

        <section className="register-card login-card">
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
              账号登录
            </span>
            <h1 className="register-title">欢迎回来</h1>
            <p className="register-subtitle">请使用您的账号继续</p>
          </header>

          <div className="login-tabs" role="tablist" aria-label="登录方式">
            {(
              [
                { key: 'username', label: '用户名' },
                { key: 'email', label: '邮箱' },
              ] as { key: LoginType; label: string }[]
            ).map((tab) => {
              const active = loginType === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`login-tab ${active ? 'login-tab--active' : ''}`}
                  onClick={() => {
                    if (active) return;
                    setLoginType(tab.key);
                    setError('');
                    form.setFieldsValue({ identifier: '' });
                    form.setFields([{ name: 'identifier', errors: [] }]);
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {error ? (
            <Alert
              showIcon={false}
              type="error"
              message={error}
              className="register-alert login-alert"
            />
          ) : null}

          <Form<FormValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            autoComplete="off"
            className="register-form login-form"
            onFinish={onFinish}
          >
            <Form.Item<FormValues>
              name="identifier"
              label={<FieldLabel label={loginType === 'email' ? '邮箱' : '用户名'} />}
              rules={
                loginType === 'email'
                  ? [
                      { required: true, message: '请输入邮箱' },
                      { pattern: emailPattern, message: '邮箱格式不正确' },
                    ]
                  : [
                      { required: true, message: '请输入用户名' },
                      { pattern: usernamePattern, message: '4-20 位字母、数字或下划线,首字符必须为字母' },
                    ]
              }
            >
              <Input
                placeholder={loginType === 'email' ? 'name@example.com' : '请输入用户名'}
                autoComplete={loginType === 'email' ? 'email' : 'username'}
                className="register-input"
                onChange={() => error && setError('')}
              />
            </Form.Item>

            <Form.Item<FormValues>
              name="password"
              label={<FieldLabel label="密码" />}
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                placeholder="请输入密码"
                autoComplete="current-password"
                className="register-input"
                iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                onChange={() => error && setError('')}
              />
            </Form.Item>

            <div className="login-options">
              <Form.Item<FormValues> name="remember" valuePropName="checked" noStyle>
                <Checkbox>记住我</Checkbox>
              </Form.Item>
            </div>

            <div className="register-submit-wrap login-submit-wrap">
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                className="register-submit-button"
              >
                <span>登录</span>
                {!loading ? <ArrowRightOutlined className="register-submit-button__icon" /> : null}
              </Button>
            </div>
          </Form>

          <footer className="register-footer">
            <span>没有账号?</span>
            <Link href="/register" className="register-footer__link">
              使用邀请码注册
            </Link>
          </footer>
        </section>
      </main>
    </ConfigProvider>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <span className="register-label-row">
      <span className="register-label-row__text">{label}</span>
    </span>
  );
}
