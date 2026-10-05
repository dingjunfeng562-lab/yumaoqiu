# 手机摄像端自动直播链路

## 目标流程

1. ROOT 在后台创建直播间并点击“生成配对码”。
2. 手机扫描二维码，服务器自动下发本房间的 RTMP 地址；手机不填写推流地址。
3. 手机点红色按钮推流到 MediaMTX。
4. 后台通过服务端私有代理预览 16:9 画面和声音；没有实际 HLS 画面时“确认发布”按钮不可用。
5. ROOT 检查完成后点击“确认发布给观众”。只有这一步才把房间状态改为 `LIVE + isPublic=true`。
6. `/live/:id` 只播放已确认发布的房间；撤回发布会立即撤销网站观众 socket 与后端媒体代理权限。

## 本地 MediaMTX

项目不把媒体服务器嵌进 Nest/Next，也不把未授权的 8888 端口开放给观众。下载官方 Windows standalone 版（当前验证过的版本为 v1.21.1）到仓库外，例如 `D:\AyumaoqiuTools\mediamtx-v1.21.1`，将 [mediamtx.yml](../apps/backend/mediamtx.yml) 复制到同目录。

```powershell
D:\AyumaoqiuTools\mediamtx-v1.21.1\mediamtx.exe D:\Ayumaoqiu\apps\backend\mediamtx.yml
```

后端 `.env`：

```dotenv
MEDIA_INGEST_HOST=192.168.1.23
MEDIA_RTMP_PORT=1935
MEDIA_HLS_ORIGIN=http://127.0.0.1:8888
```

手机需要访问电脑的 `1935/TCP`，所以首次本地测试要在管理员 PowerShell 放行：

```powershell
New-NetFirewallRule -DisplayName "Ayumaoqiu Media RTMP 1935" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 1935 -Profile Any -RemoteAddress LocalSubnet
```

API 的 4000 端口也需要之前的局域网规则。MediaMTX 的 8888 只监听回环地址，不要放行给手机或公网。MediaMTX 通过 `POST /api/media/auth` 回调后端验证发布路径和手机 token；随机房间路径不是单独的授权，token 校验仍然必须通过。

## 本地跨网络测试（推荐 Tailscale）

如果电脑和手机不在同一个 Wi-Fi，但暂时还没有部署到公网服务器，可以在两台设备上安装并登录同一个 Tailscale（或 ZeroTier）网络。以 Tailscale 为例：

1. 在电脑和手机安装 Tailscale，并登录同一个账号；在电脑上执行 `tailscale ip -4`，得到一个 `100.x.y.z` 地址。
2. 确认手机能访问电脑的 API：在手机浏览器打开 `http://100.x.y.z:4000/api/health`（如果项目没有 health 路由，打开后台页面对应的 API 地址即可）。
3. 将后端 `.env` 临时改为：

```dotenv
CAMERA_PUBLIC_URL=http://100.x.y.z:4000
MEDIA_INGEST_HOST=100.x.y.z
MEDIA_RTMP_PORT=1935
MEDIA_HLS_ORIGIN=http://127.0.0.1:8888
```

4. 重启 Nest 后端和 MediaMTX。后台生成配对码时，在“手机访问后台用的地址”中选择或手动填写 `http://100.x.y.z:4000`。
5. 手机扫码后，推流会走 Tailscale 虚拟网络；手机不需要和电脑连接同一个 Wi-Fi。Windows 防火墙需要允许 Tailscale 网卡访问 TCP `1935`，可先用管理员 PowerShell 放行：

```powershell
New-NetFirewallRule -DisplayName "Ayumaoqiu Media RTMP Tailscale" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 1935 -Profile Any -RemoteAddress Any
```

Tailscale/ZeroTier 的虚拟地址不会自动作为推荐地址显示时，可以直接在配对窗口手动填写；配对窗口禁止的只有 `localhost` 等手机自身地址。

## 服务器部署

服务器部署时，手机同样不需要与服务器处于同一个局域网，但必须能访问服务器的两个入口：

- `CAMERA_PUBLIC_URL`：手机访问后端的 HTTPS 地址，例如 `https://api.example.com`，用于二维码配对和心跳。
- `MEDIA_INGEST_HOST`：手机推 RTMP 的域名或公网 IP，例如 `media.example.com`。DNS 必须解析到服务器，防火墙/云安全组放行 `1935/TCP`。

服务器 `.env` 示例：

```dotenv
CAMERA_PUBLIC_URL=https://api.example.com
MEDIA_INGEST_HOST=media.example.com
MEDIA_RTMP_PORT=1935
MEDIA_HLS_ORIGIN=http://127.0.0.1:8888
```

MediaMTX 的 RTMP 端口需要对手机开放，但 HLS `8888` 只允许本机访问；后端继续通过本机 HLS 代理读取画面。若服务器不能直接开放 RTMP，可改用支持 TCP 转发的隧道或将 MediaMTX 部署到云服务器，普通 HTTP 反向代理不能转发 RTMP。

## 画面契约

手机端按后台的 720p/1080p/2160p 横向目标编码，发布链路固定为 16:9。后台预览和观众页都使用同一个 16:9 容器，比分以网页图层叠加，不烧进手机原始视频。
