import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const EXTERNAL_PUBLIC_URL = process.env.HAWKEYE_PUBLIC_URL || process.env.NEXT_PUBLIC_HAWKEYE_URL || '';
const GRADIO_URL = process.env.GRADIO_URL || EXTERNAL_PUBLIC_URL || 'http://127.0.0.1:7861';
const PUBLIC_URL = EXTERNAL_PUBLIC_URL || (IS_PRODUCTION ? '' : GRADIO_URL);

function payload(extra: Record<string, unknown> = {}) {
  return {
    configured: Boolean(PUBLIC_URL),
    publicUrl: PUBLIC_URL,
    ...extra,
  };
}

async function isGradioOnline() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${GRADIO_URL}/`, {
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timeout);

    return res.status === 200 || res.status === 307;
  } catch {
    return false;
  }
}

async function requireSession() {
  const session = await auth();
  const hasInvalidSession = session?.authError === 'RefreshAccessTokenError';
  if (!session || hasInvalidSession) {
    return {
      response: NextResponse.json(
        {
          online: false,
          configured: false,
          status: 'unauthorized',
          message: '请先登录后再使用鹰眼系统。',
        },
        { status: 401 },
      ),
    };
  }

  return {
    response: null,
    accessToken: session.user.accessToken,
  };
}

async function trackHawkeyeUsage(accessToken?: string) {
  if (!accessToken) return;

  try {
    await fetch(`${API_BASE}/usage-metrics/hawkeye`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });
  } catch {
    // Usage tracking should not block opening Hawkeye.
  }
}

export async function GET() {
  const authCheck = await requireSession();
  if (authCheck.response) return authCheck.response;

  const online = await isGradioOnline();

  if (!PUBLIC_URL) {
    return NextResponse.json(
      payload({
        online,
        message: '线上访问需要设置 HAWKEYE_PUBLIC_URL，不能把浏览器跳转到服务器内部的 127.0.0.1。',
      }),
    );
  }

  if (online) {
    await trackHawkeyeUsage(authCheck.accessToken);
  }

  return NextResponse.json(payload({ online }));
}

export async function POST() {
  const authCheck = await requireSession();
  if (authCheck.response) return authCheck.response;

  const online = await isGradioOnline();

  if (!PUBLIC_URL) {
    return NextResponse.json(
      payload({
        online,
        status: 'not_configured',
        message: '请先把 Good-Badminton 的 Gradio WebUI 单独部署成服务，再设置 HAWKEYE_PUBLIC_URL。',
      }),
      { status: 400 },
    );
  }

  if (!online) {
    return NextResponse.json(
      payload({
        online,
        status: 'not_running',
        message: '鹰眼服务暂时不可访问，请检查 Gradio 服务是否已经启动。',
      }),
      { status: 503 },
    );
  }

  return NextResponse.json(payload({ online, status: 'online' }));
}
