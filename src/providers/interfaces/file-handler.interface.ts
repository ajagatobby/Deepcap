/**
 * File metadata returned from upload operations
 */
export interface UploadedFileMetadata {
  /** Unique file identifier */
  name: string;
  /** Display name of the file */
  displayName?: string;
  /** MIME type of the file */
  mimeType: string;
  /** File size in bytes */
  sizeBytes?: string;
  /** URI to access the file */
  uri: string;
  /** Current state of the file */
  state: FileState;
  /** Error information if processing failed */
  error?: FileError;
}

/**
 * Options for file upload operations
 * Provider-specific options can be passed through this interface
 */
export interface FileUploadOptions {
  /** Use advanced processing (more frames, higher resolution for video) */
  advanced?: boolean;
}

/**
 * Possible states for an uploaded file
 */
export type FileState =
  | 'PROCESSING'
  | 'ACTIVE'
  | 'FAILED'
  | 'STATE_UNSPECIFIED';

/**
 * Error information for failed file processing
 */
export interface FileError {
  code?: number;
  message?: string;
}

/**
 * Interface for file handling operations
 * Implemented by both Gemini and OpenAI providers
 */
export interface IFileHandler {
  /**
   * Get the provider name
   */
  getProviderName(): string;

  /**
   * Upload a video file
   * @param filePath Path to the video file
   * @param mimeType MIME type of the video
   * @param displayName Optional display name
   * @param options Optional upload options
   */
  uploadVideo(
    filePath: string,
    mimeType: string,
    displayName?: string,
    options?: FileUploadOptions,
  ): Promise<UploadedFileMetadata>;

  /**
   * Upload a video file and wait for it to be ready for processing
   * @param filePath Path to the video file
   * @param mimeType MIME type of the video
   * @param displayName Optional display name
   * @param options Optional upload options
   */
  uploadAndWaitForActive(
    filePath: string,
    mimeType: string,
    displayName?: string,
    options?: FileUploadOptions,
  ): Promise<UploadedFileMetadata>;

  /**
   * Get the status of an uploaded file
   * @param fileName The file name/identifier
   */
  getFileStatus(fileName: string): Promise<UploadedFileMetadata>;

  /**
   * Delete an uploaded file
   * @param fileName The file name/identifier
   */
  deleteFile(fileName: string): Promise<void>;

  /**
   * Check if the file handler supports direct YouTube URL processing
   * (Gemini supports this, OpenAI does not)
   */
  supportsYouTubeUrls(): boolean;
}

/**
 * File handler injection token
 */
export const FILE_HANDLER_TOKEN = 'FILE_HANDLER';
