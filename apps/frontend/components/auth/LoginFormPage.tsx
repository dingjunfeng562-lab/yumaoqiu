'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { getSession, signIn } from 'next-auth/react';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  UserOutlined,
  LockOutlined,
  MailOutlined
} from '@ant-design/icons';
import { Alert, Button, Checkbox, ConfigProvider, Form, Input } from 'antd';
import { firstAdminPage } from '@/lib/admin-permissions';

type LoginType = 'username' | 'email';

type FormValues = {
  identifier: string;
  password: string;
  remember?: boolean;
};

const usernamePattern = /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_-]{1,19}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const manrope = { className: 'font-sans' };
const jetbrainsMono = { className: 'font-mono' };
const sessionReadyAttempts = 8;
const sessionReadyDelayMs = 120;

function destinationForRole(role?: string | null, permissions?: string[]) {
  const adminPage = firstAdminPage(role ?? undefined, permissions);
  if (adminPage) return adminPage;
  if (role === 'REFEREE') return '/referee/my-matches';
  if (role === 'PLAYER') return '/my-registrations';
  if (role === 'PHOTOGRAPHER') return '/photographer/upload';
  return '/';
}

function safeRedirect(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  if (value.startsWith('/login')) return null;
  return value;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForReadySession() {
  for (let attempt = 0; attempt < sessionReadyAttempts; attempt += 1) {
    const session = await getSession();
    if (session?.user?.accessToken && session.user.role) return session;
    await delay(sessionReadyDelayMs + attempt * 80);
  }
  return getSession();
}

export default function LoginFormPage() {
  return (
    <Suspense fallback={<main className="register-page" />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const [form] = Form.useForm<FormValues>();
  const [loginType, setLoginType] = useState<LoginType>('username');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onFinish = async (values: FormValues) => {
    setLoading(true);
    setError('');

    try {
      const res = await signIn('credentials', {
        loginType,
        identifier: values.identifier.trim(),
        password: values.password,
        rememberMe: values.remember ? 'true' : 'false',
        redirect: false,
      });

      if (!res?.ok || res?.error) {
        setError((res as { code?: string }).code === 'locked' ? '账号已锁定,请稍后再试' : '账号或密码错误');
        return;
      }

      const session = await waitForReadySession();
      const destination = safeRedirect(searchParams.get('redirect')) ?? destinationForRole(session?.user?.role, session?.user?.permissions);
      window.location.assign(destination);
    } catch {
      setError('登录服务暂时不可用,请稍后重试');
    } finally {
      setLoading(false);
    }
  };

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

        {/* 返回首页按钮 */}
        <Link href="/" className="modern-login-back">
          <ArrowLeftOutlined />
          <span>返回首页</span>
        </Link>

        {/* 登录卡片 */}
        <div className="modern-login-container">
          <section className="modern-login-card">
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
              <h1 className="modern-login-title">欢迎回来</h1>
              <p className="modern-login-subtitle">登录校园羽毛球赛事管理系统</p>
            </div>

            {/* 登录方式切换 */}
            <div className="modern-login-tabs">
              {(
                [
                  { key: 'username', label: '用户名登录', icon: <UserOutlined /> },
                  { key: 'email', label: '邮箱登录', icon: <MailOutlined /> },
                ] as { key: LoginType; label: string; icon: React.ReactNode }[]
              ).map((tab) => {
                const active = loginType === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={`modern-login-tab ${active ? 'modern-login-tab--active' : ''}`}
                    onClick={() => {
                      if (active) return;
                      setLoginType(tab.key);
                      setError('');
                      form.setFieldsValue({ identifier: '' });
                      form.setFields([{ name: 'identifier', errors: [] }]);
                    }}
                  >
                    <span className="modern-login-tab__icon">{tab.icon}</span>
                    <span className="modern-login-tab__label">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* 错误提示 */}
            {error ? (
              <Alert
                showIcon
                type="error"
                message={error}
                className="modern-login-alert"
              />
            ) : null}

            {/* 登录表单 */}
            <Form<FormValues>
              form={form}
              layout="vertical"
              requiredMark={false}
              autoComplete="off"
              className="modern-login-form"
              onFinish={onFinish}
            >
              <Form.Item<FormValues>
                name="identifier"
                label={loginType === 'email' ? '邮箱地址' : '用户名'}
                rules={
                  loginType === 'email'
                    ? [
                        { required: true, message: '请输入邮箱地址' },
                        { pattern: emailPattern, message: '邮箱格式不正确' },
                      ]
                    : [
                        { required: true, message: '请输入用户名' },
                        {
                          pattern: usernamePattern,
                          message: '用户名格式：2-20位，以中文或字母开头'
                        },
                      ]
                }
              >
                <Input
                  prefix={loginType === 'email' ? <MailOutlined /> : <UserOutlined />}
                  placeholder={loginType === 'email' ? '请输入邮箱地址' : '请输入用户名'}
                  autoComplete={loginType === 'email' ? 'email' : 'username'}
                  size="large"
                  className="modern-login-input"
                  onChange={() => error && setError('')}
                />
              </Form.Item>

              <Form.Item<FormValues>
                name="password"
                label="登录密码"
                rules={[{ required: true, message: '请输入登录密码' }]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="请输入登录密码"
                  autoComplete="current-password"
                  size="large"
                  className="modern-login-input"
                  iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                  onChange={() => error && setError('')}
                />
              </Form.Item>

              <div className="modern-login-options">
                <Form.Item<FormValues> name="remember" valuePropName="checked" noStyle>
                  <Checkbox className="modern-login-checkbox">记住登录状态</Checkbox>
                </Form.Item>
              </div>

              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                size="large"
                block
                className="modern-login-submit"
                icon={!loading ? <ArrowRightOutlined /> : undefined}
              >
                {loading ? '登录中...' : '立即登录'}
              </Button>
            </Form>

            {/* 底部链接 */}
            <div className="modern-login-footer">
              <span className="modern-login-footer__text">还没有账号？</span>
              <Link href="/register" className="modern-login-footer__link">
                使用邀请码注册
              </Link>
            </div>
          </section>

          {/* 右侧信息面板（可选） */}
          <aside className="modern-login-info">
            <div className="modern-login-info__content">
              <div className="modern-login-info__icon">
                <svg viewBox="0 0 64 64" fill="none">
                  <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2" opacity="0.2" />
                  <path
                    d="M20 28L28 36L44 20"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 className="modern-login-info__title">高效赛事管理</h2>
              <p className="modern-login-info__desc">
                为校园羽毛球赛事提供全方位的数字化管理解决方案
              </p>
              <ul className="modern-login-info__features">
                <li>
                  <span className="modern-login-info__check">✓</span>
                  <span>在线报名与资格审核</span>
                </li>
                <li>
                  <span className="modern-login-info__check">✓</span>
                  <span>智能赛程编排</span>
                </li>
                <li>
                  <span className="modern-login-info__check">✓</span>
                  <span>实时比分更新</span>
                </li>
                <li>
                  <span className="modern-login-info__check">✓</span>
                  <span>赛事数据统计</span>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </ConfigProvider>
  );
}

