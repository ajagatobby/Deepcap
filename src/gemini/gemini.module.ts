import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GeminiService } from './gemini.service';
import { FileManagerService } from './file-manager.service';
import { VideoAnalyzeService } from './video-analyze.service';
import { ChatService } from './chat.service';
import { GeminiTextGeneratorService } from './gemini-text-generator.service';

/**
 * Module providing Gemini AI services for video understanding
 */
@Module({
  imports: [ConfigModule],
  providers: [
    GeminiService,
    FileManagerService,
    VideoAnalyzeService,
    ChatService,
    GeminiTextGeneratorService,
  ],
  exports: [
    GeminiService,
    FileManagerService,
    VideoAnalyzeService,
    ChatService,
    GeminiTextGeneratorService,
  ],
})
export class GeminiModule {}
