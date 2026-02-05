import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as lancedb from '@lancedb/lancedb';
import {
  VideoRecord,
  FrameRecord,
  FrameSearchResult,
  IndexedVideoSummary,
  EnhancedFrameRecord,
  EnhancedFrameSearchResult,
  AspectType,
} from './interfaces';

// Type aliases for LanceDB
type Connection = Awaited<ReturnType<typeof lancedb.connect>>;
type Table = Awaited<ReturnType<Connection['createTable']>>;

/**
 * Service for managing LanceDB connection and operations
 * Handles video and frame tables for vector search
 * Supports both legacy frames and enhanced multi-aspect frames
 */
@Injectable()
export class LanceDBService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LanceDBService.name);
  private db: Connection;
  private videosTable: Table | null = null;
  private framesTable: Table | null = null;
  private enhancedFramesTable: Table | null = null;
  private dbPath: string;
  private isReady = false;

  // Table names
  private readonly VIDEOS_TABLE = 'videos';
  private readonly FRAMES_TABLE = 'frames';
  private readonly ENHANCED_FRAMES_TABLE = 'enhanced_frames';

  constructor(private readonly configService: ConfigService) {
    this.dbPath = this.configService.get<string>(
      'LANCEDB_PATH',
      './data/deepcap-vectors',
    );
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    // LanceDB handles cleanup automatically
    this.logger.log('LanceDB service shutting down');
  }

  /**
   * Connect to LanceDB and initialize tables
   */
  private async connect(): Promise<void> {
    this.logger.log(`Connecting to LanceDB at: ${this.dbPath}`);

    try {
      this.db = await lancedb.connect(this.dbPath);
      await this.initializeTables();
      this.isReady = true;
      this.logger.log('LanceDB connected and tables initialized');
    } catch (error) {
      this.logger.error(
        `Failed to connect to LanceDB: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Initialize or open existing tables
   */
  private async initializeTables(): Promise<void> {
    const tableNames = await this.db.tableNames();

    // Initialize videos table
    if (tableNames.includes(this.VIDEOS_TABLE)) {
      this.videosTable = await this.db.openTable(this.VIDEOS_TABLE);
      this.logger.log(`Opened existing videos table`);
    } else {
      this.logger.log('Videos table will be created on first insert');
    }

    // Initialize frames table (legacy)
    if (tableNames.includes(this.FRAMES_TABLE)) {
      this.framesTable = await this.db.openTable(this.FRAMES_TABLE);
      const count = await this.framesTable.countRows();
      this.logger.log(`Opened existing frames table with ${count} rows`);
    } else {
      this.logger.log('Frames table will be created on first insert');
    }

    // Initialize enhanced frames table (multi-aspect)
    if (tableNames.includes(this.ENHANCED_FRAMES_TABLE)) {
      this.enhancedFramesTable = await this.db.openTable(
        this.ENHANCED_FRAMES_TABLE,
      );
      const count = await this.enhancedFramesTable.countRows();
      this.logger.log(
        `Opened existing enhanced frames table with ${count} rows`,
      );
    } else {
      this.logger.log('Enhanced frames table will be created on first insert');
    }
  }

  /**
   * Check if the service is ready
   */
  isInitialized(): boolean {
    return this.isReady;
  }

  /**
   * Insert a video record
   */
  async insertVideo(video: VideoRecord): Promise<void> {
    this.logger.log(`Inserting video: ${video.id}`);

    try {
      if (!this.videosTable) {
        // Create table with first record
        this.videosTable = await this.db.createTable(this.VIDEOS_TABLE, [
          video,
        ]);
        this.logger.log('Created videos table');
      } else {
        await this.videosTable.add([video]);
      }
    } catch (error) {
      this.logger.error(`Failed to insert video: ${error.message}`);
      throw error;
    }
  }

  /**
   * Insert frame records with vectors (legacy)
   */
  async insertFrames(frames: FrameRecord[]): Promise<void> {
    if (frames.length === 0) {
      return;
    }

    this.logger.log(`Inserting ${frames.length} frames`);

    try {
      if (!this.framesTable) {
        // Create table with first batch
        this.framesTable = await this.db.createTable(this.FRAMES_TABLE, frames);
        this.logger.log('Created frames table');
      } else {
        await this.framesTable.add(frames);
      }
    } catch (error) {
      this.logger.error(`Failed to insert frames: ${error.message}`);
      throw error;
    }
  }

  /**
   * Insert enhanced frame records with multi-aspect support
   */
  async insertEnhancedFrames(frames: EnhancedFrameRecord[]): Promise<void> {
    if (frames.length === 0) {
      return;
    }

    this.logger.log(`Inserting ${frames.length} enhanced frames`);

    try {
      if (!this.enhancedFramesTable) {
        // Create table with first batch
        this.enhancedFramesTable = await this.db.createTable(
          this.ENHANCED_FRAMES_TABLE,
          frames,
        );
        this.logger.log('Created enhanced frames table');
      } else {
        await this.enhancedFramesTable.add(frames);
      }
    } catch (error) {
      this.logger.error(`Failed to insert enhanced frames: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform vector search on enhanced frames with optional aspect filtering
   * @param queryVector The query embedding vector
   * @param videoId Optional filter by video ID
   * @param aspectTypes Optional filter by aspect types
   * @param limit Maximum number of results
   */
  async enhancedVectorSearch(
    queryVector: number[],
    options: {
      videoId?: string;
      aspectTypes?: AspectType[];
      limit?: number;
    } = {},
  ): Promise<EnhancedFrameSearchResult[]> {
    const { videoId, aspectTypes, limit = 10 } = options;

    if (!this.enhancedFramesTable) {
      this.logger.warn(
        'Enhanced frames table not initialized, returning empty results',
      );
      return [];
    }

    const startTime = Date.now();

    try {
      let query = this.enhancedFramesTable
        .vectorSearch(queryVector)
        .distanceType('cosine')
        .limit(limit);

      // Build filter conditions
      const conditions: string[] = [];

      if (videoId) {
        conditions.push(`videoId = '${videoId}'`);
      }

      if (aspectTypes && aspectTypes.length > 0) {
        const aspectFilter = aspectTypes
          .map((t) => `aspectType = '${t}'`)
          .join(' OR ');
        conditions.push(`(${aspectFilter})`);
      }

      if (conditions.length > 0) {
        query = query.where(conditions.join(' AND '));
      }

      const results = await query.toArray();

      const latency = Date.now() - startTime;
      this.logger.debug(
        `Enhanced vector search completed in ${latency}ms, found ${results.length} results`,
      );

      return results as EnhancedFrameSearchResult[];
    } catch (error) {
      this.logger.error(`Enhanced vector search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform vector search on frames
   * @param queryVector The query embedding vector
   * @param videoId Optional filter by video ID
   * @param limit Maximum number of results
   */
  async vectorSearch(
    queryVector: number[],
    videoId?: string,
    limit: number = 10,
  ): Promise<FrameSearchResult[]> {
    if (!this.framesTable) {
      this.logger.warn('Frames table not initialized, returning empty results');
      return [];
    }

    const startTime = Date.now();

    try {
      let query = this.framesTable
        .vectorSearch(queryVector)
        .distanceType('cosine')
        .limit(limit);

      // Filter by videoId if provided
      if (videoId) {
        query = query.where(`videoId = '${videoId}'`);
      }

      const results = await query.toArray();

      const latency = Date.now() - startTime;
      this.logger.debug(
        `Vector search completed in ${latency}ms, found ${results.length} results`,
      );

      return results as FrameSearchResult[];
    } catch (error) {
      this.logger.error(`Vector search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get video by ID
   */
  async getVideo(videoId: string): Promise<VideoRecord | null> {
    if (!this.videosTable) {
      return null;
    }

    try {
      const results = await this.videosTable
        .query()
        .where(`id = '${videoId}'`)
        .limit(1)
        .toArray();

      return results.length > 0 ? (results[0] as VideoRecord) : null;
    } catch (error) {
      this.logger.error(`Failed to get video: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all frames for a video
   */
  async getVideoFrames(videoId: string): Promise<FrameRecord[]> {
    if (!this.framesTable) {
      return [];
    }

    try {
      const results = await this.framesTable
        .query()
        .where(`videoId = '${videoId}'`)
        .toArray();

      // Sort by timestamp seconds
      return (results as FrameRecord[]).sort(
        (a, b) => a.timestampSeconds - b.timestampSeconds,
      );
    } catch (error) {
      this.logger.error(`Failed to get video frames: ${error.message}`);
      throw error;
    }
  }

  /**
   * List all indexed videos
   */
  async listVideos(): Promise<IndexedVideoSummary[]> {
    if (!this.videosTable) {
      return [];
    }

    try {
      const results = await this.videosTable.query().toArray();

      return (results as VideoRecord[]).map((v) => ({
        id: v.id,
        title: v.title,
        sourceUri: v.sourceUri,
        frameCount: v.frameCount,
        indexedAt: v.indexedAt,
        confidence: v.confidence,
      }));
    } catch (error) {
      this.logger.error(`Failed to list videos: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if a video is already indexed
   */
  async isVideoIndexed(sourceUri: string): Promise<boolean> {
    if (!this.videosTable) {
      return false;
    }

    try {
      const results = await this.videosTable
        .query()
        .where(`sourceUri = '${sourceUri}'`)
        .limit(1)
        .toArray();

      return results.length > 0;
    } catch (error) {
      this.logger.error(
        `Failed to check video indexed status: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Delete a video and its frames (both legacy and enhanced)
   */
  async deleteVideo(videoId: string): Promise<void> {
    this.logger.log(`Deleting video: ${videoId}`);

    try {
      // Delete legacy frames
      if (this.framesTable) {
        await this.framesTable.delete(`videoId = '${videoId}'`);
      }

      // Delete enhanced frames
      if (this.enhancedFramesTable) {
        await this.enhancedFramesTable.delete(`videoId = '${videoId}'`);
      }

      // Delete video record
      if (this.videosTable) {
        await this.videosTable.delete(`id = '${videoId}'`);
      }

      this.logger.log(`Video deleted: ${videoId}`);
    } catch (error) {
      this.logger.error(`Failed to delete video: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get statistics about the database
   */
  async getStats(): Promise<{
    videoCount: number;
    frameCount: number;
    enhancedFrameCount: number;
    dbPath: string;
  }> {
    const videoCount = this.videosTable
      ? await this.videosTable.countRows()
      : 0;
    const frameCount = this.framesTable
      ? await this.framesTable.countRows()
      : 0;
    const enhancedFrameCount = this.enhancedFramesTable
      ? await this.enhancedFramesTable.countRows()
      : 0;

    return {
      videoCount,
      frameCount,
      enhancedFrameCount,
      dbPath: this.dbPath,
    };
  }

  /**
   * Get all enhanced frames for a video
   */
  async getEnhancedVideoFrames(
    videoId: string,
    aspectType?: AspectType,
  ): Promise<EnhancedFrameRecord[]> {
    if (!this.enhancedFramesTable) {
      return [];
    }

    try {
      let query = this.enhancedFramesTable
        .query()
        .where(`videoId = '${videoId}'`);

      if (aspectType) {
        query = query.where(`aspectType = '${aspectType}'`);
      }

      const results = await query.toArray();

      // Sort by timestamp seconds
      return (results as EnhancedFrameRecord[]).sort(
        (a, b) => a.timestampSeconds - b.timestampSeconds,
      );
    } catch (error) {
      this.logger.error(
        `Failed to get enhanced video frames: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Delete enhanced frames for a video
   */
  async deleteEnhancedFrames(videoId: string): Promise<void> {
    if (this.enhancedFramesTable) {
      await this.enhancedFramesTable.delete(`videoId = '${videoId}'`);
    }
  }

  /**
   * Create an ANN index on the frames table for faster search
   * Should be called after inserting a significant number of frames
   */
  async createIndex(): Promise<void> {
    // Create index on legacy frames table
    if (this.framesTable) {
      const count = await this.framesTable.countRows();
      if (count >= 256) {
        this.logger.log(`Creating IVF_PQ index on ${count} legacy frames...`);
        try {
          await this.framesTable.createIndex('vector', {
            config: lancedb.Index.ivfPq({
              numPartitions: Math.min(Math.floor(Math.sqrt(count)), 256),
              numSubVectors: 16,
            }),
          });
          this.logger.log('Legacy frames index created successfully');
        } catch (error) {
          this.logger.error(
            `Failed to create legacy frames index: ${error.message}`,
          );
        }
      }
    }

    // Create index on enhanced frames table
    if (this.enhancedFramesTable) {
      const count = await this.enhancedFramesTable.countRows();
      if (count >= 256) {
        this.logger.log(`Creating IVF_PQ index on ${count} enhanced frames...`);
        try {
          await this.enhancedFramesTable.createIndex('vector', {
            config: lancedb.Index.ivfPq({
              numPartitions: Math.min(Math.floor(Math.sqrt(count)), 256),
              numSubVectors: 16,
            }),
          });
          this.logger.log('Enhanced frames index created successfully');
        } catch (error) {
          this.logger.error(
            `Failed to create enhanced frames index: ${error.message}`,
          );
        }
      }
    }
  }

  /**
   * Get aspect type counts for a video
   */
  async getVideoAspectCounts(
    videoId: string,
  ): Promise<Record<AspectType, number>> {
    const counts: Record<AspectType, number> = {
      people: 0,
      objects: 0,
      scene: 0,
      audio: 0,
      action: 0,
      text: 0,
    };

    if (!this.enhancedFramesTable) {
      return counts;
    }

    try {
      const frames = await this.enhancedFramesTable
        .query()
        .where(`videoId = '${videoId}'`)
        .toArray();

      for (const frame of frames) {
        const aspectType = (frame as EnhancedFrameRecord).aspectType;
        if (aspectType in counts) {
          counts[aspectType]++;
        }
      }

      return counts;
    } catch (error) {
      this.logger.error(`Failed to get aspect counts: ${error.message}`);
      return counts;
    }
  }
}
