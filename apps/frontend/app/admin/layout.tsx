'use client';

export const dynamic = 'force-dynamic';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  Badge,
  Layout,
  Menu,
  Button,
  Typography,
  Dropdown,
  Avatar,
  Modal,
  Form,
  Input,
  Drawer,
  message,
} from 'antd';
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
  AuditOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const { Header, Sider, Content } = Layout;
const MOBILE_QUERY = '(max-width: 1023px)';

type MenuItem = { key: string; icon: React.ReactNode; label: string; superOnly?: boolean };

const baseMenuItems: MenuItem[] = [
  { key: '/admin', icon: <DashboardOutlined />, label: '仪表板' },
  // Only the super admin can manage users / invite codes / approvals.
  { key: '/admin/users', icon: <TeamOutlined />, label: '用户管理', superOnly: true },
  { key: '/admin/invite-codes', icon: <KeyOutlined />, label: '邀请码管理', superOnly: true },
  { key: '/admin/approvals', icon: <AuditOutlined />, label: '赛事审核', superOnly: true },
  { key: '/admin/players', icon: <UserOutlined />, label: '选手管理' },
  { key: '/admin/tournaments', icon: <TrophyOutlined />, label: '赛事配置' },
  { key: '/admin/competitions', icon: <TrophyOutlined />, label: '赛事管理' },
  { key: '/admin/events', icon: <UnorderedListOutlined />, label: '单项管理' },
  { key: '/admin/team-competitions', icon: <ApartmentOutlined />, label: '团体赛管理' },
  { key: '/admin/draws', icon: <BranchesOutlined />, label: '抽签编排' },
  { key: '/admin/scheduling', icon: <CalendarOutlined />, label: '场地排程' },
  { key: '/admin/scoring', icon: <FieldTimeOutlined />, label: '裁判分配' },
  { key: '/admin/announcements', icon: <NotificationOutlined />, label: '公告管理', superOnly: true },
  { key: '/admin/exports', icon: <DownloadOutlined />, label: '数据导出' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [passwordForm] = Form.useForm();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  // Track viewport width to switch between Sider (desktop) and Drawer (mobile)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const apply = () => setIsMobile(mql.matches);
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, []);

  // Close mobile drawer whenever the route changes
  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [pathname]);

  const token = session?.user?.accessToken as string | undefined;
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;

  // The session JWT can be stale (issued before a server-side role change).
  // Always re-fetch the current role from /auth/me on mount so SUPER_ADMIN
  // promotions show up without forcing the user to log out and back in.
  const [liveRole, setLiveRole] = useState<string | undefined>(sessionRole);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ role?: string }>('/auth/me', { token })
      .then((me) => {
        if (!cancelled && me?.role) setLiveRole(me.role);
      })
      .catch(() => {
        /* fall back to session role */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const role = liveRole ?? sessionRole;
  const isSuperAdmin = role === 'SUPER_ADMIN';

  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  useEffect(() => {
    if (!token || !isSuperAdmin) return;
    let cancelled = false;
    async function loadPending() {
      try {
        const list = await apiFetch<Array<{ approvalStatus: string; isArchived: boolean }>>('/tournaments', { token });
        if (cancelled) return;
        const pending = list.filter((t) => t.approvalStatus === 'PENDING' && !t.isArchived).length;
        setPendingApprovalCount(pending);
      } catch {
        if (!cancelled) setPendingApprovalCount(0);
      }
    }
    loadPending();
    const id = window.setInterval(loadPending, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token, pathname, isSuperAdmin]);

  const visibleMenuItems = baseMenuItems.filter((item) => !item.superOnly || isSuperAdmin);

  const menuItems = visibleMenuItems.map((item) => {
    if (item.key !== '/admin/approvals') {
      return { key: item.key, icon: item.icon, label: item.label };
    }
    return {
      key: item.key,
      icon: item.icon,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', color: '#ffffff' }}>
          <span>{item.label}</span>
          {pendingApprovalCount > 0 ? (
            <Badge
              count={pendingApprovalCount}
              color="#ff4d4f"
              size="small"
              style={{ marginLeft: 8, boxShadow: 'none' }}
            />
          ) : null}
        </span>
      ),
    };
  });

  const selectedKey = baseMenuItems.find((m) => pathname.startsWith(m.key) && m.key !== '/admin')
    ? baseMenuItems.find((m) => pathname.startsWith(m.key) && m.key !== '/admin')!.key
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

  const brandRow = (collapsedMode = false) => (
    <div
      style={{
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: '#fff',
        fontWeight: 'bold',
        fontSize: collapsedMode ? 12 : 16,
        padding: '0 8px',
      }}
    >
      <Image
        src="/logo.png"
        alt="羽动云赛"
        width={1536}
        height={1024}
        style={{ width: collapsedMode ? 34 : 42, height: collapsedMode ? 24 : 28, objectFit: 'contain' }}
      />
      {!collapsedMode && <span>羽动云赛</span>}
    </div>
  );

  const navMenu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selectedKey]}
      items={menuItems}
      onClick={({ key }) => {
        router.push(String(key));
        setMobileDrawerOpen(false);
      }}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
          {brandRow(collapsed)}
          {navMenu}
        </Sider>
      )}

      {/* Mobile slide-in drawer instead of the persistent Sider */}
      <Drawer
        placement="left"
        width={260}
        open={isMobile && mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        styles={{
          body: { padding: 0, background: '#001529' },
          header: { display: 'none' },
        }}
        rootClassName="admin-mobile-drawer"
      >
        {brandRow(false)}
        {navMenu}
      </Drawer>

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: isMobile ? '0 12px' : '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            boxShadow: '0 1px 4px rgba(0,21,41,.08)',
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined style={{ fontSize: 20 }} />}
                aria-label="打开后台菜单"
                onClick={() => setMobileDrawerOpen(true)}
                style={{ height: 44, width: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              />
            )}
            {isMobile && (
              <Typography.Text strong style={{ fontSize: 15 }}>
                后台
              </Typography.Text>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              icon={<HomeOutlined />}
              onClick={() => router.push('/')}
              style={isMobile ? { height: 40, paddingInline: 10 } : undefined}
            >
              {isMobile ? '' : '返回首页'}
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
              <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 40 }}>
                <Avatar size="small" icon={<UserOutlined />} />
                {!isMobile && <Typography.Text>{session?.user?.name}</Typography.Text>}
              </Button>
            </Dropdown>
          </div>
        </Header>
        <Content
          style={{
            margin: isMobile ? 8 : 24,
            padding: isMobile ? 12 : 24,
            background: '#fff',
            borderRadius: 8,
          }}
        >
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
