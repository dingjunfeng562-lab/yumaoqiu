# 学校 / 社会分组报名入口、报名码与双模板导入方案（v2，已被 v3 取代）

> **最新口径见 [`school-social-registration-plan-v3.md`](school-social-registration-plan-v3.md)。**
> v3 已改为：学校/社会各一个报名码、两组分别配置字段、社会组团体赛也要、导出同步。
> 本文件保留为分组 Event、游客报名、导入预览等细节的参考。

> 本版按已确认的决策重写，替代 v1 中“学校/社会同组比赛”“全部登录”的假设。
> 状态：方案待最终确认，确认后按第 13 节顺序实施。

## 0. 已确认的决策

| 决策 | 结论 |
|---|---|
| 入口登录方式 | **B：学校登录 + 社会免登录游客** |
| 学校/社会关系 | **分组**：学生组、社会组各自独立的单项、抽签、成绩 |
| 报名门槛 | 后台为每个赛事生成**唯一报名码**；两个入口都要填，前台先校验，后端提交时再校验 |
| 学生报名字段 | 管理员创建赛事时配置：学号、学院、年级专业分别“必填/选填/不收集”；导入按同一配置校验 |
| 学生双打搭档学号 | 默认必填；若赛事把“学号”配置为非必填，则搭档学号也随之为非必填 |
| 社会报名审核 | 跟随赛事现有“是否需要审核”开关，默认需要 |
| 学校/社会名额 | 同一人只能在一个组报名；`maxRegistrationEvents` 在组内计算 |

## 1. 方案总览

```text
后台创建赛事
  ├─ 学生组单项（可多选）── 学生组报名码/报名入口 ── 学号/学院/年级专业（按赛事配置）
  ├─ 社会组单项（可多选）── 社会组报名入口 ──────── 单位/俱乐部 + 联系方式（免登录）
  └─ 生成赛事唯一报名码（学校/社会入口共用）

报名人
  └─ 输入报名码 ─→ 前台校验 ─→ 选择“学生组 / 社会组”
        ├─ 学生组：登录 ─→ 填表 ─→ 提交（带报名码）
        └─ 社会组：免登录 ─→ 填表 ─→ 提交（带报名码）─→ 报名编号/查询

后台批量导入
  ├─ 学生模板（9 列）── 表头识别 ─→ 学生组单项 ─→ 按赛事字段配置校验
  └─ 社会模板（6 列）── 表头识别 ─→ 社会组单项 ─→ 按社会规则校验
```

核心原则：

1. **分组用独立 `Event` 行表达**，不新增 `EventType` 枚举值。每个组最多 5 个单项，各自抽签、排程、记分、排名。
2. **报名码是赛事级共享码**，不是每人一码；它解决“只有拿到组委会码的人才能报名”，不承担身份认证。
3. **学校/社会共用报名单和审核队列**，只多 `entrantType` 和学校细分字段。
4. **Excel 识别靠表头指纹**，模板类型决定进入哪个组；项目列只写“男子单打”等，不带组名。

## 2. 现状与本次必须修的问题

| 现状 | 影响 |
|---|---|
| `apps/frontend/app/competitions/[id]/register/page.tsx` 只有一套表单，强制学号/学院班级，且必须登录 | 社会人员无法报名；学校字段无法按赛事配置 |
| `CompetitionRegistration.studentId` 非空 | 学号选填/社会人员没有学号时无法入库 |
| `Event` 没有组别字段，一个赛事同一项目只能有一条 | 无法同时存在“学生组男单”和“社会组男单” |
| `apps/frontend/lib/excel-roster.ts` 固定 `social: true` | 学生模板的学号/学院/年级专业被丢弃，导入后全成社会人员 |
| `batchAddAdminPlayers()` 学生双打强制 `teamName`、`partnerClassName` | 模板没有队伍名称列，导入会报“缺少队伍名称” |
| `toRegistrationView().isSocial` 靠“没有学号”推断 | 学号选填后推断失效 |
| 公开选手页按 5 个 `EventType` 分组 | 两个组同项目会混在一起 |
| 后台选手筛选按 `eventName`（中文项目名） | 分组后同名项目无法区分，需改为 `eventId` |
| 赛事没有报名码 | 任何人拿到赛事链接都能报名 |

## 3. 赛事分组

### 3.1 数据表达

`Event` 增加：

```prisma
enum EntrantType {
  SCHOOL
  SOCIAL
}

model Event {
  // ...现有字段
  entrantType EntrantType @default(SCHOOL)
  groupLabel  String?     @db.VarChar(24)  // "学生组" / "社会组"；旧赛事为 null
  @@unique([tournamentId, entrantType, type])
}
```

- `EventType` 仍只有 5 个值：男单、女单、男双、女双、混双。
- 一个赛事最多 10 条 `Event`：学生组 5 条 + 社会组 5 条。
- 旧赛事的所有 `Event` 默认 `SCHOOL`、`groupLabel = null`，页面显示不变。
- 当赛事启用社会组时，把学生组事件 `groupLabel` 更新为“学生组”，社会组事件为“社会组”；
  只保留一个组时 `groupLabel` 可以为空，显示原项目名。
- 加唯一约束前先检查历史重复：

```sql
SELECT `tournamentId`, `type`, COUNT(*) AS c
FROM `Event`
GROUP BY `tournamentId`, `type`
HAVING c > 1;
```

有重复时先合并/清理再加约束（现有 `syncEvents` 和 `events.service.create` 都做过唯一校验，预计没有）。

### 3.2 创建/编辑赛事

`CreateTournamentDto` / `UpdateTournamentDto`：

```ts
// 旧字段：eventTypes?: EventType[]，兼容为 schoolEventTypes
@IsOptional() @IsArray() @IsEnum(EventType, { each: true })
schoolEventTypes?: EventType[];

@IsOptional() @IsArray() @IsEnum(EventType, { each: true })
socialEventTypes?: EventType[];

@IsBoolean() allowSchoolRegistration: boolean;
@IsBoolean() allowSocialRegistration: boolean;
```

`syncEvents(tx, tournamentId, schoolTypes, socialTypes)`：

- 用 `(entrantType, type)` 作为键，而不是只用 `type`。
- 删除事件前检查 `registrations / competitionRegistrationItems / matches / drawBrackets`，
  有数据时拒绝并提示“学生组男子单打已有报名/抽签/比赛数据”。
- 新建事件时写 `entrantType`、`groupLabel`。
- 启用社会组时，把现有学生组事件的 `groupLabel` 设为“学生组”；
  关闭社会组时，把学生组事件 `groupLabel` 清空。
- 至少保留一个组、至少一个单项。
- 报名通道开关与组别一致性：
  - 没有学生组单项 → `allowSchoolRegistration` 必须为 false；
  - 没有社会组单项 → `allowSocialRegistration` 必须为 false；
  - 至少一个通道为 true。

前台赛事创建表单“包含的单项”拆成两块：

```text
学生组单项：[男单] [女单] [男双] [女双] [混双]
社会组单项：[男单] [女单] [男双] [女双] [混双]
```

`teamEventTypes` 仍然只从学生组单项里选；团体赛暂只支持学生组（见第 14 节假设）。

### 3.3 展示标签

新增后端公共 helper：

```ts
// apps/backend/src/common/event-label.ts
export function eventTypeLabel(type: EventType): string;

export function eventDisplayLabel(event: {
  type: EventType;
  groupLabel?: string | null;
}): string {
  const label = eventTypeLabel(event.type);
  return event.groupLabel ? `${event.groupLabel} · ${label}` : label;
}
```

使用范围：

- `toCompetitionView().eventOptions` 增加 `entrantType`、`groupLabel`、`label`。
- `toCompetitionView().events / projects` 使用 `label`。
- `Registration.eventName` 新建时写 `eventDisplayLabel(event)`；旧数据不改。
- 公开页、导出、赛程、大屏、裁判端：凡是展示 `Event` 的地方使用 `eventDisplayLabel(event)`。
- 团体赛 `TeamCompetitionItem` 没有组别，继续用 `eventTypeLabel(type)`，不要加组名前缀。

需要改的前端位置（按搜索 `EVENT_TYPE_LABELS` / `eventLabel` 逐个替换）：

- `apps/frontend/app/nicaiyixiahh/tournaments/page.tsx`
- `apps/frontend/app/nicaiyixiahh/events/page.tsx`
- `apps/frontend/app/nicaiyixiahh/draws/page.tsx`
- `apps/frontend/app/nicaiyixiahh/scheduling/page.tsx`
- `apps/frontend/app/nicaiyixiahh/scoring/page.tsx`
- `apps/frontend/app/referee/matches/[matchId]/page.tsx`
- 公开赛事详情、赛程、签表、排行、大屏、历届页面

优先使用接口返回的 `event.label`；没有 `label` 时用 `groupLabel + type` 拼接。

### 3.4 对现有功能的影响

| 功能 | 影响 |
|---|---|
| 抽签 | 每个 `Event` 独立，天然分组；只需标签带组名 |
| 排程 | 按 `eventId` 排，无需改逻辑 |
| 记分/裁判 | 按 `eventId` 走，标签带组名 |
| 排名/历届 | 按 `eventId` 聚合，天然分组 |
| 公开选手 | 后端 `groupPlayers` 不能再按 5 个类型分组，改为按 `eventId` 返回/前端按 `eventOptions` 分组 |
| 后台选手筛选 | `eventName` 改为 `eventId`，否则同名项目无法区分 |
| 导出 | 增加“组别”列；项目名用 `eventDisplayLabel` |
| 团体赛 | 不变，仍用学生组单项（见假设） |
| 报名上限 | 一个报名单只属于一个组，`maxRegistrationEvents` 在组内计算 |
| 同一人报两组 | 不允许：账号报名受 `(competitionId,userId)` 唯一约束；游客按学号/姓名+电话跨组查重 |

## 4. 报名码

### 4.1 存储与生成

`Tournament` 增加：

```prisma
registrationCode        String?  @unique @db.VarChar(16)
registrationCodeEnabled Boolean  @default(true)
```

- **一个赛事一个码**，学校/社会两个入口共用；如果后续要严格分通道，再加两列即可。
- 生成时机：创建赛事时自动生成；已有赛事用一次性脚本回填。
- 格式：8 位大写字母+数字，去掉易混淆字符 `0/O/1/I`，例如 `YD7K2M9Q`。
- 前端输入统一 `trim().toUpperCase()`，不区分大小写。
- 后台可“重新生成 / 停用 / 启用”；重新生成后旧码立即失效，页面要二次确认。
- 公开接口只返回赛事公开信息，**不返回报名码本身**。

### 4.2 前台校验流程

1. 报名人打开 `/baoming`（或后台分享的带 `?code=` 的链接）。
2. 输入报名码，失焦/点击“下一步”时调用：

```http
GET /api/competitions/registration-code/:code
```

3. 后端校验：

```ts
const tournament = await prisma.tournament.findFirst({
  where: {
    registrationCode: code.trim().toUpperCase(),
    registrationCodeEnabled: true,
    isPublished: true,
    approvalStatus: 'APPROVED',
    isArchived: false,
  },
  include: { events: true },
});
if (!tournament) throw new NotFoundException('报名码无效或已停用');
```

4. 返回：

```json
{
  "tournamentId": "...",
  "title": "2026 羽动云赛",
  "startDate": "...",
  "endDate": "...",
  "location": "...",
  "registrationStatus": "报名中",
  "registrationStartTime": "...",
  "registrationEndTime": "...",
  "channels": [
    { "entrantType": "SCHOOL", "label": "学生组", "enabled": true, "loginRequired": true },
    { "entrantType": "SOCIAL", "label": "社会组", "enabled": true, "loginRequired": false }
  ],
  "fieldRules": {
    "studentId": true,
    "college": true,
    "majorGrade": false
  }
}
```

5. 前台展示赛事名称、时间、可报名组别，用户选“学生组/社会组”。
6. 提交时请求体必须带 `registrationCode`；后端再次校验，不能只信前台。
7. 错误文案统一为“报名码无效或已停用，请向组委会确认”，不要泄露赛事是否存在。
8. 限流：同一 IP 每分钟最多 20 次校验、每小时 100 次；失败 20 次后提示稍后再试。

### 4.3 提交时的校验

`SubmitCompetitionRegistrationDto` 增加 `registrationCode: string`。
`submitRegistration()` 第一步：

```ts
this.ensureRegistrationCode(competition, dto.registrationCode);
```

校验内容：

- 码与赛事匹配、`registrationCodeEnabled = true`；
- 赛事已发布、审核通过、未归档；
- 报名时间窗开启（沿用 `ensureRegistrationWindow`）；
- `entrantType` 对应的组已开放，且所选项目都属于该组；
- 学校组字段按第 5 节规则校验。

后台批量导入不需要报名码（管理员已登录并具备 `PLAYERS` 权限）。

### 4.4 管理端展示

- 赛事配置保存后，在赛事管理页展示“报名码”卡片：
  - 大号等宽字体显示，复制按钮；
  - “学生组报名链接/二维码”“社会组报名链接/二维码”；
  - 重新生成、停用/启用；
  - 提示“停用或重新生成后，旧码/旧二维码立即失效”。
- 列表接口 `GET /admin/competitions` 增加 `registrationCode`、`registrationCodeEnabled`；
  公开接口 `GET /competitions/:id` 不返回这两个字段。
- 现有赛事回填脚本：`apps/backend/prisma/backfill-registration-codes.ts`
  - 查 `registrationCode = null` 的赛事；
  - 生成唯一码并写入；
  - 部署时执行一次，README 补充说明。

## 5. 学生组报名字段规则

### 5.1 配置项

`Tournament` 增加：

```prisma
requireStudentId Boolean @default(true)
requireCollege   Boolean @default(true)
requireMajorGrade Boolean @default(false)
```

后台“报名设置”增加：

```text
学生组报名字段：
  [x] 学号必填
  [x] 学院必填
  [ ] 年级专业必填
```

- 三个都可以取消；取消后该字段不要求填写（在线表单隐藏，导入允许为空）。
- 学校名称/单位、姓名、性别、联系方式始终必填。
- 社会组没有这些字段，不受影响。

### 5.2 在线表单

- `requireStudentId=false`：不显示学号输入；`studentId = null`。
- `requireCollege=false`：不显示学院；`college = null`。
- `requireMajorGrade=false`：年级专业显示但标注“选填”，或直接隐藏；建议隐藏，减少干扰。
- `className` 仍写 `college + majorGrade` 的拼接值（有哪个拼哪个），导出兼容。
- 双打搭档：
  - 学校组：搭档学号是否必填跟随 `requireStudentId`；搭档学院/年级专业跟随各自开关；
  - 搭档学校默认同本人，不单独要求。

### 5.3 导入

- 前端导入弹窗从赛事对象读取 `fieldRules`，传给解析器。
- 必填校验按规则执行：
  - `requireStudentId=true` 且学号为空 → 第 N 行报错；
  - `false` → 允许为空，`studentId` 存 null；
  - 学院/年级专业同理。
- 双打搭档学号：`requireStudentId=true` 时必填，否则允许为空。
- 防重键：
  - 学号存在 → `studentId + eventId`；
  - 学号为空 → `name + contact + eventId`；
  - 同一文件内混用两种键时，两种都查，避免同一人重复。
- 如果三个学生字段全部为非必填，学生模板可能只剩 6 列，和社会模板无法靠表头区分：
  - 优先看第 1 行标题是否含“学生模板”；
  - 标题也没有时，导入弹窗让管理员选择“按学生组/社会组导入”；
  - 选定后按对应组匹配项目。

### 5.4 防重矩阵

| 组别 | 主键 | 搭档 |
|---|---|---|
| 学校（有学号） | `studentId + eventId` | 搭档学号 + eventId |
| 学校（无学号） | `name + contact + eventId` | 搭档姓名+联系方式 |
| 社会 | `name + contact + eventId` | 搭档姓名+联系方式 |

跨组也查一次：同一赛事同一 `studentId` 或同一 `name+contact` 不能同时出现在学生组和社会组。

## 6. 两个报名入口

### 6.1 路由

| 路由 | 用途 |
|---|---|
| `/baoming` | 报名码输入 + 赛事信息 + 学生组/社会组选择 |
| `/competitions/[id]/register?type=school&code=XXXX` | 学生组直达（需登录） |
| `/competitions/[id]/register?type=social&code=XXXX` | 社会组直达（免登录） |
| `/competitions/[id]/registration-status?token=...` | 游客报名状态查询 |
| 后台赛事管理 | 两个组各自的报名链接 + 二维码 |

- `/baoming` 是主入口；后台分享的二维码可以直接带 `code` 和 `type`。
- `/competitions/[id]/register` 如果没有 `code` 或校验失败，页内显示报名码输入框，不直接放行。
- 只开放一个组时，选择页只显示一个组；两个都未开放时提示“报名暂未开放”。

### 6.2 学校组

- 必须登录；未登录时跳 `/login?callbackUrl=<当前地址>`，登录后回到报名页。
- 只允许有 `REGISTRATION` 权限的用户（现有逻辑）。
- 表单：
  - 姓名、性别（按项目限制）；
  - 学号/学院/年级专业（按赛事配置显示与必填）；
  - 学校；
  - 联系方式；
  - 双打：队伍名称（选填）、搭档姓名/性别/学号/学校/学院/年级专业/联系方式；
  - 项目：只显示 `entrantType=SCHOOL` 的单项。
- 已报名：
  - 待审核：只读，不能重复提交；
  - 已通过：可追加新项目，不能改身份；
  - 已驳回：可修改重提。

### 6.3 社会组（免登录）

- 不需要账号；提交后创建 `userId = null` 的 `CompetitionRegistration`。
- 表单：
  - 姓名、性别；
  - 单位/俱乐部（必填，可填“个人”）；
  - 联系方式（必填）；
  - 双打：搭档姓名/性别/联系方式（必填）；队伍名称选填；
  - 项目：只显示 `entrantType=SOCIAL` 的单项。
- 提交后：
  - 返回 `guestToken`（高熵随机串，只返回一次）；
  - 成功页显示报名编号 + 查询链接；
  - 查询页凭 token 查看状态、项目、驳回原因；
  - 不提供在线修改；需要修改联系组委会。
- 如果社会选手已登录，也可以走登录报名接口，记录 `userId`，在 `/my-registrations` 查看；
  未登录则走 `public-register`。
- 邮件：社会表单可选填邮箱；有邮箱才发通知，没有则跳过；导入的社会人员没有邮箱，不发邮件。

### 6.4 报名单字段对照

| 字段 | 学生组 | 社会组 | 存储 |
|---|---|---|---|
| 姓名 | ✓ | ✓ | `name` |
| 性别 | ✓ | ✓ | `gender` |
| 学号 | 按配置 | — | `studentId` |
| 学校 | ✓ | — | `school`（学校） |
| 单位/俱乐部 | — | ✓ | `school`（单位） |
| 学院 | 按配置 | — | `college` |
| 年级专业 | 按配置 | — | `majorGrade` |
| 联系方式 | ✓ | ✓ | `contact` |
| 队伍名称 | 选填 | 选填 | `teamName` |
| 搭档姓名/性别 | 双打必填 | 双打必填 | `partnerName` / `partnerGender` |
| 搭档学号 | 按配置 | — | `partnerStudentId` |
| 搭档学院/年级专业 | 按配置 | — | `partnerCollege` / `partnerMajorGrade` |
| 搭档联系方式 | 双打必填 | 双打必填 | `partnerContact` |

### 6.5 状态与审核

```text
提交 ─→ PENDING（需要审核） ─→ APPROVED
                        └────→ REJECTED ─→ 修改重提（学生）/ 联系组委会（社会）
提交 ─→ APPROVED（关闭审核）
```

- 学校/社会共用审核队列；审核页按身份筛选。
- 游客记录显示“游客报名”、联系方式，`user` 为空。
- 审核通过时把身份、学院、年级专业、搭档细分字段复制到 `Registration`。

## 7. 数据模型

### 7.1 Prisma 变更汇总

```prisma
enum EntrantType {
  SCHOOL
  SOCIAL
}

model Tournament {
  // ...现有字段
  allowSchoolRegistration  Boolean @default(true)
  allowSocialRegistration  Boolean @default(true)
  requireStudentId         Boolean @default(true)
  requireCollege           Boolean @default(true)
  requireMajorGrade        Boolean @default(false)
  registrationCode         String? @unique @db.VarChar(16)
  registrationCodeEnabled  Boolean @default(true)
}

model Event {
  // ...现有字段
  entrantType EntrantType @default(SCHOOL)
  groupLabel  String?     @db.VarChar(24)
  @@unique([tournamentId, entrantType, type])
}

model CompetitionRegistration {
  // ...现有字段
  entrantType EntrantType @default(SCHOOL)
  studentId   String?                 // 原非空
  college     String?  @db.VarChar(120)
  majorGrade  String?  @db.VarChar(120)

  // 社会免登录
  userId      String?                 // 原非空
  guestToken  String?  @unique @db.VarChar(64)
  guestEmail  String?  @db.VarChar(191)
}

model CompetitionRegistrationEventItem {
  // ...现有字段
  partnerCollege    String? @db.VarChar(120)
  partnerMajorGrade String? @db.VarChar(120)
}

model Registration {
  // ...现有字段
  entrantType       EntrantType @default(SCHOOL)
  college           String?     @db.VarChar(120)
  majorGrade        String?     @db.VarChar(120)
  partnerCollege    String?     @db.VarChar(120)
  partnerMajorGrade String?     @db.VarChar(120)
}
```

### 7.2 迁移与回填

迁移名：`20261029_school_social_groups`

```sql
-- 表名/列名以 prisma migrate 生成的为准（当前为 PascalCase 表名、camelCase 列名）

ALTER TABLE `CompetitionRegistration`
  MODIFY `studentId` VARCHAR(191) NULL,
  MODIFY `userId` VARCHAR(191) NULL,
  ADD COLUMN `entrantType` ENUM('SCHOOL','SOCIAL') NOT NULL DEFAULT 'SCHOOL',
  ADD COLUMN `college` VARCHAR(120) NULL,
  ADD COLUMN `majorGrade` VARCHAR(120) NULL,
  ADD COLUMN `guestToken` VARCHAR(64) NULL,
  ADD COLUMN `guestEmail` VARCHAR(191) NULL;

ALTER TABLE `CompetitionRegistration`
  ADD UNIQUE INDEX `CompetitionRegistration_guestToken_key` (`guestToken`);

ALTER TABLE `CompetitionRegistrationEventItem`
  ADD COLUMN `partnerCollege` VARCHAR(120) NULL,
  ADD COLUMN `partnerMajorGrade` VARCHAR(120) NULL;

ALTER TABLE `Registration`
  ADD COLUMN `entrantType` ENUM('SCHOOL','SOCIAL') NOT NULL DEFAULT 'SCHOOL',
  ADD COLUMN `college` VARCHAR(120) NULL,
  ADD COLUMN `majorGrade` VARCHAR(120) NULL,
  ADD COLUMN `partnerCollege` VARCHAR(120) NULL,
  ADD COLUMN `partnerMajorGrade` VARCHAR(120) NULL;

ALTER TABLE `Event`
  ADD COLUMN `entrantType` ENUM('SCHOOL','SOCIAL') NOT NULL DEFAULT 'SCHOOL',
  ADD COLUMN `groupLabel` VARCHAR(24) NULL;

-- 确认无重复后再加
ALTER TABLE `Event`
  ADD UNIQUE INDEX `Event_tournamentId_entrantType_type_key`
    (`tournamentId`, `entrantType`, `type`);

ALTER TABLE `Tournament`
  ADD COLUMN `allowSchoolRegistration` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `allowSocialRegistration` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `requireStudentId` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `requireCollege` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `requireMajorGrade` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `registrationCode` VARCHAR(16) NULL,
  ADD COLUMN `registrationCodeEnabled` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `Tournament`
  ADD UNIQUE INDEX `Tournament_registrationCode_key` (`registrationCode`);

-- 历史身份回填
UPDATE `CompetitionRegistration` SET `entrantType` = 'SOCIAL'
  WHERE `studentId` IS NULL OR `studentId` = '';
UPDATE `Registration` SET `entrantType` = 'SOCIAL'
  WHERE `studentId` IS NULL OR `studentId` = '';
```

迁移后执行：

```bash
cd apps/backend
pnpm ts-node prisma/backfill-registration-codes.ts
```

脚本为每个 `registrationCode` 为空的赛事生成唯一码。
如果暂时不想让旧赛事强制报名码，可以把 `registrationCodeEnabled` 设为 false；
新赛事默认 true。

### 7.3 不做的模型

- 不建 `SchoolRegistration` / `SocialRegistration` 两张表：抽签、种子、成绩、导出都围绕
  `Registration`/`Event`，拆表会让下游翻倍。
- 不把 `EventType` 扩成 `MENS_SINGLES_SCHOOL` 等 10 个枚举值：会破坏所有按 5 个项目
  处理的计分、团体赛和前端常量；用 `Event.entrantType` 更稳。
- 不新建 `EventGroup` 表：目前只有两个固定组，`entrantType + groupLabel` 足够；
  将来要多组再升级。

## 8. 后端接口

| 接口 | 改动 |
|---|---|
| `GET /competitions/registration-code/:code` | 新增：公开校验报名码，返回赛事/组别/字段规则；必须声明在 `:id` 之前 |
| `GET /competitions/:id` | `eventOptions` 增加 `entrantType`、`groupLabel`、`label`；返回 `fieldRules`、`channels` |
| `POST /competitions/:id/register` | DTO 增加 `registrationCode`、`entrantType`；按组校验项目/字段；返回身份字段 |
| `GET /competitions/:id/registration/me` | 返回 `entrantType`、`college`、`majorGrade`、搭档细分 |
| `POST /competitions/:id/public-register` | 新增：社会游客免登录提交，返回 `guestToken` |
| `GET /competitions/:id/public-registration/:token` | 新增：游客凭 token 查询 |
| `GET /admin/competitions` | 返回 `registrationCode`、`registrationCodeEnabled`、字段规则 |
| `POST /admin/competitions/:id/registration-code/regenerate` | 新增：重新生成报名码 |
| `PATCH /admin/competitions/:id/registration-code` | 新增：启用/停用 |
| `GET /admin/competitions/:id/players` | `eventName` 改为 `eventId`；增加 `entrantType` 筛选 |
| `GET /admin/competitions/:id/registrations` | 增加 `entrantType` 筛选 |
| `POST /admin/competitions/:id/players/batch` | 每条增加 `entrantType`、新字段、`row`；校验事件组别；`teamName` 可选 |
| `PATCH /admin/competitions/:competitionId/players/:registrationId` | 可修改身份/学院/年级专业 |
| `POST /events`、`PATCH /events/:id` | DTO 增加 `entrantType`；唯一校验改为 `(tournamentId, entrantType, type)` |
| `GET /events?tournamentId=` | 返回 `entrantType`、`groupLabel`、`label`，排序按组+项目 |

### 8.1 `submitRegistration()` 关键逻辑

```ts
this.ensureRegistrationCode(competition, dto.registrationCode);

const entrantType = dto.entrantType ?? 'SCHOOL';
this.ensureChannelOpen(competition, entrantType);

const eventIds = dto.items.map((item) => item.eventId);
const events = competition.events.filter((event) => eventIds.includes(event.id));
if (events.some((event) => event.entrantType !== entrantType)) {
  throw new BadRequestException('报名项目与报名组别不一致');
}

if (entrantType === 'SCHOOL') {
  if (competition.requireStudentId && !dto.studentId?.trim()) {
    throw new BadRequestException('请填写学号');
  }
  if (competition.requireCollege && !dto.college?.trim()) {
    throw new BadRequestException('请填写学院');
  }
  if (competition.requireMajorGrade && !dto.majorGrade?.trim()) {
    throw new BadRequestException('请填写年级专业');
  }
}
```

同时修正：

- `@ArrayMaxSize(2)` 改为按赛事 `maxRegistrationEvents` 校验（当前配置最多 5，DTO 写死 2）。
- `studentId` 从必填改为按配置；社会组不传。
- `className` 由服务端按 `college + majorGrade` 生成，不再要求前端传。
- `school` 的 `@MinLength(2)` 改为 `@MinLength(1)`，社会单位可以是一个字。
- 学校防重：有学号按 `studentId`，无学号按 `name + contact`；社会按 `name + contact`；
  跨组也查一次。
- 同一用户已有另一组报名时，提示“你已报名学生组/社会组，不能重复报名另一组”。

### 8.2 游客提交

```ts
async publicRegister(competitionId, dto) {
  if (dto.entrantType !== 'SOCIAL') throw new ForbiddenException('该入口仅支持社会组报名');
  // 校验报名码、时间窗、社会字段、项目、防重
  const guestToken = randomBytes(24).toString('base64url');
  const registration = await prisma.competitionRegistration.create({
    data: { ...data, userId: null, guestToken, guestEmail: dto.guestEmail ?? null },
  });
  return { registration: view, guestToken };
}
```

- 查询接口只按 `guestToken` 查，不按手机号查，避免枚举。
- 限流：同一 IP 每小时最多 5 次提交；同一手机号每天最多 3 次。
- 审核通过/驳回时，`notifyRegistrationEmail` 用 `registration.user?.email ?? registration.guestEmail`，
  两者都为空则跳过。

### 8.3 视图

- `toCompetitionRegistrationView()` 增加：
  `entrantType`、`entrantTypeLabel`、`college`、`majorGrade`、`guest`（`!userId`）。
- `toRegistrationView()` 增加同样字段；`isSocial` 改为 `entrantType === 'SOCIAL'`。
- `toCompetitionView()` 增加 `fieldRules`、`channels`；不返回报名码。
- 公开选手 `groupPlayers` 改为按 `eventId` 分组，返回：
  ```json
  {
    "players": [...],
    "groups": [{ "eventId": "...", "label": "学生组 · 男子单打", "players": [...] }]
  }
  ```
  旧字段 `mensSingles` 等保留一个版本做兼容，前端改用 `eventOptions`/`groups`。

## 9. 批量导入

### 9.1 两个模板

**学生模板（9 列）**

| 列 | 表头 | 映射 |
|---|---|---|
| A | 序号 | `seq` |
| B | 姓名 | `name` |
| C | 性别 | `gender` |
| D | 学号 | `studentId` |
| E | 学院 | `college` |
| F | 年级专业 | `majorGrade` |
| G | 联系方式（电话号码） | `contact` |
| H | 单位（学校/名字） | `school` |
| I | 项目 | `project` |

双打示例合并 **H5:H6（单位列）**。第 1 行标题、第 2 行说明、第 3 行表头、第 4–6 行示例。

**社会模板（6 列）**

| 列 | 表头 | 映射 |
|---|---|---|
| A | 序号 | `seq` |
| B | 姓名 | `name` |
| C | 性别 | `gender` |
| D | 联系方式（电话号码） | `contact` |
| E | 单位（学校/名字） | `school` |
| F | 项目 | `project` |

双打示例合并 **E5:E6（单位列）**。旧模板 `yudongyun-roster-import.xls` 与此一致，
继续识别为社会模板。

### 9.2 文件识别

```ts
function detectTemplate(grid, fieldRules) {
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const columns = mapHeaderRow(grid[r]);
    if (!hasBaseColumns(columns)) continue;

    const studentHits = ['studentId', 'college', 'majorGrade']
      .filter((key) => columns[key] != null);

    if (studentHits.length === 0) {
      return { kind: 'SOCIAL', headerRow: r, columns };
    }
    if (fieldRules.studentId && columns.studentId == null) {
      return { kind: 'SCHOOL', error: '本赛事要求学号，但模板缺少「学号」列' };
    }
    if (fieldRules.college && columns.college == null) {
      return { kind: 'SCHOOL', error: '本赛事要求学院，但模板缺少「学院」列' };
    }
    if (fieldRules.majorGrade && columns.majorGrade == null) {
      return { kind: 'SCHOOL', error: '本赛事要求年级专业，但模板缺少「年级专业」列' };
    }
    return { kind: 'SCHOOL', headerRow: r, columns };
  }
  return null;
}
```

- 表头优先，标题/文件名只做提示。
- 一个文件多个工作表分别识别，允许学生表+社会表混在一个文件。
- 识别到学生模板后，项目只匹配 `entrantType=SCHOOL` 的单项；社会模板匹配 `SOCIAL`。
- 当前赛事没有该组该项目时，报错“本赛事未配置社会组「男子单打」项目”。
- 学生模板缺少非必填字段列时允许，缺失字段留空。
- 三个学生字段都非必填且列都不存在时，按标题“学生模板”识别；标题也没有则让管理员选组。

### 9.3 行校验

1. 跳过标题、说明、`示例/团体示例`、已知示例数据、空行。
2. 基础必填：姓名、性别、联系方式、单位、项目。
3. 学校扩展字段按 `fieldRules`：
   - 学号必填时为空 → 报错；否则允许为空；
   - 学院/年级专业同理。
4. 双打：
   - 只认“单位”列合并区域，必须正好 2 行；
   - 两行项目一致；
   - 学校双打搭档学号在 `requireStudentId=true` 时必填；
   - 搭档学院/年级专业缺失可跟随本人；
   - 未合并/合并超过 2 行报错。
5. 性别-项目校验；项目别名映射。
6. 防重：按第 5.4 节矩阵，文件内 + 数据库内 + 跨组。
7. 每人项目数：按赛事上限，导入不能绕过。
8. 所有错误带 Excel 实际行号。

### 9.4 预览与提交

- 预览顶部显示：
  - 识别结果：`Sheet1：学生模板（学生组）`、`Sheet2：社会模板（社会组）`；
  - 本赛事字段规则：`学号必填 / 学院必填 / 年级专业选填`；
  - 统计：学生组 X 人、社会组 Y 人；单打 M 人、双打 N 对；待修正 K 条。
- 明细表按组显示不同列：
  - 学生组：行、项目、学校、姓名、性别、学号、学院、年级专业、联系方式、状态；
  - 社会组：行、项目、单位、姓名、性别、联系方式、状态。
- 提交策略：按条目部分导入，双打按对整体跳过；确认“导入 X 条，跳过 Y 条”。
- 分组提交：`(eventId, entrantType)` 一组，每 500 条一批。
- 请求体增加 `entrantType`、`college`、`majorGrade`、`partnerCollege`、`partnerMajorGrade`、`row`。
- 后端校验 `event.entrantType` 与请求身份一致；不一致直接报错。

### 9.5 后端批量新增

`normalizeAdminBatchPlayer()`：

```ts
const entrantType = item.entrantType ?? (item.social ? 'SOCIAL' : 'SCHOOL');
const event = competition.events.find((e) => e.id === dto.eventId);
if (!event) throw ...
if (event.entrantType !== entrantType) {
  throw new BadRequestException('报名身份与项目组别不一致');
}

if (entrantType === 'SOCIAL') {
  // 社会规则，不要求 teamName
} else {
  // 学校规则：按 competition.requireStudentId/requireCollege/requireMajorGrade 校验
  // 双打搭档学号跟随 requireStudentId
}
```

- `teamName` 改为可选，为空时展示 `姓名 / 搭档`。
- `partnerSchool` 缺省用本人 `school`；`partnerClassName` 缺省用本人 `className`。
- 错误信息用 `item.row ?? index + 1`。
- 返回 `{ createdCount, schoolCount, socialCount }`。

### 9.6 模板文件

```text
apps/frontend/public/templates/
├── yudongyun-roster-import-school.xls   # 学生模板
├── yudongyun-roster-import-social.xls   # 社会模板
└── yudongyun-roster-import.xls          # 旧模板，保留，等同社会模板
```

导入弹窗两个下载按钮，中文文件名；识别后高亮对应模板。

## 10. 管理端页面

### 10.1 赛事创建/编辑

- 学生组单项、社会组单项两个多选框；至少一个单项。
- 学生组报名字段三个开关。
- 报名通道两个开关（与组别联动）。
- 团体赛单项只从学生组单项里选。
- 保存后生成/保留报名码。

### 10.2 赛事管理/报名码

- 报名码卡片：复制、二维码、重新生成、停用/启用。
- 学生组/社会组两个报名链接 + 二维码。
- 公开页不显示报名码。

### 10.3 单项管理

- 增加“组别”列/筛选。
- 新增单项时选择学生组/社会组。
- 同组同项目唯一；修改组别时如果有报名/抽签/比赛数据，拒绝。

### 10.4 参赛选手

- 身份筛选：全部/学生组/社会组。
- 项目筛选改为 `eventId`（下拉显示“学生组 · 男子单打”）。
- 表格增加身份标签、学院、年级专业；社会组显示单位。
- 手工新增/编辑：身份跟随所选项目，不再用“社会人员”复选框；
  学生组按赛事字段规则显示必填项。
- 从选手库选择：默认社会组；选学生组项目时需补学号/学院。

### 10.5 报名审核

- 身份筛选/统计。
- 游客标签、联系方式。
- 学生组显示学号/学院/年级专业；社会组显示单位。

### 10.6 导出

- 增加“组别”列。
- 项目名用 `eventDisplayLabel`。
- 社会组学号留空，不输出 null。
- 搭档身份/学院/年级专业一并输出。

### 10.7 公开页面

- 赛事详情：两个组别分别展示项目；两个报名按钮（带报名码）。
- 赛事列表：项目名带组别。
- 公开选手：按 `eventId` 分组，显示组别。
- 赛程/签表/排行/大屏/历届：项目名带组别。
- 报名页：先校验报名码，再选组。

## 11. 兼容性

| 场景 | 处理 |
|---|---|
| 旧模板 | 识别为社会模板，正常导入 |
| 旧 `eventTypes` 请求 | 兼容为 `schoolEventTypes` |
| 旧赛事没有报名码 | 回填脚本生成；或 `registrationCodeEnabled=false` 暂不强制 |
| 旧赛事只有学生组 | `Event.entrantType=SCHOOL`、`groupLabel=null`，显示不变 |
| 旧社会报名记录 | `studentId` 为空，回填 `SOCIAL` |
| 旧 `className` | 不拆不改；学院/年级专业留空，显示回退 |
| 旧接口 `social: true` | 继续支持，`entrantType` 优先 |
| 旧前端类型 | `studentId` 改 `string \| null`；接口层 `?? ''` |
| 邮件 | 游客无邮箱跳过，不抛错 |
| 抽签/记分 | 不感知组别，零逻辑改动，只改标签 |
| 团体赛 | 不变，仍只支持学生组 |

## 12. 测试清单

### 解析器（两个真实模板做 fixture）

- 学生模板：单打、双打（H 列合并）、示例跳过、表头第 3 行。
- 社会模板：单打、双打（E 列合并）、示例跳过。
- 同一文件两个 sheet，一学生一社会。
- 列顺序打乱、表头空格/括号。
- 删除学号列 + `requireStudentId=true` → 阻断；`false` → 允许。
- 删除学院列 + `requireCollege=true` → 阻断。
- 三个学生字段都非必填且无列 → 按标题识别/让管理员选组。
- 学生双打搭档缺学号（必填时）→ 报错。
- 双打未合并/合并 3 行 → 报错。
- 文件内重复学号/姓名+电话；跨库重复；跨组重复。
- 超过每人项目上限。
- `.xlsx` 另存版本、数字学号、前导 0。

### 后端

- 报名码：正确/错误/停用/重新生成/未发布/未审核。
- 前台校验接口限流。
- 学校组：登录、字段规则、项目组别、防重、审核。
- 社会组：游客提交、guestToken 查询、审核、驳回、无邮箱不报错。
- 同一用户/同一人跨组重复报名。
- 批量导入：学生/社会、单/双、500 条分批、错误行号、组别不匹配。
- 赛事创建：两组事件唯一、syncEvents 删除保护、groupLabel。
- 公开选手按 eventId 分组。
- 导出组别/项目名。

### 前端手工

- `/baoming` 报名码输入、错误提示、赛事信息。
- 学生组未登录跳转登录并回跳。
- 社会组免登录提交、成功页、token 查询。
- 两个组表单字段差异、字段规则隐藏/必填。
- 导入预览：识别组别、字段规则、错误明细、部分导入。
- 管理端：赛事表单两组、报名码卡片、单项组别、选手/审核筛选、二维码。
- 公开页标签、赛程/签表/排行/大屏。
- 手机端。

## 13. 实施顺序与工期

分组是本次最大改动，建议按下面顺序，避免入口/导入先做又被组别返工：

| 阶段 | 内容 | 预估 |
|---|---|---|
| 1 | Schema + migration + 报名码回填脚本 + Event 分组字段 | 1 天 |
| 2 | 赛事创建/同步事件/单项管理/组别标签（后端 + 管理端） | 2–3 天 |
| 3 | 报名码生成/校验/管理端卡片 + 字段规则 | 1–1.5 天 |
| 4 | 两个入口：`/baoming`、学校表单、社会游客、查询页 | 2–2.5 天 |
| 5 | 双模板识别 + 组别映射 + 字段规则 + 预览/部分导入 | 2–2.5 天 |
| 6 | 公开页/导出/选手/审核的组别展示与筛选 | 1.5–2 天 |
| 7 | 回归、测试、模板文件、README | 1–1.5 天 |

合计约 **11–14 个工作日**（不含团体赛分组）。如果先不做社会游客、只做登录版，
可减 2 天；如果报名码/字段规则也先不做，可再减 3 天，但会与本次确认的目标不符。

建议先做阶段 1–3（数据/分组/报名码/字段规则），这三步完成后，
入口和导入可以并行开发。

## 14. 假设与待确认

已按以下假设设计，若有出入请指出：

1. **每个组各自 5 个单项**，学生组和社会组分别抽签、排程、排名；不混组比赛。
2. **一个赛事一个报名码**，两个入口共用；如果要求学校/社会码严格分开，改为两列
   `schoolRegistrationCode` / `socialRegistrationCode`，前端按入口校验。
3. **同一人只能在一个组报名**；账号受 `(competitionId, userId)` 唯一约束，
   游客按学号/姓名+电话跨组查重。
4. **团体赛暂只支持学生组**；社会组团体赛不在本次范围。
5. **组名固定为“学生组/社会组”**；如需自定义（如“高校组/公开组”），
   把 `groupLabel` 做成赛事配置项即可。
6. **报名码对所有赛事生效**；旧赛事由回填脚本生成，管理员可停用。
7. **社会游客不提供在线修改**；需要修改联系组委会。学生登录用户按现有规则修改/追加。
8. **社会游客可不填邮箱**；不填则不发邮件，仅靠报名编号查询状态。

## 15. 关键文件

- 公开报名页：`apps/frontend/app/competitions/[id]/register/page.tsx`
- 赛事详情：`apps/frontend/app/competitions/[id]/page.tsx`
- 赛事创建/配置：`apps/frontend/app/nicaiyixiahh/tournaments/page.tsx`
- 单项管理：`apps/frontend/app/nicaiyixiahh/events/page.tsx`
- 导入解析：`apps/frontend/lib/excel-roster.ts`
- 导入弹窗：`apps/frontend/components/ExcelRosterImport.tsx`
- 社会快速录入：`apps/frontend/components/SocialPlayerImport.tsx`
- 后台选手：`apps/frontend/app/nicaiyixiahh/competitions/[id]/players/page.tsx`
- 后台审核：`apps/frontend/app/nicaiyixiahh/competitions/[id]/registrations/page.tsx`
- 后端报名：`apps/backend/src/competitions/competitions.service.ts`
- 报名 DTO：`apps/backend/src/competitions/dto/competition-registration.dto.ts`
- 赛事服务：`apps/backend/src/tournaments/tournaments.service.ts`
- 单项服务：`apps/backend/src/events/events.service.ts`
- 数据模型：`apps/backend/prisma/schema.prisma`
- 导出：`apps/backend/src/exports/exports.service.ts`
- 模板目录：`apps/frontend/public/templates/`
