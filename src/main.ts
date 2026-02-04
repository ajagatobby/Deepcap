import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Get config service
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  // Enable validation pipe globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Enable global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Enable CORS
  app.enableCors();

  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Video analysis endpoint: POST http://localhost:${port}/video/analyze`);
  logger.log(`YouTube analysis endpoint: POST http://localhost:${port}/video/analyze-url`);
}

bootstrap();
