/**
 * Timestamp range for a specific event in the video
 */
export interface TimestampRange {
  /** Start time in MM:SS format */
  start: string;
  /** End time in MM:SS format */
  end: string;
  /** Description of what happens during this timestamp */
  description: string;
}

/**
 * Confidence level for the analysis
 */
export type ConfidenceLevel = 'Low' | 'Medium' | 'High';

/**
 * Frame description for indexing
 */
export interface FrameDescription {
  /** Timestamp in MM:SS format */
  timestamp: string;
  /** Description of what's visible at this timestamp */
  description: string;
}

/**
 * Result of video analysis from Gemini
 */
export interface VideoAnalysisResult {
  /** The main analysis text */
  analysis: string;
  /** Array of relevant timestamps with descriptions */
  timestamps: TimestampRange[];
  /** Self-assessed confidence score */
  confidence: ConfidenceLevel;
  /** Optional thought summary from the model's reasoning process */
  thoughtSummary?: string;
  /** Token usage metadata */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thoughtsTokens?: number;
  };
  /** Frame-level descriptions for indexing (optional, populated when requested) */
  frames?: FrameDescription[];
}

/**
 * File metadata returned from the Files API
 */
export interface FileMetadata {
  name: string;
  displayName?: string;
  mimeType: string;
  sizeBytes?: string;
  createTime?: string;
  updateTime?: string;
  expirationTime?: string;
  sha256Hash?: string;
  uri: string;
  state: FileState;
  error?: FileError;
}

/**
 * Possible states for an uploaded file
 */
export type FileState =
  | 'PROCESSING'
  | 'ACTIVE'
  | 'FAILED'
  | 'STATE_UNSPECIFIED';

/**
 * Error information for failed file processing
 */
export interface FileError {
  code?: number;
  message?: string;
}

/**
 * Conversation message for multi-turn chat
 */
export interface ConversationMessage {
  role: 'user' | 'model';
  content: string;
  /** File URI if the message includes a video reference */
  fileUri?: string;
  /** Thought signature for maintaining reasoning context */
  thoughtSignature?: string;
}

/**
 * Chat session state for multi-turn conversations
 */
export interface ChatSession {
  id: string;
  fileUri?: string;
  fileMimeType?: string;
  messages: ConversationMessage[];
  createdAt: Date;
  lastActivityAt: Date;
}
