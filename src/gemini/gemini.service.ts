import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

/**
 * Service for initializing and providing the Google GenAI client
 */
@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private client: GoogleGenAI;
  private modelName: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    this.client = new GoogleGenAI({ apiKey });
    this.modelName = this.configService.get<string>('GEMINI_MODEL', 'gemini-3-flash-preview');
    
    this.logger.log(`Gemini client initialized with model: ${this.modelName}`);
  }

  /**
   * Get the GoogleGenAI client instance
   */
  getClient(): GoogleGenAI {
    return this.client;
  }

  /**
   * Get the configured model name
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Get the Files API instance for file operations
   */
  getFilesApi() {
    return this.client.files;
  }

  /**
   * Get the Models API instance for content generation
   */
  getModelsApi() {
    return this.client.models;
  }

  /**
   * Get the Chats API instance for multi-turn conversations
   */
  getChatsApi() {
    return this.client.chats;
  }
}
