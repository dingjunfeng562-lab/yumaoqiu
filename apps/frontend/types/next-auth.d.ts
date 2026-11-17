import 'next-auth';

declare module 'next-auth' {
  interface User {
    username?: string;
    role: string;
    permissions?: string[];
    accessToken: string;
    status: string;
    mustChangePassword: boolean;
    refreshToken?: string;
    accessTokenExpiresAt?: number;
    refreshTokenExpiresAt?: number;
  }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      username?: string | null;
      email?: string | null;
      image?: string | null;
      role: string;
      permissions?: string[];
      accessToken: string;
      status: string;
      mustChangePassword: boolean;
    };
    authError?: string;
    /** 本次登录的截止时间（毫秒时间戳），裁判端比赛保活用。 */
    accessTokenExpiresAt?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    username?: string;
    role?: string;
    permissions?: string[];
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpiresAt?: number;
    refreshTokenExpiresAt?: number;
    status?: string;
    mustChangePassword?: boolean;
    authError?: string;
  }
}
