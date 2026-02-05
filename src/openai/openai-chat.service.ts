import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { OpenAIService } from './openai.service';
import {
  OpenAIFileHandlerService,
  FrameData,
} from './openai-file-handler.service';
import {
  IChatProvider,
  ChatOptions,
  ChatSessionResult,
} from '../providers/interfaces';
import {
  ChatSession,
  ConversationMessage,
  VideoAnalysisResult,
} from '../gemini/interfaces';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * Default system instruction for video chat
 */
const CHAT_SYSTEM_INSTRUCTION = `You are a video analyst assistant engaged in a conversation about a video. Follow these rules:

1. If an event is not visually present in the video, state "No visual evidence found"
2. For every event described, provide exact timestamps in MM:SS format when relevant
3. When uncertain, indicate your confidence level
4. Maintain context from previous messages in the conversation
5. Be conversational but precise in your observations`;

/**
 * Internal chat session state
 */
interface OpenAIChatSession extends ChatSession {
  conversationHistory: ChatCompletionMessageParam[];
  /** For images: single data URL */
  imageDataUrl?: string;
  /** For videos: extracted frame data URLs */
  videoFrames?: FrameData[];
  isVideo: boolean;
}

/**
 * Service for managing multi-turn conversations about videos using OpenAI
 * Videos are automatically converted to frames for analysis
 */
@Injectable()
export class OpenAIChatService implements IChatProvider {
  private readonly logger = new Logger(OpenAIChatService.name);
  private sessions: Map<string, OpenAIChatSession> = new Map();

  constructor(
    private readonly openaiService: OpenAIService,
    private readonly fileHandlerService: OpenAIFileHandlerService,
  ) {}

  getProviderName(): string {
    return 'openai';
  }

  /**
   * Check if the MIME type is a video type
   */
  private isVideoMimeType(mimeType: string): boolean {
    return mimeType?.toLowerCase().startsWith('video/');
  }

  /**
   * Build image content parts for OpenAI Vision API
   */
  private buildImageContent(
    session: OpenAIChatSession,
    detail: 'low' | 'high' | 'auto',
  ): Array<{ type: 'image_url'; image_url: { url: string; detail: string } }> {
    if (session.isVideo && session.videoFrames) {
      return session.videoFrames.map((frame) => ({
        type: 'image_url' as const,
        image_url: { url: frame.dataUrl, detail },
      }));
    } else if (session.imageDataUrl) {
      return [
        {
          type: 'image_url' as const,
          image_url: { url: session.imageDataUrl, detail },
        },
      ];
    }
    return [];
  }

  /**
   * Generate timestamp context for video frames
   */
  private generateFrameContext(session: OpenAIChatSession): string {
    if (!session.isVideo || !session.videoFrames) return '';

    const timestamps = session.videoFrames.map(
      (f, i) => `Frame ${i + 1}: ${f.timestamp}`,
    );

    return `\n\n[Video frames at: ${timestamps.join(', ')}]`;
  }

  /**
   * Start a new chat session with a file
   * For videos, frames are automatically extracted
   */
  async startSessionWithFile(
    filePath: string,
    mimeType: string,
    initialQuery: string,
    options?: ChatOptions,
  ): Promise<ChatSessionResult> {
    const isVideo = this.isVideoMimeType(mimeType);

    this.logger.log(
      `Starting chat session with ${isVideo ? 'video' : 'image'}: ${filePath}`,
    );

    // Upload the file (frames will be extracted for videos)
    const fileMetadata = await this.fileHandlerService.uploadAndWaitForActive(
      filePath,
      mimeType,
    );

    const sessionId = uuidv4();
    const temperature = this.openaiService.mapQualityToTemperature(
      options?.qualityLevel,
    );
    const detail = this.openaiService.mapResolutionToDetail(
      options?.mediaResolution,
    );

    // Get image content based on file type
    let imageDataUrl: string | undefined;
    let videoFrames: FrameData[] | undefined;
    let imageContent: Array<{
      type: 'image_url';
      image_url: { url: string; detail: 'low' | 'high' | 'auto' };
    }>;

    if (isVideo) {
      videoFrames = this.fileHandlerService.getVideoFrames(fileMetadata.name);
      if (!videoFrames || videoFrames.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Failed to extract frames from video',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      imageContent = videoFrames.map((frame) => ({
        type: 'image_url' as const,
        image_url: { url: frame.dataUrl, detail },
      }));
      this.logger.log(`Video chat initialized with ${videoFrames.length} frames`);
    } else {
      imageDataUrl = this.fileHandlerService.getDataUrl(fileMetadata.name);
      if (!imageDataUrl) {
        throw new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Failed to process image file',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      imageContent = [
        {
          type: 'image_url' as const,
          image_url: { url: imageDataUrl, detail },
        },
      ];
    }

    // Build query with frame context for videos
    let queryWithContext = initialQuery;
    if (isVideo && videoFrames) {
      const timestamps = videoFrames.map(
        (f, i) => `Frame ${i + 1}: ${f.timestamp}`,
      );
      queryWithContext = `${initialQuery}\n\n[The following ${videoFrames.length} frames were extracted from the video at: ${timestamps.join(', ')}. Please reference timestamps when describing events.]`;
    }

    // Initialize conversation history with system message and media
    const conversationHistory: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: CHAT_SYSTEM_INSTRUCTION,
      },
      {
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text' as const,
            text: queryWithContext,
          },
        ],
      },
    ];

    try {
      const chatCompletions = this.openaiService.getChatCompletions();
      const modelName = this.openaiService.getModelName();

      const response = await chatCompletions.create({
        model: modelName,
        messages: conversationHistory,
        temperature,
        max_tokens: 4096,
      });

      const assistantMessage = response.choices[0]?.message?.content || '';

      // Add assistant response to history
      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      });

      // Create session
      const session: OpenAIChatSession = {
        id: sessionId,
        fileUri: fileMetadata.name,
        fileMimeType: mimeType,
        messages: [
          { role: 'user', content: initialQuery, fileUri: fileMetadata.name },
          { role: 'model', content: assistantMessage },
        ],
        createdAt: new Date(),
        lastActivityAt: new Date(),
        conversationHistory,
        imageDataUrl,
        videoFrames,
        isVideo,
      };

      this.sessions.set(sessionId, session);

      this.logger.log(
        `Chat session created: ${sessionId} (${isVideo ? 'video' : 'image'})`,
      );

      return {
        sessionId,
        response: {
          analysis: assistantMessage,
          timestamps: [],
          confidence: 'Medium',
          tokenUsage: response.usage
            ? {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
              }
            : undefined,
        },
      };
    } catch (error) {
      // Clean up file on failure
      await this.fileHandlerService.deleteFile(fileMetadata.name);
      this.logger.error(`Failed to start chat session: ${error.message}`);
      throw this.handleError(error);
    }
  }

  /**
   * Start a new chat session with a YouTube URL
   * Note: OpenAI cannot directly process YouTube URLs
   */
  async startSessionWithYouTube(
    youtubeUrl: string,
    initialQuery: string,
    options?: ChatOptions,
  ): Promise<ChatSessionResult> {
    throw new HttpException(
      {
        statusCode: HttpStatus.NOT_IMPLEMENTED,
        message:
          'OpenAI does not support direct YouTube URL analysis. Please download the video and upload it as a file, or use the Gemini provider.',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * Send a follow-up message in an existing chat session
   */
  async sendMessage(
    sessionId: string,
    message: string,
  ): Promise<VideoAnalysisResult> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `Chat session not found: ${sessionId}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    this.logger.log(
      `Sending message in session ${sessionId}: ${message.substring(0, 50)}...`,
    );

    // Add user message to history
    session.conversationHistory.push({
      role: 'user',
      content: message,
    });

    try {
      const chatCompletions = this.openaiService.getChatCompletions();
      const modelName = this.openaiService.getModelName();

      const response = await chatCompletions.create({
        model: modelName,
        messages: session.conversationHistory,
        temperature: 0.5,
        max_tokens: 4096,
      });

      const assistantMessage = response.choices[0]?.message?.content || '';

      // Add assistant response to history
      session.conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      });

      // Update session messages
      session.messages.push({ role: 'user', content: message });
      session.messages.push({ role: 'model', content: assistantMessage });
      session.lastActivityAt = new Date();

      this.sessions.set(sessionId, session);

      return {
        analysis: assistantMessage,
        timestamps: [],
        confidence: 'Medium',
        tokenUsage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
            }
          : undefined,
      };
    } catch (error) {
      // Remove the failed user message from history
      session.conversationHistory.pop();
      this.logger.error(`Failed to send message: ${error.message}`);
      throw this.handleError(error);
    }
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): ChatSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Return without internal state
    return {
      id: session.id,
      fileUri: session.fileUri,
      fileMimeType: session.fileMimeType,
      messages: session.messages,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
    };
  }

  /**
   * Get conversation history for a session
   */
  getConversationHistory(sessionId: string): ConversationMessage[] {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `Chat session not found: ${sessionId}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return session.messages;
  }

  /**
   * End a chat session and cleanup resources
   */
  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (session?.fileUri) {
      try {
        await this.fileHandlerService.deleteFile(session.fileUri);
      } catch (error) {
        this.logger.warn(`Failed to cleanup session file: ${error.message}`);
      }
    }

    this.sessions.delete(sessionId);
    this.logger.log(`Chat session ended: ${sessionId}`);
  }

  /**
   * List all active sessions
   */
  listSessions(): ChatSession[] {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      fileUri: session.fileUri,
      fileMimeType: session.fileMimeType,
      messages: session.messages,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
    }));
  }

  /**
   * Cleanup expired sessions (older than 1 hour)
   */
  cleanupExpiredSessions(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastActivityAt < oneHourAgo) {
        this.endSession(sessionId);
        this.logger.log(`Cleaned up expired session: ${sessionId}`);
      }
    }
  }

  /**
   * Handle OpenAI API errors
   */
  private handleError(error: any): HttpException {
    if (error.status === 429) {
      return new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'OpenAI API rate limit exceeded. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (error.status === 401) {
      return new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Invalid OpenAI API key.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: `Chat error: ${error.message}`,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
