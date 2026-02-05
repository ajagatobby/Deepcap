import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OpenAIService } from './openai.service';
import { OpenAIFileHandlerService } from './openai-file-handler.service';
import { OpenAIVideoAnalyzerService } from './openai-video-analyzer.service';
import { OpenAIChatService } from './openai-chat.service';
import { OpenAITextGeneratorService } from './openai-text-generator.service';
import { FrameExtractorService } from './frame-extractor.service';

@Module({
  imports: [ConfigModule],
  providers: [
    FrameExtractorService,
    OpenAIService,
    OpenAIFileHandlerService,
    OpenAIVideoAnalyzerService,
    OpenAIChatService,
    OpenAITextGeneratorService,
  ],
  exports: [
    FrameExtractorService,
    OpenAIService,
    OpenAIFileHandlerService,
    OpenAIVideoAnalyzerService,
    OpenAIChatService,
    OpenAITextGeneratorService,
  ],
})
export class OpenAIModule {}
