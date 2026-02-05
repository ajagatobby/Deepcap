import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ThinkingLevel } from '@google/genai';
import { GeminiService } from './gemini.service';
import {
  ITextGenerator,
  TextGenerationOptions,
  TextGenerationResult,
} from '../providers/interfaces';

/**
 * Service for text generation using Gemini
 * Used for RAG synthesis and general text generation
 * Implements ITextGenerator interface for provider abstraction
 */
@Injectable()
export class GeminiTextGeneratorService implements ITextGenerator {
  private readonly logger = new Logger(GeminiTextGeneratorService.name);

  constructor(private readonly geminiService: GeminiService) {}

  /**
   * Get the provider name
   */
  getProviderName(): string {
    return 'gemini';
  }

  /**
   * Map quality level to Gemini thinking level
   */
  private mapQualityToThinkingLevel(
    quality?: 'low' | 'medium' | 'high',
  ): ThinkingLevel {
    switch (quality) {
      case 'low':
        return ThinkingLevel.LOW;
      case 'medium':
        return ThinkingLevel.MEDIUM;
      case 'high':
      default:
        return ThinkingLevel.HIGH;
    }
  }

  /**
   * Generate text content based on a prompt
   */
  async generateContent(
    prompt: string,
    options?: TextGenerationOptions,
  ): Promise<TextGenerationResult> {
    const modelsApi = this.geminiService.getModelsApi();
    const modelName = this.geminiService.getModelName();
    const thinkingLevel = this.mapQualityToThinkingLevel(options?.qualityLevel);

    this.logger.debug(
      `Generating content with thinkingLevel=${thinkingLevel}, maxTokens=${options?.maxOutputTokens || 1024}`,
    );

    try {
      const response = await modelsApi.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        config: {
          thinkingConfig: {
            thinkingLevel,
          },
          maxOutputTokens: options?.maxOutputTokens || 1024,
        },
      });

      // Extract text from response
      const candidate = response.candidates?.[0];
      let text = '';

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text && !part.thought) {
            text += part.text;
          }
        }
      }

      return {
        text: text || 'Unable to generate response',
        tokenUsage: response.usageMetadata
          ? {
              inputTokens: response.usageMetadata.promptTokenCount || 0,
              outputTokens: response.usageMetadata.candidatesTokenCount || 0,
              thoughtsTokens: response.usageMetadata.thoughtsTokenCount,
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error(`Text generation failed: ${error.message}`);
      throw this.handleError(error);
    }
  }

  /**
   * Generate text content with a system instruction
   */
  async generateWithSystemInstruction(
    systemInstruction: string,
    prompt: string,
    options?: TextGenerationOptions,
  ): Promise<TextGenerationResult> {
    const modelsApi = this.geminiService.getModelsApi();
    const modelName = this.geminiService.getModelName();
    const thinkingLevel = this.mapQualityToThinkingLevel(options?.qualityLevel);

    this.logger.debug(
      `Generating content with system instruction, thinkingLevel=${thinkingLevel}`,
    );

    try {
      const response = await modelsApi.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel,
          },
          maxOutputTokens: options?.maxOutputTokens || 1024,
        },
      });

      // Extract text from response
      const candidate = response.candidates?.[0];
      let text = '';

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text && !part.thought) {
            text += part.text;
          }
        }
      }

      return {
        text: text || 'Unable to generate response',
        tokenUsage: response.usageMetadata
          ? {
              inputTokens: response.usageMetadata.promptTokenCount || 0,
              outputTokens: response.usageMetadata.candidatesTokenCount || 0,
              thoughtsTokens: response.usageMetadata.thoughtsTokenCount,
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error(
        `Text generation with system instruction failed: ${error.message}`,
      );
      throw this.handleError(error);
    }
  }

  /**
   * Handle Gemini API errors
   */
  private handleError(error: any): HttpException {
    // Rate limiting
    if (error.status === 429 || error.message?.includes('429')) {
      return new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Gemini API rate limit exceeded. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Network errors
    const errorMessage = error.message?.toLowerCase() || '';
    if (
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('network')
    ) {
      return new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          message:
            'Failed to connect to Gemini API. Please check your network connection and try again.',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: `Gemini API error: ${error.message}`,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
