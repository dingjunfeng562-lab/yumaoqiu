# 校园羽毛球比赛管理系统

基于 Next.js + NestJS + Prisma + MySQL/MariaDB 的校园羽毛球赛事管理系统。覆盖赛事创建与审核、报名、抽签编排、场地排程、裁判扫码执裁、实时记分、赛事图片（水印/审核/分享）、邮件通知、秩序册导出与历届归档等完整流程。

完整需求见 [docs/PRD.md](docs/PRD.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 16 (App Router)、React 19、TypeScript、Ant Design 6、Tailwind CSS 4 |
| 后端 | NestJS 11、TypeScript |
| 数据库 | MySQL 8+ / MariaDB 10.6+，Prisma 7（MariaDB adapter） |
| 认证 | NextAuth.js v5（前端）+ Passport-JWT（后端），支持 Refresh Token |
| 实时通信 | Socket.IO |
| 图片处理 | Sharp、@napi-rs/canvas（内嵌中文字体渲染文字水印） |
| 邮件 | Nodemailer（阿里云邮件推送 SMTP 465 SSL） |
| 导出 | ExcelJS |
| 包管理 | pnpm workspaces |

## 角色

| 角色 | 入口 | 说明 |
|---|---|---|
| ROOT | `/admin` | 最高权限：赛事审核、图片审核配置、全部管理功能 |
| SUPER_ADMIN | `/admin` | 总管理员：AI 助手配置、邮件设置、用户管理等 |
| ADMIN | `/admin` | 赛事管理员：创建和运营赛事（新建赛事需经审核） |
| REFEREE | `/referee` | 裁判：扫码/授权码进入赛事，按场地领取比赛并记分 |
| PHOTOGRAPHER | `/photographer/upload` | 摄影师：上传赛事图片 |
| PLAYER | `/` | 普通用户：邀请码注册，报名赛事、查看个人报名 |

登录后按角色自动跳转；无权限访问会进入 `/forbidden`。

## 功能概览

### 公开门户

- 首页：赛事轮播、快捷入口、统计数据、赛事图片瀑布流、弹窗公告
- 赛事列表与详情、公开选手名单、赛事签表
- 赛事报名（登录后）与"我的报名"
- 赛程安排、淘汰赛对阵表、成绩排行、历届数据
- 通知公告、赛事图片浏览与下载，支持通过分享链接（访问令牌）查看指定赛事图片
- 现场大屏 `/live-screen`
- AI 赛事助手（流式对话）
- 邀请码注册、登录（邮箱或用户名）、账户设置

### 管理后台

- 仪表板：赛事、图片与使用量统计
- 用户管理：创建各角色账号、启停用、改名、改角色、重置密码、批量删除
- 邀请码管理
- 赛事审核：ROOT 审批/驳回管理员新建的赛事
- 赛事配置与赛事管理：基础信息、封面、发布/撤回、归档/恢复、报名审核、入围选手（支持批量添加）
- 单项管理：项目、赛制与计分规则
- 团体赛管理：队伍（导入/快速建队）、子项、阵容、对阵生成
- 抽签编排：种子、交换签位、冻结/解冻、发布、重抽及重抽申请审批、操作日志、第二阶段（小组出线后排位）
- 场地排程：场地维护，自动/手动排程，一键清空
- 裁判分配：分配裁判、生成赛事裁判授权码/二维码
- 公告管理：富文本公告、上下线、首页弹窗
- 秩序册/数据导出：Excel 导出、出场顺序表
- 图片管理：上传、分类、删除、操作日志、原图下载，水印配置
- 图片审核：上传图片自动内容审核（ROOT 配置审核 API Key）
- AI 助手配置：模型提供方、模型、API 地址、系统提示词等
- 邮件通知设置：全局开关、模板编辑与预览、单项赛事提醒、发送日志
### 裁判端

- 通过扫描赛事二维码（`/referee/scan`）或授权链接（`/referee/authorize/:accessCode`）获得赛事执裁权限
- 按赛事 → 场地查看比赛并领取场次，"我的比赛"查看已领取/已分配场次
- 实时记分：开始、得分、撤销、暂停/恢复、交换场区、结束
- 特殊情况：弃权（单方/双方）、退赛、违例、红黄牌、事件记录
- 比分通过 WebSocket 实时同步到大屏与公开页面

### 摄影师端

- 选择赛事批量上传图片，分类为选手照、现场照、颁奖照
- 上传后自动生成水印图与缩略图，原图仅后台鉴权访问

## 项目结构

```text
ayumaoqiu/
├── apps/
│   ├── backend/                 # NestJS 后端（默认端口 4000，全局前缀 /api）
│   │   ├── assets/fonts/        # 水印用中文字体：黑体/宋体/楷体
│   │   ├── prisma/              # schema.prisma、migrations、seed.ts
│   │   ├── src/
│   │   │   ├── auth/            # 登录注册、JWT、角色、用户与邀请码
│   │   │   ├── tournaments/     # 赛事配置与审核
│   │   │   ├── competitions/    # 赛事发布、报名与审核
│   │   │   ├── events/          # 单项
│   │   │   ├── players/         # 选手
│   │   │   ├── team-competitions/ # 团体赛
│   │   │   ├── draws/           # 抽签、签表、第二阶段
│   │   │   ├── scheduling/      # 场地与排程
│   │   │   ├── scoring/         # 裁判授权与实时记分（WebSocket）
│   │   │   ├── announcements/   # 公告
│   │   │   ├── photos/          # 图片上传、水印、统计
│   │   │   ├── image-moderation/ # 图片内容审核
│   │   │   ├── mail/            # 邮件通知
│   │   │   ├── exports/         # Excel 导出
│   │   │   ├── ai-chat/         # AI 助手对话
│   │   │   ├── ai-config/       # AI 助手配置
│   │   │   ├── usage-metrics/   # 使用量统计
│   │   │   ├── public/          # 门户聚合接口
│   │   │   └── uploads/         # 静态文件（封面/图片）读取
│   │   ├── uploads/             # 上传文件存储
│   │   └── nginx-photos.conf.example # 生产环境图片静态发布参考配置
│   └── frontend/                # Next.js 前端（默认端口 3000）
│       ├── app/                 # 页面路由（admin / referee / photographer / 公开页）
│       ├── components/          # 组件（admin、auth、bracket、home、photos、referee、screen 等）
│       ├── lib/                 # API 封装与工具函数
│       ├── auth.ts              # NextAuth 配置
│       └── proxy.ts             # 路由鉴权
├── docs/PRD.md                  # 产品需求文档
├── package.json                 # Monorepo 根脚本
└── pnpm-workspace.yaml
```

## 快速开始

环境要求：Node.js >= 18、pnpm >= 9、MySQL 8+ 或 MariaDB 10.6+。

### 1. 安装依赖

```bash
pnpm install
```

### 2. 创建数据库

```sql
CREATE DATABASE ayumaoqiu DEFAULT CHARACTER SET utf8mb4;
```
### 3. 配置环境变量

`apps/backend/.env`：

```env
DATABASE_URL="mysql://用户名:密码@localhost:3306/ayumaoqiu"
JWT_SECRET="随机长字符串"
JWT_EXPIRES_IN="7d"
PORT=4000
FRONTEND_URL=http://localhost:3000
# CORS_ORIGIN=http://localhost:3000     # 可选，逗号分隔多个来源，默认取 FRONTEND_URL
# WATERMARK_FONT_FAMILY=                # 可选，覆盖文字水印默认字体

# 邮件（可选，不配置则邮件功能自动禁用）
MAIL_HOST=SMTP服务器地址
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USER=发信地址
MAIL_PASS=SMTP密码
MAIL_FROM_NAME=发件人名称
```

`apps/frontend/.env.local`：

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=随机长字符串
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

AI 助手与图片审核的 API Key 不走环境变量，登录后台后分别在"AI 助手配置"和"图片审核"页面填写。

### 4. 初始化数据库

```bash
cd apps/backend
pnpm db:push        # 或 pnpm db:migrate 使用迁移
pnpm seed
```

`pnpm seed` 会强制同步默认账号（角色 ROOT），并清理旧的 `admin` 测试账号：

| 字段 | 值 |
|---|---|
| 用户名 | `baishuwan` |
| 邮箱 | `2385362680@qq.com` |
| 密码 | `Baishuwan082508` |

部署到公网前请务必修改该密码。

### 5. 启动

```bash
# 根目录，同时启动前后端
pnpm dev
```

前端 <http://localhost:3000>，后端 <http://localhost:4000/api>（健康检查 `/api/health`）。

### 6. 体验主流程

1. 用默认账号登录 `/login`（支持邮箱或用户名）。
2. 在"邀请码管理"生成邀请码，到 `/signup` 注册普通用户。
3. 在"赛事配置"创建赛事（管理员创建的需 ROOT 在"赛事审核"通过），在"单项管理"配置项目后发布。
4. 普通用户报名，后台在赛事管理中审核报名。
5. 抽签编排 → 场地排程 → 裁判分配，生成裁判授权二维码。
6. 裁判账号扫码进入赛事，按场地领取比赛并记分，大屏 `/live-screen` 实时同步。
7. 在图片管理中配置水印并上传图片，或由摄影师账号上传。

## 常用命令

```bash
# 根目录
pnpm dev                # 同时启动前后端
pnpm dev:backend        # 仅启动后端
pnpm dev:frontend       # 仅启动前端
pnpm build:backend
pnpm build:frontend

# apps/backend
pnpm dev                # watch 模式
pnpm db:push            # 同步 schema 到数据库
pnpm db:migrate         # 创建并应用迁移
pnpm db:generate        # 生成 Prisma Client
pnpm seed               # 同步默认账号
pnpm lint
pnpm test
pnpm test:e2e

# apps/frontend
pnpm dev
pnpm build
pnpm start
pnpm lint
```
## 主要页面

| 分类 | 路径 |
|---|---|
| 公开 | `/` 首页、`/competitions` 赛事列表、`/competitions/:id` 详情、`/competitions/:id/players` 选手、`/competitions/:id/brackets` 签表 |
| 公开 | `/schedule` 赛程、`/bracket` 对阵、`/ranking` 排行、`/history` 历届、`/notice` 公告、`/photos` 图片、`/photos/:accessToken` 分享图片、`/live-screen` 大屏 |
| 账号 | `/login`、`/signup`、`/account`、`/my-registrations`、`/competitions/:id/register` |
| 管理 | `/admin`、`/admin/users`、`/admin/invite-codes`、`/admin/approvals`、`/admin/tournaments`、`/admin/competitions`、`/admin/events`、`/admin/players`、`/admin/team-competitions` |
| 管理 | `/admin/draws`、`/admin/scheduling`、`/admin/scoring`、`/admin/announcements`、`/admin/exports`、`/admin/email`、`/admin/ai-config`、`/admin/image-moderation` |
| 管理（按赛事） | `/admin/competitions/:id/registrations`、`/players`、`/photos`、`/watermark` |
| 裁判 | `/referee`、`/referee/scan`、`/referee/authorize/:accessCode`、`/referee/my-matches`、`/referee/tournaments/:tournamentId`、`.../courts/:venueId`、`/referee/matches/:matchId` |
| 摄影师 | `/photographer/upload` |

## API 概览

所有接口前缀为 `/api`，需要登录的接口使用 `Authorization: Bearer <JWT>`。下表按模块列出路由前缀，具体参数见各模块 controller。

| 模块 | 路由 | 说明 |
|---|---|---|
| 认证 | `/auth/*`（兼容 `/v1/auth/*`） | 注册、登录、刷新 Token、用户名/邮箱/邀请码校验、个人信息 |
| 用户与邀请码 | `/auth/users/*`、`/auth/invite-codes/*` | 创建各角色账号、状态/角色/密码管理、邀请码 |
| 赛事配置 | `/tournaments/*` | CRUD、封面上传、审核（approve/reject）、归档/恢复 |
| 赛事发布与报名 | `/competitions/*`、`/admin/competitions/*`、`/admin/competition-registrations/*` | 公开列表、报名、我的报名；发布、审核、选手管理、图片分享链接 |
| 单项/选手 | `/events/*`、`/players/*` | CRUD |
| 团体赛 | `/team-competitions/*` | 队伍、导入、快速建队、对阵、阵容、裁判 |
| 抽签 | `/events/:eventId/draw/*`、`/draw/redraw-requests/*`、`/events/:eventId/second-stage/*` | 草稿/执行、种子、交换、冻结、发布、重抽及审批、日志、第二阶段 |
| 排程 | `/tournaments/:id/venues`、`/venues/:id`、`/scheduling/*`、`/matches/:id/schedule` | 场地、自动/手动排程、清空 |
| 裁判与记分 | `/referee/*`、`/matches/:id/*`、`/tournaments/:id/referee-access-code` | 授权码、领取场次、记分、撤销、暂停、弃权、退赛、违例、红黄牌 |
| 公告 | `/admin/announcements/*`、`/announcements/active` | 后台管理、前台展示 |
| 图片 | `/photos/*`、`/photographer/*`、`/admin/photos/*`、`/admin/tournaments/:id/watermark` | 浏览/下载计数、分享访问、上传、原图、水印、操作日志 |
| 图片审核 | `/admin/image-moderation` | 审核配置与测试（ROOT） |
| 邮件 | `/admin/email/*` | SMTP 状态、全局设置、模板、赛事提醒、日志 |
| 导出 | `/exports/*` | 赛事 Excel 导出、出场顺序表 |
| AI | `/ai-chat/*`、`/admin/ai-config/*` | 对话（含流式）、配置、连通性测试、模型列表 |
| 门户 | `/public/*` | home、lobby、screen、brackets、history、ranking、公告弹窗等聚合数据 |
| 统计 | `/usage-metrics/summary` | 使用量概览 |
| 静态文件 | `/uploads/covers/*`、`/uploads/photos/*` | 封面与图片 |

## 图片与水印

- 每张图片保存原图、带水印图、缩略图三份，存储在 `apps/backend/uploads/photos/{tournamentId}/`。
- 原图不对外公开，只能通过后台鉴权接口下载。
- Logo 水印：最多 5 个 Logo，可调大小、间距，横图/竖图分别设置位置。
- 文字水印：最多 100 字符，支持黑体（Noto Sans SC）、宋体（Noto Serif SC）、楷体（霞鹜文楷），可调颜色、大小、位置。
- 统计每张图片及每个赛事的浏览量、下载量。
- 开启图片审核后，上传图片会先经过内容审核。

## 部署

```bash
pnpm install
pnpm build:backend
pnpm build:frontend

cd apps/backend && pnpm start:prod     # 后端
cd apps/frontend && pnpm start         # 前端
```

- 生产环境需配置正式的 `JWT_SECRET`、`NEXTAUTH_SECRET`、`FRONTEND_URL`/`CORS_ORIGIN`、`NEXT_PUBLIC_API_URL`。
- 建议用 Nginx 直接发布带水印的公开图片与封面，减轻 Node 负载，参考 [apps/backend/nginx-photos.conf.example](apps/backend/nginx-photos.conf.example)。
- `.env` 文件包含密钥，不要提交到版本库。

## 许可证

MIT
