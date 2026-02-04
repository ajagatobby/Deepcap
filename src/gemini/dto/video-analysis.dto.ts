import { ConfidenceLevel, TimestampRange } from '../interfaces/analysis-result.interface';

/**
 * Response DTO for video analysis results
 */
export class VideoAnalysisResponseDto {
  /** The main analysis text */
  analysis: string;

  /** Array of relevant timestamps with descriptions */
  timestamps: TimestampRange[];

  /** Self-assessed confidence score */
  confidence: ConfidenceLevel;

  /** Optional thought summary from the model's reasoning process */
  thoughtSummary?: string;

  /** Token usage information */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thoughtsTokens?: number;
  };

  /** Processing metadata */
  metadata?: {
    model: string;
    processingTimeMs: number;
    fileUri?: string;
  };
}

/**
 * Response DTO for chat session creation
 */
export class ChatSessionResponseDto {
  sessionId: string;
  analysis: VideoAnalysisResponseDto;
  createdAt: Date;
}

/**
 * Response DTO for chat messages
 */
export class ChatMessageResponseDto {
  sessionId: string;
  response: string;
  timestamps?: TimestampRange[];
  confidence?: ConfidenceLevel;
  thoughtSummary?: string;
}

/**
 * Response DTO for file upload status
 */
export class FileUploadStatusDto {
  fileName: string;
  state: string;
  uri?: string;
  mimeType?: string;
  expirationTime?: string;
  error?: string;
}
