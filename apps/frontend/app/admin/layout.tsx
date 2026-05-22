'use client';

export const dynamic = 'force-dynamic';

import Image from 'next/image';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Layout, Menu, Button, Typography, Dropdown, Avatar, Modal, Form, Input, message } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  TeamOutlined,
  TrophyOutlined,
  UnorderedListOutlined,
  BranchesOutlined,
  LogoutOutlined,
  HomeOutlined,
  FieldTimeOutlined,
  CalendarOutlined,
  DownloadOutlined,
  ApartmentOutlined,
  LockOutlined,
  NotificationOutlined,
  KeyOutlined,
} from '@ant-design/icons';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/admin', icon: <DashboardOutlined />, label: '仪表板' },
  { key: '/admin/users', icon: <TeamOutlined />, label: '用户管理' },
  { key: '/admin/invite-codes', icon: <KeyOutlined />, label: '邀请码管理' },
  { key: '/admin/players', icon: <UserOutlined />, label: '选手管理' },
  { key: '/admin/tournaments', icon: <TrophyOutlined />, label: '赛事配置' },
  { key: '/admin/competitions', icon: <TrophyOutlined />, label: '赛事管理' },
  { key: '/admin/events', icon: <UnorderedListOutlined />, label: '单项管理' },
  { key: '/admin/team-competitions', icon: <ApartmentOutlined />, label: '团体赛管理' },
  { key: '/admin/draws', icon: <BranchesOutlined />, label: '抽签编排' },
  { key: '/admin/scheduling', icon: <CalendarOutlined />, label: '场地排程' },
  { key: '/admin/scoring', icon: <FieldTimeOutlined />, label: '裁判分配' },
  { key: '/admin/announcements', icon: <NotificationOutlined />, label: '公告管理' },
  { key: '/admin/exports', icon: <DownloadOutlined />, label: '数据导出' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordForm] = Form.useForm();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const selectedKey = menuItems.find((m) => pathname.startsWith(m.key) && m.key !== '/admin')
    ? menuItems.find((m) => pathname.startsWith(m.key) && m.key !== '/admin')!.key
    : pathname === '/admin'
      ? '/admin'
      : '';

  async function submitPasswordChange() {
    const values = await passwordForm.validateFields();
    const token = session?.user?.accessToken as string | undefined;
    if (!token) return;

    setPasswordSubmitting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/me/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: '修改密码失败' }));
        throw new Error(error.message ?? '修改密码失败');
      }
      message.success('密码已修改，请使用新密码重新登录');
      setPasswordOpen(false);
      passwordForm.resetFields();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '修改密码失败');
    } finally {
      setPasswordSubmitting(false);
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: '#fff',
            fontWeight: 'bold',
            fontSize: collapsed ? 12 : 16,
            padding: '0 8px',
          }}
        >
          <Image
            src="/logo.png"
            alt="羽动云赛"
            width={1536}
            height={1024}
            style={{ width: collapsed ? 34 : 42, height: collapsed ? 24 : 28, objectFit: 'contain' }}
          />
          {!collapsed && <span>羽动云赛</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            boxShadow: '0 1px 4px rgba(0,21,41,.08)',
          }}
        >
          <Button icon={<HomeOutlined />} onClick={() => router.push('/')}>
            返回首页
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'change-password',
                  icon: <LockOutlined />,
                  label: '修改密码',
                  onClick: () => setPasswordOpen(true),
                },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: () => signOut({ callbackUrl: '/' }),
                },
              ],
            }}
          >
            <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <Typography.Text>{session?.user?.name}</Typography.Text>
            </Button>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          {children}
        </Content>
        <Modal
          title="修改密码"
          open={passwordOpen}
          onOk={submitPasswordChange}
          onCancel={() => {
            setPasswordOpen(false);
            passwordForm.resetFields();
          }}
          confirmLoading={passwordSubmitting}
          okText="保存"
          cancelText="取消"
        >
          <Form form={passwordForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="currentPassword"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[{ required: true, min: 8, message: '新密码至少 8 位' }]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的新密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password />
            </Form.Item>
          </Form>
        </Modal>
      </Layout>
    </Layout>
  );
}
