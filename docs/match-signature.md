# 比赛结束签字与电子比分单

## 功能

- 后台「裁判分配」页，选中赛事后有「比赛结束签字」卡片。开关按赛事单独设置，默认关闭（`Tournament.requireMatchSignature`）。
- 开关打开后，裁判端以下五种结束比赛的操作都要签字：
  - 确认结束
  - 弃权
  - 伤退/退赛
  - 黑牌取消资格
  - 双方弃权
- 签字顺序是：核对结果 → 胜方签字 → 裁判签字 → 提交。
  - 双打的胜方由两人中的一人签，签之前要选是谁。
  - 团体赛的每个单项，由赢下该单项的选手签。
  - 双方弃权没有胜方，只由裁判签。
  - 不提供「胜方无法签字」的跳过按钮，胜方必须签字。
- 后台操作不要求签字，也不生成比分单。这些操作包括：
  - 「裁判员对局管理」结束比赛
  - 后台改分
  - 签到台判弃权
  - 团体赛管理判弃权、判整队弃权
- 判断规则：
  - 裁判账号（`Role.REFEREE`）不带签名时，后端拒绝结束。
  - 管理员不带签名时照常结束。
  - 开关关闭时，即使带了签名也忽略。

## 保存方式

每签一次，生成一条 `MatchScoreSheet` 记录，同时生成三个文件。

**文件**放在 `uploads/match-signatures/<赛事>/<场次>/` 下：

| 文件 | 内容 |
| --- | --- |
| `<编号>-winner.png` | 胜方签名原图 |
| `<编号>-referee.png` | 裁判签名原图 |
| `<编号>-sheet.png` | 电子比分单，签字后由服务器生成 |

**数据库记录**包含以下内容：

- `snapshot`：签字那一刻冻结的比分。包括赛事、项目、轮次、场地、双方名单、每局比分、逐分过程、开始和结束时间、用时、结束方式和原因、签字裁判账号。
- 签字人信息：胜方签字人（第几名选手、姓名）、裁判账号。
- 签字时间、提交端 IP 和 User-Agent。
- 三个文件各自的 SHA-256。
- `contentHash`：对比分快照、两张签名的 SHA-256、签字人和签字时间一起算出的 SHA-256，作为防篡改指纹。比分单图片上也印有这个指纹。

**访问控制**：

- 记录没有修改和删除接口。
- 签名和比分单只能通过登录接口 `GET /api/scoring/matches/:id/score-sheets/:sheetId/(sheet|winner|referee)` 下载，要求「裁判分配」权限或超级管理员，管理员只能看自己的赛事。
- 文件不在公开的 `/api/uploads` 路由下。
- 实时比分推送里只有 `signatureRequired` 和 `scoreSheetSignedAt` 两个字段，不含签名。

**作废与失效**：

- 以下三种情况会把比分单标为「作废」，记录和文件保留，并写明原因：
  - 管理员重开比赛
  - 后台改分（比分确实变了才算）
  - 超级管理员清空成绩
- 同一场重新签字时，旧的比分单也会作废。
- 其他途径改动了比赛结果，比如重新抽签、重排，后台显示为「已失效」。判断依据是比赛的结束时间和签字时记录的不一致。

**校验**：后台打开比分单时，会重新计算三个文件和比分快照的指纹，与记录比对，列出对不上的项。

## 接口

- `GET/PATCH /api/scoring/tournaments/:tournamentId/signature-setting`：读取或修改开关，PATCH 请求体为 `{ enabled }`。
- `GET /api/scoring/tournaments/:tournamentId/score-sheets`：本赛事全部比分单，含作废的。
- `GET /api/scoring/matches/:id/score-sheets`：单场的比分单，附带校验结果。
- 以下五个接口的请求体可以带 `signatures: { winnerSignature, winnerSignerIndex, refereeSignature }`，签名为 PNG 的 data URL：
  - `POST /api/matches/:id/finish`
  - `POST /api/matches/:id/forfeit`
  - `POST /api/matches/:id/retire`
  - `POST /api/matches/:id/forfeit-both`
  - `POST /api/matches/:id/card`（仅黑牌）

服务器默认最多接收 100KB 的请求。前端导出签名时会裁掉空白并缩小，每张控制在约 40K 字符以内。后端要求每张解码后不超过 64KB，且必须是有笔迹的 PNG。

## 上线注意

1. **数据库迁移** `apps/backend/prisma/migrations/20261112_match_score_sheet/migration.sql`：只加列和新表，旧代码遇到新结构也能正常运行。按惯例先 mysqldump 备份，再手工执行。
2. **字体**：比分单在服务器上用 `apps/backend/assets/fonts/NotoSansSC-Bold.otf` 画中文。原来的 Dockerfile 运行层没有复制 `assets`，这次已加上（镜像约增大 60MB）。图片文字水印也用到这些字体。
3. **备份**：签名文件存在 `/data/yumaoqiu/uploads/match-signatures/`。数据库每天自动备份，这个目录不在其中，需要另外纳入备份。
