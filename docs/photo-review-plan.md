# 活动图片审核门禁方案（v3 定稿）

> 状态：定稿待实施 ｜ 2026-11-20
> 决策已确认：
> 1. 门禁同时覆盖 **活动 + 赛事**（「活动图片」模块里的两类对象）。
> 2. 管理端「图片管理」页：未通过审核时**只读预览**（能看照片和原图），**一切操作禁用**（上传、删除、批量、清空、二维码、水印）。
> 3. 已生成的二维码在对象变为待审时**立即失效**（移除"存量二维码始终可用"的例外）。
> 4. 文案统一为「**等待上级管理员同意**」。

## 1. 现状：门禁是"半开"的

审核状态只在部分入口生效：

| 功能 | 现状 | 是否符合"同意前不能用" |
|---|---|---|
| 生成上传授权二维码（首次） | 已拦（`createActivityUploadAccess` / `createTournamentUploadAccess` 要求 `APPROVED`） | ✅ |
| 已生成过上传二维码的再次查看 | **放行**（"存量兼容"分支直接返回旧 token） | ❌ |
| 管理端图片管理：列表 / 上传 / 删除 / 清空 | 不校验审核状态 | ❌ |
| 管理端原图预览 | 不校验 | ✅（只读预览本来就允许） |
| 管理端 Logo / 水印设置 | 不校验 | ❌ |
| 管理端访问二维码（已有 token） | 生成拦、**查看放行**（`createPhotoAccess` / `getOrCreatePhotoAccess` 存量例外） | ❌ |
| 摄影师扫码授权 / 上传 | 已拦（`getPhotoUploadAccess`、`assertPhotoUploadAuthorized` 要求 `APPROVED`） | ✅ |
| 公开相册（活动） | 已拦（`findGalleryByAccessToken`、`getPublicThumb/View/Download` 要求 `APPROVED`） | ✅ |
| 公开相册（赛事） | **未校验审核状态**（`findGalleryByAccessToken` 只按 token 找赛事；三个公开接口的赛事分支也没有 approval 条件） | ❌ |

## 2. 规则（定稿）

- 对象（活动 / 赛事）`approvalStatus === APPROVED` 才能使用任何图片功能。
- `PENDING` → 文案 **「等待上级管理员同意」**
- `REJECTED` → **「审核未通过」** + 驳回原因
- 管理端图片管理页：**只读预览**（照片列表 + 原图），其余操作全部禁用。
- 已生成的访问二维码 / 上传授权二维码：对象非 `APPROVED` 时立即失效。
- 前端禁用 + 后端硬拦，直接调接口同样不可用。

## 3. 文案清单（精确字符串）

| 场景 | 文案 |
|---|---|
| 列表状态标签（PENDING） | 等待上级管理员同意 |
| 列表状态筛选项（PENDING） | 等待上级管理员同意 |
| 按钮悬浮提示 | 等待上级管理员同意后才能使用 |
| 图片管理页顶部提示（PENDING） | 等待上级管理员同意 |
| 图片管理页说明 | 该{赛事/活动}图片需超级管理员同意后才能使用，同意前只能查看，上传、删除、水印和二维码均不可用。 |
| 图片管理页提示（REJECTED） | 审核未通过：{原因} |
| 后端错误（PENDING） | 该{赛事/活动}图片正在等待上级管理员同意，相关图片功能暂不可用 |
| 后端错误（REJECTED） | 该{赛事/活动}图片审核未通过：{原因} |

## 4. 后端改动

### 4.1 统一门禁 helper（`photos.service.ts`）

```ts
/** 赛事 / 活动图片的所有写操作与对外访问都要求对象已通过 ROOT 审核。 */
async assertImageTargetUsable(target: { type: 'TOURNAMENT' | 'ACTIVITY'; id: string }) {
  const row = target.type === 'TOURNAMENT'
    ? await this.prisma.tournament.findUnique({ where: { id: target.id }, select: { approvalStatus: true } })
    : await this.prisma.photoActivity.findUnique({ where: { id: target.id }, select: { approvalStatus: true, rejectReason: true } });
  if (!row) throw new NotFoundException(target.type === 'TOURNAMENT' ? '赛事不存在' : '活动不存在');
  const label = target.type === 'TOURNAMENT' ? '赛事' : '活动';
  if (row.approvalStatus === 'PENDING') {
    throw new BadRequestException(`该${label}图片正在等待上级管理员同意，相关图片功能暂不可用`);
  }
  if (row.approvalStatus === 'REJECTED') {
    const reason = (row as { rejectReason?: string | null }).rejectReason;
    throw new BadRequestException(`该${label}图片审核未通过${reason ? `：${reason}` : ''}`);
  }
}
```

### 4.2 加门禁的写操作

| 文件 | 方法 | 说明 |
|---|---|---|
| `photos.service.ts` | `uploadPhotos` / `uploadActivityPhotos` | 上传前校验（管理端上传也会走到这里） |
| `photos.service.ts` | `deletePhoto` / `deletePhotos` / `deleteTournamentPhotos` / `deleteActivityPhotos` | 按目标校验 |
| `photos.service.ts` | `updateWatermark` / `addWatermarkLogo` / `deleteWatermarkLogo` / `updateActivityWatermark` / `addActivityWatermarkLogo` / `deleteActivityWatermarkLogo` | 水印写操作 |
| `photos.service.ts` | `createTournamentUploadAccess` / `createActivityUploadAccess` | **去掉存量例外**，先校验 `APPROVED` |
| `competitions.service.ts` | `getOrCreatePhotoAccess` | **去掉存量例外**（L1060-1067），先校验 `APPROVED` |
| `photo-activities.service.ts` | `createPhotoAccess` | **去掉存量例外**（L146-148），先校验 `APPROVED` |

### 4.3 公开访问补赛事过滤

- `findGalleryByAccessToken`：赛事分支加 `approvalStatus: 'APPROVED'`。
- `getPublicThumb` / `getPublicView` / `getDownload`：赛事分支 OR 条件加 `tournament: { photoAccessToken: validAccessToken, approvalStatus: 'APPROVED' }`。
- 摄影师端已有过滤，保持不动。

### 4.4 保持可读

- `adminListPhotos`（列表）、`getOriginal`（原图预览）、`getWatermark`（GET）保持可用——支撑"只读预览"。

## 5. 前端改动

### 5.1 活动图片列表页（`apps/frontend/app/nicaiyixiahh/photo-activities/page.tsx`）

- 状态标签：`PENDING` → 「等待上级管理员同意」（橙），`REJECTED` → 「审核未通过」（红）
- 筛选下拉：`PENDING` 文案改「等待上级管理员同意」
- 操作列（活动/赛事都适用）：
  - 「图片管理」：允许进入（进去是只读预览）
  - 「Logo 设置」「生成/查看二维码」：未通过时 `disabled` + tooltip「等待上级管理员同意后才能使用」
  - 「编辑」保留（活动行）；ROOT「通过/驳回/删除」保留
- 行内 secondary 提示：「等待上级管理员同意」

### 5.2 图片管理页（`/nicaiyixiahh/{competitions|photo-activities}/[id]/photos`）

- 计算 `readOnly = target.approvalStatus !== 'APPROVED'`
- 顶部提示：PENDING →「等待上级管理员同意」；REJECTED →「审核未通过：原因」
- 只读预览：照片列表正常加载、原图按钮保留
- 禁用：上传图片、上传授权二维码、全选/批量删除、删除全部、单张删除；水印入口（如果有）保持可点但保存会被后端拦
- 现有 banner（"尚未通过审核"）替换为新文案，保持单一提示

### 5.3 水印页（`/nicaiyixiahh/{competitions|photo-activities}/[id]/watermark`）

- 后端写操作已拦，页面 `catch` 会显示后端文案；无需额外改（可选：进入时先校验，直接显示锁定提示）。

### 5.4 摄影师端 / 公开相册

- 无需改（后端已过滤/拦截）。

## 6. 兼容与存量

- 已 `APPROVED` 的对象完全不受影响。
- 已生成的二维码、但对象当前非 `APPROVED` 的：**立即失效**（按决策执行）。上线前需知会运营：正在用的活动/赛事不要改回待审。
- 无数据库变更、无迁移。

## 7. 测试

- 单测：
  - `assertImageTargetUsable` 三态（赛事/活动 × PENDING/REJECTED/APPROVED）
  - `createTournamentUploadAccess` / `createActivityUploadAccess` / `getOrCreatePhotoAccess` / `createPhotoAccess` 存量例外已移除
  - `findGalleryByAccessToken` 赛事未通过时 404
- 手动回归：
  1. ADMIN 建活动 → PENDING：列表按钮禁用、图片页只读预览、上传被拒、二维码生成被拒、旧二维码 404
  2. ROOT 通过 → 全部恢复
  3. ROOT 驳回 → 显示原因，仍只读
  4. 已通过对象被编辑 → 回到 PENDING → 立即只读 + 旧二维码失效
  5. 赛事同样跑一遍

## 8. 风险

| 风险 | 应对 |
|---|---|
| 活动/赛事改回待审导致在用二维码中断 | 前端编辑保存前提示；运营知会 |
| 只读预览被误解为"还能用" | 顶部提示 + 按钮禁用 + tooltip |
| 绕过前端直调接口 | 后端统一门禁 |
| 公开相册赛事过滤是新增行为 | 上线前确认没有依赖"未审核赛事也能看相册"的场景 |

## 9. 工作量

- 后端：helper + 约 12 个方法接线 + 4 处存量例外 + 公开赛事过滤 + 单测：**0.5–1 人天**
- 前端：列表页文案/禁用 + 图片管理页只读态：**0.5 人天**
- 回归：**0.5 人天**
- 合计 **~2 人天**，无数据库迁移。

## 10. 二期可选：照片级人工审核

如果之后还要"活动通过后每张照片再单独审"，再引入 `Photo.reviewStatus` + 审核接口 + 公开过滤 + 批量审核，存量照片回填已通过。需要时单独排期。

## 11. 上线顺序

1. 后端发布（先拦，前端未更新也能生效）
2. 前端发布（只读态与文案）
3. 抽查：一个待审活动 + 一个待审赛事，验证"只读预览 + 操作全禁 + 二维码失效"
4. 通知运营：改回待审会立即暂停图片功能

## 12. 实施清单（按文件）

- [ ] `apps/backend/src/photos/photos.service.ts`：`assertImageTargetUsable` + 上传/删除/水印/上传二维码 + 公开赛事过滤
- [ ] `apps/backend/src/competitions/competitions.service.ts`：`getOrCreatePhotoAccess` 去掉存量例外
- [ ] `apps/backend/src/photo-activities/photo-activities.service.ts`：`createPhotoAccess` 去掉存量例外
- [ ] `apps/backend/src/photos/photos.service.spec.ts` / `competitions.service.spec.ts` / `photo-activities.service.spec.ts`：补测试
- [ ] `apps/frontend/app/nicaiyixiahh/photo-activities/page.tsx`：文案 + 按钮禁用
- [ ] `apps/frontend/app/nicaiyixiahh/competitions/[id]/photos/page.tsx`：只读预览态
