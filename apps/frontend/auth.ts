import NextAuth from 'next-auth';
import { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

class LockedCredentialsSignin extends CredentialsSignin {
  code = 'locked';
}

async function refreshAccessToken(token: Record<string, unknown>): Promise<Record<string, unknown>> {
  const refreshToken = token.refreshToken as string | undefined;
  if (!refreshToken) {
    return { ...token, authError: 'RefreshAccessTokenError' };
  }

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message ?? 'refresh failed');
    }

    // Pull the freshest user fields off the refresh response so server-side
    // role / status changes (e.g. an admin getting promoted to super admin)
    // propagate into the next session tick without forcing the user to
    // log out and back in.
    const fresh = (data.user ?? {}) as {
      role?: string;
      status?: string;
      mustChangePassword?: boolean;
      username?: string;
      email?: string;
    };

    return {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt: new Date(data.accessTokenExpiresAt).getTime(),
      refreshTokenExpiresAt: new Date(data.refreshTokenExpiresAt).getTime(),
      role: fresh.role ?? token.role,
      status: fresh.status ?? token.status,
      mustChangePassword: fresh.mustChangePassword ?? token.mustChangePassword,
      username: fresh.username ?? token.username,
      email: fresh.email ?? token.email,
      authError: undefined,
    };
  } catch {
    return { ...token, authError: 'RefreshAccessTokenError' };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [
    Credentials({
      credentials: {
        loginType: { label: '登录方式', type: 'text' },
        identifier: { label: '用户名或邮箱', type: 'text' },
        password: { label: '密码', type: 'password' },
        rememberMe: { label: '记住我', type: 'text' },
      },
      async authorize(credentials) {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loginType: credentials?.loginType,
            identifier: credentials?.identifier,
            password: credentials?.password,
            rememberMe: credentials?.rememberMe === 'true',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data?.message === '账号已锁定,请稍后再试') {
            throw new LockedCredentialsSignin();
          }
          return null;
        }
        return {
          id: data.user.id,
          name: data.user.name,
          username: data.user.username,
          email: data.user.email,
          role: data.user.role,
          status: data.user.status,
          mustChangePassword: data.user.mustChangePassword,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          accessTokenExpiresAt: new Date(data.accessTokenExpiresAt).getTime(),
          refreshTokenExpiresAt: new Date(data.refreshTokenExpiresAt).getTime(),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.accessToken = (user as { accessToken: string }).accessToken;
        token.refreshToken = (user as { refreshToken: string }).refreshToken;
        token.accessTokenExpiresAt = (user as { accessTokenExpiresAt: number }).accessTokenExpiresAt;
        token.refreshTokenExpiresAt = (user as { refreshTokenExpiresAt: number }).refreshTokenExpiresAt;
        token.status = (user as { status: string }).status;
        token.mustChangePassword = (user as { mustChangePassword: boolean }).mustChangePassword;
        token.username = (user as { username?: string }).username;
        token.email = user.email;
        token.authError = undefined;
      }
      // After a self-service rename the page calls `update({ name })` so the
      // new display name propagates app-wide without a full re-login.
      if (trigger === 'update' && session && typeof (session as { name?: unknown }).name === 'string') {
        const nextName = (session as { name: string }).name;
        token.name = nextName;
        token.username = nextName;
      }
      if (token.accessTokenExpiresAt && Date.now() < (token.accessTokenExpiresAt as number) - 60_000) {
        return token;
      }
      if (token.refreshToken) {
        return refreshAccessToken(token);
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? session.user.id;
      session.user.role = token.role as string;
      session.user.accessToken = token.accessToken as string;
      session.user.status = token.status as string;
      session.user.mustChangePassword = Boolean(token.mustChangePassword);
      session.user.username = token.username as string;
      session.user.email = token.email ?? session.user.email ?? null;
      session.authError = token.authError as string | undefined;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
