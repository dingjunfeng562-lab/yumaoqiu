'use client';

import { useMemo, useState } from 'react';
import { Alert, AutoComplete, Button, Input, Modal, QRCode, Space, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

/** Payload format read by the Android camera app (PairingPayload.kt). */
export function cameraPairingPayload(serverUrl: string, token: string, version = 1): string {
  return JSON.stringify({ v: version, u: serverUrl.trim().replace(/\/+$/, ''), t: token });
}

function looksLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return true;
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export type CameraPairing = { title: string; token: string; serverUrls: string[]; version?: number; shared?: boolean; expiresAt?: string };

/**
 * Shows the room invitation as a QR code that the camera app scans.
 *
 * The code carries the server address together with the token, because the
 * address this admin page uses (usually localhost) is not one a phone can reach.
 * The backend suggests reachable LAN/public addresses; the operator can still
 * type another one.
 */
export function CameraPairingModal({ pairing, onClose }: { pairing?: CameraPairing; onClose: () => void }) {
  return (
    <Modal title="配对手机摄像端" open={Boolean(pairing)} footer={null} onCancel={onClose} destroyOnHidden>
      {/* Keyed by token: each new pairing starts from the backend's suggested address. */}
      {pairing && <PairingBody key={pairing.token} pairing={pairing} onClose={onClose} />}
    </Modal>
  );
}

function PairingBody({ pairing, onClose }: { pairing: CameraPairing; onClose: () => void }) {
  const [serverUrl, setServerUrl] = useState(pairing.serverUrls[0] ?? '');

  const valid = isHttpUrl(serverUrl) && !looksLocal(serverUrl);
  const payload = useMemo(
    () => (valid ? cameraPairingPayload(serverUrl, pairing.token, pairing.version) : ''),
    [pairing.token, pairing.version, serverUrl, valid],
  );

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label}已复制`);
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  return (
        <Space orientation="vertical" size={14} style={{ width: '100%' }}>
          <Alert
            type="warning" showIcon
            message={pairing.shared ? `${pairing.title} · 直播间统一配对二维码` : pairing.version === 2 ? `${pairing.title} · 配对码 5 分钟内有效，仅可使用一次` : '配对码只显示这一次'}
            description={pairing.shared ? `单机位和多机位均扫描此码；同一台手机重扫会恢复原机位。${pairing.expiresAt ? `有效至 ${new Date(pairing.expiresAt).toLocaleString('zh-CN', { hour12: false })}。` : ''}重置二维码不影响已接入手机。` : '打开手机上的「羽毛球摄像端」，点“扫码配对”，对准下面的二维码。重新生成会让旧手机立即失效。'}
          />

          <div>
            <Typography.Text strong>手机访问后台用的地址</Typography.Text>
            <AutoComplete
              style={{ width: '100%', marginTop: 6 }}
              value={serverUrl}
              onChange={setServerUrl}
              options={pairing.serverUrls.map((url) => ({ value: url }))}
              placeholder="https://api.example.com"
              aria-label="手机访问后台用的地址"
              status={serverUrl && !valid ? 'error' : undefined}
            />
            <Typography.Text type={valid ? 'secondary' : 'danger'} style={{ fontSize: 12 }}>
              {valid
                ? '手机可与电脑同一局域网，也可以使用 Tailscale/ZeroTier 等虚拟网络地址或公网域名。不要带 /api。'
                : pairing.serverUrls.length === 0
                  ? '没找到局域网地址。请填写手机能访问到的地址（例如这台电脑的局域网 IP 加端口）。'
                  : '请填写手机能访问到的 http(s) 地址，不能是 localhost。'}
            </Typography.Text>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {payload
              ? <QRCode value={payload} size={240} errorLevel="M" bordered={false} />
              : <div style={{ width: 240, height: 240, display: 'grid', placeItems: 'center', background: '#f5f5f5', color: '#999' }}>填写有效地址后显示二维码</div>}
          </div>

          <details>
            <summary style={{ cursor: 'pointer', color: '#666' }}>手机不方便扫码？手动输入</summary>
            <Space orientation="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
              <div data-allow-copy>
                <Input aria-label="摄像端配对码" value={pairing.token} readOnly />
              </div>
              <Space wrap>
                <Button icon={<CopyOutlined />} onClick={() => void copy(pairing.token, '配对码')}>复制配对码</Button>
                <Button icon={<CopyOutlined />} disabled={!valid} onClick={() => void copy(serverUrl, '后台地址')}>复制后台地址</Button>
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                在 App 里点“手动输入”，分别粘贴后台地址和配对码。
              </Typography.Text>
            </Space>
          </details>

          <div style={{ textAlign: 'right' }}>
            <Button type="primary" onClick={onClose}>手机已连上</Button>
          </div>
        </Space>
  );
}
