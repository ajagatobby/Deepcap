import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import {
  ThinkingLevel,
  MediaResolution,
} from '@google/genai';
import { GeminiService } from './gemini.service';
import { FileManagerService } from './file-manager.service';
import {
  ChatSession,
  ConversationMessage,
  VideoAnalysisResult,
} from './interfaces';
import { ThinkingLevelInput, MediaResolutionInput } from './dto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Default system instruction for video chat
 */
const CHAT_SYSTEM_INSTRUCTION = `You are a video analyst assistant engaged in a conversation about a video. Follow these rules:

1. If an event is not visually present in the video, state "No visual evidence found"
2. For every event described, provide exact timestamps in MM:SS format when relevant
3. When uncertain, indicate your confidence level
4. Use code execution to inspect pixels or calculate durations when needed
5. Maintain context from previous messages in the conversation
6. Be conversational but precise in your observations`;

/**
 * Service for managing multi-turn conversations about videos
 * Handles thought signature management for maintaining reasoning context
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  
  // In-memory session storage (use Redis/database in production)
  private sessions: Map<string, ChatSession> = new Map();
  
  // Store chat instances for each session
  private chatInstances: Map<string, any> = new Map();

  constructor(
    private readonly geminiService: GeminiService,
    private readonly fileManagerService: FileManagerService,
  ) {}

  /**
   * Convert input thinking level to SDK type
   */
  private toSdkThinkingLevel(input?: ThinkingLevelInput): ThinkingLevel {
    switch (input) {
      case ThinkingLevelInput.MINIMAL:
        return ThinkingLevel.MINIMAL;
      case ThinkingLevelInput.LOW:
        return ThinkingLevel.LOW;
      case ThinkingLevelInput.MEDIUM:
        return ThinkingLevel.MEDIUM;
      case ThinkingLevelInput.HIGH:
      default:
        return ThinkingLevel.HIGH;
    }
  }

  /**
   * Convert input media resolution to SDK type
   */
  private toSdkMediaResolution(input?: MediaResolutionInput): MediaResolution {
    switch (input) {
      case MediaResolutionInput.LOW:
        return MediaResolution.MEDIA_RESOLUTION_LOW;
      case MediaResolutionInput.MEDIUM:
        return MediaResolution.MEDIA_RESOLUTION_MEDIUM;
      case MediaResolutionInput.HIGH:
      default:
        return MediaResolution.MEDIA_RESOLUTION_HIGH;
    }
  }

  /**
   * Start a new chat session with a video file
   * @param filePath Path to the video file
   * @param mimeType MIME type of the video
   * @param initialQuery The first question about the video
   * @param options Configuration options
   */
  async startSessionWithFile(
    filePath: string,
    mimeType: string,
    initialQuery: string,
    options: {
      thinkingLevel?: ThinkingLevelInput;
      mediaResolution?: MediaResolutionInput;
    } = {},
  ): Promise<{ sessionId: string; response: VideoAnalysisResult }> {
    const {
      thinkingLevel = ThinkingLevelInput.HIGH,
      mediaResolution = MediaResolutionInput.HIGH,
    } = options;

    const sdkThinkingLevel = this.toSdkThinkingLevel(thinkingLevel);
    const sdkMediaResolution = this.toSdkMediaResolution(mediaResolution);

    // Upload and wait for the file to be active
    this.logger.log(`Starting chat session with video: ${filePath}`);
    const fileMetadata = await this.fileManagerService.uploadAndWaitForActive(
      filePath,
      mimeType,
    );

    // Create a new session
    const sessionId = uuidv4();
    const session: ChatSession = {
      id: sessionId,
      fileUri: fileMetadata.uri,
      fileMimeType: fileMetadata.mimeType,
      messages: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    // Create a chat instance using the SDK's chat feature
    // The SDK handles thought signatures automatically
    const chatsApi = this.geminiService.getChatsApi();
    const modelName = this.geminiService.getModelName();

    const chat = chatsApi.create({
      model: modelName,
      config: {
        systemInstruction: CHAT_SYSTEM_INSTRUCTION,
        thinkingConfig: {
          thinkingLevel: sdkThinkingLevel,
          includeThoughts: true,
        },
        mediaResolution: sdkMediaResolution,
      },
    });

    this.chatInstances.set(sessionId, chat);

    // Send the initial message with the video
    try {
      const response = await chat.sendMessage({
        message: [
          {
            fileData: {
              fileUri: fileMetadata.uri,
              mimeType: fileMetadata.mimeType,
            },
          },
          {
            text: initialQuery,
          },
        ],
      });

      // Store the conversation turn
      session.messages.push({
        role: 'user',
        content: initialQuery,
        fileUri: fileMetadata.uri,
      });

      const analysisResult = this.parseResponse(response);

      session.messages.push({
        role: 'model',
        content: analysisResult.analysis,
      });

      session.lastActivityAt = new Date();
      this.sessions.set(sessionId, session);

      this.logger.log(`Chat session created: ${sessionId}`);

      return {
        sessionId,
        response: analysisResult,
      };
    } catch (error) {
      // Clean up on failure
      this.sessions.delete(sessionId);
      this.chatInstances.delete(sessionId);
      
      this.logger.error(`Failed to start chat session: ${error.message}`);
      throw this.handleError(error);
    }
  }

  /**
   * Start a new chat session with a YouTube URL
   */
  async startSessionWithYouTube(
    youtubeUrl: string,
    initialQuery: string,
    options: {
      thinkingLevel?: ThinkingLevelInput;
      mediaResolution?: MediaResolutionInput;
    } = {},
  ): Promise<{ sessionId: string; response: VideoAnalysisResult }> {
    const {
      thinkingLevel = ThinkingLevelInput.HIGH,
      mediaResolution = MediaResolutionInput.HIGH,
    } = options;

    const sdkThinkingLevel = this.toSdkThinkingLevel(thinkingLevel);
    const sdkMediaResolution = this.toSdkMediaResolution(mediaResolution);

    const sessionId = uuidv4();
    const session: ChatSession = {
      id: sessionId,
      fileUri: youtubeUrl,
      fileMimeType: 'video/mp4', // Default for YouTube
      messages: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    const chatsApi = this.geminiService.getChatsApi();
    const modelName = this.geminiService.getModelName();

    // Note: Code execution is not enabled for YouTube URLs as it's not supported
    const chat = chatsApi.create({
      model: modelName,
      config: {
        systemInstruction: CHAT_SYSTEM_INSTRUCTION,
        thinkingConfig: {
          thinkingLevel: sdkThinkingLevel,
          includeThoughts: true,
        },
        mediaResolution: sdkMediaResolution,
      },
    });

    this.chatInstances.set(sessionId, chat);

    try {
      // Don't specify mimeType for YouTube URLs - let the API infer it
      const response = await chat.sendMessage({
        message: [
          {
            fileData: {
              fileUri: youtubeUrl,
            },
          },
          {
            text: initialQuery,
          },
        ],
      });

      session.messages.push({
        role: 'user',
        content: initialQuery,
        fileUri: youtubeUrl,
      });

      const analysisResult = this.parseResponse(response);

      session.messages.push({
        role: 'model',
        content: analysisResult.analysis,
      });

      session.lastActivityAt = new Date();
      this.sessions.set(sessionId, session);

      this.logger.log(`YouTube chat session created: ${sessionId}`);

      return {
        sessionId,
        response: analysisResult,
      };
    } catch (error) {
      this.sessions.delete(sessionId);
      this.chatInstances.delete(sessionId);
      
      this.logger.error(`Failed to start YouTube chat session: ${error.message}`);
      throw this.handleError(error);
    }
  }

  /**
   * Send a follow-up message in an existing chat session
   * The SDK automatically handles thought signatures for conversation continuity
   * @param sessionId The session ID
   * @param message The follow-up message
   */
  async sendMessage(
    sessionId: string,
    message: string,
  ): Promise<VideoAnalysisResult> {
    const session = this.sessions.get(sessionId);
    const chat = this.chatInstances.get(sessionId);

    if (!session || !chat) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `Chat session not found: ${sessionId}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    this.logger.log(`Sending message in session ${sessionId}: ${message.substring(0, 50)}...`);

    try {
      // The SDK's chat.sendMessage automatically handles thought signatures
      // It preserves the thoughtSignature from previous responses and passes them back
      const response = await chat.sendMessage({
        message: message,
      });

      // Update session
      session.messages.push({
        role: 'user',
        content: message,
      });

      const analysisResult = this.parseResponse(response);

      session.messages.push({
        role: 'model',
        content: analysisResult.analysis,
      });

      session.lastActivityAt = new Date();
      this.sessions.set(sessionId, session);

      return analysisResult;
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`);
      throw this.handleError(error);
    }
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
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
    
    if (session) {
      // Delete the uploaded file if it was a file upload (not YouTube)
      if (session.fileUri && !session.fileUri.includes('youtube.com')) {
        try {
          // Extract file name from URI
          const fileName = session.fileUri.split('/').pop();
          if (fileName) {
            await this.fileManagerService.deleteFile(fileName);
          }
        } catch (error) {
          this.logger.warn(`Failed to cleanup session file: ${error.message}`);
        }
      }
    }

    this.sessions.delete(sessionId);
    this.chatInstances.delete(sessionId);
    this.logger.log(`Chat session ended: ${sessionId}`);
  }

  /**
   * List all active sessions
   */
  listSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
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
   * Parse the chat response into VideoAnalysisResult
   */
  private parseResponse(response: any): VideoAnalysisResult {
    let thoughtSummary: string | undefined;
    let analysisText = '';

    // Handle the response text
    if (response.text) {
      analysisText = response.text;
    }

    // Check for thought summaries in candidates
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.thought && part.text) {
          thoughtSummary = part.text;
        } else if (part.text && !part.thought) {
          analysisText = part.text;
        }
      }
    }

    // Try to parse as JSON (if structured output)
    let parsed: any = null;
    try {
      parsed = JSON.parse(analysisText);
    } catch {
      // Not JSON, treat as plain text
    }

    const result: VideoAnalysisResult = {
      analysis: parsed?.analysis || analysisText || 'No response generated',
      timestamps: parsed?.timestamps || [],
      confidence: parsed?.confidence || 'Medium',
      thoughtSummary,
    };

    // Add token usage if available
    if (response.usageMetadata) {
      result.tokenUsage = {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
        thoughtsTokens: response.usageMetadata.thoughtsTokenCount,
      };
    }

    return result;
  }

  /**
   * Handle errors and convert to appropriate HTTP exceptions
   */
  private handleError(error: any): HttpException {
    // Handle rate limiting (429)
    if (error.status === 429 || error.message?.includes('429')) {
      return new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'API rate limit exceeded. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Handle thought signature validation errors (400)
    if (error.status === 400 && error.message?.includes('thought_signature')) {
      return new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Thought signature validation failed. Please start a new session.',
        },
        HttpStatus.BAD_REQUEST,
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
