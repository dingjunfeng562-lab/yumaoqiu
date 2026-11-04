import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { MaintenanceMiddleware } from './maintenance/maintenance.middleware';

function parseCorsOrigins(value?: string) {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api', {
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGIN ?? process.env.FRONTEND_URL);

  app.enableCors({
    origin: allowedOrigins.length === 0 ? true : allowedOrigins,
    credentials: true,
  });
  // 全服维护闸门：放在 CORS 之后（503 也要带跨域头，前端才读得到提示），路由之前。
  app.use(app.get(MaintenanceMiddleware).use);

  await app.listen(process.env.PORT ?? 4000, '0.0.0.0');
  console.log(`Backend running on http://0.0.0.0:${process.env.PORT ?? 4000}`);
}
bootstrap();
