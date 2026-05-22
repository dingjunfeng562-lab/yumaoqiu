import 'next-auth';

declare module 'next-auth' {
  interface User {
    username?: string;
    role: string;
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
      accessToken: string;
      status: string;
      mustChangePassword: boolean;
    };
    authError?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    username?: string;
    role?: string;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpiresAt?: number;
    refreshTokenExpiresAt?: number;
    status?: string;
    mustChangePassword?: boolean;
    authError?: string;
  }
}
