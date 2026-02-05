import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

/**
 * Extracted frame data
 */
export interface ExtractedFrame {
  /** Frame number (0-indexed) */
  index: number;
  /** Timestamp in seconds */
  timestampSeconds: number;
  /** Formatted timestamp (MM:SS) */
  timestamp: string;
  /** Path to the extracted frame image */
  filePath: string;
  /** Base64-encoded image data */
  base64Data?: string;
  /** MIME type of the image */
  mimeType: string;
}

/**
 * Frame extraction options
 */
export interface FrameExtractionOptions {
  /** Interval between frames in seconds (default: 2) */
  intervalSeconds?: number;
  /** Maximum number of frames to extract (default: 20) */
  maxFrames?: number;
  /** Output image format (default: 'jpg') */
  format?: 'jpg' | 'png';
  /** Image quality for jpg (1-100, default: 85) */
  quality?: number;
  /** Scale the output images (e.g., '640:-1' for 640px width, auto height) */
  scale?: string;
}

/**
 * Video metadata
 */
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
}

/**
 * Service for extracting frames from video files using ffmpeg
 */
@Injectable()
export class FrameExtractorService {
  private readonly logger = new Logger(FrameExtractorService.name);
  private readonly tempDir: string;

  constructor() {
    // Create a temp directory for frame extraction
    this.tempDir = path.join(os.tmpdir(), 'deepcap-frames');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Check if ffmpeg is available
   */
  async isFFmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn('ffmpeg', ['-version']);
      process.on('error', () => resolve(false));
      process.on('close', (code) => resolve(code === 0));
    });
  }

  /**
   * Get video metadata using ffprobe
   */
  async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        videoPath,
      ];

      const process = spawn('ffprobe', args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe failed: ${stderr}`));
          return;
        }

        try {
          const data = JSON.parse(stdout);
          const videoStream = data.streams?.find(
            (s: any) => s.codec_type === 'video',
          );

          if (!videoStream) {
            reject(new Error('No video stream found'));
            return;
          }

          // Parse frame rate (can be in format "30/1" or "29.97")
          let fps = 30;
          if (videoStream.r_frame_rate) {
            const parts = videoStream.r_frame_rate.split('/');
            fps = parts.length === 2
              ? parseInt(parts[0]) / parseInt(parts[1])
              : parseFloat(videoStream.r_frame_rate);
          }

          resolve({
            duration: parseFloat(data.format?.duration || videoStream.duration || '0'),
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            fps: fps || 30,
          });
        } catch (error) {
          reject(new Error(`Failed to parse ffprobe output: ${error.message}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`ffprobe not found. Please install ffmpeg: ${error.message}`));
      });
    });
  }

  /**
   * Extract frames from a video file
   */
  async extractFrames(
    videoPath: string,
    options: FrameExtractionOptions = {},
  ): Promise<ExtractedFrame[]> {
    const {
      intervalSeconds = 2,
      maxFrames = 20,
      format = 'jpg',
      quality = 85,
      scale = '640:-1', // 640px width, maintain aspect ratio
    } = options;

    // Verify video file exists
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    // Check ffmpeg availability
    const ffmpegAvailable = await this.isFFmpegAvailable();
    if (!ffmpegAvailable) {
      throw new Error(
        'ffmpeg is not installed. Please install ffmpeg to enable video frame extraction for OpenAI.',
      );
    }

    // Get video metadata
    const metadata = await this.getVideoMetadata(videoPath);
    this.logger.log(
      `Video metadata: duration=${metadata.duration}s, ${metadata.width}x${metadata.height}, ${metadata.fps}fps`,
    );

    // Calculate frame extraction timestamps
    const timestamps = this.calculateTimestamps(
      metadata.duration,
      intervalSeconds,
      maxFrames,
    );

    this.logger.log(
      `Extracting ${timestamps.length} frames at intervals of ~${intervalSeconds}s`,
    );

    // Create a unique directory for this extraction
    const extractionId = uuidv4();
    const outputDir = path.join(this.tempDir, extractionId);
    fs.mkdirSync(outputDir, { recursive: true });

    // Extract frames
    const frames: ExtractedFrame[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const outputPath = path.join(outputDir, `frame_${i.toString().padStart(4, '0')}.${format}`);

      try {
        await this.extractSingleFrame(videoPath, timestamp, outputPath, {
          format,
          quality,
          scale,
        });

        // Read and convert to base64
        const imageBuffer = fs.readFileSync(outputPath);
        const base64Data = imageBuffer.toString('base64');

        frames.push({
          index: i,
          timestampSeconds: timestamp,
          timestamp: this.formatTimestamp(timestamp),
          filePath: outputPath,
          base64Data,
          mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png',
        });
      } catch (error) {
        this.logger.warn(
          `Failed to extract frame at ${timestamp}s: ${error.message}`,
        );
      }
    }

    this.logger.log(`Successfully extracted ${frames.length} frames`);

    return frames;
  }

  /**
   * Extract a single frame at a specific timestamp
   */
  private async extractSingleFrame(
    videoPath: string,
    timestampSeconds: number,
    outputPath: string,
    options: { format: string; quality: number; scale: string },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-ss', timestampSeconds.toString(),
        '-i', videoPath,
        '-vframes', '1',
        '-vf', `scale=${options.scale}`,
      ];

      // Add quality settings for jpg
      if (options.format === 'jpg') {
        args.push('-q:v', Math.round((100 - options.quality) / 3.33).toString());
      }

      args.push('-y', outputPath);

      const process = spawn('ffmpeg', args);
      let stderr = '';

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Frame extraction failed: ${stderr}`));
          return;
        }

        if (!fs.existsSync(outputPath)) {
          reject(new Error('Frame file was not created'));
          return;
        }

        resolve();
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Calculate timestamps for frame extraction
   */
  private calculateTimestamps(
    duration: number,
    intervalSeconds: number,
    maxFrames: number,
  ): number[] {
    const timestamps: number[] = [];

    // If video is very short, extract fewer frames
    if (duration <= 5) {
      // For videos <= 5s, extract at 0s, middle, and end
      timestamps.push(0);
      if (duration > 2) timestamps.push(duration / 2);
      if (duration > 1) timestamps.push(Math.max(0, duration - 0.5));
      return timestamps.slice(0, maxFrames);
    }

    // Calculate actual interval to not exceed maxFrames
    const estimatedFrames = Math.ceil(duration / intervalSeconds);
    const actualInterval =
      estimatedFrames > maxFrames
        ? duration / maxFrames
        : intervalSeconds;

    // Generate timestamps
    for (let t = 0; t < duration; t += actualInterval) {
      timestamps.push(t);
      if (timestamps.length >= maxFrames) break;
    }

    // Always include a frame near the end if not already included
    const lastTimestamp = timestamps[timestamps.length - 1];
    if (duration - lastTimestamp > actualInterval / 2 && timestamps.length < maxFrames) {
      timestamps.push(Math.max(0, duration - 0.5));
    }

    return timestamps;
  }

  /**
   * Format seconds to MM:SS timestamp
   */
  private formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Clean up extracted frames
   */
  async cleanupFrames(frames: ExtractedFrame[]): Promise<void> {
    if (frames.length === 0) return;

    // Get the directory from the first frame
    const frameDir = path.dirname(frames[0].filePath);

    try {
      // Delete all frame files
      for (const frame of frames) {
        if (fs.existsSync(frame.filePath)) {
          fs.unlinkSync(frame.filePath);
        }
      }

      // Remove the directory
      if (fs.existsSync(frameDir)) {
        fs.rmdirSync(frameDir);
      }

      this.logger.debug(`Cleaned up ${frames.length} frames from ${frameDir}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup frames: ${error.message}`);
    }
  }

  /**
   * Clean up old extraction directories (older than specified hours)
   */
  cleanupOldExtractions(maxAgeHours: number = 1): void {
    try {
      const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;

      if (!fs.existsSync(this.tempDir)) return;

      const dirs = fs.readdirSync(this.tempDir);
      for (const dir of dirs) {
        const dirPath = path.join(this.tempDir, dir);
        const stats = fs.statSync(dirPath);

        if (stats.isDirectory() && stats.mtimeMs < cutoffTime) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          this.logger.debug(`Cleaned up old extraction directory: ${dir}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to cleanup old extractions: ${error.message}`);
    }
  }
}
