import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { VideoController } from './video.controller';
import { GeminiModule } from '../gemini';

/**
 * Module for video analysis endpoints
 */
@Module({
  imports: [
    GeminiModule,
    MulterModule.register({
      dest: './uploads',
    }),
  ],
  controllers: [VideoController],
})
export class VideoModule {}
