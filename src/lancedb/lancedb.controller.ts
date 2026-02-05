import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Logger,
  ParseFilePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { VideoIndexService } from './video-index.service';
import { RAGChatService } from './rag-chat.service';
import { LanceDBService } from './lancedb.service';
import { EmbeddingService } from './embedding.service';
import { AIProviderFactory } from '../providers';
import {
  IndexVideoDto,
  IndexYouTubeDto,
  RAGChatDto,
  GlobalSearchDto,
} from './dto';
import { ConfigService } from '@nestjs/config';
import { VideoFileValidator } from '../common/validators';

// Ensure uploads directory exists
const uploadsDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Controller for LanceDB video indexing and RAG search
 * Supports multiple AI providers (Gemini, OpenAI)
 */
@Controller('lancedb')
export class LanceDBController {
  private readonly logger = new Logger(LanceDBController.name);

  constructor(
    private readonly videoIndexService: VideoIndexService,
    private readonly ragChatService: RAGChatService,
    private readonly lancedbService: LanceDBService,
    private readonly embeddingService: EmbeddingService,
    private readonly providerFactory: AIProviderFactory,
    private readonly configService: ConfigService,
  ) {}

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
   * Index an uploaded video file for RAG search
   * Analyzes the video with selected AI provider to extract frame descriptions, then indexes them
   */
  @Post('index')
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: uploadsDir,
        filename: (req, file, callback) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          callback(null, `index-${uniqueSuffix}${ext}`);
        },
      }),
    }),
  )
  async indexVideo(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // Custom video validator with max 2GB file size
          new VideoFileValidator({ maxSize: 2 * 1024 * 1024 * 1024 }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: IndexVideoDto,
  ) {
    const startTime = Date.now();
    const fileHandler = this.providerFactory.getFileHandler(dto.provider);
    const videoAnalyzer = this.providerFactory.getVideoAnalyzer(dto.provider);
    const providerName = videoAnalyzer.getProviderName();

    // Auto-generate title from filename if not provided
    const title =
      dto.title ||
      file.originalname.replace(/\.[^/.]+$/, '') ||
      `Video ${Date.now()}`;

    this.logger.log(
      `Indexing video: ${title}, size: ${file.size} bytes, provider: ${providerName}`,
    );

    let fileMetadata: { uri: string; mimeType: string; name: string } | null =
      null;

    try {
      // Upload file to provider and wait for it to be ready
      const uploadedFile = await fileHandler.uploadAndWaitForActive(
        file.path,
        file.mimetype,
        title,
      );
      fileMetadata = {
        uri: uploadedFile.uri,
        mimeType: uploadedFile.mimeType,
        name: uploadedFile.name,
      };

      this.logger.log(`File uploaded and active: ${fileMetadata.uri}`);

      // Analyze video to extract frame descriptions
      const analysis = await videoAnalyzer.analyzeForIndexing(
        fileMetadata.uri,
        fileMetadata.mimeType,
        {
          qualityLevel: this.mapThinkingLevelToQuality(dto.thinkingLevel),
          mediaResolution: this.mapMediaResolutionToQuality(
            dto.mediaResolution,
          ),
        },
      );

      this.logger.log(
        `Analysis complete, ${analysis.frames?.length || 0} frames extracted`,
      );

      // Index the video with frame descriptions
      const result = await this.videoIndexService.indexVideoAnalysis(
        fileMetadata.uri,
        title,
        analysis,
        analysis.frames || [],
      );

      return {
        ...result,
        provider: providerName,
        indexingTimeMs: Date.now() - startTime,
        tokenUsage: analysis.tokenUsage,
      };
    } catch (error) {
      this.logger.error(`Failed to index video: ${error.message}`, error.stack);
      throw error;
    } finally {
      // Clean up the local file
      try {
        if (existsSync(file.path)) {
          unlinkSync(file.path);
        }
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to cleanup local file: ${cleanupError.message}`,
        );
      }

      // Clean up the uploaded file from provider
      if (fileMetadata) {
        try {
          await fileHandler.deleteFile(fileMetadata.name);
        } catch (cleanupError) {
          this.logger.warn(
            `Failed to cleanup provider file: ${cleanupError.message}`,
          );
        }
      }
    }
  }

  /**
   * Index a YouTube video for RAG search (legacy - basic frame extraction)
   * Analyzes the video with selected AI provider to extract frame descriptions, then indexes them
   */
  @Post('index/youtube')
  async indexYouTube(@Body() dto: IndexYouTubeDto) {
    const startTime = Date.now();
    const videoAnalyzer = this.providerFactory.getVideoAnalyzer(dto.provider);
    const providerName = videoAnalyzer.getProviderName();

    this.logger.log(
      `Indexing YouTube video: ${dto.url}, provider: ${providerName}`,
    );

    // Auto-generate title if not provided
    const title = dto.title || this.generateTitleFromUrl(dto.url);

    try {
      // Analyze YouTube video to extract frame descriptions
      const analysis = await videoAnalyzer.analyzeYouTubeForIndexing(dto.url, {
        qualityLevel: this.mapThinkingLevelToQuality(dto.thinkingLevel),
        mediaResolution: this.mapMediaResolutionToQuality(dto.mediaResolution),
        startOffset: dto.startOffset,
        endOffset: dto.endOffset,
      });

      this.logger.log(
        `Analysis complete, ${analysis.frames?.length || 0} frames extracted`,
      );

      // Index the video with frame descriptions
      const result = await this.videoIndexService.indexVideoAnalysis(
        dto.url,
        title,
        analysis,
        analysis.frames || [],
      );

      return {
        ...result,
        provider: providerName,
        indexingTimeMs: Date.now() - startTime,
        tokenUsage: analysis.tokenUsage,
      };
    } catch (error) {
      this.logger.error(
        `Failed to index YouTube video: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * ADVANCED: Index a YouTube video with comprehensive multi-modal extraction
   * Extracts detailed information about people, objects, scenes, audio, and text
   * This enables answering detailed questions about demographics, speech, etc.
   */
  @Post('index/youtube/advanced')
  async indexYouTubeAdvanced(@Body() dto: IndexYouTubeDto) {
    const startTime = Date.now();
    const videoAnalyzer = this.providerFactory.getVideoAnalyzer(dto.provider);
    const providerName = videoAnalyzer.getProviderName();

    this.logger.log(
      `Advanced indexing YouTube video: ${dto.url}, provider: ${providerName}`,
    );

    // Auto-generate title if not provided
    const title = dto.title || this.generateTitleFromUrl(dto.url);

    try {
      // Perform advanced multi-modal analysis
      const analysis = await videoAnalyzer.analyzeYouTubeForAdvancedIndexing(
        dto.url,
        {
          qualityLevel: this.mapThinkingLevelToQuality(dto.thinkingLevel),
          mediaResolution: this.mapMediaResolutionToQuality(
            dto.mediaResolution,
          ),
          startOffset: dto.startOffset,
          endOffset: dto.endOffset,
        },
      );

      this.logger.log(
        `Advanced analysis complete, ${analysis.frames?.length || 0} frames extracted`,
      );

      // Index with multi-aspect embedding generation
      const result = await this.videoIndexService.indexAdvancedVideoAnalysis(
        dto.url,
        title,
        analysis,
      );

      return {
        ...result,
        provider: providerName,
        indexingTimeMs: Date.now() - startTime,
        tokenUsage: analysis.tokenUsage,
        analysisType: 'advanced',
      };
    } catch (error) {
      this.logger.error(
        `Failed to perform advanced YouTube indexing: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * ADVANCED: Index an uploaded video with comprehensive multi-modal extraction
   * Extracts detailed information about people, objects, scenes, audio, and text
   */
  @Post('index/advanced')
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: uploadsDir,
        filename: (req, file, callback) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          callback(null, `advanced-${uniqueSuffix}${ext}`);
        },
      }),
    }),
  )
  async indexVideoAdvanced(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // Custom video validator with max 2GB file size
          new VideoFileValidator({ maxSize: 2 * 1024 * 1024 * 1024 }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: IndexVideoDto,
  ) {
    const startTime = Date.now();
    const fileHandler = this.providerFactory.getFileHandler(dto.provider);
    const videoAnalyzer = this.providerFactory.getVideoAnalyzer(dto.provider);
    const providerName = videoAnalyzer.getProviderName();

    const title =
      dto.title ||
      file.originalname.replace(/\.[^/.]+$/, '') ||
      `Video ${Date.now()}`;

    this.logger.log(
      `Advanced indexing video: ${title}, size: ${file.size} bytes, provider: ${providerName}`,
    );

    let fileMetadata: { uri: string; mimeType: string; name: string } | null =
      null;

    try {
      // Upload file to provider with advanced extraction options
      // This enables more frames and higher resolution for comprehensive analysis
      const uploadedFile = await fileHandler.uploadAndWaitForActive(
        file.path,
        file.mimetype,
        title,
        { advanced: true },
      );
      fileMetadata = {
        uri: uploadedFile.uri,
        mimeType: uploadedFile.mimeType,
        name: uploadedFile.name,
      };

      this.logger.log(`File uploaded and active (advanced mode): ${fileMetadata.uri}`);

      // Perform advanced multi-modal analysis
      const analysis = await videoAnalyzer.analyzeForAdvancedIndexing(
        fileMetadata.uri,
        fileMetadata.mimeType,
        {
          qualityLevel: this.mapThinkingLevelToQuality(dto.thinkingLevel),
          mediaResolution: this.mapMediaResolutionToQuality(
            dto.mediaResolution,
          ),
        },
      );

      this.logger.log(
        `Advanced analysis complete, ${analysis.frames?.length || 0} frames extracted`,
      );

      // Index with multi-aspect embedding generation
      const result = await this.videoIndexService.indexAdvancedVideoAnalysis(
        fileMetadata.uri,
        title,
        analysis,
      );

      return {
        ...result,
        provider: providerName,
        indexingTimeMs: Date.now() - startTime,
        tokenUsage: analysis.tokenUsage,
        analysisType: 'advanced',
      };
    } catch (error) {
      this.logger.error(
        `Failed to perform advanced video indexing: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      // Cleanup
      try {
        if (existsSync(file.path)) {
          unlinkSync(file.path);
        }
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to cleanup local file: ${cleanupError.message}`,
        );
      }

      if (fileMetadata) {
        try {
          await fileHandler.deleteFile(fileMetadata.name);
        } catch (cleanupError) {
          this.logger.warn(
            `Failed to cleanup provider file: ${cleanupError.message}`,
          );
        }
      }
    }
  }

  /**
   * Chat with an indexed video using RAG (legacy - basic search)
   * Retrieves relevant frames and synthesizes an answer
   */
  @Post('chat')
  async chat(@Body() dto: RAGChatDto) {
    const startTime = Date.now();
    const providerName = dto.provider
      ? dto.provider
      : this.providerFactory.getDefaultProvider();

    this.logger.log(
      `RAG chat for video ${dto.videoId}: ${dto.query.substring(0, 100)}..., provider: ${providerName}`,
    );

    try {
      const response = await this.ragChatService.chat(
        dto.videoId,
        dto.query,
        dto.topK,
        dto.provider,
      );

      return {
        ...response,
        provider: providerName,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(`RAG chat failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * ADVANCED: Chat with an indexed video using multi-aspect RAG
   * Provides detailed answers about people (gender, race, age, clothing),
   * audio (speech transcription), objects, scenes, and actions
   */
  @Post('chat/advanced')
  async chatAdvanced(@Body() dto: RAGChatDto) {
    const startTime = Date.now();
    const providerName = dto.provider
      ? dto.provider
      : this.providerFactory.getDefaultProvider();

    this.logger.log(
      `Advanced RAG chat for video ${dto.videoId}: ${dto.query.substring(0, 100)}..., provider: ${providerName}`,
    );

    try {
      const response = await this.ragChatService.advancedChat(
        dto.videoId,
        dto.query,
        dto.topK,
        dto.provider,
      );

      return {
        ...response,
        provider: providerName,
        latencyMs: Date.now() - startTime,
        chatType: 'advanced',
      };
    } catch (error) {
      this.logger.error(
        `Advanced RAG chat failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Search across all indexed videos (legacy)
   * Returns relevant frames from any video
   */
  @Post('search')
  async globalSearch(@Body() dto: GlobalSearchDto) {
    const startTime = Date.now();
    this.logger.log(`Global search: ${dto.query.substring(0, 100)}...`);

    try {
      const response = await this.ragChatService.globalSearch(
        dto.query,
        dto.topK,
      );

      return {
        ...response,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(`Global search failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * ADVANCED: Search across all indexed videos with multi-aspect support
   * Returns detailed results including aspect type distribution
   */
  @Post('search/advanced')
  async globalSearchAdvanced(@Body() dto: GlobalSearchDto) {
    const startTime = Date.now();
    this.logger.log(
      `Advanced global search: ${dto.query.substring(0, 100)}...`,
    );

    try {
      const response = await this.ragChatService.advancedGlobalSearch(
        dto.query,
        dto.topK,
      );

      return {
        ...response,
        latencyMs: Date.now() - startTime,
        searchType: 'advanced',
      };
    } catch (error) {
      this.logger.error(
        `Advanced global search failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * List all indexed videos
   */
  @Get('videos')
  async listVideos() {
    try {
      const videos = await this.videoIndexService.listIndexedVideos();
      return {
        videos,
        count: videos.length,
      };
    } catch (error) {
      this.logger.error(`Failed to list videos: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get details of a specific indexed video
   */
  @Get('videos/:id')
  async getVideo(@Param('id') id: string) {
    try {
      const video = await this.videoIndexService.getIndexedVideo(id);
      return video;
    } catch (error) {
      this.logger.error(
        `Failed to get video ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Delete an indexed video and its frames
   */
  @Delete('videos/:id')
  async deleteVideo(@Param('id') id: string) {
    try {
      await this.videoIndexService.deleteIndexedVideo(id);
      return {
        success: true,
        message: `Video ${id} and its frames have been deleted`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to delete video ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get LanceDB statistics
   */
  @Get('stats')
  async getStats() {
    try {
      const stats = await this.lancedbService.getStats();
      return {
        ...stats,
        embeddingModel: this.configService.get<string>(
          'EMBEDDING_MODEL',
          'Xenova/all-MiniLM-L6-v2',
        ),
        embeddingServiceReady: this.embeddingService.isInitialized(),
      };
    } catch (error) {
      this.logger.error(`Failed to get stats: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find similar content using a text query (uses advanced multi-aspect search)
   */
  @Get('similar')
  async findSimilar(
    @Query('query') query: string,
    @Query('videoId') videoId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!query) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Query parameter is required',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const results = await this.ragChatService.findSimilarByQuery(
        query,
        videoId,
        limit ? parseInt(limit, 10) : undefined,
      );

      return {
        results,
        count: results.length,
      };
    } catch (error) {
      this.logger.error(`Find similar failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Health check for LanceDB services
   */
  @Get('health')
  async health() {
    return {
      status: 'ok',
      embeddingServiceReady: this.embeddingService.isInitialized(),
      lancedbConnected: true,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate a title from a URL (YouTube or file)
   */
  private generateTitleFromUrl(url: string): string {
    try {
      // Try to extract YouTube video ID
      const youtubeMatch = url.match(
        /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/,
      );
      if (youtubeMatch) {
        return `YouTube Video ${youtubeMatch[1]}`;
      }

      // Try to extract filename from URL
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop();
      if (filename) {
        return filename.replace(/\.[^/.]+$/, ''); // Remove extension
      }
    } catch {
      // URL parsing failed
    }

    // Fallback to timestamp-based title
    return `Video indexed at ${new Date().toISOString()}`;
  }
}
