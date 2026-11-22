import type { NextRequest } from 'next/server';

export function GET(request: NextRequest) {
  return new Response(null, {
    status: 307,
    headers: { Location: `/competitions${request.nextUrl.search}` },
  });
}
