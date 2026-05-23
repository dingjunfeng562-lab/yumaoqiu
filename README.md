# 校园羽毛球比赛管理系统

基于 Next.js + NestJS + Prisma + MySQL/MariaDB 的校园羽毛球赛事管理系统，覆盖公开门户、后台管理、报名审核、抽签编排、场地排程、裁判记分与数据归档等完整流程。

> 完整需求文档见 [docs/PRD.md](docs/PRD.md)

## 当前功能概览

### 公开端

- 首页门户与品牌展示
- 赛事列表：展示已发布赛事、报名状态、项目与已审核人数
- 邀请码注册：按邀请码创建管理员 / 裁判 / 普通用户账号
- 登录：按角色自动跳转到后台、裁判端或门户首页
- 赛事报名：普通用户登录后可提交个人赛事报名
- 公开选手名单：查看各赛事已通过审核的参赛选手
- 赛程安排：展示后台排程后的比赛时间与场地
- 淘汰赛对阵表：展示公开签表与团体赛对阵
- 通知公告：展示后台发布的赛事公告
- 历届数据：查看归档赛事、成绩统计、比赛记录
- 成绩排行页：为公开成绩沉淀预留展示入口

### 管理后台

- 用户管理：管理员、裁判、普通用户列表、启停用、重置密码、删除
- 邀请码管理：生成、启停用、复制、删除邀请码
- 选手管理：选手信息维护与搜索
- 赛事管理：赛事创建、发布/撤回发布、基础信息维护
- 单项管理：配置赛事项目、赛制与计分规则
- 报名审核：查看报名记录，执行通过、驳回、移除
- 赛事选手页：按赛事查看已入围选手
- 团体赛管理：配置团体赛队伍、子项、阵容与对阵数据
- 抽签编排：生成和维护淘汰赛签表，支持种子、交换签位、冻结/重抽
- 场地排程：维护场地并自动/手动安排比赛
- 裁判分配：给场次分配裁判并查看比赛状态
- 公告管理：维护公开公告内容
- 数据导出：导出赛事相关 Excel 数据
- 修改个人密码、退出登录

### 裁判端

- 查看分配给自己的比赛场次
- 进入实时记分页执裁
- 比赛开始、记分、撤销、事件记录
- 实时同步比赛状态

### 后端能力

- JWT / NextAuth 凭证登录
- 基于角色的访问控制：ADMIN / REFEREE / PLAYER
- 邀请码注册与账号状态控制
- 赛事报名与审核流转
- 公开门户数据聚合接口
- 抽签、排程、记分、公告、导出接口
- 历届赛事与公开展示接口

## 项目结构

```text
ayumaoqiu/
├── apps/
│   ├── backend/        # NestJS 后端 (默认端口 4000)
│   └── frontend/       # Next.js 前端 (默认端口 3000)
├── docs/
│   └── PRD.md          # 产品需求文档
├── package.json        # Monorepo 根
└── pnpm-workspace.yaml
```

## 环境要求

- Node.js >= 18
- pnpm >= 9
- MySQL 8+ 或 MariaDB 10.6+

## 快速开始

### 开发流程建议

1. 启动数据库并创建 `ayumaoqiu` 数据库。
2. 在 `apps/backend/.env` 中配置 `DATABASE_URL`、JWT 参数。
3. 执行 `pnpm db:push` 和 `pnpm seed` 初始化数据。
4. 分别启动后端与前端，先用默认管理员进入后台。
5. 在后台生成邀请码，再测试普通用户注册、报名、审核、抽签、排程与裁判流程。

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动数据库并创建库

```sql
CREATE DATABASE ayumaoqiu;
```

### 3. 配置后端环境变量

`apps/backend/.env`:

```env
DATABASE_URL="mysql://用户名:密码@localhost:3306/ayumaoqiu"
JWT_SECRET="随机长字符串"
JWT_EXPIRES_IN="7d"
PORT=4000
```

### 4. 初始化数据库

```bash
cd apps/backend
pnpm db:push
pnpm seed
```

`pnpm seed` 会强制同步 1 个默认管理员账号，账号记录如下：

| 字段 | 值 |
|---|---|
| 用户名 | `baishuwan` |
| 邮箱 | `2385362680@qq.com` |
| 密码 | `Baishuwan082508` |
| 角色 | `SUPER_ADMIN` |

> 注意：密码首字母是大写 `B`。

### 5. 启动后端

```bash
cd apps/backend
pnpm dev
# 后端运行在 http://localhost:4000
```

### 6. 配置并启动前端

`apps/frontend/.env.local`:

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=随机长字符串
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

```bash
cd apps/frontend
pnpm dev
# 前端运行在 http://localhost:3000
```

### 7. 登录与体验

打开浏览器访问 <http://localhost:3000>。

#### 默认管理员账号

系统初始化后会同步一个默认管理员用户：

| 字段 | 值 |
|---|---|
| 用户名 | `baishuwan` |
| 邮箱 | `2385362680@qq.com` |
| 密码 | `Baishuwan082508` |
| 角色 | `SUPER_ADMIN` |

#### 登录说明

- 后端登录接口支持 **用户名或邮箱** 作为登录标识。
- 当前前端登录页输入框和校验规则按“邮箱登录”设计，因此浏览器中建议使用：`2385362680@qq.com / Baishuwan082508`
- 如果后续希望前端直接支持用户名登录，需要把登录页的邮箱格式校验改成“用户名或邮箱”模式。

登录后会按角色自动跳转：

- 管理员 → `/admin`
- 裁判 → `/referee`
- 普通用户 → `/`

普通用户注册需先由管理员在后台生成邀请码。

## 常见使用路径

### 本地首次体验

1. 执行 `pnpm seed`，确保默认管理员账号已同步。
2. 启动前后端后访问 `/login`。
3. 使用 `2385362680@qq.com / Baishuwan082508` 登录后台。
4. 在“邀请码管理”中生成普通用户邀请码。
5. 打开 `/signup` 完成普通用户注册。
6. 使用普通用户登录后进入赛事报名页测试报名。
7. 回到后台完成审核、抽签、排程与裁判分配。

### 角色体验说明

- **管理员**：使用默认管理员或后台新建管理员账号进入 `/admin`
- **裁判**：由管理员创建裁判账号后进入 `/referee`
- **普通用户**：使用邀请码注册后，从门户进入赛事报名流程

## 常用命令

```bash
# 根目录
pnpm dev                # 同时启动前后端
pnpm dev:backend        # 仅启动后端
pnpm dev:frontend       # 仅启动前端
pnpm build:backend      # 构建后端
pnpm build:frontend     # 构建前端

# 后端 (apps/backend)
pnpm dev                # 启动后端 (watch 模式)
pnpm db:push            # 推送 schema 变更到数据库
pnpm db:migrate         # 创建并应用迁移
pnpm db:generate        # 重新生成 Prisma Client
pnpm seed               # 强制同步默认管理员账号
pnpm test               # 运行单元测试
pnpm test:e2e           # 运行 e2e 测试

# 前端 (apps/frontend)
pnpm dev                # 启动前端
pnpm build              # 构建前端
pnpm lint               # 运行 ESLint
```

## 主要页面

| 角色 | 路径 | 说明 |
|---|---|---|
| 公开 | `/` | 门户首页 |
| 公开 | `/competitions` | 赛事列表 |
| 公开 | `/competitions/:id/register` | 赛事报名 |
| 公开 | `/competitions/:id/players` | 赛事选手名单 |
| 公开 | `/schedule` | 赛程安排 |
| 公开 | `/bracket` | 淘汰赛对阵表 |
| 公开 | `/notice` | 通知公告 |
| 公开 | `/history` | 历届数据 |
| 公开 | `/signup` | 邀请码注册 |
| 通用 | `/login` | 登录页 |
| 管理员 | `/admin` | 管理后台首页 |
| 管理员 | `/admin/users` | 用户管理 |
| 管理员 | `/admin/invite-codes` | 邀请码管理 |
| 管理员 | `/admin/players` | 选手管理 |
| 管理员 | `/admin/competitions` | 赛事管理 |
| 管理员 | `/admin/events` | 单项管理 |
| 管理员 | `/admin/team-competitions` | 团体赛管理 |
| 管理员 | `/admin/draws` | 抽签编排 |
| 管理员 | `/admin/scheduling` | 场地排程 |
| 管理员 | `/admin/scoring` | 裁判分配 |
| 管理员 | `/admin/announcements` | 公告管理 |
| 管理员 | `/admin/exports` | 数据导出 |
| 裁判 | `/referee` | 裁判场次列表 |
| 裁判 | `/referee/matches/:matchId` | 实时记分 |

## API 概览

所有 API 默认前缀为 `/api`。

### 认证与用户

> 当前后端支持“邮箱或用户名”登录；但前端登录页输入框与校验规则当前按邮箱模式展示。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 使用邀请码注册 |
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/auth/me` | 获取当前用户信息 |
| PATCH | `/api/auth/me/password` | 修改当前用户密码 |
| GET | `/api/auth/users` | 列出用户 |
| POST | `/api/auth/users/admin` | 创建管理员 |
| POST | `/api/auth/users/referee` | 创建裁判 |
| PATCH | `/api/auth/users/:id/status` | 更新用户状态 |
| POST | `/api/auth/users/:id/reset-password` | 重置用户密码 |
| DELETE | `/api/auth/users/:id` | 删除用户 |
| GET/POST | `/api/auth/invite-codes` | 查询/创建邀请码 |
| PATCH/DELETE | `/api/auth/invite-codes/:id` | 更新状态/删除邀请码 |

### 赛事基础管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/players` | 选手管理 |
| GET/POST/PATCH/DELETE | `/api/tournaments` | 赛事管理 |
| PATCH | `/api/tournaments/:id/archive` | 归档赛事 |
| POST | `/api/tournaments/upload-cover` | 上传赛事封面 |
| GET/POST/PATCH/DELETE | `/api/events` | 单项管理 |
| GET/POST/PATCH/DELETE | `/api/announcements` | 公告管理 |
| GET/POST/PATCH/DELETE | `/api/team-competitions` | 团体赛管理 |
| GET/POST | `/api/team-competitions/:id/teams` | 团体队伍管理 |
| POST | `/api/team-competitions/:id/teams/import` | 批量导入队员 |
| POST | `/api/team-competitions/:id/teams/quick-preview` | 预览快速建队 |
| POST | `/api/team-competitions/:id/teams/quick-create` | 快速建队 |
| PATCH | `/api/team-competitions/teams/:teamId` | 更新队伍 |
| PUT | `/api/team-competitions/teams/:teamId/members` | 替换队员名单 |
| DELETE | `/api/team-competitions/teams/:teamId` | 删除队伍 |

### 赛事与报名

| 方法 | 路径 | 说明 |
|---|---|---|| GET | `/api/competitions` | 公开赛事列表 |
| GET | `/api/competitions/:id` | 公开赛事详情 |
| GET | `/api/competitions/:id/players` | 公开赛事选手名单 |
| GET | `/api/competitions/:id/registration/me` | 当前用户报名信息 |
| POST | `/api/competitions/:id/register` | 提交报名 |
| GET | `/api/admin/competitions` | 后台赛事列表 |
| PATCH | `/api/admin/competitions/:id/publish` | 发布赛事 |
| PATCH | `/api/admin/competitions/:id/unpublish` | 取消发布 |
| GET | `/api/admin/competitions/:id/registrations` | 报名审核列表 |
| GET | `/api/admin/competitions/:id/players` | 后台赛事选手列表 |
| PATCH | `/api/admin/competition-registrations/:registrationId/approve` | 通过报名 |
| PATCH | `/api/admin/competition-registrations/:registrationId/reject` | 驳回报名 |
| PATCH | `/api/admin/competition-registrations/:registrationId/remove` | 移除报名 |

### 公共展示

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/public/home` | 首页聚合数据 |
| GET | `/api/public/lobby` | 大厅/门户数据 |
| GET | `/api/public/screen` | 大屏数据 |
| GET | `/api/public/team-competitions` | 团体赛公开数据 |
| GET | `/api/public/announcements` | 公开公告 |
| GET | `/api/public/brackets` | 公开签表 |
| GET | `/api/public/history` | 历届数据 |

### 排程、记分与导出

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/events/:eventId/draw` | 生成签表草稿 |
| POST | `/api/events/:eventId/draw/execute` | 执行抽签 |
| PUT | `/api/events/:eventId/draw/seeds` | 更新种子 |
| POST | `/api/events/:eventId/draw/swap` | 交换签位 |
| POST | `/api/events/:eventId/draw/freeze` | 冻结签表 |
| POST | `/api/events/:eventId/draw/unfreeze` | 解冻签表 |
| POST | `/api/events/:eventId/draw/redraw` | 重抽 |
| GET | `/api/events/:eventId/draw/history` | 查看签表历史 |
| GET | `/api/events/:eventId/draw/logs` | 查看操作日志 |
| GET | `/api/events/:eventId/bracket` | 获取对阵图 |
| GET/POST | `/api/tournaments/:tournamentId/venues` | 查询/创建场地 |
| PATCH/DELETE | `/api/venues/:id` | 修改/删除场地 |
| GET | `/api/scheduling` | 查询赛程 |
| POST | `/api/scheduling/auto` | 自动排程 |
| PATCH | `/api/matches/:id/schedule` | 手动调整赛程 |
| GET | `/api/referee/matches` | 裁判本人场次 |
| GET | `/api/matches/:id/score` | 获取比赛状态 |
| POST | `/api/matches/:id/start` | 开始比赛 |
| POST | `/api/matches/:id/point` | 记分 |
| POST | `/api/matches/:id/undo` | 撤销上一分 |
| POST | `/api/matches/:id/events` | 记录比赛事件 |
| PATCH | `/api/matches/:id/referee` | 分配单项赛裁判 |
| GET/POST/PATCH/DELETE | `/api/team-competitions` | 团体赛管理 |
| GET/POST | `/api/team-competitions/:id/teams` | 团体队伍管理 |
| POST | `/api/team-competitions/:id/teams/import` | 批量导入队员 |
| POST | `/api/team-competitions/:id/teams/quick-preview` | 预览快速建队 |
| POST | `/api/team-competitions/:id/teams/quick-create` | 快速建队 |
| PATCH | `/api/team-competitions/teams/:teamId` | 更新队伍 |
| PUT | `/api/team-competitions/teams/:teamId/members` | 替换队员名单 |
| DELETE | `/api/team-competitions/teams/:teamId` | 删除队伍 |
| POST | `/api/team-competitions/:id/draw` | 生成团体赛对阵 |
| GET | `/api/team-competitions/team-matches/:teamMatchId/lineups` | 获取团体阵容 |
| PUT | `/api/team-competitions/team-matches/:teamMatchId/lineups` | 设置团体阵容 |
| PATCH | `/api/team-competitions/matches/:matchId/referee` | 分配团体赛裁判 |
| GET | `/api/exports/tournaments/:id/:kind` | 导出赛事数据 |

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 16 (App Router) + TypeScript + Ant Design 6 + Tailwind CSS 4 |
| 后端 | NestJS 11 + TypeScript |
| 数据库 | MySQL / MariaDB |
| ORM | Prisma 7 |
| 认证 | NextAuth.js v5 (前端) + Passport-JWT (后端) |
| 实时通信 | Socket.IO |
| 包管理 | pnpm workspaces |
