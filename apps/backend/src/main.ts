import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

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

  await app.listen(process.env.PORT ?? 4000);
  console.log(`Backend running on http://localhost:${process.env.PORT ?? 4000}`);
}
bootstrap();
