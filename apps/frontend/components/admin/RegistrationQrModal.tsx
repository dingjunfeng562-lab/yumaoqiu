'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Button, Checkbox, Modal, QRCode, Space, Tag, Tooltip, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';

/** 扫码报名入口：报名码本身决定组别，链接只需要带码。 */
export function registrationEntryUrl(tournamentId: string, code: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/competitions/${tournamentId}/register?code=${encodeURIComponent(code)}`;
}

/** 按后端 verifyRegistrationCode 的拦截顺序，给出扫码后能否进入报名表。 */
export function qrUsability(state: {
  archived?: boolean;
  published?: boolean;
  groupOpen: boolean;
  codeEnabled: boolean;
}): { usable: boolean; reason?: string } {
  if (state.archived) return { usable: false, reason: '赛事已归档，扫码无法报名' };
  if (state.published === false) return { usable: false, reason: '赛事未审核通过或未公开，扫码暂时无法报名' };
  if (!state.codeEnabled) return { usable: false, reason: '报名码已停用，扫码无法报名' };
  if (!state.groupOpen) return { usable: false, reason: '还没有开放报名的组别，扫码会提示未开放' };
  return { usable: true };
}

export type RegistrationQrTarget = {
  tournamentId: string;
  tournamentName: string;
  /** 一个赛事一个报名码，扫码后报名人自己选组别；不传组别名时海报不印组别。 */
  groupName?: string;
  code: string;
  usable: boolean;
  reason?: string;
};

const COLORS = [
  { value: '#000000', label: '黑色' },
  { value: '#1d4ed8', label: '蓝色' },
  { value: '#15803d', label: '绿色' },
  { value: '#b91c1c', label: '红色' },
];
const DEFAULT_LOGO = '/icon.png';
const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
// 下载图按 2 倍像素绘制；隐藏二维码直接按目标像素渲染，避免放大发糊。
const SCALE = 2;
const QR_SIZE = 480;

function fileSafe(text: string) {
  return text.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || '报名';
}

function fileName(target: RegistrationQrTarget) {
  return [target.tournamentName, target.groupName].filter(Boolean).map((part) => fileSafe(part!)).join('-');
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let line = '';
  for (const char of Array.from(text.trim())) {
    const next = line + char;
    if (!line || ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      const cut = Array.from(line);
      while (cut.length && ctx.measureText(`${cut.join('')}…`).width > maxWidth) cut.pop();
      lines.push(`${cut.join('')}…`);
      return lines;
    }
    lines.push(line);
    line = char;
  }
  if (line) lines.push(line);
  return lines;
}

function saveCanvas(canvas: HTMLCanvasElement, filename: string) {
  try {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = filename;
    link.click();
  } catch {
    message.error('图片导出失败，请换一张 logo 后重试');
  }
}

export function RegistrationQrModal({
  target,
  onClose,
  extra,
}: {
  target: RegistrationQrTarget | null;
  onClose: () => void;
  extra?: ReactNode;
}) {
  const [color, setColor] = useState(COLORS[0].value);
  const [withLogo, setWithLogo] = useState(false);
  // 本地图片只在浏览器里读成 data URL，不上传服务器。
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hiResRef = useRef<HTMLDivElement>(null);

  const url = target ? registrationEntryUrl(target.tournamentId, target.code) : '';
  const logo = withLogo ? customLogo ?? DEFAULT_LOGO : undefined;

  function hiResQr() {
    const canvas = hiResRef.current?.querySelector('canvas');
    if (!canvas) message.error('二维码还没生成好，请稍后再试');
    return canvas ?? null;
  }

  function downloadPlain() {
    const qr = hiResQr();
    if (!qr || !target) return;
    const margin = 32;
    const canvas = document.createElement('canvas');
    canvas.width = (QR_SIZE + margin * 2) * SCALE;
    canvas.height = canvas.width;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, QR_SIZE + margin * 2, QR_SIZE + margin * 2);
    ctx.drawImage(qr, margin, margin, QR_SIZE, QR_SIZE);
    saveCanvas(canvas, `${fileName(target)}-报名二维码.png`);
  }

  function downloadPoster() {
    const qr = hiResQr();
    if (!qr || !target) return;
    const width = 720;
    const pad = 60;
    const center = width / 2;
    const canvas = document.createElement('canvas');
    const measure = canvas.getContext('2d');
    if (!measure) return;
    measure.font = `bold 34px ${FONT}`;
    const titleLines = wrapText(measure, target.tournamentName, width - pad * 2, 2);
    measure.font = `bold 44px ${FONT}`;
    const groupLines = target.groupName ? wrapText(measure, target.groupName, width - pad * 2, 2) : [];
    const height = pad + titleLines.length * 48 + 12 + groupLines.length * 58 + 28 + QR_SIZE + 36 + 40 + 14 + 30 + pad;

    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, 10);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    let y = pad;
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold 34px ${FONT}`;
    for (const line of titleLines) {
      ctx.fillText(line, center, y);
      y += 48;
    }
    y += 12;
    ctx.fillStyle = color;
    ctx.font = `bold 44px ${FONT}`;
    for (const line of groupLines) {
      ctx.fillText(line, center, y);
      y += 58;
    }
    y += 28;
    ctx.drawImage(qr, (width - QR_SIZE) / 2, y, QR_SIZE, QR_SIZE);
    y += QR_SIZE + 36;
    ctx.fillStyle = '#334155';
    ctx.font = `bold 30px ${FONT}`;
    ctx.fillText(`报名码  ${target.code}`, center, y);
    y += 40 + 14;
    ctx.fillStyle = '#64748b';
    ctx.font = `24px ${FONT}`;
    ctx.fillText(target.groupName ? '微信扫一扫，进入本组报名' : '微信扫一扫，选择组别报名', center, y);

    saveCanvas(canvas, `${fileName(target)}-报名海报.png`);
  }

  function pickLogo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      message.error('logo 图片请小于 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCustomLogo(typeof reader.result === 'string' ? reader.result : null);
      setWithLogo(true);
    };
    reader.readAsDataURL(file);
  }

  const qrProps = {
    value: url,
    color,
    bgColor: '#ffffff',
    icon: logo,
    errorLevel: logo ? ('H' as const) : ('M' as const),
    bordered: false,
  };

  return (
    <Modal title="报名二维码" open={Boolean(target)} onCancel={onClose} footer={null} width={460} destroyOnHidden>
      {target ? (
        <Space orientation="vertical" size={12} style={{ width: '100%', alignItems: 'center', position: 'relative' }}>
          <div style={{ textAlign: 'center' }}>
            {target.groupName ? (
              <>
                <Typography.Text type="secondary">{target.tournamentName}</Typography.Text>
                <Typography.Title level={4} style={{ margin: '2px 0 0' }}>{target.groupName}</Typography.Title>
              </>
            ) : (
              <Typography.Title level={4} style={{ margin: 0 }}>{target.tournamentName}</Typography.Title>
            )}
          </div>
          <QRCode {...qrProps} type="canvas" size={240} iconSize={52} />
          <Tag color={target.usable ? 'green' : 'orange'}>{target.usable ? (target.groupName ? '扫码可直接进入本组报名' : '扫码后选择组别报名') : target.reason}</Tag>
          <Typography.Text>
            报名码{' '}
            <Typography.Text code copyable={{ text: target.code }}>
              {target.code}
            </Typography.Text>
          </Typography.Text>
          <Typography.Text
            type="secondary"
            copyable={{ text: url }}
            style={{ fontSize: 12, textAlign: 'center', wordBreak: 'break-all' }}
          >
            {url}
          </Typography.Text>

          <Space wrap size={10} style={{ justifyContent: 'center' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              颜色
            </Typography.Text>
            {COLORS.map((item) => (
              <Tooltip key={item.value} title={item.label}>
                <button
                  type="button"
                  aria-label={item.label}
                  onClick={() => setColor(item.value)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: item.value,
                    border: '2px solid #fff',
                    boxShadow: color === item.value ? `0 0 0 2px ${item.value}` : '0 0 0 1px #e2e8f0',
                    cursor: 'pointer',
                  }}
                />
              </Tooltip>
            ))}
            <Checkbox checked={withLogo} onChange={(event) => setWithLogo(event.target.checked)}>
              中间放 logo
            </Checkbox>
            {withLogo ? (
              customLogo ? (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setCustomLogo(null)}>
                  恢复网站图标
                </Button>
              ) : (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => fileRef.current?.click()}>
                  换成本地图片
                </Button>
              )
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                pickLogo(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </Space>

          <Space wrap style={{ justifyContent: 'center' }}>
            <Button type="primary" icon={<DownloadOutlined />} onClick={downloadPoster}>
              下载海报
            </Button>
            <Button icon={<DownloadOutlined />} onClick={downloadPlain}>
              下载纯二维码
            </Button>
            {extra}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
            海报印有赛事名和报名码，适合发群或打印。本站图片审核会拦截二维码，请勿把海报上传为赛事封面或赛事图片。
          </Typography.Text>

          {/* 下载用的高清二维码，不显示 */}
          <div ref={hiResRef} aria-hidden style={{ position: 'absolute', left: -99999, top: 0, pointerEvents: 'none' }}>
            <QRCode {...qrProps} type="canvas" size={QR_SIZE * SCALE} iconSize={Math.round(QR_SIZE * SCALE * 0.2)} />
          </div>
        </Space>
      ) : null}
    </Modal>
  );
}
