import { JwtService } from '@nestjs/jwt';
import { ServiceUnavailableException } from '@nestjs/common';
import { AuthController } from '../auth/auth.controller';
import {
  MaintenanceMiddleware,
  MAINTENANCE_MESSAGE,
  MAINTENANCE_READONLY_MESSAGE,
} from './maintenance.middleware';
import {
  DEFAULT_MAINTENANCE_TITLE,
  MaintenanceService,
} from './maintenance.service';

type Row = {
  id: string;
  enabled: boolean;
  title: string;
  content: string;
  startedAt: Date | null;
  expectedEndAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date;
};

function fakePrisma(
  initial: Partial<Row> | null,
  users: Record<string, { role: string; status: string }> = {},
) {
  let row: Row | null = initial
    ? {
        id: 'default',
        enabled: false,
        title: DEFAULT_MAINTENANCE_TITLE,
        content: '',
        startedAt: null,
        expectedEndAt: null,
        updatedBy: null,
        updatedAt: new Date(),
        ...initial,
      }
    : null;
  return {
    get row() {
      return row;
    },
    systemMaintenance: {
      findUnique: jest.fn(() => Promise.resolve(row)),
      upsert: jest.fn(
        ({ create, update }: { create: Row; update: Partial<Row> }) => {
          row = row
            ? { ...row, ...update, updatedAt: new Date() }
            : { ...create, updatedAt: new Date() };
          return Promise.resolve(row);
        },
      ),
    },
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(users[where.id] ?? null),
      ),
    },
  };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe('全服维护', () => {
  const jwt = new JwtService({ secret: 'maintenance-spec' });
  const users = {
    root: { role: 'ROOT', status: 'ACTIVE' },
    admin: { role: 'ADMIN', status: 'ACTIVE' },
    demoted: { role: 'PLAYER', status: 'ACTIVE' },
    disabledRoot: { role: 'ROOT', status: 'DISABLED' },
    player: { role: 'PLAYER', status: 'ACTIVE' },
  };
  const bearer = (
    sub: string,
    role: string,
    extra: Record<string, unknown> = {},
  ) => `Bearer ${jwt.sign({ sub, role, ...extra })}`;

  async function run(
    enabled: boolean,
    method: string,
    path: string,
    authorization?: string,
  ) {
    const prisma = fakePrisma({ enabled }, users);
    const middleware = new MaintenanceMiddleware(
      new MaintenanceService(prisma as never),
      jwt,
      prisma as never,
    );
    const res = fakeRes();
    const next = jest.fn<void, unknown[]>();
    await middleware.use(
      { method, path, headers: { authorization } } as never,
      res as never,
      next,
    );
    return {
      passed: next.mock.calls.length === 1 && next.mock.calls[0].length === 0,
      res,
      prisma,
    };
  }

  describe('中间件', () => {
    it('未开启时什么都不拦', async () => {
      expect(
        (await run(false, 'POST', '/api/competitions/x/register')).passed,
      ).toBe(true);
    });

    it('读请求始终放行，也不去查维护状态', async () => {
      const { passed, prisma } = await run(true, 'GET', '/api/public/brackets');
      expect(passed).toBe(true);
      expect(prisma.systemMaintenance.findUnique).not.toHaveBeenCalled();
    });

    it('游客的写请求返回 503 MAINTENANCE，且不让 CDN 缓存', async () => {
      const { passed, res } = await run(
        true,
        'POST',
        '/api/competitions/x/public-register',
      );
      expect(passed).toBe(false);
      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({
        statusCode: 503,
        code: 'MAINTENANCE',
        message: MAINTENANCE_MESSAGE,
      });
      expect(res.headers['Cache-Control']).toBe('no-store');
    });

    it('选手、裁判等账号的写请求同样拦下', async () => {
      const { passed, res } = await run(
        true,
        'PATCH',
        '/api/scoring/matches/m1',
        bearer('player', 'PLAYER'),
      );
      expect(passed).toBe(false);
      expect((res.body as { code: string }).code).toBe('MAINTENANCE');
    });

    it('管理员只能看，写请求返回 MAINTENANCE_READONLY', async () => {
      const { passed, res } = await run(
        true,
        'POST',
        '/api/draws/e1/generate',
        bearer('admin', 'ADMIN'),
      );
      expect(passed).toBe(false);
      expect(res.body).toEqual({
        statusCode: 503,
        code: 'MAINTENANCE_READONLY',
        message: MAINTENANCE_READONLY_MESSAGE,
      });
    });

    it('超级管理员照常操作', async () => {
      expect(
        (
          await run(
            true,
            'DELETE',
            '/api/tournaments/t1',
            bearer('root', 'ROOT'),
          )
        ).passed,
      ).toBe(true);
      expect(
        (
          await run(
            true,
            'PUT',
            '/api/admin/maintenance',
            bearer('root', 'ROOT'),
          )
        ).passed,
      ).toBe(true);
    });

    it('令牌里写着超级管理员、库里已降级或停用的，按库里为准', async () => {
      expect(
        (await run(true, 'POST', '/api/x', bearer('demoted', 'ROOT'))).passed,
      ).toBe(false);
      expect(
        (await run(true, 'POST', '/api/x', bearer('disabledRoot', 'ROOT')))
          .passed,
      ).toBe(false);
    });

    it('伪造签名或拿续期令牌当访问令牌都不算超级管理员', async () => {
      const forged = `Bearer ${new JwtService({ secret: 'other' }).sign({ sub: 'root', role: 'ROOT' })}`;
      expect((await run(true, 'POST', '/api/x', forged)).passed).toBe(false);
      expect(
        (
          await run(
            true,
            'POST',
            '/api/x',
            bearer('root', 'ROOT', { tokenType: 'refresh' }),
          )
        ).passed,
      ).toBe(false);
    });

    it('登录、续期登录态始终可用', async () => {
      for (const path of [
        '/api/auth/login',
        '/api/v1/auth/login',
        '/api/auth/refresh',
        '/api/v1/auth/refresh',
      ]) {
        expect((await run(true, 'POST', path)).passed).toBe(true);
      }
      expect((await run(true, 'POST', '/api/auth/register')).passed).toBe(
        false,
      );
    });
  });

  describe('服务', () => {
    it('表里没有记录时按未开启处理，前台拿不到草稿内容', async () => {
      const service = new MaintenanceService(fakePrisma(null) as never);
      const status = await service.getPublicStatus();
      expect(status.enabled).toBe(false);
      expect(status).not.toHaveProperty('content');
      expect(typeof status.serverTime).toBe('string');
    });

    it('开启时记录开始时间，维护中再次保存不重置；关闭后保留', async () => {
      const prisma = fakePrisma(null);
      const service = new MaintenanceService(prisma as never);
      const opened = await service.update(
        {
          enabled: true,
          title: '  ',
          expectedEndAt: '2026-11-04T02:00:00.000Z',
        },
        'root',
      );
      expect(opened.enabled).toBe(true);
      expect(opened.title).toBe(DEFAULT_MAINTENANCE_TITLE);
      expect(opened.startedAt).not.toBeNull();
      expect(opened.expectedEndAt).toBe('2026-11-04T02:00:00.000Z');

      const resaved = await service.update(
        { content: '<p>升级中</p>' },
        'root',
      );
      expect(resaved.startedAt).toBe(opened.startedAt);
      expect(resaved.expectedEndAt).toBe(opened.expectedEndAt);

      const cleared = await service.update({ expectedEndAt: null }, 'root');
      expect(cleared.expectedEndAt).toBeNull();

      const closed = await service.update({ enabled: false }, 'root');
      expect(closed.enabled).toBe(false);
      expect(closed.startedAt).toBe(opened.startedAt);
      expect((await service.getPublicStatus()).enabled).toBe(false);
    });

    it('保存内容时过滤脚本和事件属性，保留文字和图片', async () => {
      const service = new MaintenanceService(fakePrisma(null) as never);
      const saved = await service.update({
        enabled: true,
        content:
          '<p onclick="x()">升级<script>alert(1)</script></p><img src="/api/uploads/maintenance/a.webp" onerror="x()">',
      });
      expect(saved.content).toBe(
        '<p>升级</p><img src="/api/uploads/maintenance/a.webp">',
      );
      const status = await service.getPublicStatus();
      expect(status).toMatchObject({ enabled: true, content: saved.content });
    });

    it('开关变化立即生效，不等缓存过期', async () => {
      const prisma = fakePrisma({ enabled: false });
      const service = new MaintenanceService(prisma as never);
      expect((await service.getState()).enabled).toBe(false);
      await service.update({ enabled: true });
      expect((await service.getState()).enabled).toBe(true);
    });

    it('保存前发出、保存后才返回的旧读库结果不会把开关改回去', async () => {
      const prisma = fakePrisma({ enabled: false });
      const service = new MaintenanceService(prisma as never);
      let release!: () => void;
      prisma.systemMaintenance.findUnique.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ...prisma.row!, enabled: false });
          }),
      );
      const stale = service.getState();
      await service.update({ enabled: true });
      release();
      expect((await stale).enabled).toBe(false);
      expect((await service.getState()).enabled).toBe(true);
    });

    it('读库失败时沿用上次状态，从未读到过就按未开启处理', async () => {
      const prisma = fakePrisma({ enabled: true });
      const service = new MaintenanceService(prisma as never);
      expect((await service.getState()).enabled).toBe(true);
      prisma.systemMaintenance.findUnique.mockRejectedValueOnce(
        new Error('db down'),
      );
      expect((await service.getAdminConfig()).enabled).toBe(true);

      const fresh = new MaintenanceService({
        systemMaintenance: {
          findUnique: jest.fn().mockRejectedValue(new Error('db down')),
        },
      } as never);
      expect((await fresh.getState()).enabled).toBe(false);
    });
  });

  describe('登录', () => {
    function controller(role: string, enabled: boolean) {
      const authService = {
        login: jest.fn(() =>
          Promise.resolve({ access_token: 't', user: { role } }),
        ),
      };
      const maintenance = {
        getState: jest.fn(() => Promise.resolve({ enabled })),
      };
      return new AuthController(authService as never, maintenance as never);
    }

    it('维护期间选手、裁判、图片员不能登录', async () => {
      for (const role of ['PLAYER', 'REFEREE', 'PHOTOGRAPHER']) {
        await expect(
          controller(role, true).login({} as never),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
      }
    });

    it('维护期间管理员和超级管理员可以登录；未维护时所有人照常登录', async () => {
      await expect(
        controller('ADMIN', true).login({} as never),
      ).resolves.toMatchObject({ access_token: 't' });
      await expect(
        controller('ROOT', true).login({} as never),
      ).resolves.toMatchObject({ access_token: 't' });
      await expect(
        controller('PLAYER', false).login({} as never),
      ).resolves.toMatchObject({ access_token: 't' });
    });
  });
});
