import { TextGenerationOptions, TextGenerationResult } from './ai-provider.interface';

/**
 * Interface for text generation operations (used in RAG synthesis)
 * Implemented by both Gemini and OpenAI providers
 */
export interface ITextGenerator {
  /**
   * Get the provider name
   */
  getProviderName(): string;

  /**
   * Generate text content based on a prompt
   * @param prompt The input prompt
   * @param options Generation options
   */
  generateContent(
    prompt: string,
    options?: TextGenerationOptions,
  ): Promise<TextGenerationResult>;

  /**
   * Generate text content with a system instruction
   * @param systemInstruction System-level instruction
   * @param prompt User prompt
   * @param options Generation options
   */
  generateWithSystemInstruction(
    systemInstruction: string,
    prompt: string,
    options?: TextGenerationOptions,
  ): Promise<TextGenerationResult>;
}

/**
 * Text generator injection token
 */
export const TEXT_GENERATOR_TOKEN = 'TEXT_GENERATOR';
