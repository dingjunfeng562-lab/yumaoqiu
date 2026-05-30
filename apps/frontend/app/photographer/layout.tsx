'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Button, Layout, Spin, Typography } from 'antd';
import { CameraOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';

const { Header, Content } = Layout;

export default function PhotographerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      router.replace('/login?redirect=/photographer/upload');
      return;
    }
    if (role && role !== 'PHOTOGRAPHER') {
      router.replace('/forbidden');
    }
  }, [status, role, router]);

  if (status === 'loading' || (status === 'authenticated' && role !== 'PHOTOGRAPHER')) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          background: '#fff',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 1px 4px rgba(0,21,41,.08)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <CameraOutlined style={{ fontSize: 20, color: '#0a5dd1' }} />
          <Typography.Text strong style={{ fontSize: 16 }}>
            赛事图片上传
          </Typography.Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Typography.Text type="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <UserOutlined />
            {session?.user?.name ?? (session?.user as { username?: string } | undefined)?.username}
          </Typography.Text>
          <Button icon={<LogoutOutlined />} onClick={() => signOut({ callbackUrl: '/' })}>
            退出登录
          </Button>
        </div>
      </Header>
      <Content style={{ padding: 16, background: '#f5f7fb' }}>{children}</Content>
    </Layout>
  );
}
