/**
 * Common types and interfaces for AI providers
 */

/**
 * Supported AI providers
 */
export enum AIProvider {
  GEMINI = 'gemini',
  OPENAI = 'openai',
}

/**
 * Token usage metadata
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens?: number;
}

/**
 * Analysis options common to all providers
 */
export interface AnalysisOptions {
  /** Quality level for analysis (maps to thinkingLevel in Gemini, temperature in OpenAI) */
  qualityLevel?: 'low' | 'medium' | 'high';
  /** Media resolution for video/image processing */
  mediaResolution?: 'low' | 'medium' | 'high';
  /** Custom system prompt */
  systemPrompt?: string;
}

/**
 * Indexing options for frame extraction
 */
export interface IndexingOptions {
  /** Quality level for analysis */
  qualityLevel?: 'low' | 'medium' | 'high';
  /** Media resolution for video/image processing */
  mediaResolution?: 'low' | 'medium' | 'high';
  /** Whether to use advanced multi-modal extraction */
  advanced?: boolean;
}

/**
 * Chat session options
 */
export interface ChatOptions {
  /** Quality level for analysis */
  qualityLevel?: 'low' | 'medium' | 'high';
  /** Media resolution for video/image processing */
  mediaResolution?: 'low' | 'medium' | 'high';
}

/**
 * Text generation options for RAG synthesis
 */
export interface TextGenerationOptions {
  /** System instruction for the model */
  systemInstruction?: string;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Quality level (maps to temperature in OpenAI) */
  qualityLevel?: 'low' | 'medium' | 'high';
}

/**
 * Text generation result
 */
export interface TextGenerationResult {
  text: string;
  tokenUsage?: TokenUsage;
}

/**
 * Provider information
 */
export interface ProviderInfo {
  name: AIProvider;
  modelName: string;
  isAvailable: boolean;
}
