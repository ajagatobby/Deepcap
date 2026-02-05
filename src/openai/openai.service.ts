import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * Service for initializing and providing the OpenAI client
 */
@Injectable()
export class OpenAIService implements OnModuleInit {
  private readonly logger = new Logger(OpenAIService.name);
  private client: OpenAI;
  private modelName: string;
  private isConfigured = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY not configured. OpenAI provider will not be available.',
      );
      return;
    }

    this.client = new OpenAI({ apiKey });
    this.modelName = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
    this.isConfigured = true;

    this.logger.log(`OpenAI client initialized with model: ${this.modelName}`);
  }

  /**
   * Check if OpenAI is configured and available
   */
  isAvailable(): boolean {
    return this.isConfigured;
  }

  /**
   * Get the OpenAI client instance
   */
  getClient(): OpenAI {
    if (!this.isConfigured) {
      throw new Error('OpenAI is not configured. Please set OPENAI_API_KEY.');
    }
    return this.client;
  }

  /**
   * Get the configured model name
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Get the chat completions API
   */
  getChatCompletions() {
    return this.getClient().chat.completions;
  }

  /**
   * Get the files API
   */
  getFilesApi() {
    return this.getClient().files;
  }

  /**
   * Map quality level to temperature
   * Higher quality = lower temperature (more deterministic)
   */
  mapQualityToTemperature(quality?: 'low' | 'medium' | 'high'): number {
    switch (quality) {
      case 'low':
        return 0.8;
      case 'medium':
        return 0.5;
      case 'high':
      default:
        return 0.2;
    }
  }

  /**
   * Map media resolution to OpenAI image detail
   */
  mapResolutionToDetail(
    resolution?: 'low' | 'medium' | 'high',
  ): 'low' | 'high' | 'auto' {
    switch (resolution) {
      case 'low':
        return 'low';
      case 'medium':
        return 'auto';
      case 'high':
      default:
        return 'high';
    }
  }
}
