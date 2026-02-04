import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GeminiService } from './gemini.service';
import { FileManagerService } from './file-manager.service';
import { VideoAnalyzeService } from './video-analyze.service';
import { ChatService } from './chat.service';

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
  ],
  exports: [
    GeminiService,
    FileManagerService,
    VideoAnalyzeService,
    ChatService,
  ],
})
export class GeminiModule {}
