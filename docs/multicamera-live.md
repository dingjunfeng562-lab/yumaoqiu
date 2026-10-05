# 多机位赛事直播 V1

本模块依据《羽动云赛多机位赛事直播系统》2026-10-05 开发文档扩展现有直播模块。
Android 摄像端、Web 导播台、观众 PGM 与赛事比分分离；媒体采用 LiveKit SFU。

## 使用入口

1. ROOT 打开 `/admin/broadcasts`，创建直播间并选择要直播的比赛。
2. 在直播间配置的「手机扫码接入」选择 1～6 个机位，点击「配对二维码」；也可以进入「直播导播」使用同一个入口。
3. 安装本项目 `apps/camera-android/app/build/outputs/apk/debug/app-debug.apk`（1.2.1），单台和多台手机均扫描直播间统一二维码，自动分配空闲 CAM。有效期内跨页面、刷新后再打开都是同一码；只有「重置二维码」会提前作废旧码，已配对手机不受影响。同一手机用当前有效码重新扫码会恢复原机位。更换手机时可先「解除配对」，新手机仍扫描直播间二维码。
4. 选定主音频 CAM，并把 USB 接收器接入该手机；其余手机仅发布视频。各手机点「开始接入」。
5. 管理页点击「开始直播」，或导播台点击「开始对外直播」，即可开放原来的 `/live/:broadcastId` 观众地址；尚无画面时显示「待开始」。首次直接在管理页开始默认启用 1 个机位；需要多机位时先在扫码入口选择数量。单机位由有音频权限的操作者开始时自动设为正式画面和主音频；多机位仍需选 PVW、按 TAKE 设置 PGM，并选择主音频。真实画面和声音就绪后，观众页自动播放。
6. 暂停撤回观众访问，摄像可继续；结束保留观众页的「直播已结束」提示，并关闭媒体房间、释放机位、撤销摄像配对凭据。结束后可再次点击开始，同一观众页回到「待开始」，手机需扫描新二维码接入。结束直播不会代替裁判完成比赛确认。

ROOT 可按用户 ID 授予房间导播权限。`canAudio=false` 的导播只能切视频；音频操作由服务端单独检查。配对和权限管理仍限 ROOT。

## 实现边界

| 项目 | 实现 |
| --- | --- |
| 业务状态 | 扩展现有 BroadcastSession，增加摄像机、导播授权、操作日志；所有控制使用 sequence 乐观锁 |
| 配对 | 单机位和多机位统一使用 30 分钟直播间码；有效期内复用，事务锁保护并发分配；换码后同设备重扫恢复原机位，满员拒绝新设备。解除配对后复用空闲机位。凭据数据库只存哈希，二维码由随机邀请 ID 和服务端密钥恢复 |
| 媒体权限 | 5 分钟 LiveKit JWT，绑定 Room/Identity/发布源；摄像机不能订阅或发送控制数据 |
| 观众权限 | 摄像 SDK 在发布前关闭默认订阅，按服务端 metadata 设置 SFU 逐轨白名单；只允许当前 PGM、主音频和切换期间的旧 PGM |
| 切换 | 后端验证真实视频 Track；观众双 video 元素等待首帧，500ms 后释放旧订阅，保留最后画面用于失败回退 |
| 主音频 | TAKE 不写 audioCameraId；旧主音频先静音和收回发布权限，再授权新源；App 对非主音频直接取消发布 |
| 画质 | 手机按镜头、尺寸对应帧时长和 H.264 编码器能力手选分辨率/帧率，自动优先 1080p60，其次 1080p30；360p simulcast 供缩略预览，PVW/PGM/观众请求完整层，实际发送受网络带宽影响 |
| 比分 | 复用 BroadcastOverlay 和已有裁判计分通道，不另建可由摄像或导播修改的比分接口 |
| 恢复 | SDK 短断重连；完全断连后用保存的机位凭据领取新媒体令牌，重新发布原 CAM；后台巡检重试结束直播时未完成的媒体清理 |

不使用 `canSubscribe=false + 服务端强制订阅` 的方式管理观众，当前 LiveKit 对此存在兼容性问题。观众拥有订阅能力，但摄像端通过 SFU 的逐轨白名单限制可见轨道。自建 LiveKit 不提供与 Cloud 相同的令牌立即吊销机制，因此服务端同时检查业务权限、移除失效参与者并定时复核。参见 [LiveKit 轨道权限](https://docs.livekit.io/transport/media/publish/) 和 [自建服务说明](https://docs.livekit.io/transport/self-hosting/)。

## 配置和部署

### Windows 本地多机位测试

保留跨网络接入能力；当前测试仅选择局域网运行配置，并不限制 App 的网络类型。现有公网/TURN 示例独立保留。

在项目根目录执行：

```powershell
node infra/livekit/configure-local.cjs
node infra/livekit/start-local.cjs
```

配置程序自动选择物理网卡 IPv4，写入后端 `.env` 和被 Git 忽略的 `infra/livekit/.local/livekit.yaml`，生成随机媒体密钥并备份原环境文件。首次配置或电脑 IP 改变后需重启后端；媒体服务运行时更改地址也需要重启该媒体进程。后端环境文件按项目路径解析，避免启动目录变化导致配置丢失。

管理员终端首次执行 `node infra/livekit/enable-local-firewall.cjs`，仅允许指定 LiveKit 程序接收局域网 TCP 7880/7881、UDP 7882。手机扫码访问后端 TCP 4000，沿用已有 API 防火墙规则。App 安装 1.2 或更高版本后扫描直播管理/导播页的「配对二维码」，机位容量在首次接入前选择；只用一个机位也采用相同的二维码接入流程。

本地跨不同网络测试可将电脑与手机加入同一虚拟组网，再使用 `node infra/livekit/configure-local.cjs --host 电脑的VPN_IP` 配置媒体与二维码地址，并重启后端/媒体。管理员防火墙工具可用 `--remote-subnet VPN的IPv4网段/CIDR` 放行该组网；API 4000 同样需允许该组网访问。未建立可互通的组网或公网媒体/TURN 时，手机 5G 无法直接连接电脑的 `192.168.*` 地址。此限制来自路由，不是 App 限制。

后端读取 `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`；可用 `LIVEKIT_INTERNAL_URL` 指向本机管理 API。`LIVEKIT_VIEWER_LIMIT` 默认 8，用于保守控制观看规模。公开接入使用 HTTPS/WSS，手机只需要访问公网业务地址和媒体地址。

当前本地 4000 后端已配置并加载 LiveKit，媒体地址为 `ws://192.168.1.23:7880`，手机后台地址为 `http://192.168.1.23:4000`；媒体服务已启动，程序限定的局域网 TCP 7880/7881、UDP 7882 防火墙规则已生效。另建了「1号场地 · 多机位测试」4 CAM 房间，原单机位直播间继续运行。公网媒体尚未部署；本地配置与公网模板独立，App 继续支持可达的公网或 VPN 地址。

生产示例位于 `infra/livekit/`：

- `backend.env.example`：业务后端所需变量。
- `livekit.yaml.example`：媒体和 TURN 配置，复制为 `livekit.yaml` 后填写真实域名、证书。
- `compose.yaml`：固定 LiveKit 1.13.7 的 Linux 部署示例。
- `nginx.conf.example`：独立媒体子域名的 WSS 反向代理。

使用现有网站服务器时，另提供 `backend.existing-site.env.example`、`nginx-existing-site.conf.example`、`livekit-existing-site.yaml.example`，通过 `wss://ydysyumao.cn/livekit` 代理信令，TURN 使用现有站点证书与 5349 端口。部署前仍须核实服务器身份、Nginx 现有配置、证书路径、CDN WebSocket 转发和防火墙；这些模板尚未在公网应用。

按需开放 TCP 443/7881/5349、UDP 3478/50000～50100；7880 管理入口仅允许本机/可信网络。TURN/TLS 示例使用 5349；若校园网只允许 443，需要给 TURN 单独 IP，或配置 SNI TCP 分流，不能直接抢占现有网站 443。证书与真实 API 密钥不入库。

本机已对 `localhost:3306/ayumaoqiu` 应用并登记 `20261005_broadcast_multicamera` 增量迁移。原有数据库仍存在历史迁移登记差异；不要直接对生产运行全部历史待迁移项。上线前先核对已有表结构，再应用本次增量 SQL。`test/multicamera-db.cjs` 仅支持本地数据库，默认只检查，`--apply` 才执行本次新增结构。

## 验证记录

1.2.3 帧率与清晰度（2026-10-05）：多机位自动档改为优先 1080p60，且显式保留不可用的 60 帧入口，点击解释具体限制。Capability 检查与实际 CameraX 输出共用 `CaptureQualityPolicy`，按尺寸对应的最短帧时长排除慢输出；使用设备公开的固定/可变 AE 帧率范围，不虚构未支持的 `{60,60}`。CaptureRequest 设置录像意图，高帧率不强制电子防抖，支持时优先光学防抖；按实际帧时间戳统计采集帧率，与发送帧率分别显示。参见 [Android CaptureRequest](https://developer.android.com/reference/android/hardware/camera2/CaptureRequest) 的帧时长、AE 帧率和防抖约束。

网页原有 `adaptiveStream` 可用较小的元素尺寸覆盖显式 HIGH 请求；同一 publication 的缩略图和 PVW/PGM 又分别设置清晰度。现在关闭按元素尺寸降档，并按同一机位所有画面的最高需求管理清晰度。App 编码策略由保帧率降分辨率改为优先保分辨率，辅助层由 180p/360p 调整为单个 360p，保留带宽不足时的降级能力。实际 SDK 行为见本地 `livekit-client/src/room/track/RemoteTrackPublication.ts` 的 `emitTrackUpdate()`，背景说明见 [LiveKit 视频分层](https://docs.livekit.io/transport/media/advanced/)。这解决了已找到的低清机制，但不能据此断言现场的每一次模糊都来自网络或分层。

本次浏览器联调通过：桌面和 390px 手机视口的 PVW、PGM、观众播放器均收到测试源完整 1280×720 分辨率，切机位和主音频连续性、非 PGM 权限隔离、暂停撤权仍通过；已检查导播/观众截图。前端 TypeScript、修改文件 ESLint 和清晰度共享订阅回归测试通过。手机 60 帧还需真机确认，不能以浏览器模拟摄像源或能力判断替代硬件验证。

Android `assembleDebug`、46 项单测和 `lintDebug` 通过（lint 0 errors，保留已有 79 warnings）。`outputs/camera-android/Ayumaoqiu-Camera-1.2.3-debug.apk` 为 versionCode 6，签名验证通过且与 1.2.2 一致，可覆盖安装；校验记录见 `outputs/camera-android/verification-1.2.3.json`。

1.2.2 连接与画面修复（2026-10-05）：用户补充异常 `Attempt to invoke virtual method 'java.lang.Class java.lang.Object.get…'`。核对当前 SDK 后发现 `ParticipantTrackPermission.toProto()` 无条件调用 `setParticipantSid()`，原调用只填写 identity，使导播/观众存在时产生空指针并触发主动断连。现在同时传入真实 identity/SID，缺少标识则不授予权限；仍保留逐轨白名单。依据 [LiveKit 2.29.0 LocalParticipant](https://github.com/livekit/client-sdk-android/blob/v2.29.0/livekit-android-sdk/src/main/java/io/livekit/android/room/participant/LocalParticipant.kt)；新增测试通过 SDK 真实 protobuf 转换复现旧写法并验证新写法、主音频/画面隔离及暂停拒绝。

相机按 [LiveKit 2.29.0 CameraXSession](https://github.com/livekit/client-sdk-android/blob/v2.29.0/livekit-android-camerax/src/main/java/livekit/org/webrtc/CameraXSession.kt) 的方式撤销纹理自带的传感器旋转/前置镜像，再应用 CameraX 目标旋转；仅在 `hasCameraTransform()` 为真时撤销，详见 [CameraX TransformationInfo](https://developer.android.com/reference/androidx/camera/core/SurfaceRequest.TransformationInfo)。使用 DisplayListener 监听 180° 横屏翻转，状态栏和控制区归入同一 16:9 取景框。重连创建独立采集器，取消旧连接不再释放新连接；重扫前保留本地凭据，旧服务端返回“该手机已绑定机位”时须经同地址 config 鉴权成功才恢复。新安装包版本为 1.2.2（versionCode 5）。这些源码改动不等同于真机画面验收。

本次验证：`:app:assembleDebug :app:testDebugUnitTest :app:lintDebug --offline --no-daemon` 通过，40 项单测零失败（包含真实 SDK 空指针复现与修复回归）；当前 4000 API/3000 浏览器的 `test/camera-pairing-ui.smoke.cjs` 通过重扫、二维码重置恢复、手机替换和移动端入口检查。`outputs/camera-android/Ayumaoqiu-Camera-1.2.2-debug.apk` 的签名验证通过，签名证书与 1.2.1 一致，可以覆盖安装；校验记录为同目录 `verification-1.2.2.json`。ADB 未连接真机，未验证手机安装后的旋转、触控及持续推流。

统一二维码与重扫恢复（2026-10-05）：直播管理和导播台统一使用 `POST /broadcasts/:id/live/join-code`，默认复用有效邀请；`rotate: true` 才主动重置，1 个机位同样支持。同手机重扫新码更新自己的凭据并保留机位，不影响其他手机；解除配对保护正在直播的正式画面、主音频和过渡机位。无需数据库迁移或更换 1.2.1 App。本地真实数据库 `test/multicamera-join.smoke.cjs` 和实际 4000 API/3000 浏览器 `test/camera-pairing-ui.smoke.cjs` 均通过：并发复用二维码、单/多机位、换码恢复、手机替换、失效码拒绝和移动端入口。前端 TypeScript、后端构建及相关 5 项单测通过；新增/修改的配对组件 ESLint 通过，管理页保留原有 4 处 `react-hooks/set-state-in-effect` 报错。截图为 `output/playwright/camera-pairing-admin.png` 和 `camera-pairing-phone.png`；Android 真机重新扫码仍需现场确认。

1.2.1 显示适配（2026-10-05）：取景框改为完整等比容纳 16:9，超宽屏留边；多机位控件改用 dp 尺寸，适配挖孔、系统栏安全区与反向横屏，曝光滑杆随可用宽度布局。`:app:assembleDebug :app:testDebugUnitTest :app:lintDebug --offline --no-daemon` 通过，35 项单测零失败，APK 签名验证通过。安装包为 `outputs/camera-android/Ayumaoqiu-Camera-1.2.1-debug.apk`（versionCode 4），与 1.2 使用同一签名。当前未连接 ADB 真机，尚未验证实际显示与触控；用户截图中的连接异常尚未定位，本次显示修改不代表连接问题已修复。

1.2 更新（2026-10-05）：新增 `20261005_broadcast_shared_join` 迁移，已在本地应用并登记；`test/multicamera-db.cjs --shared-join --apply` 仅处理此新增表。真实数据库测试 `test/multicamera-join.smoke.cjs` 已通过并发扫码分配、同机重试恢复、满员限制、旧码失效、过期/关闭二维码及已结束房间拒绝接入。前后端 TypeScript、相关前端 ESLint、后端 5 项单测，以及安卓 1.2 APK、35 项单测与 lint 已通过。随后在本地 4000 后端与 LAN LiveKit 上完成了 1.2 真实 SFU/浏览器回归（设置 `QA_API_URL=http://127.0.0.1:4000/api`）：共用码同时分配独立 CAM、重试恢复、满员拒绝、换码保留已配对手机，以及 PGM/音频/权限/手机布局全部通过；截图已更新。

2026-10-05：

- 后端 TypeScript 编译及 5 项媒体令牌权限、服务故障后清理测试通过。
- 前端 TypeScript、新增文件 ESLint 通过。
- 本机 LiveKit 1.13.7 与独立后端 4010 联调，通过一次性配对、房间权限隔离、过期 sequence 拒绝、音视频就绪后开播。
- Playwright 以三个独立浏览器生成视频源，真实发布至 SFU；确认三路导播预览、CAM1→CAM2 正式切换、切换前后主音频 Track ID 一致、暂停后拒绝新观众令牌。
- 绕过播放器直接请求非 PGM 视频，SFU 拒绝订阅；目标机位无视频时 TAKE 被拒绝并保留原 PGM；重新配对后旧设备凭据失效。
- 桌面与 390px 手机导播布局检查通过；手机滚动页面后 TAKE 操作栏仍在可视区域，截图位于 `output/playwright/multicamera-*.png`。
- 安卓 Debug APK、34 项单元测试、Android lint 已通过；无连接的 ADB 真机。

测试脚本：`apps/backend/test/multicamera.smoke.cjs`。用 `node --env-file=.env test/multicamera.smoke.cjs` 运行前，应启动前端 3000、隔离测试后端 4010 和本地 LiveKit 7880。脚本自行创建并清理测试用户、赛事、直播间。

## 现场验收仍需完成

当前证据来自编译、静态检查、真实 SFU 和浏览器模拟摄像源，不等同安卓硬件验收。还需三台不同网络的真机、DJI Mic Mini 接收器及真实公网 TLS/TURN 环境，验证相机厂商兼容、缩放和对焦期间不断流、USB 拔插、Wi-Fi/蜂窝切换、来电/锁屏、100 次连续切机位、4 CAM + 5～8 观众的整场发热/电量/带宽压测。

超广角快捷倍率只在设备 CameraX zoomRange 实际开放时显示；未开放的物理镜头不冒充可用。当前预览和视频采用硬切与首帧保护，未加入淡入淡出、自动备用机位、服务器合成、回放或 CDN。
