import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from './gemini.service';
import { FileMetadata, FileState } from './interfaces';
import {
  IFileHandler,
  UploadedFileMetadata,
  FileState as ProviderFileState,
  FileUploadOptions,
} from '../providers/interfaces';

/**
 * Custom error for file processing failures
 */
export class FileProcessingError extends HttpException {
  constructor(
    message: string,
    public readonly fileMetadata?: Partial<FileMetadata>,
  ) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message,
        fileMetadata,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * Custom error for file upload timeout
 */
export class FileProcessingTimeoutError extends HttpException {
  constructor(fileName: string, attempts: number) {
    super(
      {
        statusCode: HttpStatus.REQUEST_TIMEOUT,
        message: `File processing timed out after ${attempts} attempts`,
        fileName,
      },
      HttpStatus.REQUEST_TIMEOUT,
    );
  }
}

/**
 * Service for managing video file uploads using the Google AI Files API
 * Implements IFileHandler interface for provider abstraction
 */
@Injectable()
export class FileManagerService implements IFileHandler {
  private readonly logger = new Logger(FileManagerService.name);
  private readonly maxPollAttempts: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly geminiService: GeminiService,
    private readonly configService: ConfigService,
  ) {
    this.maxPollAttempts = this.configService.get<number>('MAX_POLL_ATTEMPTS', 30);
    this.pollIntervalMs = this.configService.get<number>('POLL_INTERVAL_MS', 2000);
  }

  /**
   * Get the provider name
   */
  getProviderName(): string {
    return 'gemini';
  }

  /**
   * Check if this handler supports direct YouTube URL processing
   * Gemini supports this natively
   */
  supportsYouTubeUrls(): boolean {
    return true;
  }

  /**
   * Get the status of an uploaded file (IFileHandler interface)
   */
  async getFileStatus(fileName: string): Promise<UploadedFileMetadata> {
    const metadata = await this.getFileInfo(fileName);
    return this.toUploadedFileMetadata(metadata);
  }

  /**
   * Convert internal FileMetadata to UploadedFileMetadata interface
   */
  private toUploadedFileMetadata(metadata: FileMetadata): UploadedFileMetadata {
    return {
      name: metadata.name,
      displayName: metadata.displayName,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      uri: metadata.uri,
      state: metadata.state as ProviderFileState,
      error: metadata.error,
    };
  }

  /**
   * Upload a video file to Google's temporary storage
   * @param filePath Path to the video file
   * @param mimeType MIME type of the video (e.g., 'video/mp4')
   * @param displayName Optional display name for the file
   * @param _options Upload options (ignored for Gemini as it processes full video natively)
   */
  async uploadVideo(
    filePath: string,
    mimeType: string,
    displayName?: string,
    _options?: FileUploadOptions,
  ): Promise<FileMetadata> {
    this.logger.log(`Uploading video: ${filePath} (${mimeType})`);

    const filesApi = this.geminiService.getFilesApi();

    try {
      const uploadResult = await filesApi.upload({
        file: filePath,
        config: {
          mimeType,
          displayName: displayName || `video_${Date.now()}`,
        },
      });

      this.logger.log(`File uploaded: ${uploadResult.name}, state: ${uploadResult.state}`);

      // Convert to our FileMetadata interface
      const fileMetadata: FileMetadata = {
        name: uploadResult.name,
        displayName: uploadResult.displayName,
        mimeType: uploadResult.mimeType,
        sizeBytes: uploadResult.sizeBytes,
        createTime: uploadResult.createTime,
        updateTime: uploadResult.updateTime,
        expirationTime: uploadResult.expirationTime,
        sha256Hash: uploadResult.sha256Hash,
        uri: uploadResult.uri,
        state: this.mapFileState(uploadResult.state),
      };

      return fileMetadata;
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error.message}`, error.stack);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: `Failed to upload file: ${error.message}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Wait for a file to reach ACTIVE state
   * Implements polling with configurable attempts and interval
   * @param fileName The file name returned from upload
   */
  async waitForActive(fileName: string): Promise<FileMetadata> {
    this.logger.log(`Waiting for file to become active: ${fileName}`);

    const filesApi = this.geminiService.getFilesApi();
    let attempts = 0;

    while (attempts < this.maxPollAttempts) {
      attempts++;

      try {
        const file = await filesApi.get({ name: fileName });
        const state = this.mapFileState(file.state);

        this.logger.debug(
          `Poll attempt ${attempts}/${this.maxPollAttempts}: ${fileName} - state: ${state}`,
        );

        if (state === 'ACTIVE') {
          this.logger.log(`File is now active: ${fileName}`);
          return {
            name: file.name,
            displayName: file.displayName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            createTime: file.createTime,
            updateTime: file.updateTime,
            expirationTime: file.expirationTime,
            sha256Hash: file.sha256Hash,
            uri: file.uri,
            state: 'ACTIVE',
          };
        }

        if (state === 'FAILED') {
          this.logger.error(`File processing failed: ${fileName}`);
          throw new FileProcessingError(
            `File processing failed: ${file.error?.message || 'Unknown error'}`,
            {
              name: file.name,
              state: 'FAILED',
              error: file.error,
            },
          );
        }

        // Still processing, wait before next poll
        await this.sleep(this.pollIntervalMs);
      } catch (error) {
        if (error instanceof FileProcessingError) {
          throw error;
        }
        this.logger.error(`Error polling file status: ${error.message}`);
        // Continue polling on transient errors
        await this.sleep(this.pollIntervalMs);
      }
    }

    // Max attempts reached
    throw new FileProcessingTimeoutError(fileName, this.maxPollAttempts);
  }

  /**
   * Upload a video and wait for it to be ready
   * Combines upload and polling in one operation
   * @param filePath Path to the video file
   * @param mimeType MIME type of the video
   * @param displayName Optional display name for the file
   * @param options Upload options (ignored for Gemini as it processes full video natively)
   */
  async uploadAndWaitForActive(
    filePath: string,
    mimeType: string,
    displayName?: string,
    options?: FileUploadOptions,
  ): Promise<FileMetadata> {
    const uploaded = await this.uploadVideo(filePath, mimeType, displayName, options);
    
    // If already active, return immediately
    if (uploaded.state === 'ACTIVE') {
      return uploaded;
    }

    // Wait for processing to complete
    return this.waitForActive(uploaded.name);
  }

  /**
   * Delete a file from Google's storage
   * @param fileName The file name to delete
   */
  async deleteFile(fileName: string): Promise<void> {
    this.logger.log(`Deleting file: ${fileName}`);

    const filesApi = this.geminiService.getFilesApi();

    try {
      await filesApi.delete({ name: fileName });
      this.logger.log(`File deleted: ${fileName}`);
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error.message}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Failed to delete file: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get metadata for a file
   * @param fileName The file name to get info for
   */
  async getFileInfo(fileName: string): Promise<FileMetadata> {
    const filesApi = this.geminiService.getFilesApi();

    try {
      const file = await filesApi.get({ name: fileName });
      return {
        name: file.name,
        displayName: file.displayName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        createTime: file.createTime,
        updateTime: file.updateTime,
        expirationTime: file.expirationTime,
        sha256Hash: file.sha256Hash,
        uri: file.uri,
        state: this.mapFileState(file.state),
        error: file.error,
      };
    } catch (error) {
      this.logger.error(`Failed to get file info: ${error.message}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `File not found: ${fileName}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * List all uploaded files
   */
  async listFiles(): Promise<FileMetadata[]> {
    const filesApi = this.geminiService.getFilesApi();
    const files: FileMetadata[] = [];

    try {
      const listResponse = await filesApi.list({ config: { pageSize: 100 } });
      
      for await (const file of listResponse) {
        files.push({
          name: file.name,
          displayName: file.displayName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          createTime: file.createTime,
          updateTime: file.updateTime,
          expirationTime: file.expirationTime,
          sha256Hash: file.sha256Hash,
          uri: file.uri,
          state: this.mapFileState(file.state),
        });
      }

      return files;
    } catch (error) {
      this.logger.error(`Failed to list files: ${error.message}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Failed to list files: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Map SDK file state to our FileState type
   */
  private mapFileState(state: string): FileState {
    switch (state?.toUpperCase()) {
      case 'ACTIVE':
        return 'ACTIVE';
      case 'PROCESSING':
        return 'PROCESSING';
      case 'FAILED':
        return 'FAILED';
      default:
        return 'STATE_UNSPECIFIED';
    }
  }

  /**
   * Sleep utility for polling
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
