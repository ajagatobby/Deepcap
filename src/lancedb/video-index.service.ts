import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { EmbeddingService } from './embedding.service';
import { LanceDBService } from './lancedb.service';
import {
  VideoRecord,
  FrameRecord,
  FrameDescription,
  IndexResult,
  IndexedVideoSummary,
  EnhancedFrameRecord,
  EnhancedFrameRecordBase,
  AspectType,
  AdvancedVideoAnalysisResult,
  AdvancedFrameData,
  PersonMetadata,
  ObjectMetadata,
  SceneMetadata,
  AudioMetadata,
  TextOnScreenMetadata,
} from './interfaces';
import { VideoAnalysisResult } from '../gemini/interfaces';

/**
 * Service for indexing video analysis results into LanceDB
 * Orchestrates the embedding and storage pipeline
 */
@Injectable()
export class VideoIndexService {
  private readonly logger = new Logger(VideoIndexService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly lancedbService: LanceDBService,
  ) {}

  /**
   * Index a video analysis with frame-level descriptions
   * @param sourceUri YouTube URL or file path
   * @param title Video title
   * @param analysis Analysis result from Gemini
   * @param frameDescriptions Array of frame descriptions to index
   * @param duration Optional video duration in seconds
   */
  async indexVideoAnalysis(
    sourceUri: string,
    title: string,
    analysis: VideoAnalysisResult,
    frameDescriptions: FrameDescription[],
    duration?: number,
  ): Promise<IndexResult> {
    const startTime = Date.now();
    const videoId = uuidv4();

    this.logger.log(
      `Indexing video: ${title} (${frameDescriptions.length} frames)`,
    );

    try {
      // Check if already indexed
      const isIndexed = await this.lancedbService.isVideoIndexed(sourceUri);
      if (isIndexed) {
        this.logger.warn(`Video already indexed: ${sourceUri}`);
        throw new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message: 'Video is already indexed',
            sourceUri,
          },
          HttpStatus.CONFLICT,
        );
      }

      // Validate frame descriptions
      if (frameDescriptions.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'No frame descriptions provided for indexing',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 1. Generate embeddings for all frame descriptions
      this.logger.log(
        `Generating embeddings for ${frameDescriptions.length} frames...`,
      );
      const descriptions = frameDescriptions.map((f) => f.description);
      const embeddings = await this.embeddingService.embedBatch(descriptions);

      // 2. Create video record
      const videoRecord: VideoRecord = {
        id: videoId,
        sourceUri,
        title,
        duration,
        fullAnalysis: analysis.analysis,
        confidence: analysis.confidence,
        indexedAt: new Date().toISOString(),
        frameCount: frameDescriptions.length,
        thoughtSummary: analysis.thoughtSummary,
      };

      // 3. Create frame records with vectors
      const frameRecords: FrameRecord[] = frameDescriptions.map(
        (frame, index) => ({
          id: uuidv4(),
          videoId,
          timestamp: frame.timestamp,
          timestampSeconds: this.parseTimestamp(frame.timestamp),
          description: frame.description,
          vector: embeddings[index],
        }),
      );

      // 4. Insert into LanceDB
      await this.lancedbService.insertVideo(videoRecord);
      await this.lancedbService.insertFrames(frameRecords);

      const indexingTimeMs = Date.now() - startTime;
      this.logger.log(
        `Video indexed successfully: ${videoId} (${frameDescriptions.length} frames in ${indexingTimeMs}ms)`,
      );

      // 5. Optionally create index if enough data
      const stats = await this.lancedbService.getStats();
      if (stats.frameCount >= 256) {
        await this.lancedbService.createIndex();
      }

      return {
        videoId,
        frameCount: frameDescriptions.length,
        indexingTimeMs,
        success: true,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Failed to index video: ${error.message}`, error.stack);
      return {
        videoId,
        frameCount: 0,
        indexingTimeMs: Date.now() - startTime,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Index from timestamps array (from existing analysis format)
   * Converts timestamps to frame descriptions
   */
  async indexFromTimestamps(
    sourceUri: string,
    title: string,
    analysis: VideoAnalysisResult,
    duration?: number,
  ): Promise<IndexResult> {
    // Convert timestamps to frame descriptions
    const frameDescriptions: FrameDescription[] = analysis.timestamps.map(
      (ts) => ({
        timestamp: ts.start,
        description: `[${ts.start} - ${ts.end}] ${ts.description}`,
      }),
    );

    // If no timestamps, create a single frame from the full analysis
    if (frameDescriptions.length === 0) {
      frameDescriptions.push({
        timestamp: '00:00',
        description: analysis.analysis,
      });
    }

    return this.indexVideoAnalysis(
      sourceUri,
      title,
      analysis,
      frameDescriptions,
      duration,
    );
  }

  /**
   * Advanced multi-aspect indexing for comprehensive video search
   * Creates multiple embeddings per frame for different aspects (people, objects, scene, audio, action, text)
   */
  async indexAdvancedVideoAnalysis(
    sourceUri: string,
    title: string,
    analysis: AdvancedVideoAnalysisResult,
    duration?: number,
  ): Promise<IndexResult> {
    const startTime = Date.now();
    const videoId = uuidv4();

    this.logger.log(
      `Starting advanced indexing for: ${title} (${analysis.frames.length} frames)`,
    );

    try {
      // Check if already indexed
      const isIndexed = await this.lancedbService.isVideoIndexed(sourceUri);
      if (isIndexed) {
        this.logger.warn(`Video already indexed: ${sourceUri}`);
        throw new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message: 'Video is already indexed',
            sourceUri,
          },
          HttpStatus.CONFLICT,
        );
      }

      // Validate frame data
      if (analysis.frames.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'No frame data provided for indexing',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 1. Extract all aspect descriptions from frames
      const aspectRecords: EnhancedFrameRecordBase[] =
        this.extractAspectDescriptions(videoId, analysis.frames);
      this.logger.log(
        `Extracted ${aspectRecords.length} aspect records from frames`,
      );

      // 2. Generate embeddings for all aspect descriptions
      this.logger.log(
        `Generating embeddings for ${aspectRecords.length} aspect records...`,
      );
      const contents: string[] = aspectRecords.map((r) => r.content);
      const embeddings = await this.embeddingService.embedBatch(contents);

      // 3. Add vectors to records
      const enhancedFrameRecords: EnhancedFrameRecord[] = aspectRecords.map(
        (record, index): EnhancedFrameRecord => ({
          id: record.id,
          videoId: record.videoId,
          timestamp: record.timestamp,
          timestampSeconds: record.timestampSeconds,
          aspectType: record.aspectType,
          content: record.content,
          metadata: record.metadata,
          vector: embeddings[index],
        }),
      );

      // 4. Create video record
      const videoRecord: VideoRecord = {
        id: videoId,
        sourceUri,
        title,
        duration,
        fullAnalysis: analysis.summary,
        confidence: analysis.confidence,
        indexedAt: new Date().toISOString(),
        frameCount: enhancedFrameRecords.length,
        thoughtSummary: analysis.thoughtSummary,
      };

      // 5. Insert into LanceDB
      await this.lancedbService.insertVideo(videoRecord);
      await this.lancedbService.insertEnhancedFrames(enhancedFrameRecords);

      const indexingTimeMs = Date.now() - startTime;

      // Log aspect distribution
      const aspectCounts = this.countAspects(enhancedFrameRecords);
      this.logger.log(
        `Video indexed successfully: ${videoId} (${enhancedFrameRecords.length} records in ${indexingTimeMs}ms)`,
      );
      this.logger.log(
        `Aspect distribution: people=${aspectCounts.people}, objects=${aspectCounts.objects}, ` +
          `scene=${aspectCounts.scene}, audio=${aspectCounts.audio}, action=${aspectCounts.action}, text=${aspectCounts.text}`,
      );

      // 6. Optionally create index if enough data
      const stats = await this.lancedbService.getStats();
      if (stats.enhancedFrameCount >= 256) {
        await this.lancedbService.createIndex();
      }

      return {
        videoId,
        frameCount: enhancedFrameRecords.length,
        indexingTimeMs,
        success: true,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Failed to index video: ${error.message}`, error.stack);
      return {
        videoId,
        frameCount: 0,
        indexingTimeMs: Date.now() - startTime,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Extract aspect descriptions from advanced frame data
   * Creates multiple searchable records per frame
   */
  private extractAspectDescriptions(
    videoId: string,
    frames: AdvancedFrameData[],
  ): EnhancedFrameRecordBase[] {
    const records: EnhancedFrameRecordBase[] = [];

    for (const frame of frames) {
      const timestampSeconds = this.parseTimestamp(frame.timestamp);

      // Extract PEOPLE descriptions
      if (frame.people && frame.people.length > 0) {
        const peopleDescription = this.buildPeopleDescription(
          frame.timestamp,
          frame.people,
        );
        if (peopleDescription) {
          records.push({
            id: uuidv4(),
            videoId,
            timestamp: frame.timestamp,
            timestampSeconds,
            aspectType: 'people',
            content: peopleDescription,
            metadata: JSON.stringify(frame.people),
          });
        }
      }

      // Extract OBJECTS descriptions
      if (frame.objects && frame.objects.length > 0) {
        const objectsDescription = this.buildObjectsDescription(
          frame.timestamp,
          frame.objects,
        );
        if (objectsDescription) {
          records.push({
            id: uuidv4(),
            videoId,
            timestamp: frame.timestamp,
            timestampSeconds,
            aspectType: 'objects',
            content: objectsDescription,
            metadata: JSON.stringify(frame.objects),
          });
        }
      }

      // Extract SCENE description
      if (frame.scene) {
        const sceneDescription = this.buildSceneDescription(
          frame.timestamp,
          frame.scene,
        );
        if (sceneDescription) {
          records.push({
            id: uuidv4(),
            videoId,
            timestamp: frame.timestamp,
            timestampSeconds,
            aspectType: 'scene',
            content: sceneDescription,
            metadata: JSON.stringify(frame.scene),
          });
        }
      }

      // Extract AUDIO descriptions
      if (frame.audio) {
        const audioDescription = this.buildAudioDescription(
          frame.timestamp,
          frame.audio,
        );
        if (audioDescription) {
          records.push({
            id: uuidv4(),
            videoId,
            timestamp: frame.timestamp,
            timestampSeconds,
            aspectType: 'audio',
            content: audioDescription,
            metadata: JSON.stringify(frame.audio),
          });
        }
      }

      // Extract TEXT ON SCREEN descriptions
      if (frame.textOnScreen && frame.textOnScreen.length > 0) {
        const textDescription = this.buildTextDescription(
          frame.timestamp,
          frame.textOnScreen,
        );
        if (textDescription) {
          records.push({
            id: uuidv4(),
            videoId,
            timestamp: frame.timestamp,
            timestampSeconds,
            aspectType: 'text',
            content: textDescription,
            metadata: JSON.stringify(frame.textOnScreen),
          });
        }
      }

      // Extract ACTION description
      if (frame.actionDescription) {
        records.push({
          id: uuidv4(),
          videoId,
          timestamp: frame.timestamp,
          timestampSeconds,
          aspectType: 'action',
          content: `At ${frame.timestamp}: ${frame.actionDescription}`,
          metadata: JSON.stringify({ action: frame.actionDescription }),
        });
      }
    }

    return records;
  }

  /**
   * Build a searchable description for people in frame
   */
  private buildPeopleDescription(
    timestamp: string,
    people: PersonMetadata[],
  ): string {
    const descriptions = people.map((person, index) => {
      const parts: string[] = [];

      // ROLE is the most important for searchability (e.g., "robber", "victim")
      if (person.role && person.role !== 'unknown') {
        parts.push(`[${person.role.toUpperCase()}]`);
      }

      // Threat level for dangerous individuals
      if (person.threatLevel && person.threatLevel !== 'none') {
        parts.push(`(threat: ${person.threatLevel})`);
      }

      // Basic demographics
      if (person.gender) parts.push(person.gender);
      if (person.apparentAge) parts.push(person.apparentAge);
      if (person.apparentEthnicity)
        parts.push(`appears ${person.apparentEthnicity}`);

      // Physical build
      if (person.physicalBuild) parts.push(person.physicalBuild);

      // Physical description
      if (
        person.distinguishingFeatures &&
        person.distinguishingFeatures.length > 0
      ) {
        parts.push(`with ${person.distinguishingFeatures.join(', ')}`);
      }

      // Clothing
      if (person.clothing && person.clothing.length > 0) {
        parts.push(`wearing ${person.clothing.join(', ')}`);
      }

      // Facial expression and emotion
      if (person.facialExpression) parts.push(`expression: ${person.facialExpression}`);
      if (person.emotion) parts.push(`emotion: ${person.emotion}`);

      // Body language
      if (person.bodyLanguage) parts.push(`body language: ${person.bodyLanguage}`);

      // Action and interaction
      if (person.action) parts.push(`action: ${person.action}`);
      if (person.interactionWith) parts.push(`interacting with: ${person.interactionWith}`);
      if (person.position) parts.push(`positioned ${person.position}`);

      const personId = person.id || `Person ${index + 1}`;
      return `${personId}: ${parts.join(', ')}`;
    });

    return `At ${timestamp}: ${descriptions.join('. ')}`;
  }

  /**
   * Build a searchable description for objects in frame
   */
  private buildObjectsDescription(
    timestamp: string,
    objects: ObjectMetadata[],
  ): string {
    const descriptions = objects.map((obj) => {
      const parts: string[] = [obj.name];

      if (obj.color) parts.push(obj.color);
      if (obj.brand) parts.push(`(${obj.brand})`);
      if (obj.state) parts.push(obj.state);
      if (obj.description) parts.push(`- ${obj.description}`);

      return parts.join(' ');
    });

    return `At ${timestamp}: Objects visible - ${descriptions.join(', ')}`;
  }

  /**
   * Build a searchable description for scene
   */
  private buildSceneDescription(
    timestamp: string,
    scene: SceneMetadata,
  ): string {
    const parts: string[] = [];

    if (scene.locationType) parts.push(scene.locationType);
    if (scene.specificLocation) parts.push(scene.specificLocation);
    if (scene.lighting) parts.push(`${scene.lighting} lighting`);
    if (scene.weather) parts.push(scene.weather);
    if (scene.timeOfDay) parts.push(scene.timeOfDay);
    if (scene.cameraAngle) parts.push(`${scene.cameraAngle} shot`);
    if (scene.mood) parts.push(`${scene.mood} atmosphere`);

    return `At ${timestamp}: Scene - ${parts.join(', ')}`;
  }

  /**
   * Build a searchable description for audio
   */
  private buildAudioDescription(
    timestamp: string,
    audio: { speech?: any[]; music?: string; sounds?: string[] },
  ): string {
    const parts: string[] = [];

    // Speech transcription (most important for search)
    if (audio.speech && audio.speech.length > 0) {
      const speechParts = audio.speech.map((s) => {
        const speaker = s.speaker || 'Someone';
        const tone = s.tone ? ` (${s.tone} tone)` : '';
        return `${speaker} says: "${s.text}"${tone}`;
      });
      parts.push(speechParts.join('. '));
    }

    // Music
    if (audio.music) {
      parts.push(`Music: ${audio.music}`);
    }

    // Sound effects
    if (audio.sounds && audio.sounds.length > 0) {
      parts.push(`Sounds: ${audio.sounds.join(', ')}`);
    }

    if (parts.length === 0) {
      return '';
    }

    return `At ${timestamp}: ${parts.join('. ')}`;
  }

  /**
   * Build a searchable description for text on screen
   */
  private buildTextDescription(
    timestamp: string,
    textItems: TextOnScreenMetadata[],
  ): string {
    const descriptions = textItems.map((item) => {
      const position = item.position ? ` (${item.position})` : '';
      return `${item.type}: "${item.text}"${position}`;
    });

    return `At ${timestamp}: Text on screen - ${descriptions.join(', ')}`;
  }

  /**
   * Count aspects in enhanced frame records
   */
  private countAspects(
    records: EnhancedFrameRecord[],
  ): Record<AspectType, number> {
    const counts: Record<AspectType, number> = {
      people: 0,
      objects: 0,
      scene: 0,
      audio: 0,
      action: 0,
      text: 0,
    };

    for (const record of records) {
      if (record.aspectType in counts) {
        counts[record.aspectType]++;
      }
    }

    return counts;
  }

  /**
   * Get indexed video details
   */
  async getIndexedVideo(videoId: string): Promise<{
    video: VideoRecord;
    frames: FrameDescription[];
  } | null> {
    const video = await this.lancedbService.getVideo(videoId);
    if (!video) {
      return null;
    }

    const frames = await this.lancedbService.getVideoFrames(videoId);

    return {
      video,
      frames: frames.map((f) => ({
        timestamp: f.timestamp,
        description: f.description,
      })),
    };
  }

  /**
   * List all indexed videos
   */
  async listIndexedVideos(): Promise<IndexedVideoSummary[]> {
    return this.lancedbService.listVideos();
  }

  /**
   * Delete an indexed video
   */
  async deleteIndexedVideo(videoId: string): Promise<void> {
    const video = await this.lancedbService.getVideo(videoId);
    if (!video) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `Video not found: ${videoId}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    await this.lancedbService.deleteVideo(videoId);
  }

  /**
   * Check if a video is indexed
   */
  async isVideoIndexed(sourceUri: string): Promise<boolean> {
    return this.lancedbService.isVideoIndexed(sourceUri);
  }

  /**
   * Get database statistics
   */
  async getStats() {
    return this.lancedbService.getStats();
  }

  /**
   * Parse timestamp string to seconds
   * Supports MM:SS and HH:MM:SS formats
   */
  private parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(':').map(Number);

    if (parts.length === 2) {
      // MM:SS
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      // HH:MM:SS
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return 0;
  }
}
