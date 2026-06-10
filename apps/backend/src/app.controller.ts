import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  redirectToFrontend(@Res() response: Response) {
    return response.redirect(this.appService.getFrontendUrl());
  }

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }
}
