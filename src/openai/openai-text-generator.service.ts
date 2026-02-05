import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { OpenAIService } from './openai.service';
import {
  ITextGenerator,
  TextGenerationOptions,
  TextGenerationResult,
} from '../providers/interfaces';

/**
 * Service for text generation using OpenAI
 * Used for RAG synthesis and general text generation
 */
@Injectable()
export class OpenAITextGeneratorService implements ITextGenerator {
  private readonly logger = new Logger(OpenAITextGeneratorService.name);

  constructor(private readonly openaiService: OpenAIService) {}

  getProviderName(): string {
    return 'openai';
  }

  /**
   * Generate text content based on a prompt
   */
  async generateContent(
    prompt: string,
    options?: TextGenerationOptions,
  ): Promise<TextGenerationResult> {
    const chatCompletions = this.openaiService.getChatCompletions();
    const modelName = this.openaiService.getModelName();
    const temperature = this.openaiService.mapQualityToTemperature(
      options?.qualityLevel,
    );

    this.logger.debug(
      `Generating content with temperature=${temperature}, maxTokens=${options?.maxOutputTokens || 1024}`,
    );

    try {
      const response = await chatCompletions.create({
        model: modelName,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature,
        max_tokens: options?.maxOutputTokens || 1024,
      });

      const text = response.choices[0]?.message?.content || '';

      return {
        text,
        tokenUsage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
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
    const chatCompletions = this.openaiService.getChatCompletions();
    const modelName = this.openaiService.getModelName();
    const temperature = this.openaiService.mapQualityToTemperature(
      options?.qualityLevel,
    );

    this.logger.debug(
      `Generating content with system instruction, temperature=${temperature}`,
    );

    try {
      const response = await chatCompletions.create({
        model: modelName,
        messages: [
          {
            role: 'system',
            content: systemInstruction,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature,
        max_tokens: options?.maxOutputTokens || 1024,
      });

      const text = response.choices[0]?.message?.content || '';

      return {
        text,
        tokenUsage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
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
   * Handle OpenAI API errors
   */
  private handleError(error: any): HttpException {
    // Rate limiting
    if (error.status === 429) {
      return new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'OpenAI API rate limit exceeded. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Authentication error
    if (error.status === 401) {
      return new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Invalid OpenAI API key.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Model not found
    if (error.status === 404) {
      return new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `OpenAI model not found: ${error.message}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: `OpenAI API error: ${error.message}`,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
