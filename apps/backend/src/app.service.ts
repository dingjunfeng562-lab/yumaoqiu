import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getFrontendUrl(): string {
    return process.env.FRONTEND_URL ?? 'http://localhost:3000';
  }

  getHealth() {
    return {
      status: 'ok',
      service: 'backend',
    };
  }
}
