# 学校/社会分组报名、双报名码、双模板导入与团体赛方案（v3）

> 本版是最终口径。v2 中“一个赛事一个报名码”“团体赛只做学生组”作废；
> 其余未提到的细节（分组 Event、游客报名、导入预览等）沿用
> [`school-social-registration-plan.md`](school-social-registration-plan.md)。

## 0. 最终决策

| 决策 | 结论 |
|---|---|
| 学校/社会关系 | **分组**：各自独立的单项、团体赛、抽签、成绩 |
| 报名字段 | **两组分别配置**：学生组配置学号/学院/年级专业；社会组配置邮箱；核心字段始终必填 |
| 报名码 | **学校组、社会组各一个码**，各自独立生成/停用/重新生成 |
| 学校入口 | 必须登录 |
| 社会入口 | 免登录游客；可选填邮箱 |
| 同一人报两组 | 不允许 |
| 学生双打搭档学号 | 跟随学生组“学号”字段配置：必填则搭档必填 |
| 团体赛 | **学生组、社会组都要**，各自独立队伍/对阵/排名 |
| 导出 | 报名表、秩序册、成绩册、团体赛导出全部增加组别/新字段；支持按组导出和回导模板 |

## 1. 范围

本次包含：

1. `Event` 分组（学生组/社会组各最多 5 个单项）。
2. 两个报名码和两个报名入口。
3. 两组独立的报名字段配置。
4. 学校登录报名、社会免登录游客报名。
5. 学生/社会双模板 Excel 导入，按表头识别、按组映射、按字段配置校验。
6. **学生组/社会组两套团体赛**。
7. 所有 Excel 导出同步组别与新字段。

## 2. 数据模型增量（相对 v2）

### 2.1 赛事

```prisma
model Tournament {
  // v2 已有：
  // allowSchoolRegistration / allowSocialRegistration
  // requireStudentId / requireCollege / requireMajorGrade  -> 由下面的 JSON 取代

  schoolRegistrationCode String? @unique @db.VarChar(16)
  socialRegistrationCode String? @unique @db.VarChar(16)
  registrationCodeEnabled Boolean @default(true)

  /// 两组报名字段规则；为空时用默认值
  registrationFieldRules Json?
}
```

`registrationFieldRules` 结构：

```ts
type FieldState = 'required' | 'optional' | 'hidden';

type RegistrationFieldRules = {
  SCHOOL: {
    studentId: FieldState;
    college: FieldState;
    majorGrade: FieldState;
  };
  SOCIAL: {
    email: FieldState;
  };
};
```

默认值：

```json
{
  "SCHOOL": {
    "studentId": "required",
    "college": "required",
    "majorGrade": "optional"
  },
  "SOCIAL": {
    "email": "optional"
  }
}
```

说明：

- 姓名、性别、学校/单位、联系方式、项目始终必填，不放进配置。
- `hidden`：表单不显示、导入允许缺失、入库为空。
- `optional`：表单显示但非必填、导入允许为空。
- `required`：表单必填、导入必填。
- 队伍名称始终选填，不放进配置。
- 社会组邮箱只用于通知，导入模板没有邮箱列，导入时为空。

### 2.2 团体赛

```prisma
model TeamCompetition {
  // ...现有字段
  entrantType EntrantType @default(SCHOOL)
  @@unique([tournamentId, entrantType])
}
```

- 一个赛事最多两条团体赛：学生组、社会组。
- 旧团体赛默认 `SCHOOL`，行为不变。
- 学生组团体赛继续由赛事创建表单的“团体赛”配置维护；
  社会组团体赛在“团体赛管理”页新建，选择“社会组”。
- `syncTeamCompetition()` 只处理 `entrantType = SCHOOL`，不会覆盖社会组。
- 团体赛下的 `Team / TeamMember / TeamMatch / TeamGroup / TeamLineup` 都挂在
  `teamCompetitionId` 上，天然按组隔离，不需要额外加组别字段。

### 2.3 沿用 v2 的字段

以下仍按 v2：

- `Event.entrantType`、`Event.groupLabel`、`@@unique([tournamentId, entrantType, type])`
- `CompetitionRegistration.entrantType / studentId? / college / majorGrade / userId? / guestToken / guestEmail`
- `CompetitionRegistrationEventItem.partnerCollege / partnerMajorGrade`
- `Registration.entrantType / college / majorGrade / partnerCollege / partnerMajorGrade`

## 3. 双报名码

### 3.1 生成

- 创建赛事时：
  - 如果配置了学生组单项 → 生成 `schoolRegistrationCode`；
  - 如果配置了社会组单项 → 生成 `socialRegistrationCode`。
- 格式：8 位大写字母+数字，去掉 `0/O/1/I`，例如 `YD7K2M9Q`。
- 两码分别唯一；前端输入统一去空格、转大写。
- 已有赛事由脚本 `apps/backend/prisma/backfill-registration-codes.ts` 回填：
  - 学生组码：有学生组单项的赛事生成；
  - 社会组码：只给已有社会组单项的赛事生成；
  - 没有对应组单项的码留空，该入口不可用。
- 停用某个组：把对应码置空，或提供 `schoolCodeEnabled/socialCodeEnabled`；
  建议直接提供两个启用开关，避免丢失码值。
  - 最终采用：`schoolRegistrationCodeEnabled`、`socialRegistrationCodeEnabled` 两个布尔，
    默认 true；码本身保留，停用后不能报名。

### 3.2 校验

公开接口：

```http
GET /api/competitions/registration-code/:code
```

后端：

```ts
const normalized = code.trim().toUpperCase();
const tournament = await prisma.tournament.findFirst({
  where: {
    registrationCodeEnabled: true,
    isPublished: true,
    approvalStatus: 'APPROVED',
    isArchived: false,
    OR: [
      { schoolRegistrationCode: normalized, schoolRegistrationCodeEnabled: true },
      { socialRegistrationCode: normalized, socialRegistrationCodeEnabled: true },
    ],
  },
  include: { events: true },
});
if (!tournament) throw new NotFoundException('报名码无效或已停用');

const entrantType =
  tournament.schoolRegistrationCode === normalized ? 'SCHOOL' : 'SOCIAL';
```

返回：

```json
{
  "tournamentId": "...",
  "title": "2026 羽动云赛",
  "startDate": "...",
  "endDate": "...",
  "location": "...",
  "registrationStatus": "报名中",
  "entrantType": "SOCIAL",
  "entrantTypeLabel": "社会组",
  "loginRequired": false,
  "fieldRules": {
    "studentId": "required",
    "college": "required",
    "majorGrade": "optional",
    "email": "optional"
  }
}
```

- 报名码本身决定组别，前台不再让用户选“学生组/社会组”；
  拿到学校码只能进学校表单，拿到社会码只能进社会表单。
- 提交时请求体带 `registrationCode` 和 `entrantType`；后端校验码与组别一致。
- 错误文案统一“报名码无效或已停用，请向组委会确认”。
- 限流：同 IP 每分钟 20 次校验、每小时 100 次；失败 20 次后提示稍后再试。

### 3.3 提交校验

```ts
const expected =
  dto.entrantType === 'SCHOOL'
    ? competition.schoolRegistrationCode
    : competition.socialRegistrationCode;

const enabled =
  dto.entrantType === 'SCHOOL'
    ? competition.schoolRegistrationCodeEnabled
    : competition.socialRegistrationCodeEnabled;

if (!expected || !enabled || normalize(dto.registrationCode) !== expected) {
  throw new ForbiddenException('报名码无效或已停用，请向组委会确认');
}
```

- 所选项目必须全部属于 `dto.entrantType` 对应的组。
- 后台批量导入不需要报名码。

### 3.4 管理端

- 赛事管理页“报名码”卡片分两块：

```text
学生组报名码：YD7K2M9Q  [复制] [二维码] [重新生成] [启用/停用]
社会组报名码：YD9F4N2X  [复制] [二维码] [重新生成] [启用/停用]
```

- 二维码内容：
  - 学生：`{FRONTEND_URL}/competitions/{id}/register?type=school&code={schoolCode}`
  - 社会：`{FRONTEND_URL}/competitions/{id}/register?type=social&code={socialCode}`
- 重新生成只影响对应组；二次确认提示旧码/旧二维码立即失效。
- 公开接口不返回两个码。

## 4. 两组字段配置

### 4.1 后台

赛事创建/编辑页“报名设置”增加两张卡片：

```text
学生组报名字段
  学号：      [必填 ▼]  （必填 / 选填 / 不收集）
  学院：      [必填 ▼]
  年级专业：  [选填 ▼]

社会组报名字段
  邮箱：      [选填 ▼]  （选填 / 不收集）
```

- 保存时写入 `registrationFieldRules`；缺失的键用默认值补齐。
- 已经有人报名后修改字段配置：
  - 把必填改成选填/不收集：允许；
  - 把选填/不收集改成必填：只影响新报名，历史数据不回溯；
  - 保存时提示“只影响之后的报名/导入，已提交数据不重新校验”。

### 4.2 在线表单

- `required`：显示并必填（红星）。
- `optional`：显示但标注“选填”。
- `hidden`：不显示，提交时置空。
- 学生组：
  - `studentId` 隐藏时不显示学号；提交 `studentId = null`；
  - `college` / `majorGrade` 同理；
  - `className` 由服务端按 `college + majorGrade` 生成（有哪个拼哪个）。
- 社会组：
  - 邮箱 `optional` 时显示“选填邮箱，用于接收审核结果”；
  - `hidden` 时不显示；提交为空。
- 双打：
  - 学校组搭档学号跟随 `SCHOOL.studentId`；
  - 搭档学院/年级专业跟随各自配置；
  - 搭档学校默认同本人。
- 前端从报名码校验接口拿到的 `fieldRules` 渲染；不要在前端写死。

### 4.3 导入

- 前端导入弹窗从赛事对象读取 `registrationFieldRules`，传给解析器。
- 学生模板：
  - `studentId=required` 且为空 → 第 N 行报错；
  - `optional/hidden` 且为空 → 允许；
  - 学院/年级专业同理；
  - 字段列不存在时：`required` 报错“本赛事要求学号，但模板缺少学号列”；
    `optional/hidden` 允许。
- 社会模板：
  - 没有学号/学院/年级专业/邮箱列，按社会固定字段校验；
  - 邮箱导入为空，不影响审核。
- 双打搭档学号：`SCHOOL.studentId=required` 时必填，否则允许为空。
- 防重：
  - 有学号 → `studentId + eventId`；
  - 无学号 → `name + contact + eventId`；
  - 社会 → `name + contact + eventId`；
  - 同一文件内两种键都查；跨组也查。
- 三个学生字段全部 `hidden` 时，学生模板可能退化成 6 列：
  - 先看标题“学生模板”；
  - 标题也没有时，导入弹窗让管理员选择“按学生组/社会组导入”。

## 5. 两个入口

### 5.1 流程

```text
扫码/打开 /baoming
  └─ 输入报名码
       ├─ 学校码 → 登录（未登录跳登录）→ 学生组表单 → 提交
       └─ 社会码 → 游客表单 → 提交 → 报名编号 + 查询链接
```

- `/baoming` 只有一个输入框；码决定组别。
- 也可直接打开带 `code` 的链接：
  - `/competitions/[id]/register?type=school&code=SCHOOLCODE`
  - `/competitions/[id]/register?type=social&code=SOCIALCODE`
- 页面加载先校验码；码无效/停用显示错误，不显示表单。
- 学校组未登录：`/login?callbackUrl=<当前地址>`，登录后回跳。
- 社会组提交成功返回 `guestToken`，只显示一次；查询页
  `/competitions/[id]/registration-status?token=...`。
- 社会组如果已登录，也可走登录报名接口，记录 `userId`，在 `/my-registrations` 查看；
  未登录走 `public-register`。

### 5.2 表单字段

| 字段 | 学校组 | 社会组 | 说明 |
|---|---|---|---|
| 姓名 | ✓ | ✓ | 始终必填 |
| 性别 | ✓ | ✓ | 始终必填，按项目限制 |
| 学号 | 按配置 | — | 学生组 |
| 学校 | ✓ | — | 学生组 |
| 学院 | 按配置 | — | 学生组 |
| 年级专业 | 按配置 | — | 学生组 |
| 单位/俱乐部 | — | ✓ | 社会组，可填“个人” |
| 联系方式 | ✓ | ✓ | 两组必填 |
| 邮箱 | — | 按配置 | 社会组，仅通知 |
| 队伍名称 | 选填 | 选填 | 双打 |
| 搭档姓名/性别 | 双打必填 | 双打必填 | |
| 搭档学号 | 按配置 | — | 学校双打 |
| 搭档学院/年级专业 | 按配置 | — | 学校双打 |
| 搭档联系方式 | 双打必填 | 双打必填 | |

### 5.3 审核

- 共用审核队列，按组筛选。
- 游客显示“社会组 · 游客报名”、联系方式，`user` 为空。
- 审核通过复制身份/学院/年级专业/搭档字段到 `Registration`。
- 游客无邮箱时跳过邮件，不报错。

## 6. 批量导入

模板、表头识别、双打合并、预览/部分导入沿用 v2，增加：

1. 识别结果直接决定组别：学生模板 → 学生组，社会模板 → 社会组。
2. 项目匹配按 `(entrantType, type)`：
   - 学生模板只找学生组单项；
   - 社会模板只找社会组单项；
   - 找不到时提示“本赛事未配置社会组「男子单打」项目”。
3. 校验按 `registrationFieldRules` 对应组执行。
4. 预览顶部显示：
   - 工作表识别结果和组别；
   - 本赛事该组字段规则；
   - 学生/社会人数、单打/双打、待修正条数。
5. 提交分组：`(eventId, entrantType)`，每 500 条一批。
6. 后端校验 `event.entrantType` 与请求身份一致。
7. 旧模板 `yudongyun-roster-import.xls` 继续识别为社会模板。
8. 模板文件：
   - `yudongyun-roster-import-school.xls`
   - `yudongyun-roster-import-social.xls`
   - 旧文件保留。

## 7. 社会组团体赛

### 7.1 数据与创建

- `TeamCompetition.entrantType`，唯一 `(tournamentId, entrantType)`。
- 创建入口：
  - 学生组：赛事创建表单里的“团体赛”配置（现有逻辑，`syncTeamCompetition` 只管 SCHOOL）；
  - 社会组：`/nicaiyixiahh/team-competitions` 页“创建团体赛”，选择赛事 + 组别 + 项目/赛制。
- `POST /team-competitions` DTO 增加 `entrantType`；同赛事同组只能一条。
- 默认名称：`学生组团体赛` / `社会组团体赛`，管理员可改。
- 团体赛项目（`TeamCompetitionItem.eventType`）仍用 5 个 `EventType`；
  社会组团体赛的项目必须属于社会组单项配置范围（如果赛事配置了社会组单项）。

### 7.2 队伍与名单

- 队伍、队员、出场名单、对阵、小组、排名全部按 `teamCompetitionId` 隔离。
- 队员必须来自对应组的报名选手：
  - `GET /team-competitions/:id/available-players` 增加组别过滤：
    学生组只返回 `Registration.entrantType=SCHOOL` 的选手；
    社会组只返回 `SOCIAL`。
  - 同一球员不能同时出现在学生组和社会组的队伍里（跨组校验）。
- 队伍导入/快速建队沿用现有格式；组别由所属团体赛决定。
- 社会组队伍的 `affiliation` 用单位/俱乐部；学生组用学校。

### 7.3 管理与公开

- 团体赛列表增加“组别”列/筛选；创建弹窗增加组别。
- 团体赛详情页显示“社会组”标签。
- 公开团体赛页/大屏/导出按组展示，避免同名队伍混淆。
- 学生组团体赛仍由赛事创建表单管理；社会组团体赛不会因为保存赛事表单被删除。

### 7.4 导出

- 团体赛秩序册/成绩册增加“组别”列。
- 按组导出：`?entrantType=SOCIAL` 只导出社会组。
- 同一赛事两组都有时，默认导出全部，组别列区分。

## 8. 文件导出同步

### 8.1 报名表/选手导出

新增列：

- 组别（学生组/社会组）
- 学号（未收集时留空）
- 学院
- 年级专业
- 学校/单位
- 联系方式
- 项目（带组别标签）
- 搭档姓名/性别/学号/学院/年级专业/联系方式

支持：

- 按组筛选导出（学生组/社会组/全部）。
- 按项目筛选导出（`eventId`）。
- 导出列顺序与导入模板一致，支持“导出 → 修改 → 再导入”：
  - 学生组导出 9 列：序号、姓名、性别、学号、学院、年级专业、联系方式、单位、项目；
  - 社会组导出 6 列：序号、姓名、性别、联系方式、单位、项目。
- 双打按两行导出，单位列合并（ExcelJS 支持合并单元格）；如果实现合并成本高，
  先按两行导出、单位重复，导入时用“相邻同单位”兼容开关（v2 的严格合并可保留）。

### 8.2 秩序册/成绩册

- 项目名统一用 `eventDisplayLabel(event)`：`学生组 · 男子单打`。
- 团体赛项目名加组别；团体赛队伍/成绩按组区分。
- 大屏/公开页同步标签。

### 8.3 后端与前端

- `exports.service.ts`：
  - `ExportRegistration` 增加 `entrantType/college/majorGrade/partnerCollege/partnerMajorGrade`；
  - 查询 include 这些字段；
  - 导出函数接受 `entrantType`、`eventId` 过滤；
  - 团体赛导出读取 `teamCompetition.entrantType`。
- `orderbook-workbook.ts`：项目名用组别标签。
- `apps/frontend/app/nicaiyixiahh/exports/page.tsx`：增加组别筛选、按组导出按钮。
- 公开页/后台列表的项目标签统一走 `event.label`。

## 9. 迁移与兼容

### 9.1 迁移增量

在 v2 迁移基础上：

```sql
ALTER TABLE `Tournament`
  DROP COLUMN `requireStudentId`,
  DROP COLUMN `requireCollege`,
  DROP COLUMN `requireMajorGrade`,
  ADD COLUMN `schoolRegistrationCode` VARCHAR(16) NULL,
  ADD COLUMN `socialRegistrationCode` VARCHAR(16) NULL,
  ADD COLUMN `schoolRegistrationCodeEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `socialRegistrationCodeEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `registrationFieldRules` JSON NULL;

ALTER TABLE `Tournament`
  ADD UNIQUE INDEX `Tournament_schoolRegistrationCode_key` (`schoolRegistrationCode`),
  ADD UNIQUE INDEX `Tournament_socialRegistrationCode_key` (`socialRegistrationCode`);

ALTER TABLE `TeamCompetition`
  ADD COLUMN `entrantType` ENUM('SCHOOL','SOCIAL') NOT NULL DEFAULT 'SCHOOL';

-- 确认无重复后加
ALTER TABLE `TeamCompetition`
  ADD UNIQUE INDEX `TeamCompetition_tournamentId_entrantType_key`
    (`tournamentId`, `entrantType`);
```

注意：v2 的 `requireStudentId` 等字段如果已经建了，可以保留并作为默认值来源，
不必 DROP；以实际迁移状态为准。推荐直接用 JSON，避免两套配置并存。

### 9.2 回填

- 学生组报名码：所有赛事生成。
- 社会组报名码：有社会组单项的赛事生成；没有的留空。
- `registrationFieldRules`：为空时服务端用默认值，不强制回填。
- 旧团体赛：默认 `SCHOOL`。
- 旧 `Event`：默认 `SCHOOL`、`groupLabel = null`。
- 旧社会报名记录：`entrantType = SOCIAL`。
- 旧 `className`：不拆分、不改写。

### 9.3 兼容

| 场景 | 处理 |
|---|---|
| 旧模板 | 识别为社会模板 |
| 旧 `eventTypes` 请求 | 兼容为 `schoolEventTypes` |
| 旧赛事无报名码 | 回填脚本生成；管理员可停用 |
| 旧赛事只有学生组 | 显示不变 |
| 旧团体赛 | 默认学生组 |
| 旧接口 `social: true` | 继续支持 |
| 旧前端类型 | `studentId` 改可空 |
| 游客无邮箱 | 跳过邮件 |

## 10. 实施顺序与工期

| 阶段 | 内容 | 预估 |
|---|---|---|
| 1 | Schema + 迁移 + 分组 Event + 双报名码 + 字段配置 JSON | 4–5 天 |
| 2 | 赛事创建/单项/团体赛（学生组）/标签/筛选 | 3–4 天 |
| 3 | 两个入口：`/baoming`、学校表单、社会游客、查询 | 2–3 天 |
| 4 | 双模板识别 + 组别映射 + 字段规则 + 预览/导入 | 2–3 天 |
| 5 | 导出同步（报名表/秩序册/成绩册/回导模板） | 1–2 天 |
| 6 | 社会组团体赛（模型/管理/公开/导出） | 4–5 天 |
| 7 | 回归、测试、模板、README | 2 天 |

合计约 **18–24 个工作日**。如果社会组团体赛延后，前 5 阶段约 **12–17 天** 可先上线
个人报名和导入；团体赛作为第二阶段。

建议顺序：1 → 2 → 3 → 4 → 5 → 6 → 7。其中 3 和 4 可以在 2 之后并行。

## 11. 假设

1. 学生组、社会组各最多 5 个单项；团体赛两组各一条。
2. 社会组团体赛使用与学生组相同的赛制/项目结构，只是组别不同。
3. 一个赛事一个学生组码、一个社会组码；码只用于报名入口，不用于身份认证。
4. 同一人只能报一个组；团队赛也跨组查重。
5. 社会组邮箱只用于通知，导入模板不含邮箱。
6. 团体赛队员来自对应组的报名选手；跨组球员不允许。
7. 字段配置只覆盖学号/学院/年级专业（学生组）和邮箱（社会组）；核心字段始终必填。
8. 导出“回导模板”先保证列顺序一致；双打合并单元格如实现成本高，可先用相邻同单位兼容。
