# 原生安卓摄像头 V1：本次实施与验收记录

记录日期：2026-10-08。需求依据：用户提供的《羽毛球原生安卓摄像头开发文档V1.docx》。本文记录当前代码与测试结果，不将文档中的性能目标写成已达标结果。

更新说明：本文保留 1.3.0 的历史记录。用户随后反馈红米 K60 Pro 本机取景缩放卡顿；1.3.1 已更改缩放调度和自动帧率策略，当前行为以 [1.3.1 修复记录](camera-android-1.3.1-zoom.md) 为准。

## 工程与交付

- App 源码：`D:\Ayumaoqiu\apps\camera-android`。
- `D:\AyumaoqiuTools` 是 Android SDK、JDK、Gradle 等工具链目录，不是 App 源码。
- `D:\Ayumaoqiu-acl-recovery` 是权限备份/恢复资料，不是 App 源码。
- 测试安装包：`D:\Ayumaoqiu\outputs\camera-android\Ayumaoqiu-Camera-1.3.0-debug.apk`。
- 包名 `com.ayumaoqiu.camera`；versionCode `7`；versionName `1.3.0-ayumaoqiu`。
- 保留工作区原有品牌图标、名称和旧版 RTMP/SRT 平滑变焦改动。未提交 Git、推送或部署服务器。

本次完成手机端 A/B 阶段的一批代码实现及离线验证；A/B 的实机验收仍未完成，不能称为整个 V1 已完成。发布包是 debug 签名测试版，不是正式发布签名版。

## 已实现的手机端改动

| 文档要求 | 当前实现 | 验证边界 |
| --- | --- | --- |
| 共用变焦控制、仅保留最新目标 | `ZoomController` 统一按钮、滑条、双指输入；上一项 CameraControl Future 完成后才继续；镜头解绑时作废旧回调 | 单测验证目标合并、串行状态、边界和不越界；画面平滑度待真机 |
| 变焦不重建媒体链路 | 倍率变化只调用同一个 CameraControl，不切换 Room/Track/UseCase | 代码路径确认；长时间稳定性待真机 |
| 实际倍率能力 | 按 CameraX zoomState 范围过滤按钮和滑条 | 不宣称数字变焦无损，也不把倍率叫光学焦段 |
| 点击对焦、AF/AE 锁定、恢复自动 | 反算 aspect-fit 留边与 VideoFrame 旋转；CameraX 按 Preview 宽高比映射传感器；恢复自动同时解除锁定和归零曝光补偿 | 坐标数学有单测；前后镜头对焦落点待真机 |
| 非主音频机位不申请/发布声音 | 摄像头与麦克风权限分开；仅指定主音频 CAM 请求麦克风；空机位 ID 不视为主音频 | 权限拒绝、系统设置返回、Android 13/14/15 行为待真机 |
| 前台服务类型正确 | 先启用 microphone 类型再创建音轨；后台首次启用音频时要求返回 App，音频失败不主动重建视频 | 代码与 lint 验证；后台、锁屏、来电恢复待真机 |
| 1080p30，默认 4 Mbps，上限可调 | 新版多机位自动优先 1080p30，然后 720p30；独立 2～6 Mbps 主视频设置；保留能力允许的手选 60 FPS | 目标参数单测通过；实际采集与发送分别显示 |
| 硬件 H.264，不静默软件回退 | MediaCodec 能力只接受硬编；WebRTC 显式硬件 H.264 工厂与硬件 simulcast 工厂；无可用 H.264 时拒绝发布并提示 | Android 10+ 硬件标志；更早系统仅名称过滤。实际编码实现与机型兼容需实测 |
| 低清辅助层 | 目标 640×360、12 FPS、0.4 Mbps；可显式关闭不兼容辅助层，并提示额外带宽风险 | 双层存在与订阅结果待实测；不能仅凭 publish 成功确认双层 |
| USB 收音、拔出提示、备用输入显式开启 | 默认 USB-only；启动音频先静音，实际路由确认后放行；拔出时暂停并持续告警；内置备用为手机端明确选择 | 纯逻辑单测通过；DJI Mic 的系统路由、音质与热插拔待实测 |
| 音量和削波提示 | PCM RMS 电平与近满幅采样检测；实际路由未知上报 `ERROR`，不冒充内置麦克风 | 后端已有枚举兼容；电平和削波观感待实测 |
| 退避恢复与网络变化 | 1、2、4、8、15 秒封顶退避，成功后重置；默认网络变更提前唤醒；SDK 断开后重新获取 join 配置和凭据 | 单测验证退避；断网恢复 ≤10 秒尚未证明 |
| 可诊断状态 | 目标/采集/发送 FPS、实际尺寸、码率、RTT、丢包、网络、电量、热状态；`LiveCameraStats` 输出各层 RID、编码实现与质量受限原因 | 空闲/未订阅层可能为 0；不能把目标值当实测值 |
| 停止释放资源 | 通知栏「停止摄像」释放摄像会话、Track、Room、ADM、EGL、唤醒锁；界面「停止接入」保留本地构图预览 | 代码路径确认；再次接入与长时间资源回收待真机 |

旧版 RTMP/SRT 模式仍保留，需要音频权限；其档位和码率策略与新版多机位模式分开，不能拿旧版 4K/高码率策略作为 V1 公网带宽结果。

## 本次软件验证

- `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug --offline --no-daemon`：完整 Gradle 流程成功。
- 61 项 JVM 单元测试：0 failures，0 errors，包括现有配对/接口/画质/订阅权限测试，以及新退避、变焦队列、对焦坐标、编码参数和音频策略测试。
- lint：0 errors、80 warnings。警告包括既有 UI/兼容性/依赖问题；BouncyCastle 依赖中存在 TrustAllX509TrustManager 警告，仍需在正式发布前审计相关使用路径。lint 通过不等于安全审计通过。
- `aapt dump badging`：包名、版本、SDK 与应用名称正确。
- `apksigner verify --verbose --print-certs`：APK v2 签名有效，与既有 1.2.3 测试包签名证书一致；具备覆盖安装的包名/证书条件，未实际执行手机覆盖安装。
- APK 文件 SHA-256：`AF31E75381569F0361F2A0756085B1701E27D5F82A2C0548B8B6A1F83A4194B1`。
- 本次 ADB 连接检查未获许可，因此没有手机安装、真实摄像、DJI Mic 或 OBS 联调结果。

当前 minSdk 仍为 24，targetSdk/compileSdk 为 35；现场验收建议按照文档使用 Android 10+，优先覆盖 Android 13/14/15。没有把兼容声明冒充已测机型列表。

## 文档中仍未完成的开发项

已有服务端和网页存在多机位配对、PVW/PGM、TAKE、固定主音频、比分叠加、OBS 页面和订阅白名单基础，本次未改动这些模块，也未重新验证它们。

1. 控制端单写者租约、`commandId` 幂等、完整 `expectedVersion`/事件重放/统一 `requestId, code, message, data` 约定。已有 `sequence` 乐观检查不能视为完整替代。
2. 主音频备用设备预准备、确认音轨可用后原子切换的完整服务端/导播协议。目前仅有本机 USB/内置输入策略，不等于跨机位原子音频切换。
3. 弱网按策略自动降至 720p/更低帧率，以及 BALANCED 与 MAINTAIN_RESOLUTION 的现场比较。当前沿用 MAINTAIN_RESOLUTION，用户可手选画质和码率。
4. 辅助层不兼容时，导播端自动限制 2～4 个并发预览。本机已提供显式关闭辅助层，但导播自动限流尚未实现。
5. 六位数字配对码。当前沿用已有二维码和 `live_`/`live_room_` 长码，不宣称支持六位码。
6. 导播端比分编辑/撤销/操作日志与计分状态的统一版本协议，及按文档完善控制权冲突处理。
7. 正式签名包、设备兼容矩阵、现场性能记录、生产配置复核和完整回滚验收。

## 真机验收顺序

按照文档先通过单手机 A/B 验收，再推进四机位 C/D；以下均为待执行目标。

1. 安装本测试包（优先覆盖旧包，保留凭据），从后台共用二维码配对。首次只授予摄像头，确认非主音频 CAM 仍可纯视频接入。
2. 正横屏/反横屏、前后镜头分别检查预览与发送方向、点焦落点、AF/AE 锁定、曝光归零、手势与滑条来回变焦 20 次，记录画面而非仅 UI 倍率。
3. 从后台指定主音频 CAM：验证首次麦克风授权、拒绝与设置返回；确认其他 CAM 没有麦克风轨。
4. 插 DJI Mic，检查真实 USB 路由和电平；拍手测音画同步，记录 OBS 必要偏移。拔出应暂停/持续告警；仅在明确允许内置备用后才能有内置声音，再插 USB 应恢复确认路由。
5. 导播与 OBS 同时订阅，查看 `LiveCameraStats` 是否实际存在高清和 360p RID、实际分辨率/FPS、编码实现和码率；若不兼容，显式关闭辅助层，减少预览并重测带宽。
6. 切换 Wi-Fi/蜂窝，断网 10 秒后恢复；记录恢复耗时，检查 Track/Room 是否重复、画面是否冻结以及 ON AIR 状态是否正确。测试后台、锁屏、来电、撤销权限和通知栏停止。
7. 四手机两小时连续推流、六机位扩展、100 次 TAKE、OBS 连续抓取 30 分钟。按原文测 P95 视频/切换 ≤1 秒、音画偏差 ≤150 ms、比分刷新 ≤500 ms、恢复 ≤10 秒及带宽/服务器资源。

### 现场诊断命令（用户允许 ADB 后）

```powershell
& "D:\AyumaoqiuTools\sdk\platform-tools\adb.exe" install -r "D:\Ayumaoqiu\outputs\camera-android\Ayumaoqiu-Camera-1.3.0-debug.apk"
& "D:\AyumaoqiuTools\sdk\platform-tools\adb.exe" logcat -s LiveCameraStats LiveCameraService
```

正式上线前不要只根据本页勾选硬件项；保存每台手机型号/系统、网络、订阅端、实际编码层与录屏证据。

## 可复现构建

本机 Java 默认临时目录曾导致 Windows Pipe/UnixDomainSocket 的 `Invalid argument`；使用短临时目录后构建正常。只对当前 PowerShell 会话设置环境，不修改系统全局配置。

```powershell
New-Item -ItemType Directory -Path "D:\Ayumaoqiu\.build-tmp" -Force | Out-Null
$env:JAVA_HOME = "D:\AyumaoqiuTools\jdk17-medium"
$env:GRADLE_USER_HOME = "D:\AyumaoqiuTools\gradle-home"
$env:ANDROID_HOME = "D:\AyumaoqiuTools\sdk"
$env:TEMP = "D:\Ayumaoqiu\.build-tmp"
$env:TMP = "D:\Ayumaoqiu\.build-tmp"
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=D:\Ayumaoqiu\.build-tmp"
Set-Location "D:\Ayumaoqiu\apps\camera-android"
& "D:\AyumaoqiuTools\gradle\gradle-8.13\bin\gradle.bat" "-Pkotlin.compiler.execution.strategy=in-process" :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --offline --no-daemon
```

## 实现参考

- [CameraControl：缩放 Future、对焦锁定与取消](https://developer.android.com/reference/androidx/camera/core/CameraControl)
- [SurfaceOrientedMeteringPointFactory：坐标与 UseCase 宽高比](https://developer.android.com/reference/androidx/camera/core/SurfaceOrientedMeteringPointFactory)
- [LiveKit Android LiveKitOverrides：编码工厂与 EGL 注入](https://docs.livekit.io/reference/client-sdk-android/livekit-android-sdk/io.livekit.android/-live-kit-overrides/index.html)

接口签名另与本机固定版本 CameraX 1.4.2、LiveKit Android 2.29.0、prefixed WebRTC 144.7559.14 的缓存字节码核对，未升级依赖。
