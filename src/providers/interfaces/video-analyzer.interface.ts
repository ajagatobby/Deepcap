import {
  VideoAnalysisResult,
  FrameDescription,
} from '../../gemini/interfaces';
import { AdvancedVideoAnalysisResult } from '../../lancedb/interfaces';
import { AnalysisOptions, IndexingOptions } from './ai-provider.interface';

/**
 * YouTube analysis options
 */
export interface YouTubeAnalysisOptions extends AnalysisOptions {
  /** Start offset for video clipping (e.g., "30s", "1m30s") */
  startOffset?: string;
  /** End offset for video clipping */
  endOffset?: string;
}

/**
 * Interface for video analysis operations
 * Implemented by both Gemini and OpenAI providers
 */
export interface IVideoAnalyzer {
  /**
   * Get the provider name
   */
  getProviderName(): string;

  /**
   * Analyze a video file with a specific query
   * @param filePath Path to the video file
   * @param mimeType MIME type of the video
   * @param query The analysis query/question
   * @param options Configuration options
   */
  analyzeVideoFile(
    filePath: string,
    mimeType: string,
    query: string,
    options?: AnalysisOptions,
  ): Promise<VideoAnalysisResult>;

  /**
   * Analyze a video by its file URI (already uploaded/processed)
   * @param fileUri URI of the uploaded file
   * @param mimeType MIME type of the video
   * @param query The analysis query/question
   * @param options Configuration options
   */
  analyzeByFileUri(
    fileUri: string,
    mimeType: string,
    query: string,
    options?: AnalysisOptions,
  ): Promise<VideoAnalysisResult>;

  /**
   * Analyze a YouTube video URL
   * @param youtubeUrl YouTube video URL
   * @param query The analysis query/question
   * @param options Configuration options including clipping
   */
  analyzeYouTubeUrl(
    youtubeUrl: string,
    query: string,
    options?: YouTubeAnalysisOptions,
  ): Promise<VideoAnalysisResult>;

  /**
   * Extract frame-level descriptions for indexing (basic)
   * @param fileUri URI of the uploaded file
   * @param mimeType MIME type of the video
   * @param options Configuration options
   */
  analyzeForIndexing(
    fileUri: string,
    mimeType: string,
    options?: IndexingOptions,
  ): Promise<VideoAnalysisResult>;

  /**
   * Extract frame-level descriptions from YouTube for indexing
   * @param youtubeUrl YouTube video URL
   * @param options Configuration options including clipping
   */
  analyzeYouTubeForIndexing(
    youtubeUrl: string,
    options?: YouTubeAnalysisOptions & IndexingOptions,
  ): Promise<VideoAnalysisResult>;

  /**
   * Advanced multi-modal extraction for comprehensive indexing
   * @param fileUri URI of the uploaded file
   * @param mimeType MIME type of the video
   * @param options Configuration options
   */
  analyzeForAdvancedIndexing(
    fileUri: string,
    mimeType: string,
    options?: IndexingOptions,
  ): Promise<AdvancedVideoAnalysisResult>;

  /**
   * Advanced multi-modal extraction from YouTube
   * @param youtubeUrl YouTube video URL
   * @param options Configuration options including clipping
   */
  analyzeYouTubeForAdvancedIndexing(
    youtubeUrl: string,
    options?: YouTubeAnalysisOptions & IndexingOptions,
  ): Promise<AdvancedVideoAnalysisResult>;

  /**
   * Get the default system instruction used by this analyzer
   */
  getDefaultSystemInstruction(): string;
}

/**
 * Video analyzer injection token
 */
export const VIDEO_ANALYZER_TOKEN = 'VIDEO_ANALYZER';
