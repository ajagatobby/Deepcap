import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { VideoController } from './video.controller';
import { ProvidersModule } from '../providers/providers.module';

/**
 * Module for video analysis endpoints
 * Supports multiple AI providers (Gemini, OpenAI)
 */
@Module({
  imports: [
    ProvidersModule,
    MulterModule.register({
      dest: './uploads',
    }),
  ],
  controllers: [VideoController],
})
export class VideoModule {}
