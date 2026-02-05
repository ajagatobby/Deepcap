import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIProvider,
  IVideoAnalyzer,
  IChatProvider,
  ITextGenerator,
  IFileHandler,
  ProviderInfo,
} from './interfaces';

// Gemini imports
import { VideoAnalyzeService as GeminiVideoAnalyzer } from '../gemini/video-analyze.service';
import { ChatService as GeminiChatService } from '../gemini/chat.service';
import { FileManagerService as GeminiFileHandler } from '../gemini/file-manager.service';
import { GeminiService } from '../gemini/gemini.service';
import { GeminiTextGeneratorService } from '../gemini/gemini-text-generator.service';

// OpenAI imports
import { OpenAIVideoAnalyzerService } from '../openai/openai-video-analyzer.service';
import { OpenAIChatService } from '../openai/openai-chat.service';
import { OpenAITextGeneratorService } from '../openai/openai-text-generator.service';
import { OpenAIFileHandlerService } from '../openai/openai-file-handler.service';
import { OpenAIService } from '../openai/openai.service';

/**
 * Factory service for selecting and providing AI providers
 * Allows runtime selection of Gemini or OpenAI based on configuration or request
 */
@Injectable()
export class AIProviderFactory {
  private readonly logger = new Logger(AIProviderFactory.name);
  private readonly defaultProvider: AIProvider;

  constructor(
    private readonly configService: ConfigService,
    // Gemini services
    private readonly geminiService: GeminiService,
    private readonly geminiVideoAnalyzer: GeminiVideoAnalyzer,
    private readonly geminiChatService: GeminiChatService,
    private readonly geminiFileHandler: GeminiFileHandler,
    private readonly geminiTextGenerator: GeminiTextGeneratorService,
    // OpenAI services
    private readonly openaiService: OpenAIService,
    private readonly openaiVideoAnalyzer: OpenAIVideoAnalyzerService,
    private readonly openaiChatService: OpenAIChatService,
    private readonly openaiTextGenerator: OpenAITextGeneratorService,
    private readonly openaiFileHandler: OpenAIFileHandlerService,
  ) {
    const configuredProvider = this.configService.get<string>(
      'AI_PROVIDER',
      'gemini',
    );
    this.defaultProvider =
      configuredProvider === 'openai' ? AIProvider.OPENAI : AIProvider.GEMINI;

    this.logger.log(`Default AI provider: ${this.defaultProvider}`);
  }

  /**
   * Get the default provider
   */
  getDefaultProvider(): AIProvider {
    return this.defaultProvider;
  }

  /**
   * Get information about available providers
   */
  getAvailableProviders(): ProviderInfo[] {
    const providers: ProviderInfo[] = [];

    // Check Gemini availability
    try {
      this.geminiService.getClient();
      providers.push({
        name: AIProvider.GEMINI,
        modelName: this.geminiService.getModelName(),
        isAvailable: true,
      });
    } catch {
      providers.push({
        name: AIProvider.GEMINI,
        modelName: 'not configured',
        isAvailable: false,
      });
    }

    // Check OpenAI availability
    if (this.openaiService.isAvailable()) {
      providers.push({
        name: AIProvider.OPENAI,
        modelName: this.openaiService.getModelName(),
        isAvailable: true,
      });
    } else {
      providers.push({
        name: AIProvider.OPENAI,
        modelName: 'not configured',
        isAvailable: false,
      });
    }

    return providers;
  }

  /**
   * Check if a specific provider is available
   */
  isProviderAvailable(provider: AIProvider): boolean {
    if (provider === AIProvider.GEMINI) {
      try {
        this.geminiService.getClient();
        return true;
      } catch {
        return false;
      }
    }

    if (provider === AIProvider.OPENAI) {
      return this.openaiService.isAvailable();
    }

    return false;
  }

  /**
   * Validate and resolve provider
   * Falls back to default if requested provider is not available
   */
  resolveProvider(requestedProvider?: AIProvider | string): AIProvider {
    // Normalize the provider string
    const provider = this.normalizeProvider(requestedProvider);

    // Check if requested provider is available
    if (provider && this.isProviderAvailable(provider)) {
      return provider;
    }

    // If not available, check if default is available
    if (this.isProviderAvailable(this.defaultProvider)) {
      if (provider && provider !== this.defaultProvider) {
        this.logger.warn(
          `Requested provider ${provider} is not available, falling back to ${this.defaultProvider}`,
        );
      }
      return this.defaultProvider;
    }

    // Try the other provider
    const fallback =
      this.defaultProvider === AIProvider.GEMINI
        ? AIProvider.OPENAI
        : AIProvider.GEMINI;

    if (this.isProviderAvailable(fallback)) {
      this.logger.warn(
        `Default provider ${this.defaultProvider} is not available, falling back to ${fallback}`,
      );
      return fallback;
    }

    throw new HttpException(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'No AI providers are available. Please configure GEMINI_API_KEY or OPENAI_API_KEY.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /**
   * Normalize provider string to AIProvider enum
   */
  private normalizeProvider(provider?: AIProvider | string): AIProvider | null {
    if (!provider) return null;

    const normalized = String(provider).toLowerCase();
    if (normalized === 'gemini') return AIProvider.GEMINI;
    if (normalized === 'openai') return AIProvider.OPENAI;

    return null;
  }

  /**
   * Get video analyzer for the specified provider
   */
  getVideoAnalyzer(provider?: AIProvider | string): IVideoAnalyzer {
    const resolvedProvider = this.resolveProvider(provider);

    if (resolvedProvider === AIProvider.OPENAI) {
      return this.openaiVideoAnalyzer;
    }

    // Cast Gemini service to interface (will implement in next step)
    return this.geminiVideoAnalyzer as unknown as IVideoAnalyzer;
  }

  /**
   * Get chat provider for the specified provider
   */
  getChatProvider(provider?: AIProvider | string): IChatProvider {
    const resolvedProvider = this.resolveProvider(provider);

    if (resolvedProvider === AIProvider.OPENAI) {
      return this.openaiChatService;
    }

    // Cast Gemini service to interface (will implement in next step)
    return this.geminiChatService as unknown as IChatProvider;
  }

  /**
   * Get text generator for the specified provider
   */
  getTextGenerator(provider?: AIProvider | string): ITextGenerator {
    const resolvedProvider = this.resolveProvider(provider);

    if (resolvedProvider === AIProvider.OPENAI) {
      return this.openaiTextGenerator;
    }

    return this.geminiTextGenerator;
  }

  /**
   * Get file handler for the specified provider
   */
  getFileHandler(provider?: AIProvider | string): IFileHandler {
    const resolvedProvider = this.resolveProvider(provider);

    if (resolvedProvider === AIProvider.OPENAI) {
      return this.openaiFileHandler;
    }

    // Cast Gemini service to interface (will implement in next step)
    return this.geminiFileHandler as unknown as IFileHandler;
  }
}
