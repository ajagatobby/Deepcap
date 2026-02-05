import { FileValidator } from '@nestjs/common';

/**
 * Supported video MIME types
 */
const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/mpeg',
  'video/mov',
  'video/quicktime', // .mov files often report as quicktime
  'video/avi',
  'video/x-msvideo', // .avi files
  'video/x-flv',
  'video/mpg',
  'video/webm',
  'video/wmv',
  'video/x-ms-wmv', // .wmv files
  'video/3gpp',
];

/**
 * Custom validator for video file uploads
 * More reliable than the built-in FileTypeValidator for video files
 */
export class VideoFileValidator extends FileValidator<{
  maxSize?: number;
}> {
  constructor(
    protected readonly validationOptions: { maxSize?: number } = {},
  ) {
    super(validationOptions);
  }

  isValid(file?: Express.Multer.File): boolean {
    if (!file) {
      return false;
    }

    // Check file size if maxSize is specified
    if (this.validationOptions.maxSize && file.size > this.validationOptions.maxSize) {
      return false;
    }

    // Check MIME type - be lenient and check if it starts with 'video/'
    // or matches one of our supported types
    const mimeType = file.mimetype?.toLowerCase();
    if (!mimeType) {
      return false;
    }

    // Accept any video/* type or specifically supported types
    if (mimeType.startsWith('video/')) {
      return true;
    }

    // Also accept application/octet-stream for some video files
    // that browsers don't recognize properly
    if (mimeType === 'application/octet-stream') {
      // Check extension as fallback
      const ext = file.originalname?.toLowerCase().split('.').pop();
      const videoExtensions = ['mp4', 'mpeg', 'mpg', 'mov', 'avi', 'flv', 'webm', 'wmv', '3gp', '3gpp'];
      return videoExtensions.includes(ext || '');
    }

    return SUPPORTED_VIDEO_TYPES.includes(mimeType);
  }

  buildErrorMessage(file: Express.Multer.File): string {
    if (!file) {
      return 'No file provided';
    }

    if (this.validationOptions.maxSize && file.size > this.validationOptions.maxSize) {
      const maxSizeMB = Math.round(this.validationOptions.maxSize / (1024 * 1024));
      const fileSizeMB = Math.round(file.size / (1024 * 1024));
      return `File size (${fileSizeMB}MB) exceeds maximum allowed size (${maxSizeMB}MB)`;
    }

    return `Unsupported video format: ${file.mimetype}. Supported formats: MP4, MPEG, MOV, AVI, FLV, WebM, WMV, 3GPP`;
  }
}
