import './env.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
const app = await NestFactory.create(AppModule, { bodyParser: false });
configureApp(app);
await app.listen(Number(process.env.BACKEND_PORT || process.env.PORT || 3001), '0.0.0.0');
