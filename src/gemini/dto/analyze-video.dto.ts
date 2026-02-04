import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsEnum,
  MaxLength,
} from 'class-validator';
import {
  ThinkingLevel as SdkThinkingLevel,
  MediaResolution as SdkMediaResolution,
} from '@google/genai';

/**
 * Re-export SDK types for external use
 */
export { SdkThinkingLevel as ThinkingLevel };
export { SdkMediaResolution as MediaResolution };

/**
 * Thinking level options for API input (string values for validation)
 */
export enum ThinkingLevelInput {
  MINIMAL = 'MINIMAL',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Media resolution options for API input (string values for validation)
 */
export enum MediaResolutionInput {
  LOW = 'MEDIA_RESOLUTION_LOW',
  MEDIUM = 'MEDIA_RESOLUTION_MEDIUM',
  HIGH = 'MEDIA_RESOLUTION_HIGH',
}

/**
 * DTO for analyzing a video file upload
 */
export class AnalyzeVideoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  query: string;

  @IsOptional()
  @IsEnum(ThinkingLevelInput)
  thinkingLevel?: ThinkingLevelInput = ThinkingLevelInput.HIGH;

  @IsOptional()
  @IsEnum(MediaResolutionInput)
  mediaResolution?: MediaResolutionInput = MediaResolutionInput.HIGH;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  systemPrompt?: string;
}

/**
 * DTO for analyzing a YouTube video URL
 */
export class AnalyzeYouTubeDto {
  @IsUrl()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  query: string;

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
 * DTO for multi-turn chat about a video
 */
export class VideoChatDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}

/**
 * DTO for starting a new chat session with a video
 */
export class StartVideoChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  initialQuery: string;

  @IsOptional()
  @IsEnum(ThinkingLevelInput)
  thinkingLevel?: ThinkingLevelInput = ThinkingLevelInput.HIGH;

  @IsOptional()
  @IsEnum(MediaResolutionInput)
  mediaResolution?: MediaResolutionInput = MediaResolutionInput.HIGH;
}
