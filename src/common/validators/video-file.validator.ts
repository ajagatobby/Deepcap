import { FileValidator } from '@nestjs/common';

export interface VideoFileValidatorOptions {
  maxSize?: number;
}

/**
 * Custom video file validator that checks both MIME type and file extension
 * More permissive than NestJS's built-in FileTypeValidator which uses magic bytes
 */
export class VideoFileValidator extends FileValidator<VideoFileValidatorOptions> {
  private readonly allowedMimeTypes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-flv',
    'video/webm',
    'video/x-ms-wmv',
    'video/3gpp',
    'video/mov',
    'video/avi',
    'application/mp4',
    'application/x-mpegURL',
    'video/MP2T',
  ];

  private readonly allowedExtensions = [
    '.mp4',
    '.mpeg',
    '.mpg',
    '.mov',
    '.avi',
    '.flv',
    '.webm',
    '.wmv',
    '.3gp',
    '.3gpp',
    '.m4v',
    '.mkv',
  ];

  isValid(file?: Express.Multer.File): boolean {
    if (!file) {
      return false;
    }

    // Check MIME type (case-insensitive, allows parameters like charset)
    const mimeType = file.mimetype?.toLowerCase().split(';')[0].trim();
    const isMimeTypeValid = this.allowedMimeTypes.some(
      (allowed) => mimeType === allowed.toLowerCase(),
    );

    // Check file extension as fallback
    const ext = this.getFileExtension(file.originalname);
    const isExtensionValid = this.allowedExtensions.includes(ext.toLowerCase());

    return isMimeTypeValid || isExtensionValid;
  }

  buildErrorMessage(): string {
    return `Validation failed: File must be a video (allowed types: ${this.allowedExtensions.join(', ')})`;
  }

  private getFileExtension(filename: string): string {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return '';
    }
    return filename.substring(lastDotIndex).toLowerCase();
  }
}
