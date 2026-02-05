import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  IFileHandler,
  UploadedFileMetadata,
  FileState,
} from '../providers/interfaces';
import {
  FrameExtractorService,
  ExtractedFrame,
} from './frame-extractor.service';

/**
 * Frame data for OpenAI Vision API
 */
export interface FrameData {
  timestamp: string;
  timestampSeconds: number;
  dataUrl: string;
}

/**
 * Options for video upload and frame extraction
 */
export interface VideoUploadOptions {
  /** Use advanced extraction settings (more frames, higher resolution) */
  advanced?: boolean;
  /** Custom interval between frames in seconds */
  intervalSeconds?: number;
  /** Custom maximum number of frames to extract */
  maxFrames?: number;
  /** Custom image scale (e.g., '1280:-1' for 1280px width) */
  scale?: string;
}

/**
 * In-memory file storage for OpenAI
 * For videos, we extract frames and store them as images
 * For images, we store the base64 data directly
 */
interface StoredFile {
  id: string;
  filePath: string;
  mimeType: string;
  displayName?: string;
  sizeBytes: number;
  isVideo: boolean;
  /** For images: single base64 data */
  base64Data?: string;
  /** For videos: extracted frames */
  frames?: ExtractedFrame[];
  createdAt: Date;
}

/**
 * Service for handling file operations for OpenAI
 * OpenAI Vision API accepts base64-encoded images
 * For videos, we automatically extract frames using ffmpeg
 */
@Injectable()
export class OpenAIFileHandlerService implements IFileHandler {
  private readonly logger = new Logger(OpenAIFileHandlerService.name);
  private storedFiles: Map<string, StoredFile> = new Map();

  constructor(private readonly frameExtractor: FrameExtractorService) {}

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
   * Upload a file (handles both images and videos)
   * For videos, frames are automatically extracted
   */
  async uploadVideo(
    filePath: string,
    mimeType: string,
    displayName?: string,
    options?: VideoUploadOptions,
  ): Promise<UploadedFileMetadata> {
    this.logger.log(`Processing file for OpenAI: ${filePath} (${mimeType})`);

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `File not found: ${filePath}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const stats = fs.statSync(filePath);
    const fileId = `openai-file-${uuidv4()}`;
    const isVideo = this.isVideoMimeType(mimeType);

    let storedFile: StoredFile;

    if (isVideo) {
      // Extract frames from video
      // Use advanced settings for comprehensive extraction or standard settings
      const isAdvanced = options?.advanced ?? false;

      // Advanced mode: more frames, denser coverage, higher resolution
      // Standard mode: fewer frames, optimized for basic analysis
      // For a 2-min video: advanced = 60 frames (~2s interval), standard = 15 frames (~8s interval)
      const extractionOptions = {
        intervalSeconds: options?.intervalSeconds ?? (isAdvanced ? 0.5 : 3),
        maxFrames: options?.maxFrames ?? (isAdvanced ? 60 : 15),
        format: 'jpg' as const,
        quality: isAdvanced ? 90 : 85,
        scale: options?.scale ?? (isAdvanced ? '1280:-1' : '640:-1'),
      };

      this.logger.log(
        `Extracting frames from video: ${filePath} (advanced: ${isAdvanced}, maxFrames: ${extractionOptions.maxFrames}, interval: ${extractionOptions.intervalSeconds}s, scale: ${extractionOptions.scale})`,
      );

      try {
        const frames = await this.frameExtractor.extractFrames(
          filePath,
          extractionOptions,
        );

        if (frames.length === 0) {
          throw new Error('No frames could be extracted from the video');
        }

        storedFile = {
          id: fileId,
          filePath,
          mimeType,
          displayName: displayName || path.basename(filePath),
          sizeBytes: stats.size,
          isVideo: true,
          frames,
          createdAt: new Date(),
        };

        this.logger.log(
          `Video processed: ${fileId} - extracted ${frames.length} frames (${isAdvanced ? 'advanced' : 'standard'} mode)`,
        );
      } catch (error) {
        this.logger.error(`Frame extraction failed: ${error.message}`);
        throw new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: `Failed to extract frames from video: ${error.message}. Make sure ffmpeg is installed.`,
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } else {
      // For images, store base64 directly
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      storedFile = {
        id: fileId,
        filePath,
        mimeType,
        displayName: displayName || path.basename(filePath),
        sizeBytes: stats.size,
        isVideo: false,
        base64Data,
        createdAt: new Date(),
      };

      this.logger.log(
        `Image processed: ${fileId} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
      );
    }

    this.storedFiles.set(fileId, storedFile);

    return {
      name: fileId,
      displayName: storedFile.displayName,
      mimeType,
      sizeBytes: String(stats.size),
      uri: `openai://files/${fileId}`,
      state: 'ACTIVE' as FileState,
    };
  }

  /**
   * Upload and wait for active (immediate for OpenAI since we process locally)
   */
  async uploadAndWaitForActive(
    filePath: string,
    mimeType: string,
    displayName?: string,
    options?: VideoUploadOptions,
  ): Promise<UploadedFileMetadata> {
    // For OpenAI, the file is immediately ready after upload
    return this.uploadVideo(filePath, mimeType, displayName, options);
  }

  /**
   * Upload with advanced extraction settings
   * Uses more frames, denser coverage, and higher resolution for comprehensive analysis
   */
  async uploadForAdvancedAnalysis(
    filePath: string,
    mimeType: string,
    displayName?: string,
  ): Promise<UploadedFileMetadata> {
    return this.uploadVideo(filePath, mimeType, displayName, { advanced: true });
  }

  /**
   * Get the status of a stored file
   */
  async getFileStatus(fileNameOrUri: string): Promise<UploadedFileMetadata> {
    const fileId = this.extractFileId(fileNameOrUri);
    const storedFile = this.storedFiles.get(fileId);

    if (!storedFile) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `File not found: ${fileNameOrUri}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      name: storedFile.id,
      displayName: storedFile.displayName,
      mimeType: storedFile.mimeType,
      sizeBytes: String(storedFile.sizeBytes),
      uri: `openai://files/${storedFile.id}`,
      state: 'ACTIVE' as FileState,
    };
  }

  /**
   * Delete a stored file and clean up extracted frames
   */
  async deleteFile(fileNameOrUri: string): Promise<void> {
    const fileId = this.extractFileId(fileNameOrUri);
    const storedFile = this.storedFiles.get(fileId);

    if (storedFile) {
      // Clean up extracted frames if this was a video
      if (storedFile.frames && storedFile.frames.length > 0) {
        await this.frameExtractor.cleanupFrames(storedFile.frames);
      }

      this.storedFiles.delete(fileId);
      this.logger.log(`File deleted: ${fileId}`);
    }
  }

  /**
   * OpenAI does not support direct YouTube URL processing
   */
  supportsYouTubeUrls(): boolean {
    return false;
  }

  /**
   * Extract file ID from either a raw ID or a full URI
   */
  private extractFileId(fileNameOrUri: string): string {
    // Handle full URI format: openai://files/openai-file-xxx
    if (fileNameOrUri.startsWith('openai://files/')) {
      return fileNameOrUri.replace('openai://files/', '');
    }
    return fileNameOrUri;
  }

  /**
   * Check if the stored file is a video (has extracted frames)
   */
  isVideo(fileNameOrUri: string): boolean {
    const fileId = this.extractFileId(fileNameOrUri);
    const storedFile = this.storedFiles.get(fileId);
    return storedFile?.isVideo || false;
  }

  /**
   * Get the base64 data for an image file (not for videos)
   */
  getBase64Data(fileNameOrUri: string): string | undefined {
    const fileId = this.extractFileId(fileNameOrUri);
    const storedFile = this.storedFiles.get(fileId);
    if (storedFile?.isVideo) return undefined;
    return storedFile?.base64Data;
  }

  /**
   * Get the MIME type for a file
   */
  getMimeType(fileNameOrUri: string): string | undefined {
    const fileId = this.extractFileId(fileNameOrUri);
    const storedFile = this.storedFiles.get(fileId);
    return storedFile?.mimeType;
  }

  /**
   * Get a data URL for an image file (for OpenAI Vision API)
   * For videos, use getVideoFrames() instead
   */
  getDataUrl(fileNameOrUri: string): string | undefined {
    const fileId = this.extractFileId(fileNameOrUri);
    const storedFile = this.storedFiles.get(fileId);
    if (!storedFile || storedFile.isVideo) return undefined;
    if (!storedFile.base64Data) return undefined;
    return `data:${storedFile.mimeType};base64,${storedFile.base64Data}`;
  }

  /**
   * Get video frames as data URLs (for OpenAI Vision API)
   * Returns an array of frame data with timestamps
   */
  getVideoFrames(fileNameOrUri: string): FrameData[] | undefined {
    const fileId = this.extractFileId(fileNameOrUri);
    const storedFile = this.storedFiles.get(fileId);

    if (!storedFile?.isVideo || !storedFile.frames) {
      return undefined;
    }

    return storedFile.frames.map((frame) => ({
      timestamp: frame.timestamp,
      timestampSeconds: frame.timestampSeconds,
      dataUrl: `data:${frame.mimeType};base64,${frame.base64Data}`,
    }));
  }

  /**
   * Get the number of frames for a video file
   */
  getFrameCount(fileNameOrUri: string): number {
    const fileId = this.extractFileId(fileNameOrUri);
    const storedFile = this.storedFiles.get(fileId);
    return storedFile?.frames?.length || 0;
  }

  /**
   * Clean up old files (older than specified hours)
   */
  async cleanupOldFiles(maxAgeHours: number = 1): Promise<void> {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    for (const [id, file] of this.storedFiles.entries()) {
      if (file.createdAt < cutoff) {
        // Clean up frames if this was a video
        if (file.frames && file.frames.length > 0) {
          await this.frameExtractor.cleanupFrames(file.frames);
        }
        this.storedFiles.delete(id);
        this.logger.log(`Cleaned up old file: ${id}`);
      }
    }

    // Also clean up any orphaned frame extraction directories
    this.frameExtractor.cleanupOldExtractions(maxAgeHours);
  }
}
