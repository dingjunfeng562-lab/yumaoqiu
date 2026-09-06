# 校园羽毛球比赛管理系统

基于 **Next.js + NestJS + Prisma + MySQL/MariaDB** 的校园羽毛球赛事管理系统，覆盖公开门户、后台管理、报名审核、抽签编排、场地排程、裁判记分、图片管理与数据归档等完整流程。

> 完整需求文档见 [docs/PRD.md](docs/PRD.md)

## 当前功能概览

### 公开端

- **首页门户与品牌展示**：赛事轮播、快捷入口、统计数据展示
- **赛事列表**：展示已发布赛事、报名状态、项目与已审核人数
- **邀请码注册**：按邀请码创建管理员 / 裁判 / 普通用户账号
- **登录**：按角色自动跳转到后台、裁判端或门户首页
- **赛事报名**：普通用户登录后可提交个人赛事报名
- **公开选手名单**：查看各赛事已通过审核的参赛选手
- **赛程安排**：展示后台排程后的比赛时间与场地
- **淘汰赛对阵表**：展示公开签表与团体赛对阵
- **通知公告**：展示后台发布的赛事公告
- **历届数据**：查看归档赛事、成绩统计、比赛记录
- **成绩排行页**：为公开成绩沉淀预留展示入口
- **赛事图片**：浏览赛事图片、查看统计信息（浏览量/下载量）

### 管理后台

- **仪表盘**：赛事统计、图片统计、数据概览
- **用户管理**：管理员、裁判、普通用户列表、启停用、重置密码、删除
- **邀请码管理**：生成、启停用、复制、删除邀请码
- **选手管理**：选手信息维护与搜索
- **赛事管理**：赛事创建、发布/撤回发布、基础信息维护
- **单项管理**：配置赛事项目、赛制与计分规则
- **报名审核**：查看报名记录，执行通过、驳回、移除
- **赛事选手页**：按赛事查看已入围选手
- **团体赛管理**：配置团体赛队伍、子项、阵容与对阵数据
- **抽签编排**：生成和维护淘汰赛签表，支持种子、交换签位、冻结/重抽
- **场地排程**：维护场地并自动/手动安排比赛
- **裁判分配**：给场次分配裁判并查看比赛状态
- **公告管理**：维护公开公告内容
- **数据导出**：导出赛事相关 Excel 数据
- **图片管理**：赛事图片上传、分类、管理、统计
- **水印设置**：Logo 水印、文字水印配置（字体、颜色、位置）
- **邮件通知**：赛事邮件配置与发送
- 修改个人密码、退出登录

### 裁判端

- **查看分配给自己的比赛场次**
- **进入实时记分页执裁**
- **比赛开始、记分、撤销、事件记录**
- **实时同步比赛状态**

### 摄影师端

- **图片上传**：批量上传赛事图片
- **图片分类**：选手照、现场照、颁奖照
- **图片管理**：查看已上传图片

### 后端能力

- **认证与授权**：JWT / NextAuth 凭证登录、基于角色的访问控制（ADMIN / REFEREE / PLAYER / SUPER_ADMIN / ROOT）
- **邀请码注册与账号状态控制**
- **赛事报名与审核流转**
- **公开门户数据聚合接口**
- **抽签、排程、记分、公告、导出接口**
- **历届赛事与公开展示接口**
- **图片上传与水印处理**：支持 Logo 水印、文字水印（黑体/宋体/楷体）、自定义颜色与位置
- **图片统计**：浏览量、下载量统计
- **邮件通知**：赛事相关邮件发送

## 项目结构

```text
ayumaoqiu/
├── apps/
│   ├── backend/                    # NestJS 后端 (默认端口 4000)
│   │   ├── assets/fonts/           # 嵌入中文字体（水印渲染用）
│   │   │   ├── NotoSansSC-Bold.otf    # 黑体
│   │   │   ├── NotoSerifSC-Regular.otf # 宋体
│   │   │   └── LXGWWenKai-Regular.ttf  # 楷体（霞鹜文楷）
│   │   ├── prisma/                 # Prisma ORM 配置
│   │   │   ├── schema.prisma          # 数据库模型
│   │   │   ├── seed.ts                # 初始化数据脚本
│   │   │   └── migrations/            # 数据库迁移记录
│   │   ├── src/
│   │   │   ├── auth/               # 认证模块
│   │   │   ├── competitions/        # 赛事报名模块
│   │   │   ├── draws/               # 抽签编排模块
│   │   │   ├── events/              # 单项赛事模块
│   │   │   ├── exports/             # 数据导出模块
│   │   │   ├── mail/                # 邮件通知模块
│   │   │   ├── photos/              # 图片管理与水印模块
│   │   │   ├── players/             # 选手管理模块
│   │   │   ├── scheduling/          # 场地排程模块
│   │   │   ├── scoring/             # 裁判记分模块
│   │   │   ├── tournaments/         # 赛事管理模块
│   │   │   ├── team-competitions/   # 团体赛模块
│   │   │   └── main.ts              # 应用入口
│   │   ├── uploads/                 # 上传文件存储目录
│   │   └── package.json
│   └── frontend/                   # Next.js 前端 (默认端口 3000)
│       ├── app/
│       │   ├── admin/               # 管理后台页面
│       │   ├── bracket/             # 淘汰赛对阵页面
│       │   ├── competitions/        # 赛事公开页面
│       │   ├── photographer/        # 摄影师上传页面
│       │   ├── photos/              # 公开图片浏览页面
│       │   ├── referee/             # 裁判端页面
│       │   ├── live-screen/         # 大屏展示页面
│       │   └── layout.tsx           # 全局布局
│       ├── components/              # 通用组件
│       │   ├── bracket/             # 对阵图组件
│       │   ├── photos/              # 图片画廊组件
│       │   └── screen/              # 大屏组件
│       ├── lib/                     # 工具函数
│       └── package.json
├── docs/
│   └── PRD.md                      # 产品需求文档
├── outputs/                        # 导出文件输出目录
├── package.json                    # Monorepo 根
├── pnpm-workspace.yaml             # pnpm 工作区配置
└── README.md
```

## 环境要求

- **Node.js >= 18**
- **pnpm >= 9**
- **MySQL 8+ 或 MariaDB 10.6+**

## 快速开始

### 开发流程建议

1. 启动数据库并创建 `ayumaoqiu` 数据库。
2. 在 `apps/backend/.env` 中配置 `DATABASE_URL`、JWT 参数。
3. 执行 `pnpm db:push` 和 `pnpm seed` 初始化数据。
4. 分别启动后端与前端，先用默认管理员进入后台。
5. 在后台生成邀请码，再测试普通用户注册、报名、审核、抽签、排程与裁判流程。
6. 在后台配置水印设置，测试图片上传功能。

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

`pnpm seed` 会强制同步默认管理员账号，账号记录如下：

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
- 摄影师 → `/photographer`
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
8. 在“图片管理”中上传赛事图片，配置水印设置。

### 角色体验说明

| 角色 | 入口 | 说明 |
|---|---|---|
| **管理员** | `/admin` | 使用默认管理员或后台新建管理员账号进入 |
| **裁判** | `/referee` | 由管理员创建裁判账号后进入 |
| **摄影师** | `/photographer` | 由管理员创建摄影师账号后进入 |
| **普通用户** | `/` | 使用邀请码注册后，从门户进入赛事报名流程 |

## 水印功能说明

系统支持对上传的赛事图片自动添加水印：

### Logo 水印
- 支持上传多个 Logo（最多 5 个）
- 可调整 Logo 大小（占图片高度的百分比）
- 可调整 Logo 之间的间距
- 支持横图和竖图不同位置设置

### 文字水印
- 支持自定义文字内容（最多 100 字符）
- 支持三种字体：黑体、宋体、楷体
- 支持自定义文字颜色（颜色选择器）
- 支持调整文字大小（占图片高度的百分比）
- 支持独立设置横图和竖图位置
- 文字位置可与 Logo 相同（合并显示）或不同（独立显示）

### 字体文件
项目内嵌三种开源中文字体，确保跨平台一致性：
- **黑体**: Noto Sans SC Bold
- **宋体**: Noto Serif SC Regular
- **楷体**: LXGW WenKai（霞鹜文楷）

## 图片统计功能

- **总浏览量**：所有赛事图片的浏览次数汇总
- **总下载量**：所有赛事图片的下载次数汇总
- **单图片统计**：每张图片的浏览量和下载量
- **赛事统计**：各赛事的图片数、浏览量、下载量

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
| **公开** | `/` | 门户首页 |
| **公开** | `/competitions` | 赛事列表 |
| **公开** | `/competitions/:id/register` | 赛事报名 |
| **公开** | `/competitions/:id/players` | 赛事选手名单 |
| **公开** | `/schedule` | 赛程安排 |
| **公开** | `/bracket` | 淘汰赛对阵表 |
| **公开** | `/notice` | 通知公告 |
| **公开** | `/history` | 历届数据 |
| **公开** | `/photos` | 赛事图片 |
| **公开** | `/signup` | 邀请码注册 |
| **通用** | `/login` | 登录页 |
| **管理员** | `/admin` | 管理后台首页（仪表盘） |
| **管理员** | `/admin/users` | 用户管理 |
| **管理员** | `/admin/invite-codes` | 邀请码管理 |
| **管理员** | `/admin/players` | 选手管理 |
| **管理员** | `/admin/competitions` | 赛事管理 |
| **管理员** | `/admin/competitions/:id/photos` | 图片管理 |
| **管理员** | `/admin/competitions/:id/watermark` | 水印设置 |
| **管理员** | `/admin/events` | 单项管理 |
| **管理员** | `/admin/team-competitions` | 团体赛管理 |
| **管理员** | `/admin/draws` | 抽签编排 |
| **管理员** | `/admin/scheduling` | 场地排程 |
| **管理员** | `/admin/scoring` | 裁判分配 |
| **管理员** | `/admin/announcements` | 公告管理 |
| **管理员** | `/admin/exports` | 数据导出 |
| **管理员** | `/admin/email` | 邮件通知 |
| **裁判** | `/referee` | 裁判场次列表 |
| **裁判** | `/referee/matches/:matchId` | 实时记分 |
| **摄影师** | `/photographer` | 摄影师首页 |
| **摄影师** | `/photographer/upload` | 图片上传 |

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
| POST | `/api/auth/users/photographer` | 创建摄影师 |
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
| POST | `/api/team-competitions/:id/draw` | 生成团体赛对阵 |
| GET | `/api/team-competitions/team-matches/:teamMatchId/lineups` | 获取团体阵容 |
| PUT | `/api/team-competitions/team-matches/:teamMatchId/lineups` | 设置团体阵容 |
| PATCH | `/api/team-competitions/matches/:matchId/referee` | 分配团体赛裁判 |

### 赛事与报名

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/competitions` | 公开赛事列表 |
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

### 图片管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/photos` | 公开图片列表（按赛事） |
| GET | `/api/photos/:id/download` | 下载图片（下载计数+1） |
| POST | `/api/photos` | 摄影师上传图片 |
| GET | `/api/admin/photos` | 后台图片列表 |
| POST | `/api/admin/tournaments/:id/photos` | 管理员上传图片 |
| DELETE | `/api/admin/photos/:id` | 删除图片 |
| DELETE | `/api/admin/tournaments/:id/photos` | 批量删除赛事图片 |
| GET | `/api/admin/tournaments/:id/watermark` | 获取水印配置 |
| PUT | `/api/admin/tournaments/:id/watermark` | 更新水印配置 |
| POST | `/api/admin/tournaments/:id/watermark/logos` | 上传水印 Logo |
| DELETE | `/api/admin/tournaments/:id/watermark/logos` | 删除水印 Logo |

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
| GET | `/api/exports/tournaments/:id/:kind` | 导出赛事数据 |

## 技术栈

| 层 | 选型 |
|---|---|
| **前端** | Next.js 16 (App Router) + TypeScript + Ant Design 6 + Tailwind CSS 4 |
| **后端** | NestJS 11 + TypeScript |
| **数据库** | MySQL / MariaDB |
| **ORM** | Prisma 7 |
| **认证** | NextAuth.js v5 (前端) + Passport-JWT (后端) |
| **实时通信** | Socket.IO |
| **图片处理** | Sharp + @napi-rs/canvas |
| **邮件发送** | Nodemailer |
| **Excel 导出** | ExcelJS |
| **包管理** | pnpm workspaces |

## 项目特性

- **模块化架构**：前后端分离，模块职责清晰
- **角色权限控制**：细粒度的角色访问控制（管理员、超级管理员、裁判、摄影师、普通用户）
- **图片水印系统**：支持 Logo 和文字水印，自定义字体、颜色、位置
- **图片统计**：浏览量、下载量统计
- **实时记分**：WebSocket 实时同步比赛状态
- **邮件通知**：赛事相关邮件自动发送
- **数据导出**：支持 Excel 格式数据导出
- **响应式设计**：支持桌面端和移动端
- **完整测试**：单元测试与集成测试

## 开发规范

- **代码风格**：使用 ESLint + Prettier 进行代码检查和格式化
- **类型安全**：全项目使用 TypeScript，确保类型安全
- **提交规范**：遵循常规提交规范（Conventional Commits）
- **环境变量**：使用 `.env` 文件管理敏感配置，不提交到版本控制

## 部署说明

### 生产环境部署

1. 构建前后端：
   ```bash
   pnpm build:backend
   pnpm build:frontend
   ```

2. 配置生产环境变量：
   - 后端：数据库连接、JWT 密钥、邮件配置
   - 前端：API 地址、NextAuth 配置

3. 启动后端服务：
   ```bash
   cd apps/backend
   pnpm start:prod
   ```

4. 启动前端服务：
   ```bash
   cd apps/frontend
   pnpm start
   ```

### 图片存储

- 图片存储在 `apps/backend/uploads/photos/` 目录下
- 包含原始图片、带水印图片、缩略图三种尺寸
- 建议配合 CDN 或对象存储使用以提升访问性能

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
