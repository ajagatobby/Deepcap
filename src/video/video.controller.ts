import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import {
  AnalyzeVideoDto,
  AnalyzeYouTubeDto,
  VideoChatDto,
  StartVideoChatDto,
  VideoAnalysisResponseDto,
  ChatSessionResponseDto,
  ChatMessageResponseDto,
} from '../gemini';
import { AIProviderFactory } from '../providers';
import { VideoFileValidator } from '../common/validators';

// Ensure uploads directory exists
const uploadsDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Controller for video analysis endpoints
 * Supports multiple AI providers (Gemini, OpenAI)
 */
@Controller('video')
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(private readonly providerFactory: AIProviderFactory) {}

  /**
   * Upload and analyze a video file
   * POST /video/analyze
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: uploadsDir,
        filename: (req, file, callback) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          callback(null, `video-${uniqueSuffix}${ext}`);
        },
      }),
    }),
  )
  async analyzeVideo(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // Custom video validator with max 2GB file size
          new VideoFileValidator({ maxSize: 2 * 1024 * 1024 * 1024 }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: AnalyzeVideoDto,
  ): Promise<VideoAnalysisResponseDto> {
    const startTime = Date.now();
    const videoAnalyzer = this.providerFactory.getVideoAnalyzer(dto.provider);
    const providerName = videoAnalyzer.getProviderName();

    this.logger.log(
      `Analyzing video: ${file.originalname} (${file.size} bytes) with provider: ${providerName}`,
    );

    try {
      const result = await videoAnalyzer.analyzeVideoFile(
        file.path,
        file.mimetype,
        dto.query,
        {
          qualityLevel: this.mapThinkingLevelToQuality(dto.thinkingLevel),
          mediaResolution: this.mapMediaResolutionToQuality(
            dto.mediaResolution,
          ),
          systemPrompt: dto.systemPrompt,
        },
      );

      const processingTime = Date.now() - startTime;

      return {
        analysis: result.analysis,
        timestamps: result.timestamps,
        confidence: result.confidence,
        thoughtSummary: result.thoughtSummary,
        tokenUsage: result.tokenUsage,
        metadata: {
          model: providerName,
          processingTimeMs: processingTime,
        },
      };
    } finally {
      // Clean up the uploaded file
      try {
        if (existsSync(file.path)) {
          unlinkSync(file.path);
        }
      } catch (error) {
        this.logger.warn(`Failed to cleanup uploaded file: ${error.message}`);
      }
    }
  }

  /**
   * Map thinking level input to quality level
   */
  private mapThinkingLevelToQuality(
    thinkingLevel?: string,
  ): 'low' | 'medium' | 'high' {
    switch (thinkingLevel) {
      case 'MINIMAL':
      case 'LOW':
        return 'low';
      case 'MEDIUM':
        return 'medium';
      case 'HIGH':
      default:
        return 'high';
    }
  }

  /**
   * Map media resolution input to quality level
   */
  private mapMediaResolutionToQuality(
    mediaResolution?: string,
  ): 'low' | 'medium' | 'high' {
    switch (mediaResolution) {
      case 'MEDIA_RESOLUTION_LOW':
        return 'low';
      case 'MEDIA_RESOLUTION_MEDIUM':
        return 'medium';
      case 'MEDIA_RESOLUTION_HIGH':
      default:
        return 'high';
    }
  }

  /**
   * Analyze a YouTube video URL
   * POST /video/analyze-url
   */
  @Post('analyze-url')
  @HttpCode(HttpStatus.OK)
  async analyzeYouTube(
    @Body() dto: AnalyzeYouTubeDto,
  ): Promise<VideoAnalysisResponseDto> {
    const startTime = Date.now();
    const videoAnalyzer = this.providerFactory.getVideoAnalyzer(dto.provider);
    const providerName = videoAnalyzer.getProviderName();

    this.logger.log(
      `Analyzing YouTube URL: ${dto.url} with provider: ${providerName}`,
    );

    const result = await videoAnalyzer.analyzeYouTubeUrl(dto.url, dto.query, {
      qualityLevel: this.mapThinkingLevelToQuality(dto.thinkingLevel),
      mediaResolution: this.mapMediaResolutionToQuality(dto.mediaResolution),
      startOffset: dto.startOffset,
      endOffset: dto.endOffset,
    });

    const processingTime = Date.now() - startTime;

    return {
      analysis: result.analysis,
      timestamps: result.timestamps,
      confidence: result.confidence,
      thoughtSummary: result.thoughtSummary,
      tokenUsage: result.tokenUsage,
      metadata: {
        model: providerName,
        processingTimeMs: processingTime,
        fileUri: dto.url,
      },
    };
  }

  /**
   * Start a new chat session with an uploaded video
   * POST /video/chat/start
   */
  @Post('chat/start')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: uploadsDir,
        filename: (req, file, callback) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          callback(null, `chat-video-${uniqueSuffix}${ext}`);
        },
      }),
    }),
  )
  async startChatWithFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // Custom video validator with max 2GB file size
          new VideoFileValidator({ maxSize: 2 * 1024 * 1024 * 1024 }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: StartVideoChatDto,
  ): Promise<ChatSessionResponseDto> {
    const chatProvider = this.providerFactory.getChatProvider(dto.provider);
    const providerName = chatProvider.getProviderName();

    this.logger.log(
      `Starting chat session with video: ${file.originalname} using provider: ${providerName}`,
    );

    try {
      const { sessionId, response } = await chatProvider.startSessionWithFile(
        file.path,
        file.mimetype,
        dto.initialQuery,
        {
          qualityLevel: this.mapThinkingLevelToQuality(dto.thinkingLevel),
          mediaResolution: this.mapMediaResolutionToQuality(
            dto.mediaResolution,
          ),
        },
      );

      return {
        sessionId,
        analysis: {
          analysis: response.analysis,
          timestamps: response.timestamps,
          confidence: response.confidence,
          thoughtSummary: response.thoughtSummary,
          tokenUsage: response.tokenUsage,
        },
        createdAt: new Date(),
      };
    } finally {
      // Clean up the local file (it's already uploaded to provider)
      try {
        if (existsSync(file.path)) {
          unlinkSync(file.path);
        }
      } catch (error) {
        this.logger.warn(`Failed to cleanup uploaded file: ${error.message}`);
      }
    }
  }

  /**
   * Start a new chat session with a YouTube URL
   * POST /video/chat/start-youtube
   */
  @Post('chat/start-youtube')
  @HttpCode(HttpStatus.CREATED)
  async startChatWithYouTube(
    @Body() dto: AnalyzeYouTubeDto,
  ): Promise<ChatSessionResponseDto> {
    const chatProvider = this.providerFactory.getChatProvider(dto.provider);
    const providerName = chatProvider.getProviderName();

    this.logger.log(
      `Starting chat session with YouTube URL: ${dto.url} using provider: ${providerName}`,
    );

    const { sessionId, response } = await chatProvider.startSessionWithYouTube(
      dto.url,
      dto.query,
      {
        qualityLevel: this.mapThinkingLevelToQuality(dto.thinkingLevel),
        mediaResolution: this.mapMediaResolutionToQuality(dto.mediaResolution),
      },
    );

    return {
      sessionId,
      analysis: {
        analysis: response.analysis,
        timestamps: response.timestamps,
        confidence: response.confidence,
        thoughtSummary: response.thoughtSummary,
        tokenUsage: response.tokenUsage,
      },
      createdAt: new Date(),
    };
  }

  /**
   * Send a message in an existing chat session
   * POST /video/chat/message
   * Note: Uses the same provider that was used to start the session
   */
  @Post('chat/message')
  @HttpCode(HttpStatus.OK)
  async sendChatMessage(
    @Body() dto: VideoChatDto,
  ): Promise<ChatMessageResponseDto> {
    this.logger.log(`Chat message in session ${dto.sessionId}`);

    // Try both providers to find the session
    const geminiChat = this.providerFactory.getChatProvider('gemini');
    const openaiChat = this.providerFactory.getChatProvider('openai');

    let response;
    let providerUsed = 'unknown';

    // Check Gemini first
    if (geminiChat.getSession(dto.sessionId)) {
      response = await geminiChat.sendMessage(dto.sessionId, dto.message);
      providerUsed = 'gemini';
    } else if (openaiChat.getSession(dto.sessionId)) {
      response = await openaiChat.sendMessage(dto.sessionId, dto.message);
      providerUsed = 'openai';
    } else {
      // Try default provider
      const defaultChat = this.providerFactory.getChatProvider();
      response = await defaultChat.sendMessage(dto.sessionId, dto.message);
      providerUsed = defaultChat.getProviderName();
    }

    return {
      sessionId: dto.sessionId,
      response: response.analysis,
      timestamps: response.timestamps,
      confidence: response.confidence,
      thoughtSummary: response.thoughtSummary,
    };
  }

  /**
   * Get chat session history
   * GET /video/chat/:sessionId/history
   */
  @Get('chat/:sessionId/history')
  async getChatHistory(@Param('sessionId') sessionId: string) {
    // Try both providers to find the session
    const geminiChat = this.providerFactory.getChatProvider('gemini');
    const openaiChat = this.providerFactory.getChatProvider('openai');

    if (geminiChat.getSession(sessionId)) {
      return geminiChat.getConversationHistory(sessionId);
    } else if (openaiChat.getSession(sessionId)) {
      return openaiChat.getConversationHistory(sessionId);
    }

    // Try default provider
    const defaultChat = this.providerFactory.getChatProvider();
    return defaultChat.getConversationHistory(sessionId);
  }

  /**
   * Get chat session info
   * GET /video/chat/:sessionId
   */
  @Get('chat/:sessionId')
  async getChatSession(@Param('sessionId') sessionId: string) {
    // Try both providers to find the session
    const geminiChat = this.providerFactory.getChatProvider('gemini');
    const openaiChat = this.providerFactory.getChatProvider('openai');

    let session = geminiChat.getSession(sessionId);
    let provider = 'gemini';

    if (!session) {
      session = openaiChat.getSession(sessionId);
      provider = 'openai';
    }

    if (!session) {
      return { error: 'Session not found' };
    }

    return {
      id: session.id,
      provider,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      messageCount: session.messages.length,
    };
  }

  /**
   * End a chat session
   * DELETE /video/chat/:sessionId
   */
  @Delete('chat/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async endChatSession(@Param('sessionId') sessionId: string): Promise<void> {
    // Try both providers to end the session
    const geminiChat = this.providerFactory.getChatProvider('gemini');
    const openaiChat = this.providerFactory.getChatProvider('openai');

    if (geminiChat.getSession(sessionId)) {
      await geminiChat.endSession(sessionId);
    } else if (openaiChat.getSession(sessionId)) {
      await openaiChat.endSession(sessionId);
    } else {
      // Try default provider
      const defaultChat = this.providerFactory.getChatProvider();
      await defaultChat.endSession(sessionId);
    }
  }

  /**
   * List all active chat sessions
   * GET /video/chat
   */
  @Get('chat')
  async listChatSessions() {
    // Get sessions from both providers
    const geminiChat = this.providerFactory.getChatProvider('gemini');
    const openaiChat = this.providerFactory.getChatProvider('openai');

    const geminiSessions = geminiChat.listSessions().map((s) => ({
      id: s.id,
      provider: 'gemini',
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      messageCount: s.messages.length,
    }));

    const openaiSessions = openaiChat.listSessions().map((s) => ({
      id: s.id,
      provider: 'openai',
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      messageCount: s.messages.length,
    }));

    return [...geminiSessions, ...openaiSessions];
  }

  /**
   * Get available AI providers
   * GET /video/providers
   */
  @Get('providers')
  async getProviders() {
    return this.providerFactory.getAvailableProviders();
  }
}
