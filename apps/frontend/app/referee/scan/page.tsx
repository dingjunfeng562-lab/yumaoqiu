'use client';
import { useCurrentAccess } from '@/lib/use-current-role';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Input, Spin } from 'antd';
import { CameraOutlined, PictureOutlined } from '@ant-design/icons';
import { parseRefereeEntry } from '@/lib/referee-entry';

export default function RefereeScanPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const access = useCurrentAccess();
  const canReferee = access.ready && access.can('REFEREE');
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const [scanning, setScanning] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');

  function stopCamera() {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }

  useEffect(() => () => stopCamera(), []);

  function openEntry(value: string) {
    const path = parseRefereeEntry(value, window.location.origin);
    stopCamera();
    setScanning(false);
    router.push(path);
  }

  async function startCamera() {
    stopCamera();
    const run = generation.current;
    setError('');
    setScanning(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前环境无法打开摄像头，请使用 HTTPS 访问，或选择二维码图片识别。');
      }
      const { default: jsQR } = await import('jsqr');
      if (run !== generation.current) return;
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
      if (run !== generation.current || !video.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      video.current.srcObject = media;
      await video.current.play();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('当前浏览器无法识别二维码，请更换浏览器。');
      function tick() {
        if (run !== generation.current) return;
        const frame = video.current;
        if (frame && frame.readyState >= 2 && frame.videoWidth) {
          canvas.width = Math.min(frame.videoWidth, 960);
          canvas.height = Math.round(frame.videoHeight * canvas.width / frame.videoWidth);
          context!.drawImage(frame, 0, 0, canvas.width, canvas.height);
          const pixels = context!.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(pixels.data, pixels.width, pixels.height);
          if (code) {
            try { openEntry(code.data); return; }
            catch (err) { setError(err instanceof Error ? err.message : '二维码无效'); }
          }
        }
        timer.current = setTimeout(tick, 200);
      }
      tick();
    } catch (err) {
      if (run !== generation.current) return;
      stopCamera();
      setScanning(false);
      setError(err instanceof DOMException && err.name === 'NotAllowedError'
        ? '摄像头权限未开启，请允许访问摄像头，或选择二维码图片。'
        : err instanceof Error ? err.message : '摄像头启动失败，请选择二维码图片。');
    }
  }

  async function readImage(file?: File) {
    if (!file) return;
    stopCamera();
    setScanning(false);
    setReading(true);
    setError('');
    const run = generation.current;
    const objectUrl = URL.createObjectURL(file);
    try {
      const { default: jsQR } = await import('jsqr');
      const picture = new Image();
      picture.src = objectUrl;
      await picture.decode();
      if (run !== generation.current) return;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(picture.naturalWidth, picture.naturalHeight));
      canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器无法读取图片');
      context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(pixels.data, pixels.width, pixels.height);
      if (!code) throw new Error('未识别到二维码，请选择清晰、完整的赛事二维码图片');
      openEntry(code.data);
    } catch (err) {
      if (run === generation.current) setError(err instanceof Error ? err.message : '图片识别失败');
    } finally {
      URL.revokeObjectURL(objectUrl);
      setReading(false);
    }
  }

  if (status === 'loading') return <div className="grid min-h-screen place-items-center"><Spin /></div>;
  if (!canReferee) return <Alert type="error" title="请使用裁判账号登录后扫码" />;

  return (
    <main className="min-h-screen bg-slate-50 !px-4 !py-6">
      <section className="!mx-auto flex max-w-xl flex-col gap-5 rounded-2xl border border-blue-100 bg-white !p-5 shadow-sm">
        <Link href="/referee/my-matches" className="text-blue-600">← 返回我的赛事</Link>
        <h1 className="text-2xl font-black">扫码执裁</h1>
        <p className="text-sm text-slate-500">扫描后台「裁判分配」中的赛事二维码，获得该赛事授权后，先选择场地，再查看具体比赛。</p>
        {error && <Alert type="warning" title={error} showIcon />}
        <div className="relative overflow-hidden rounded-xl bg-slate-900">
          <video ref={video} muted playsInline className="aspect-square w-full object-cover" />
          {!scanning && <div className="absolute inset-0 grid place-items-center text-slate-300">将赛事二维码放入取景框</div>}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="large" type="primary" icon={<CameraOutlined />} disabled={reading} onClick={() => {
            if (scanning) { stopCamera(); setScanning(false); } else { void startCamera(); }
          }}>{scanning ? '关闭摄像头' : '打开摄像头扫码'}</Button>
          <Button size="large" icon={<PictureOutlined />} loading={reading} onClick={() => fileInput.current?.click()}>识别二维码图片</Button>
          <input ref={fileInput} type="file" accept="image/*" aria-label="选择二维码图片" className="hidden" onChange={(event) => {
            void readImage(event.target.files?.[0]);
            event.target.value = '';
          }} />
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-100 !pt-4">
          <p className="text-sm text-slate-500">也可以粘贴管理员复制的赛事入口链接</p>
          <Input.Search aria-label="赛事入口链接" placeholder="粘贴赛事入口链接" enterButton="进入赛事" value={link} onChange={(event) => setLink(event.target.value)} onSearch={() => {
            try { openEntry(link); } catch (err) { setError(err instanceof Error ? err.message : '链接无效'); }
          }} />
        </div>
      </section>
    </main>
  );
}
