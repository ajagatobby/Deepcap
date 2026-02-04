import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsNumber,
  MaxLength,
  Min,
  IsEnum,
} from 'class-validator';
import { ThinkingLevelInput, MediaResolutionInput } from '../../gemini/dto';

/**
 * Frame description for indexing
 */
export class FrameDescriptionDto {
  @IsString()
  @IsNotEmpty()
  timestamp: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;
}

/**
 * DTO for indexing a video file
 */
export class IndexVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsEnum(ThinkingLevelInput)
  thinkingLevel?: ThinkingLevelInput = ThinkingLevelInput.HIGH;

  @IsOptional()
  @IsEnum(MediaResolutionInput)
  mediaResolution?: MediaResolutionInput = MediaResolutionInput.HIGH;
}

/**
 * DTO for indexing a YouTube video
 */
export class IndexYouTubeDto {
  @IsUrl()
  @IsNotEmpty()
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsEnum(ThinkingLevelInput)
  thinkingLevel?: ThinkingLevelInput = ThinkingLevelInput.HIGH;

  @IsOptional()
  @IsEnum(MediaResolutionInput)
  mediaResolution?: MediaResolutionInput = MediaResolutionInput.HIGH;

  @IsOptional()
  @IsString()
  startOffset?: string;

  @IsOptional()
  @IsString()
  endOffset?: string;
}

/**
 * DTO for RAG chat request
 */
export class RAGChatDto {
  @IsString()
  @IsNotEmpty()
  videoId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  query: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  topK?: number;
}

/**
 * DTO for global search
 */
export class GlobalSearchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  query: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  topK?: number;
}

/**
 * Response DTO for index result
 */
export class IndexResultDto {
  videoId: string;
  frameCount: number;
  indexingTimeMs: number;
  success: boolean;
  error?: string;
}

/**
 * Response DTO for RAG chat
 */
export class RAGChatResponseDto {
  answer: string;
  sources: Array<{
    timestamp: string;
    description: string;
    relevanceScore?: number;
  }>;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs: number;
}

/**
 * Response DTO for indexed video list
 */
export class IndexedVideoDto {
  id: string;
  title: string;
  sourceUri: string;
  frameCount: number;
  indexedAt: string;
  confidence: string;
}

/**
 * Response DTO for database stats
 */
export class StatsDto {
  videoCount: number;
  frameCount: number;
  embeddingModel: string;
  dbPath: string;
}
