import { NestFactory } from '@nestjs/core';
import { frontendUrl, observeEnabled } from './env.js';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    ...(observeEnabled ? { instrument: ObserveInstrument } : {}),
  });

  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001 );
}

await bootstrap();
