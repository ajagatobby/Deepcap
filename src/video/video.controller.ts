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
  MaxFileSizeValidator,
  FileTypeValidator,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import {
  VideoAnalyzeService,
  ChatService,
  AnalyzeVideoDto,
  AnalyzeYouTubeDto,
  VideoChatDto,
  StartVideoChatDto,
  VideoAnalysisResponseDto,
  ChatSessionResponseDto,
  ChatMessageResponseDto,
} from '../gemini';

// Ensure uploads directory exists
const uploadsDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Controller for video analysis endpoints
 */
@Controller('video')
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(
    private readonly videoAnalyzeService: VideoAnalyzeService,
    private readonly chatService: ChatService,
  ) {}

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
          // Max 2GB file size (Files API limit)
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 * 1024 }),
          // Supported video formats
          new FileTypeValidator({
            fileType: /^video\/(mp4|mpeg|mov|avi|x-flv|mpg|webm|wmv|3gpp)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: AnalyzeVideoDto,
  ): Promise<VideoAnalysisResponseDto> {
    const startTime = Date.now();
    this.logger.log(
      `Analyzing video: ${file.originalname} (${file.size} bytes)`,
    );

    try {
      const result = await this.videoAnalyzeService.analyzeVideoFile(
        file.path,
        file.mimetype,
        dto.query,
        {
          thinkingLevel: dto.thinkingLevel,
          mediaResolution: dto.mediaResolution,
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
          model: 'gemini-3-flash-preview',
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
   * Analyze a YouTube video URL
   * POST /video/analyze-url
   */
  @Post('analyze-url')
  @HttpCode(HttpStatus.OK)
  async analyzeYouTube(
    @Body() dto: AnalyzeYouTubeDto,
  ): Promise<VideoAnalysisResponseDto> {
    const startTime = Date.now();
    this.logger.log(`Analyzing YouTube URL: ${dto.url}`);

    const result = await this.videoAnalyzeService.analyzeYouTubeUrl(
      dto.url,
      dto.query,
      {
        thinkingLevel: dto.thinkingLevel,
        mediaResolution: dto.mediaResolution,
        startOffset: dto.startOffset,
        endOffset: dto.endOffset,
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
        model: 'gemini-3-flash-preview',
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
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 * 1024 }),
          new FileTypeValidator({
            fileType: /^video\/(mp4|mpeg|mov|avi|x-flv|mpg|webm|wmv|3gpp)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: StartVideoChatDto,
  ): Promise<ChatSessionResponseDto> {
    this.logger.log(`Starting chat session with video: ${file.originalname}`);

    try {
      const { sessionId, response } =
        await this.chatService.startSessionWithFile(
          file.path,
          file.mimetype,
          dto.initialQuery,
          {
            thinkingLevel: dto.thinkingLevel,
            mediaResolution: dto.mediaResolution,
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
      // Clean up the local file (it's already uploaded to Google)
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
    this.logger.log(`Starting chat session with YouTube URL: ${dto.url}`);

    const { sessionId, response } =
      await this.chatService.startSessionWithYouTube(dto.url, dto.query, {
        thinkingLevel: dto.thinkingLevel,
        mediaResolution: dto.mediaResolution,
      });

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
   */
  @Post('chat/message')
  @HttpCode(HttpStatus.OK)
  async sendChatMessage(
    @Body() dto: VideoChatDto,
  ): Promise<ChatMessageResponseDto> {
    this.logger.log(`Chat message in session ${dto.sessionId}`);

    const response = await this.chatService.sendMessage(
      dto.sessionId,
      dto.message,
    );

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
    return this.chatService.getConversationHistory(sessionId);
  }

  /**
   * Get chat session info
   * GET /video/chat/:sessionId
   */
  @Get('chat/:sessionId')
  async getChatSession(@Param('sessionId') sessionId: string) {
    const session = this.chatService.getSession(sessionId);
    if (!session) {
      return { error: 'Session not found' };
    }
    return {
      id: session.id,
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
    await this.chatService.endSession(sessionId);
  }

  /**
   * List all active chat sessions
   * GET /video/chat
   */
  @Get('chat')
  async listChatSessions() {
    const sessions = this.chatService.listSessions();
    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      messageCount: s.messages.length,
    }));
  }
}
