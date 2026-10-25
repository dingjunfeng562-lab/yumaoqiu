'use client';

export const dynamic = 'force-dynamic';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
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
import type { MenuProps } from 'antd';
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
  MailOutlined,
  MessageOutlined,
  VideoCameraOutlined,
  PictureOutlined,
  ScheduleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { canAccessAdminPage, firstAdminPage } from '@/lib/admin-permissions';
import { useCurrentAccess } from '@/lib/use-current-role';

const { Header, Sider, Content } = Layout;
const MOBILE_QUERY = '(max-width: 1023px)';
const SIDER_DEFAULT_WIDTH = 236;
const SIDER_MIN_WIDTH = 76;
const SIDER_MAX_WIDTH = 340;
const SIDER_COLLAPSE_WIDTH = 120;
const SIDER_SNAP_COLLAPSED = 150;

type NavItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
  section: string;
};

const MENU_SECTIONS = [
  { key: 'overview', label: '总览' },
  { key: 'competition', label: '赛事管理' },
  { key: 'execution', label: '竞赛执行' },
  { key: 'content', label: '内容与传播' },
  { key: 'system', label: '系统与账号' },
] as const;

const baseMenuItems: NavItem[] = [
  { key: '/nicaiyixiahh', section: 'overview', icon: <DashboardOutlined />, label: '仪表板' },
  { key: '/nicaiyixiahh/approvals', section: 'competition', icon: <AuditOutlined />, label: '赛事审核' },
  { key: '/nicaiyixiahh/tournaments', section: 'competition', icon: <TrophyOutlined />, label: '赛事配置' },
  { key: '/nicaiyixiahh/competitions', section: 'competition', icon: <TrophyOutlined />, label: '赛事管理' },
  { key: '/nicaiyixiahh/events', section: 'competition', icon: <UnorderedListOutlined />, label: '单项管理' },
  { key: '/nicaiyixiahh/team-competitions', section: 'competition', icon: <ApartmentOutlined />, label: '团体赛管理' },
  { key: '/nicaiyixiahh/players', section: 'competition', icon: <UserOutlined />, label: '选手管理' },
  { key: '/nicaiyixiahh/draws', section: 'execution', icon: <BranchesOutlined />, label: '抽签编排' },
  { key: '/nicaiyixiahh/scheduling', section: 'execution', icon: <CalendarOutlined />, label: '场地排程' },
  { key: '/nicaiyixiahh/scoring', section: 'execution', icon: <FieldTimeOutlined />, label: '裁判分配' },
  { key: '/nicaiyixiahh/match-management', section: 'execution', icon: <ScheduleOutlined />, label: '裁判员对局管理' },
  { key: '/nicaiyixiahh/exports', section: 'execution', icon: <DownloadOutlined />, label: '秩序册/数据导出' },
  { key: '/nicaiyixiahh/photo-activities', section: 'content', icon: <PictureOutlined />, label: '活动图片' },
  { key: '/nicaiyixiahh/image-moderation', section: 'content', icon: <AuditOutlined />, label: '图片审核' },
  { key: '/nicaiyixiahh/announcements', section: 'content', icon: <NotificationOutlined />, label: '公告管理' },
  { key: '/nicaiyixiahh/broadcasts', section: 'content', icon: <VideoCameraOutlined />, label: '直播管理' },
  { key: '/nicaiyixiahh/users', section: 'system', icon: <TeamOutlined />, label: '用户管理' },
  { key: '/nicaiyixiahh/invite-codes', section: 'system', icon: <KeyOutlined />, label: '邀请码管理' },
  { key: '/nicaiyixiahh/email', section: 'system', icon: <MailOutlined />, label: '邮件通知设置' },
  { key: '/nicaiyixiahh/ai-config', section: 'system', icon: <MessageOutlined />, label: 'AI 助手配置' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [siderWidth, setSiderWidth] = useState(SIDER_DEFAULT_WIDTH);
  const [siderResizing, setSiderResizing] = useState(false);
  const collapsed = siderWidth < SIDER_COLLAPSE_WIDTH;
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [menuNavigation, setMenuNavigation] = useState<{
    key: string;
    fromPathname: string;
  } | null>(null);
  const siderResizeRef = useRef<{ startX: number; moved: boolean } | null>(null);
  const siderClickSuppressed = useRef(false);
  const drawerSwipeRef = useRef<{ startX: number; startY: number } | null>(null);
  const prefetchedRoutesRef = useRef(new Set<string>());
  const [passwordForm] = Form.useForm();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const pendingNavigationKey = menuNavigation?.fromPathname === pathname ? menuNavigation.key : null;
  const isNavigating = Boolean(pendingNavigationKey && pendingNavigationKey !== pathname);

  // Track viewport width to switch between Sider (desktop) and Drawer (mobile)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const apply = () => setIsMobile(mql.matches);
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, []);

  const token = session?.user?.accessToken as string | undefined;
  const access = useCurrentAccess();
  const role = access.role;
  // 功能菜单随个人权限逐项显示。
  const isSuperOrRoot = access.can('TOURNAMENT_ADMIN');
  useEffect(() => {
    if (access.ready && !canAccessAdminPage(role, pathname, access.permissions)) {
      router.replace(pathname === '/nicaiyixiahh' ? firstAdminPage(role, access.permissions) ?? '/forbidden' : '/forbidden');
    }
  }, [access.ready, access.permissions, role, pathname, router]);

  // 客户端跳转异常时最多保留 8 秒高亮；仍未完成则整页跳转兜底。
  useEffect(() => {
    if (!menuNavigation) return;
    const timer = window.setTimeout(() => {
      const pending = menuNavigation.fromPathname === pathname && menuNavigation.key !== pathname;
      setMenuNavigation(null);
      if (pending) {
        message.warning('页面加载较慢，正在重新加载…');
        window.location.assign(menuNavigation.key);
      }
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [menuNavigation, pathname]);

  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  useEffect(() => {
    if (!token || !isSuperOrRoot) return;
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
  }, [token, pathname, isSuperOrRoot]);

  const visibleMenuItems = baseMenuItems.filter(
    (item) => canAccessAdminPage(role, item.key, access.permissions),
  );

  function prefetchRoute(path: string) {
    if (prefetchedRoutesRef.current.has(path)) return;
    prefetchedRoutesRef.current.add(path);
    router.prefetch(path);
  }

  // 空闲时预热当前账号可访问的后台路由，减少首次点击菜单时的等待。
  useEffect(() => {
    if (!access.ready || isMobile) return;
    const timer = window.setTimeout(() => {
      for (const item of baseMenuItems) {
        if (!canAccessAdminPage(role, item.key, access.permissions)) continue;
        if (prefetchedRoutesRef.current.has(item.key)) continue;
        prefetchedRoutesRef.current.add(item.key);
        router.prefetch(item.key);
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [access.permissions, access.ready, isMobile, role, router]);

  const menuItems: MenuProps['items'] = MENU_SECTIONS.flatMap((section) => {
    const items = visibleMenuItems.filter((item) => item.section === section.key);
    if (!items.length) return [];
    return [{
      type: 'group' as const,
      key: `section-${section.key}`,
      label: <span className="admin-nav-section-label">{section.label}</span>,
      children: items.map((item) => ({
        key: item.key,
        icon: pendingNavigationKey === item.key ? <LoadingOutlined spin /> : item.icon,
        title: item.label,
        onMouseEnter: () => prefetchRoute(item.key),
        label: item.key === '/nicaiyixiahh/approvals' ? (
          <span className="admin-nav-approval">
            <span>{item.label}</span>
            {pendingApprovalCount > 0 ? (
              <Badge
                count={pendingApprovalCount}
                color="#ff4d4f"
                size="small"
                style={{ boxShadow: 'none' }}
              />
            ) : null}
          </span>
        ) : item.label,
      })),
    }];
  });

  const selectedKey = baseMenuItems.find((m) => pathname.startsWith(m.key) && m.key !== '/nicaiyixiahh')
    ? baseMenuItems.find((m) => pathname.startsWith(m.key) && m.key !== '/nicaiyixiahh')!.key
    : pathname === '/nicaiyixiahh'
      ? '/nicaiyixiahh'
      : '';
  const displayedSelectedKey =
    menuNavigation?.fromPathname === pathname ? menuNavigation.key : selectedKey;

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

  function startSiderResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    siderResizeRef.current = {
      startX: event.clientX,
      moved: false,
    };
    siderClickSuppressed.current = false;
    setSiderResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveSiderResize(event: React.PointerEvent<HTMLButtonElement>) {
    const start = siderResizeRef.current;
    if (!start) return;
    const deltaX = event.clientX - start.startX;
    if (Math.abs(deltaX) > 3) start.moved = true;
    setSiderWidth(Math.min(SIDER_MAX_WIDTH, Math.max(SIDER_MIN_WIDTH, event.clientX)));
  }

  function endSiderResize(event: React.PointerEvent<HTMLButtonElement>) {
    const start = siderResizeRef.current;
    siderResizeRef.current = null;
    setSiderResizing(false);
    if (!start) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!start.moved) return;

    const width = Math.min(SIDER_MAX_WIDTH, Math.max(SIDER_MIN_WIDTH, event.clientX));
    setSiderWidth(width < SIDER_SNAP_COLLAPSED ? SIDER_MIN_WIDTH : Math.max(180, width));
    siderClickSuppressed.current = true;
    window.setTimeout(() => {
      siderClickSuppressed.current = false;
    }, 350);
  }

  function toggleSiderFromGrip() {
    if (siderClickSuppressed.current) {
      siderClickSuppressed.current = false;
      return;
    }
    setSiderWidth((current) => (current < SIDER_SNAP_COLLAPSED ? SIDER_DEFAULT_WIDTH : SIDER_MIN_WIDTH));
  }

  function startDrawerSwipe(event: React.PointerEvent<HTMLDivElement>) {
    drawerSwipeRef.current = { startX: event.clientX, startY: event.clientY };
  }

  function moveDrawerSwipe(event: React.PointerEvent<HTMLDivElement>) {
    const start = drawerSwipeRef.current;
    if (!start) return;
    const deltaX = event.clientX - start.startX;
    const deltaY = event.clientY - start.startY;
    if (deltaX < -65 && Math.abs(deltaY) < 45) {
      drawerSwipeRef.current = null;
      setMobileDrawerOpen(false);
    }
  }

  function endDrawerSwipe() {
    drawerSwipeRef.current = null;
  }

  const roleLabel = role === 'ROOT' ? '超级管理员' : role === 'ADMIN' ? '管理员' : '后台用户';

  const brandRow = (collapsedMode = false) => (
    <div className={`admin-brand${collapsedMode ? ' is-collapsed' : ''}`}>
      <div className="admin-brand-mark">
        <Image
          src="/logo-mark.png"
          alt="羽动云赛"
          width={256}
          height={256}
          priority
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
      {!collapsedMode ? (
        <div className="admin-brand-copy">
          <span className="admin-brand-title">羽动云赛</span>
          <span className="admin-brand-subtitle">赛事管理后台</span>
        </div>
      ) : null}
    </div>
  );

  const siderFooter = (
    <div className="admin-sider-footer">
      <div className="admin-sider-user">
        <span className="admin-sider-avatar">{(session?.user?.name ?? '管').slice(0, 1)}</span>
        <div className="admin-sider-user-copy">
          <span className="admin-sider-user-name">{session?.user?.name ?? '后台用户'}</span>
          <span className="admin-sider-user-role">{roleLabel}</span>
        </div>
        <span className="admin-sider-online" title="已登录" />
      </div>
      <span className="admin-sider-version">BADMINTON OPS · V1.0</span>
    </div>
  );

  const navMenu = (
    <Menu
      className="admin-nav-menu"
      theme="dark"
      mode="inline"
      inlineCollapsed={!isMobile && collapsed}
      selectedKeys={[displayedSelectedKey]}
      items={menuItems}
      onClick={({ key }) => {
        const targetPath = String(key);
        setMobileDrawerOpen(false);
        if (targetPath === pathname) return;

        // Highlight immediately while Next.js loads the target route.
        setMenuNavigation({ key: targetPath, fromPathname: pathname });
        try {
          router.push(targetPath);
        } catch {
          window.location.assign(targetPath);
        }
      }}
    />
  );

  return (
    <Layout style={{ height: '100vh', minHeight: '100vh', overflow: 'hidden' }}>
      {isNavigating ? <div className="admin-nav-progress" aria-hidden /> : null}
      {!isMobile && (
        <Sider
          className={`admin-navigation-panel${siderResizing ? ' is-resizing' : ''}`}
          theme="dark"
          width={siderWidth}
          style={{
            height: '100vh',
            position: 'sticky',
            top: 0,
            overflow: 'visible',
            flex: '0 0 auto',
            zIndex: 5,
          }}
        >
          <div className="admin-sider-inner">
            {brandRow(collapsed)}
            <div
              className="admin-nav-shell"
              onMouseEnter={() => visibleMenuItems.forEach((item) => prefetchRoute(item.key))}
            >
              <div className="admin-nav-scroll">{navMenu}</div>
              <span className="admin-nav-fade" aria-hidden />
            </div>
            <button
              type="button"
              className="admin-sider-collapse"
              onClick={() => setSiderWidth(collapsed ? SIDER_DEFAULT_WIDTH : SIDER_MIN_WIDTH)}
              aria-label={collapsed ? '展开菜单' : '收起菜单'}
              title={collapsed ? '点击展开；也可按住右侧边缘向右拖动' : '点击收起；也可按住右侧边缘向左拖动'}
              style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              {!collapsed ? <span>收起菜单</span> : null}
            </button>
            {!collapsed ? siderFooter : null}
          </div>
          <button
            type="button"
            className="admin-sider-resize-grip"
            aria-label="拖动调整侧边栏宽度"
            title="按住拖动调整侧边栏宽度；向左拖到底可收起；点击可切换"
            onClick={toggleSiderFromGrip}
            onPointerDown={startSiderResize}
            onPointerMove={moveSiderResize}
            onPointerUp={endSiderResize}
            onPointerCancel={endSiderResize}
          >
            <span className="admin-sider-resize-grip-line" />
          </button>
        </Sider>
      )}

      {/* Mobile slide-in drawer instead of the persistent Sider */}
      <Drawer
        placement="left"
        size={280}
        open={isMobile && mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        styles={{
          body: { padding: 0, background: '#041a44' },
          header: { display: 'none' },
        }}
        rootClassName="admin-mobile-drawer"
      >
        <div
          className="admin-navigation-panel admin-mobile-panel"
          style={{ height: '100%', touchAction: 'pan-y' }}
          onPointerDown={startDrawerSwipe}
          onPointerMove={moveDrawerSwipe}
          onPointerUp={endDrawerSwipe}
          onPointerCancel={endDrawerSwipe}
        >
          <div className="admin-sider-inner">
            {brandRow(false)}
            <div
              className="admin-nav-shell"
              onMouseEnter={() => visibleMenuItems.forEach((item) => prefetchRoute(item.key))}
            >
              <div className="admin-nav-scroll">{navMenu}</div>
              <span className="admin-nav-fade" aria-hidden />
            </div>
            {siderFooter}
          </div>
        </div>
      </Drawer>

      <Layout style={{ height: '100vh', minWidth: 0, overflow: 'hidden' }}>
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
            flex: '0 0 auto',
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
                    key: 'account',
                    icon: <UserOutlined />,
                    label: '账户设置',
                    onClick: () => router.push('/account'),
                  },
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
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          {access.ready && canAccessAdminPage(role, pathname, access.permissions) ? children : null}
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
