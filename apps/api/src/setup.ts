import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { raw } from 'express';
import helmet from 'helmet';
import { AppException } from './common/app-exception';
import { AllExceptionsFilter } from './common/response';
import { env } from './config/env';

const flatten = (errs: ValidationError[], parent = ''): Array<{ field: string; message: string }> =>
  errs.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    return [
      ...Object.values(e.constraints ?? {}).map((message) => ({ field, message })),
      ...flatten(e.children ?? [], field),
    ];
  });

/** Shared by main.ts and the e2e tests so both run the exact same HTTP pipeline. */
export function configureApp(app: INestApplication) {
  const http = app.getHttpAdapter().getInstance();
  http.set('trust proxy', 1);
  http.disable('x-powered-by');

  app.setGlobalPrefix('api/v1');
  app.use((req: any, res: any, next: () => void) => {
    req.requestId = randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  app.use(helmet());
  app.use(cookieParser());
  // raw bytes for presigned local uploads (must precede the JSON parser)
  app.use('/api/v1/attachments/local-upload', raw({ type: '*/*', limit: '5mb' }));

  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Device-Id', 'X-Entry-Source'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      errorHttpStatusCode: 422,
      exceptionFactory: (errors) =>
        new AppException(422, 'VALIDATION_ERROR', 'Some fields need attention', flatten(errors)),
    }),
  );
}
