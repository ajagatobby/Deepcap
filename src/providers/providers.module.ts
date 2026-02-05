import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GeminiModule } from '../gemini/gemini.module';
import { OpenAIModule } from '../openai/openai.module';
import { AIProviderFactory } from './ai-provider.factory';

/**
 * Module that provides the AI provider factory and related services
 * Import this module to get access to provider selection functionality
 */
@Module({
  imports: [ConfigModule, GeminiModule, OpenAIModule],
  providers: [AIProviderFactory],
  exports: [AIProviderFactory, GeminiModule, OpenAIModule],
})
export class ProvidersModule {}
