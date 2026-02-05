import { VideoAnalysisResult, ChatSession, ConversationMessage } from '../../gemini/interfaces';
import { ChatOptions } from './ai-provider.interface';

/**
 * Chat session creation result
 */
export interface ChatSessionResult {
  sessionId: string;
  response: VideoAnalysisResult;
}

/**
 * Interface for multi-turn chat operations
 * Implemented by both Gemini and OpenAI providers
 */
export interface IChatProvider {
  /**
   * Get the provider name
   */
  getProviderName(): string;

  /**
   * Start a new chat session with a video file
   * @param filePath Path to the video file
   * @param mimeType MIME type of the video
   * @param initialQuery The first question about the video
   * @param options Configuration options
   */
  startSessionWithFile(
    filePath: string,
    mimeType: string,
    initialQuery: string,
    options?: ChatOptions,
  ): Promise<ChatSessionResult>;

  /**
   * Start a new chat session with a YouTube URL
   * @param youtubeUrl YouTube video URL
   * @param initialQuery The first question about the video
   * @param options Configuration options
   */
  startSessionWithYouTube(
    youtubeUrl: string,
    initialQuery: string,
    options?: ChatOptions,
  ): Promise<ChatSessionResult>;

  /**
   * Send a follow-up message in an existing chat session
   * @param sessionId The session ID
   * @param message The follow-up message
   */
  sendMessage(sessionId: string, message: string): Promise<VideoAnalysisResult>;

  /**
   * Get session information
   * @param sessionId The session ID
   */
  getSession(sessionId: string): ChatSession | undefined;

  /**
   * Get conversation history for a session
   * @param sessionId The session ID
   */
  getConversationHistory(sessionId: string): ConversationMessage[];

  /**
   * End a chat session and cleanup resources
   * @param sessionId The session ID
   */
  endSession(sessionId: string): Promise<void>;

  /**
   * List all active sessions
   */
  listSessions(): ChatSession[];

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions(): void;
}

/**
 * Chat provider injection token
 */
export const CHAT_PROVIDER_TOKEN = 'CHAT_PROVIDER';
