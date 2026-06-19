import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should report the service as ok', () => {
      expect(appController.getHealth()).toEqual({ status: 'ok', service: 'backend' });
    });
  });

  describe('root', () => {
    it('should redirect to the configured frontend url', () => {
      const redirect = jest.fn();
      const response = { redirect } as unknown as Response;

      appController.redirectToFrontend(response);

      expect(redirect).toHaveBeenCalledWith(
        process.env.FRONTEND_URL ?? 'http://localhost:3000',
      );
    });
  });
});
