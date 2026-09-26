import './config/load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from './config/env';
import { configureApp } from './setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);
  await app.listen(env.port);
  new Logger('Bootstrap').log(`Branch Pulse API listening on :${env.port} (/api/v1)`);
}

bootstrap();
