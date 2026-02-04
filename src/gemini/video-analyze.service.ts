import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ThinkingLevel, MediaResolution } from '@google/genai';
import { GeminiService } from './gemini.service';
import { FileManagerService } from './file-manager.service';
import {
  VideoAnalysisResult,
  TimestampRange,
  ConfidenceLevel,
  FrameDescription,
} from './interfaces';
import { ThinkingLevelInput, MediaResolutionInput } from './dto';
import {
  AdvancedVideoAnalysisResult,
  AdvancedFrameData,
} from '../lancedb/interfaces';

/**
 * JSON schema for structured video analysis output
 */
const ANALYSIS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    analysis: {
      type: 'string',
      description: 'The main analysis text describing findings from the video',
    },
    timestamps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: {
            type: 'string',
            description: 'Start time in MM:SS format',
          },
          end: {
            type: 'string',
            description: 'End time in MM:SS format',
          },
          description: {
            type: 'string',
            description: 'Description of what happens during this timestamp',
          },
        },
        required: ['start', 'end', 'description'],
      },
      description: 'Array of relevant timestamps with descriptions',
    },
    confidence: {
      type: 'string',
      enum: ['Low', 'Medium', 'High'],
      description: 'Self-assessed confidence score for the analysis',
    },
  },
  required: ['analysis', 'timestamps', 'confidence'],
};

/**
 * JSON schema for frame-level extraction (for indexing)
 */
const FRAME_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    analysis: {
      type: 'string',
      description: 'Overall summary of the video content',
    },
    frames: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: {
            type: 'string',
            description: 'Timestamp in MM:SS format',
          },
          description: {
            type: 'string',
            description:
              'Detailed description of what is visible at this timestamp',
          },
        },
        required: ['timestamp', 'description'],
      },
      description: 'Array of frame-level descriptions throughout the video',
    },
    confidence: {
      type: 'string',
      enum: ['Low', 'Medium', 'High'],
      description: 'Self-assessed confidence score',
    },
  },
  required: ['analysis', 'frames', 'confidence'],
};

/**
 * System instruction for frame-level extraction
 */
const FRAME_EXTRACTION_INSTRUCTION = `You are a video content extractor. Your job is to extract detailed frame-by-frame descriptions for semantic indexing.

Rules:
1. Extract descriptions at regular intervals (approximately every 2-5 seconds for short videos, 10-15 seconds for longer videos)
2. Each frame description should be self-contained and searchable
3. Include: visual elements, actions, text on screen, people, objects, colors, emotions, and scene composition
4. Use precise timestamps in MM:SS format
5. Be descriptive but concise - each description should be 1-3 sentences
6. Cover the entire video duration, not just highlights
7. Do not infer or hallucinate - only describe what is visually present

Focus on creating descriptions that would match natural language search queries about the video content.`;

/**
 * Advanced multi-modal extraction instruction for comprehensive video indexing
 */
const ADVANCED_EXTRACTION_INSTRUCTION = `You are an expert video analyst performing comprehensive multi-modal extraction for semantic indexing. Your goal is to extract EVERY detail that could be useful for answering questions about this video.

For EACH significant moment (every 2-3 seconds), extract ALL of the following:

## PEOPLE ANALYSIS (for each person visible)
- **Gender**: male/female/unknown
- **Apparent age**: infant/child/teenager/young-adult/middle-aged/elderly
- **Apparent ethnicity/race**: Be specific and respectful (e.g., "appears East Asian", "appears Black/African descent", "appears Caucasian/White", "appears South Asian", "appears Hispanic/Latino", "appears Middle Eastern", "mixed/ambiguous")
- **Clothing**: List ALL visible clothing items with colors (e.g., "blue denim jeans, white cotton t-shirt, black Nike sneakers")
- **Emotion/Expression**: happy/sad/angry/surprised/neutral/fearful/disgusted/contemptuous/confused/bored
- **Current action**: What exactly are they doing?
- **Position in frame**: left/center/right AND foreground/midground/background
- **Distinguishing features**: glasses, sunglasses, beard, mustache, tattoos visible, piercings, jewelry, hair style (short/long/bald/curly/straight), hair color, body type, height relative to others

## OBJECTS ANALYSIS
- List ALL significant objects visible
- Include: name, color, brand (if visible), size, state (open/closed/on/off/broken), position
- Note any text/labels on objects (read them exactly)
- Include vehicles, furniture, electronics, food, drinks, tools, etc.

## SCENE ANALYSIS
- **Location type**: indoor/outdoor/vehicle/mixed
- **Specific location**: Be precise (modern office with glass walls, suburban kitchen, city street at night, beach, etc.)
- **Lighting**: bright/dim/natural/artificial/mixed, direction of light, any shadows
- **Weather** (if outdoor): sunny/cloudy/overcast/rainy/snowy/foggy
- **Time of day**: morning/midday/afternoon/evening/night/dawn/dusk
- **Camera angle**: extreme close-up/close-up/medium shot/wide shot/aerial/POV/over-the-shoulder
- **Camera movement**: static/pan/tilt/zoom/tracking/handheld
- **Overall mood**: tense/calm/chaotic/romantic/mysterious/joyful/sad/energetic

## AUDIO ANALYSIS (CRITICAL - transcribe EVERYTHING)
- **Transcribe ALL spoken words VERBATIM** - every single word said
- **Speaker identification**: Person 1, Person 2, Narrator, Off-screen voice, etc.
- **Tone of voice**: calm/excited/angry/sad/scared/whispered/shouted/sarcastic/monotone
- **Language**: English, Spanish, etc.
- **Music**: Describe genre, mood, tempo, instruments heard (upbeat pop, melancholic piano, dramatic orchestral)
- **Sound effects**: footsteps, door closing, phone ringing, car engine, etc.
- **Ambient sounds**: traffic, birds, crowd noise, silence, etc.

## TEXT ON SCREEN
- Transcribe ALL visible text exactly as written
- **Signs**: street signs, store names, billboards
- **Titles/Captions**: movie titles, subtitles, lower thirds
- **UI Elements**: app interfaces, websites, phone screens
- **Labels**: product labels, name tags, etc.
- Note position: top/bottom/left/right/center

## ACTIONS/EVENTS
- Describe the action in detail
- Note cause and effect relationships
- Identify any significant transitions or changes

CRITICAL RULES:
1. Be EXTREMELY detailed - capture everything that could answer any question
2. For EVERY person, ALWAYS include gender, approximate age, and apparent ethnicity
3. Transcribe ALL speech word-for-word - this is essential
4. If something is unclear, say "unclear" rather than guessing
5. Use consistent terminology throughout for better search matching
6. Cover the ENTIRE video duration with dense extraction (every 2-3 seconds)
7. Each timestamp entry should be comprehensive - include all aspects present at that moment`;

/**
 * Advanced extraction response schema for comprehensive multi-modal data
 */
const ADVANCED_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Comprehensive summary of the entire video content',
    },
    frames: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: {
            type: 'string',
            description: 'Timestamp in MM:SS format',
          },
          people: {
            type: 'array',
            description: 'All people visible at this timestamp',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Person identifier (Person 1, Person 2, etc.)',
                },
                gender: {
                  type: 'string',
                  description: 'male/female/unknown',
                },
                apparentAge: {
                  type: 'string',
                  description:
                    'infant/child/teenager/young-adult/middle-aged/elderly',
                },
                apparentEthnicity: {
                  type: 'string',
                  description: 'Apparent ethnicity/race description',
                },
                clothing: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of clothing items with colors',
                },
                emotion: {
                  type: 'string',
                  description: 'Facial expression/emotion',
                },
                action: {
                  type: 'string',
                  description: 'What the person is doing',
                },
                position: {
                  type: 'string',
                  description: 'Position in frame',
                },
                distinguishingFeatures: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Notable features like glasses, beard, tattoos, hair',
                },
              },
            },
          },
          objects: {
            type: 'array',
            description: 'All significant objects visible',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Object name',
                },
                color: {
                  type: 'string',
                  description: 'Object color',
                },
                brand: {
                  type: 'string',
                  description: 'Brand if visible',
                },
                state: {
                  type: 'string',
                  description: 'State of object (open/closed/on/off)',
                },
                description: {
                  type: 'string',
                  description: 'Additional details',
                },
              },
            },
          },
          scene: {
            type: 'object',
            description: 'Scene information',
            properties: {
              locationType: {
                type: 'string',
                description: 'indoor/outdoor/vehicle',
              },
              specificLocation: {
                type: 'string',
                description: 'Specific location description',
              },
              lighting: {
                type: 'string',
                description: 'Lighting conditions',
              },
              weather: {
                type: 'string',
                description: 'Weather if outdoor',
              },
              timeOfDay: {
                type: 'string',
                description: 'Time of day',
              },
              cameraAngle: {
                type: 'string',
                description: 'Camera angle/shot type',
              },
              mood: {
                type: 'string',
                description: 'Overall mood/atmosphere',
              },
            },
          },
          audio: {
            type: 'object',
            description: 'Audio at this timestamp',
            properties: {
              speech: {
                type: 'array',
                description: 'All speech at this timestamp',
                items: {
                  type: 'object',
                  properties: {
                    speaker: {
                      type: 'string',
                      description: 'Speaker identifier',
                    },
                    text: {
                      type: 'string',
                      description: 'Exact words spoken',
                    },
                    tone: {
                      type: 'string',
                      description: 'Tone of voice',
                    },
                    language: {
                      type: 'string',
                      description: 'Language spoken',
                    },
                  },
                },
              },
              music: {
                type: 'string',
                description: 'Music description if present',
              },
              sounds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Sound effects and ambient sounds',
              },
            },
          },
          textOnScreen: {
            type: 'array',
            description: 'All text visible on screen',
            items: {
              type: 'object',
              properties: {
                text: {
                  type: 'string',
                  description: 'The actual text content',
                },
                type: {
                  type: 'string',
                  description: 'Type: title/subtitle/sign/label/ui-element',
                },
                position: {
                  type: 'string',
                  description: 'Position on screen',
                },
              },
            },
          },
          actionDescription: {
            type: 'string',
            description:
              'Detailed description of actions/events at this timestamp',
          },
        },
        required: ['timestamp'],
      },
    },
    confidence: {
      type: 'string',
      enum: ['Low', 'Medium', 'High'],
      description: 'Overall confidence in the extraction',
    },
  },
  required: ['summary', 'frames', 'confidence'],
};

/**
 * Default system instruction for anti-hallucination strategy (SEASON prompt)
 */
const DEFAULT_SYSTEM_INSTRUCTION = `You are a video analyst. Follow these rules strictly:

1. ACCURACY: If an event is not visually present in the video, you must state "No visual evidence found". Do not guess or infer events that are not clearly visible.

2. TIMESTAMPS: For every event described, provide the exact timestamp range in MM:SS - MM:SS format. Be precise about when events occur.

3. UNCERTAINTY: When uncertain about what you observe, indicate your confidence level honestly. It's better to acknowledge uncertainty than to fabricate details.

4. CODE EXECUTION: When visual ambiguity exists, use code execution to:
   - Inspect specific pixels or regions of video frames
   - Crop and examine areas at higher resolution
   - Calculate temporal durations between events
   - Analyze patterns or count objects

5. STRUCTURED OUTPUT: Always provide your response in the specified JSON format with analysis, timestamps, and confidence fields.

6. DETAIL: Describe visual elements with specificity - colors, positions, movements, text visible on screen, facial expressions, and any other relevant details you can actually observe.`;

/**
 * Service for analyzing videos using Gemini 3 Flash
 */
@Injectable()
export class VideoAnalyzeService {
  private readonly logger = new Logger(VideoAnalyzeService.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly fileManagerService: FileManagerService,
  ) {}

  /**
   * Convert input thinking level to SDK type
   */
  private toSdkThinkingLevel(input?: ThinkingLevelInput): ThinkingLevel {
    switch (input) {
      case ThinkingLevelInput.MINIMAL:
        return ThinkingLevel.MINIMAL;
      case ThinkingLevelInput.LOW:
        return ThinkingLevel.LOW;
      case ThinkingLevelInput.MEDIUM:
        return ThinkingLevel.MEDIUM;
      case ThinkingLevelInput.HIGH:
      default:
        return ThinkingLevel.HIGH;
    }
  }

  /**
   * Convert input media resolution to SDK type
   */
  private toSdkMediaResolution(input?: MediaResolutionInput): MediaResolution {
    switch (input) {
      case MediaResolutionInput.LOW:
        return MediaResolution.MEDIA_RESOLUTION_LOW;
      case MediaResolutionInput.MEDIUM:
        return MediaResolution.MEDIA_RESOLUTION_MEDIUM;
      case MediaResolutionInput.HIGH:
      default:
        return MediaResolution.MEDIA_RESOLUTION_HIGH;
    }
  }

  /**
   * Analyze a video file with a specific query
   * @param filePath Path to the video file
   * @param mimeType MIME type of the video
   * @param query The analysis query/question
   * @param options Configuration options
   */
  async analyzeVideoFile(
    filePath: string,
    mimeType: string,
    query: string,
    options: {
      thinkingLevel?: ThinkingLevelInput;
      mediaResolution?: MediaResolutionInput;
      systemPrompt?: string;
    } = {},
  ): Promise<VideoAnalysisResult> {
    const startTime = Date.now();

    // Upload and wait for the file to be active
    this.logger.log(`Starting video analysis for: ${filePath}`);
    const fileMetadata = await this.fileManagerService.uploadAndWaitForActive(
      filePath,
      mimeType,
    );

    try {
      // Analyze using the file URI
      const result = await this.analyzeByFileUri(
        fileMetadata.uri,
        fileMetadata.mimeType,
        query,
        options,
      );

      const processingTime = Date.now() - startTime;
      this.logger.log(`Video analysis completed in ${processingTime}ms`);

      return result;
    } finally {
      // Clean up the uploaded file
      try {
        await this.fileManagerService.deleteFile(fileMetadata.name);
      } catch (error) {
        this.logger.warn(`Failed to cleanup file: ${error.message}`);
      }
    }
  }

  /**
   * Analyze a video by its file URI (already uploaded)
   */
  async analyzeByFileUri(
    fileUri: string,
    mimeType: string,
    query: string,
    options: {
      thinkingLevel?: ThinkingLevelInput;
      mediaResolution?: MediaResolutionInput;
      systemPrompt?: string;
    } = {},
  ): Promise<VideoAnalysisResult> {
    const {
      thinkingLevel = ThinkingLevelInput.HIGH,
      mediaResolution = MediaResolutionInput.HIGH,
      systemPrompt = DEFAULT_SYSTEM_INSTRUCTION,
    } = options;

    const sdkThinkingLevel = this.toSdkThinkingLevel(thinkingLevel);
    const sdkMediaResolution = this.toSdkMediaResolution(mediaResolution);

    const modelsApi = this.geminiService.getModelsApi();
    const modelName = this.geminiService.getModelName();

    this.logger.log(
      `Analyzing video with thinkingLevel=${thinkingLevel}, mediaResolution=${mediaResolution}`,
    );

    try {
      // Execute with retry for transient network failures
      const response = await this.executeWithRetry(
        () =>
          modelsApi.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    fileData: {
                      fileUri,
                      mimeType,
                    },
                  },
                  {
                    text: query,
                  },
                ],
              },
            ],
            config: {
              // System instruction for anti-hallucination
              systemInstruction: systemPrompt,

              // Thinking configuration for Gemini 3
              thinkingConfig: {
                thinkingLevel: sdkThinkingLevel,
                includeThoughts: true,
              },

              // Media resolution for video frames (280 tokens/frame at HIGH)
              mediaResolution: sdkMediaResolution,

              // Enable code execution for visual analysis (Agentic Vision)
              tools: [{ codeExecution: {} }],

              // Structured JSON output
              responseMimeType: 'application/json',
              responseSchema: ANALYSIS_RESPONSE_SCHEMA,
            },
          }),
        {
          maxRetries: 3,
          baseDelayMs: 2000,
          operationName: 'Video analysis',
        },
      );

      // Parse the response
      return this.parseAnalysisResponse(response);
    } catch (error) {
      this.logger.error(`Video analysis failed: ${error.message}`, error.stack);

      // Handle rate limiting (429)
      if (error.status === 429 || error.message?.includes('429')) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'API rate limit exceeded. Please try again later.',
            retryAfter: error.headers?.['retry-after'] || 60,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Provide more helpful error messages for common issues
      const errorMessage = error.message?.toLowerCase() || '';

      if (
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('network')
      ) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_GATEWAY,
            message:
              'Failed to connect to Gemini API. Please check your network connection and try again.',
            details: error.message,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Video analysis failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute with retry logic for transient network failures
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      baseDelayMs?: number;
      operationName?: string;
    } = {},
  ): Promise<T> {
    const {
      maxRetries = 3,
      baseDelayMs = 1000,
      operationName = 'operation',
    } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if this is a retryable error (network failures, timeouts, 5xx errors)
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff with jitter
        const delayMs =
          baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        this.logger.warn(
          `${operationName} failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${Math.round(delayMs)}ms...`,
        );

        await this.delay(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is retryable (transient network failures)
   */
  private isRetryableError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';

    // Network-level errors that are typically transient
    const retryablePatterns = [
      'fetch failed',
      'network error',
      'econnreset',
      'econnrefused',
      'etimedout',
      'socket hang up',
      'dns lookup failed',
      'getaddrinfo',
      'certificate',
      'ssl',
      'tls',
    ];

    if (retryablePatterns.some((pattern) => message.includes(pattern))) {
      return true;
    }

    // 5xx server errors are retryable
    if (error.status >= 500 && error.status < 600) {
      return true;
    }

    // 503 Service Unavailable
    if (error.status === 503) {
      return true;
    }

    return false;
  }

  /**
   * Analyze a YouTube video URL
   */
  async analyzeYouTubeUrl(
    youtubeUrl: string,
    query: string,
    options: {
      thinkingLevel?: ThinkingLevelInput;
      mediaResolution?: MediaResolutionInput;
      systemPrompt?: string;
      startOffset?: string;
      endOffset?: string;
    } = {},
  ): Promise<VideoAnalysisResult> {
    const {
      thinkingLevel = ThinkingLevelInput.HIGH,
      mediaResolution = MediaResolutionInput.HIGH,
      systemPrompt = DEFAULT_SYSTEM_INSTRUCTION,
      startOffset,
      endOffset,
    } = options;

    const sdkThinkingLevel = this.toSdkThinkingLevel(thinkingLevel);
    const sdkMediaResolution = this.toSdkMediaResolution(mediaResolution);

    const modelsApi = this.geminiService.getModelsApi();
    const modelName = this.geminiService.getModelName();

    this.logger.log(`Analyzing YouTube video: ${youtubeUrl}`);

    try {
      // Build the file data part with optional video metadata for clipping
      // Note: Don't specify mimeType for YouTube URLs - let the API infer it
      const fileDataPart: any = {
        fileData: {
          fileUri: youtubeUrl,
        },
      };

      // Add video metadata if clipping is specified
      if (startOffset || endOffset) {
        fileDataPart.videoMetadata = {};
        if (startOffset) {
          fileDataPart.videoMetadata.startOffset = startOffset;
        }
        if (endOffset) {
          fileDataPart.videoMetadata.endOffset = endOffset;
        }
      }

      // Execute with retry for transient network failures
      const response = await this.executeWithRetry(
        () =>
          modelsApi.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  fileDataPart,
                  {
                    text: query,
                  },
                ],
              },
            ],
            config: {
              systemInstruction: systemPrompt,
              thinkingConfig: {
                thinkingLevel: sdkThinkingLevel,
                includeThoughts: true,
              },
              mediaResolution: sdkMediaResolution,
              // Note: Code execution is not enabled for YouTube URLs as it's not supported
              responseMimeType: 'application/json',
              responseSchema: ANALYSIS_RESPONSE_SCHEMA,
            },
          }),
        {
          maxRetries: 3,
          baseDelayMs: 2000,
          operationName: 'YouTube video analysis',
        },
      );

      return this.parseAnalysisResponse(response);
    } catch (error) {
      this.logger.error(
        `YouTube analysis failed: ${error.message}`,
        error.stack,
      );

      if (error.status === 429 || error.message?.includes('429')) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'API rate limit exceeded. Please try again later.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Provide more helpful error messages for common issues
      const errorMessage = error.message?.toLowerCase() || '';

      if (
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('network')
      ) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_GATEWAY,
            message:
              'Failed to connect to Gemini API. Please check your network connection and try again.',
            details: error.message,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      if (
        errorMessage.includes('video') &&
        (errorMessage.includes('unavailable') ||
          errorMessage.includes('private') ||
          errorMessage.includes('restricted'))
      ) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message:
              'The YouTube video is unavailable, private, or restricted. Please ensure the video is publicly accessible.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `YouTube analysis failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Analyze and extract frame-level descriptions for indexing (uploaded file)
   * Returns both analysis and detailed frame descriptions
   */
  async analyzeForIndexing(
    fileUri: string,
    mimeType: string,
    options: {
      thinkingLevel?: ThinkingLevelInput;
      mediaResolution?: MediaResolutionInput;
    } = {},
  ): Promise<VideoAnalysisResult> {
    const {
      thinkingLevel = ThinkingLevelInput.HIGH,
      mediaResolution = MediaResolutionInput.HIGH,
    } = options;

    const sdkThinkingLevel = this.toSdkThinkingLevel(thinkingLevel);
    const sdkMediaResolution = this.toSdkMediaResolution(mediaResolution);

    const modelsApi = this.geminiService.getModelsApi();
    const modelName = this.geminiService.getModelName();

    this.logger.log(`Extracting frame descriptions for indexing: ${fileUri}`);

    try {
      const response = await this.executeWithRetry(
        () =>
          modelsApi.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    fileData: {
                      fileUri,
                      mimeType,
                    },
                  },
                  {
                    text: 'Extract detailed frame-by-frame descriptions from this video for semantic search indexing. Cover the entire video duration.',
                  },
                ],
              },
            ],
            config: {
              systemInstruction: FRAME_EXTRACTION_INSTRUCTION,
              thinkingConfig: {
                thinkingLevel: sdkThinkingLevel,
                includeThoughts: true,
              },
              mediaResolution: sdkMediaResolution,
              tools: [{ codeExecution: {} }],
              responseMimeType: 'application/json',
              responseSchema: FRAME_EXTRACTION_SCHEMA,
            },
          }),
        {
          maxRetries: 3,
          baseDelayMs: 2000,
        },
      );

      return this.parseFrameExtractionResponse(response);
    } catch (error) {
      this.logger.error(
        `Frame extraction failed: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Frame extraction failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Analyze and extract frame-level descriptions for indexing (YouTube URL)
   * Returns both analysis and detailed frame descriptions
   */
  async analyzeYouTubeForIndexing(
    youtubeUrl: string,
    options: {
      thinkingLevel?: ThinkingLevelInput;
      mediaResolution?: MediaResolutionInput;
      startOffset?: string;
      endOffset?: string;
    } = {},
  ): Promise<VideoAnalysisResult> {
    const {
      thinkingLevel = ThinkingLevelInput.HIGH,
      mediaResolution = MediaResolutionInput.HIGH,
      startOffset,
      endOffset,
    } = options;

    const sdkThinkingLevel = this.toSdkThinkingLevel(thinkingLevel);
    const sdkMediaResolution = this.toSdkMediaResolution(mediaResolution);

    const modelsApi = this.geminiService.getModelsApi();
    const modelName = this.geminiService.getModelName();

    this.logger.log(
      `Extracting frame descriptions from YouTube for indexing: ${youtubeUrl}`,
    );

    try {
      // Build the file data part
      const fileDataPart: any = {
        fileData: {
          fileUri: youtubeUrl,
        },
      };

      // Add video metadata if clipping is specified
      if (startOffset || endOffset) {
        fileDataPart.videoMetadata = {};
        if (startOffset) {
          fileDataPart.videoMetadata.startOffset = startOffset;
        }
        if (endOffset) {
          fileDataPart.videoMetadata.endOffset = endOffset;
        }
      }

      const response = await this.executeWithRetry(
        () =>
          modelsApi.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  fileDataPart,
                  {
                    text: 'Extract detailed frame-by-frame descriptions from this video for semantic search indexing. Cover the entire video duration.',
                  },
                ],
              },
            ],
            config: {
              systemInstruction: FRAME_EXTRACTION_INSTRUCTION,
              thinkingConfig: {
                thinkingLevel: sdkThinkingLevel,
                includeThoughts: true,
              },
              mediaResolution: sdkMediaResolution,
              // Note: Code execution is not enabled for YouTube URLs
              responseMimeType: 'application/json',
              responseSchema: FRAME_EXTRACTION_SCHEMA,
            },
          }),
        {
          maxRetries: 3,
          baseDelayMs: 2000,
        },
      );

      return this.parseFrameExtractionResponse(response);
    } catch (error) {
      this.logger.error(
        `YouTube frame extraction failed: ${error.message}`,
        error.stack,
      );

      const errorMessage = error.message?.toLowerCase() || '';

      if (
        errorMessage.includes('video') &&
        (errorMessage.includes('unavailable') ||
          errorMessage.includes('private'))
      ) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message:
              'The YouTube video is unavailable or private. Please ensure the video is publicly accessible.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `YouTube frame extraction failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Advanced multi-modal analysis for comprehensive video indexing (uploaded file)
   * Extracts detailed information about people, objects, scenes, audio, and actions
   */
  async analyzeForAdvancedIndexing(
    fileUri: string,
    mimeType: string,
    options: {
      thinkingLevel?: ThinkingLevelInput;
      mediaResolution?: MediaResolutionInput;
    } = {},
  ): Promise<AdvancedVideoAnalysisResult> {
    const {
      thinkingLevel = ThinkingLevelInput.HIGH,
      mediaResolution = MediaResolutionInput.HIGH,
    } = options;

    const sdkThinkingLevel = this.toSdkThinkingLevel(thinkingLevel);
    const sdkMediaResolution = this.toSdkMediaResolution(mediaResolution);

    const modelsApi = this.geminiService.getModelsApi();
    const modelName = this.geminiService.getModelName();

    this.logger.log(`Starting advanced multi-modal extraction for: ${fileUri}`);

    try {
      const response = await this.executeWithRetry(
        () =>
          modelsApi.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    fileData: {
                      fileUri,
                      mimeType,
                    },
                  },
                  {
                    text: `Perform comprehensive multi-modal analysis of this video. Extract EVERY detail about:
1. ALL people (gender, age, ethnicity, clothing, emotions, actions, features)
2. ALL objects (name, color, brand, state)
3. Scene details (location, lighting, weather, mood)
4. ALL audio (transcribe ALL speech word-for-word, describe music and sounds)
5. ALL text visible on screen
6. ALL actions and events

Cover the ENTIRE video at 2-3 second intervals. Be extremely thorough - this will be used for semantic search.`,
                  },
                ],
              },
            ],
            config: {
              systemInstruction: ADVANCED_EXTRACTION_INSTRUCTION,
              thinkingConfig: {
                thinkingLevel: sdkThinkingLevel,
                includeThoughts: true,
              },
              mediaResolution: sdkMediaResolution,
              tools: [{ codeExecution: {} }],
              responseMimeType: 'application/json',
              responseSchema: ADVANCED_EXTRACTION_SCHEMA,
            },
          }),
        {
          maxRetries: 3,
          baseDelayMs: 3000,
        },
      );

      return this.parseAdvancedExtractionResponse(response);
    } catch (error) {
      this.logger.error(
        `Advanced extraction failed: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Advanced video extraction failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Advanced multi-modal analysis for comprehensive video indexing (YouTube URL)
   * Extracts detailed information about people, objects, scenes, audio, and actions
   */
  async analyzeYouTubeForAdvancedIndexing(
    youtubeUrl: string,
    options: {
      thinkingLevel?: ThinkingLevelInput;
      mediaResolution?: MediaResolutionInput;
      startOffset?: string;
      endOffset?: string;
    } = {},
  ): Promise<AdvancedVideoAnalysisResult> {
    const {
      thinkingLevel = ThinkingLevelInput.HIGH,
      mediaResolution = MediaResolutionInput.HIGH,
      startOffset,
      endOffset,
    } = options;

    const sdkThinkingLevel = this.toSdkThinkingLevel(thinkingLevel);
    const sdkMediaResolution = this.toSdkMediaResolution(mediaResolution);

    const modelsApi = this.geminiService.getModelsApi();
    const modelName = this.geminiService.getModelName();

    this.logger.log(
      `Starting advanced multi-modal extraction for YouTube: ${youtubeUrl}`,
    );

    try {
      // Build the file data part
      const fileDataPart: any = {
        fileData: {
          fileUri: youtubeUrl,
        },
      };

      // Add video metadata if clipping is specified
      if (startOffset || endOffset) {
        fileDataPart.videoMetadata = {};
        if (startOffset) {
          fileDataPart.videoMetadata.startOffset = startOffset;
        }
        if (endOffset) {
          fileDataPart.videoMetadata.endOffset = endOffset;
        }
      }

      const response = await this.executeWithRetry(
        () =>
          modelsApi.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  fileDataPart,
                  {
                    text: `Perform comprehensive multi-modal analysis of this video. Extract EVERY detail about:
1. ALL people (gender, age, ethnicity, clothing, emotions, actions, features)
2. ALL objects (name, color, brand, state)
3. Scene details (location, lighting, weather, mood)
4. ALL audio (transcribe ALL speech word-for-word, describe music and sounds)
5. ALL text visible on screen
6. ALL actions and events

Cover the ENTIRE video at 2-3 second intervals. Be extremely thorough - this will be used for semantic search.`,
                  },
                ],
              },
            ],
            config: {
              systemInstruction: ADVANCED_EXTRACTION_INSTRUCTION,
              thinkingConfig: {
                thinkingLevel: sdkThinkingLevel,
                includeThoughts: true,
              },
              mediaResolution: sdkMediaResolution,
              // Note: Code execution is not enabled for YouTube URLs
              responseMimeType: 'application/json',
              responseSchema: ADVANCED_EXTRACTION_SCHEMA,
            },
          }),
        {
          maxRetries: 3,
          baseDelayMs: 3000,
        },
      );

      return this.parseAdvancedExtractionResponse(response);
    } catch (error) {
      this.logger.error(
        `YouTube advanced extraction failed: ${error.message}`,
        error.stack,
      );

      const errorMessage = error.message?.toLowerCase() || '';

      if (
        errorMessage.includes('video') &&
        (errorMessage.includes('unavailable') ||
          errorMessage.includes('private'))
      ) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message:
              'The YouTube video is unavailable or private. Please ensure the video is publicly accessible.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `YouTube advanced extraction failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Parse advanced extraction response into structured data
   */
  private parseAdvancedExtractionResponse(
    response: any,
  ): AdvancedVideoAnalysisResult {
    let thoughtSummary: string | undefined;
    let extractionJson: any;

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new Error('Invalid response: no content parts');
    }

    for (const part of candidate.content.parts) {
      if (part.thought && part.text) {
        thoughtSummary = part.text;
      } else if (part.text && !part.thought) {
        try {
          extractionJson = JSON.parse(part.text);
        } catch {
          this.logger.warn(
            'Failed to parse advanced extraction JSON, using fallback',
          );
          extractionJson = {
            summary: part.text,
            frames: [],
            confidence: 'Medium',
          };
        }
      }
    }

    if (!extractionJson) {
      throw new Error('No advanced extraction content in response');
    }

    // Parse and validate frames
    const frames: AdvancedFrameData[] = (extractionJson.frames || [])
      .filter((f: any) => f && typeof f === 'object')
      .map((f: any) => this.parseAdvancedFrame(f));

    // Build the result
    const result: AdvancedVideoAnalysisResult = {
      summary: extractionJson.summary || 'No summary provided',
      frames,
      confidence: extractionJson.confidence || 'Medium',
      thoughtSummary,
    };

    // Add token usage if available
    if (response.usageMetadata) {
      result.tokenUsage = {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
        thoughtsTokens: response.usageMetadata.thoughtsTokenCount,
      };
    }

    this.logger.log(
      `Advanced extraction complete: ${frames.length} frames extracted`,
    );

    return result;
  }

  /**
   * Parse a single advanced frame from the extraction response
   */
  private parseAdvancedFrame(frame: any): AdvancedFrameData {
    return {
      timestamp: String(frame.timestamp || '00:00'),
      people: Array.isArray(frame.people)
        ? frame.people.map((p: any) => ({
            id: p.id,
            gender: p.gender,
            apparentAge: p.apparentAge,
            apparentEthnicity: p.apparentEthnicity,
            clothing: Array.isArray(p.clothing) ? p.clothing : [],
            emotion: p.emotion,
            action: p.action,
            position: p.position,
            distinguishingFeatures: Array.isArray(p.distinguishingFeatures)
              ? p.distinguishingFeatures
              : [],
          }))
        : [],
      objects: Array.isArray(frame.objects)
        ? frame.objects.map((o: any) => ({
            name: o.name || 'unknown object',
            color: o.color,
            brand: o.brand,
            position: o.position,
            state: o.state,
            description: o.description,
          }))
        : [],
      scene: frame.scene
        ? {
            locationType: frame.scene.locationType,
            specificLocation: frame.scene.specificLocation,
            lighting: frame.scene.lighting,
            weather: frame.scene.weather,
            timeOfDay: frame.scene.timeOfDay,
            cameraAngle: frame.scene.cameraAngle,
            mood: frame.scene.mood,
          }
        : undefined,
      audio: frame.audio
        ? {
            speech: Array.isArray(frame.audio.speech)
              ? frame.audio.speech.map((s: any) => ({
                  speaker: s.speaker,
                  text: s.text || '',
                  tone: s.tone,
                  language: s.language,
                }))
              : [],
            music: frame.audio.music,
            sounds: Array.isArray(frame.audio.sounds) ? frame.audio.sounds : [],
          }
        : undefined,
      textOnScreen: Array.isArray(frame.textOnScreen)
        ? frame.textOnScreen.map((t: any) => ({
            text: t.text || '',
            type: t.type || 'other',
            position: t.position,
          }))
        : [],
      actionDescription: frame.actionDescription,
    };
  }

  /**
   * Parse the frame extraction response
   */
  private parseFrameExtractionResponse(response: any): VideoAnalysisResult {
    let thoughtSummary: string | undefined;
    let extractionJson: any;

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new Error('Invalid response: no content parts');
    }

    for (const part of candidate.content.parts) {
      if (part.thought && part.text) {
        thoughtSummary = part.text;
      } else if (part.text && !part.thought) {
        try {
          extractionJson = JSON.parse(part.text);
        } catch {
          extractionJson = {
            analysis: part.text,
            frames: [],
            confidence: 'Medium',
          };
        }
      }
    }

    if (!extractionJson) {
      throw new Error('No frame extraction content in response');
    }

    // Parse frames
    const frames: FrameDescription[] = (extractionJson.frames || [])
      .filter((f: any) => f && typeof f === 'object')
      .map((f: any) => ({
        timestamp: String(f.timestamp || '00:00'),
        description: String(f.description || ''),
      }));

    // Build the result
    const result: VideoAnalysisResult = {
      analysis: extractionJson.analysis || 'No analysis provided',
      timestamps: [], // Frame extraction doesn't use timestamp ranges
      confidence: this.parseConfidence(extractionJson.confidence),
      thoughtSummary,
      frames,
    };

    // Add token usage if available
    if (response.usageMetadata) {
      result.tokenUsage = {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
        thoughtsTokens: response.usageMetadata.thoughtsTokenCount,
      };
    }

    return result;
  }

  /**
   * Parse the Gemini response into VideoAnalysisResult
   */
  private parseAnalysisResponse(response: any): VideoAnalysisResult {
    let thoughtSummary: string | undefined;
    let analysisJson: any;

    // Extract thought summary and analysis from response parts
    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new Error('Invalid response: no content parts');
    }

    for (const part of candidate.content.parts) {
      // Check for thought summary
      if (part.thought && part.text) {
        thoughtSummary = part.text;
      }
      // Check for main text response (JSON)
      else if (part.text && !part.thought) {
        try {
          analysisJson = JSON.parse(part.text);
        } catch {
          // If not JSON, treat as plain text analysis
          analysisJson = {
            analysis: part.text,
            timestamps: [],
            confidence: 'Medium' as ConfidenceLevel,
          };
        }
      }
    }

    if (!analysisJson) {
      throw new Error('No analysis content in response');
    }

    // Build the result
    const result: VideoAnalysisResult = {
      analysis: analysisJson.analysis || 'No analysis provided',
      timestamps: this.parseTimestamps(analysisJson.timestamps),
      confidence: this.parseConfidence(analysisJson.confidence),
      thoughtSummary,
    };

    // Add token usage if available
    if (response.usageMetadata) {
      result.tokenUsage = {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
        thoughtsTokens: response.usageMetadata.thoughtsTokenCount,
      };
    }

    return result;
  }

  /**
   * Parse and validate timestamps from the response
   */
  private parseTimestamps(timestamps: any[]): TimestampRange[] {
    if (!Array.isArray(timestamps)) {
      return [];
    }

    return timestamps
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        start: String(t.start || '00:00'),
        end: String(t.end || '00:00'),
        description: String(t.description || ''),
      }));
  }

  /**
   * Parse and validate confidence level
   */
  private parseConfidence(confidence: any): ConfidenceLevel {
    const validLevels: ConfidenceLevel[] = ['Low', 'Medium', 'High'];
    if (validLevels.includes(confidence)) {
      return confidence;
    }
    return 'Medium';
  }

  /**
   * Get the default system instruction
   */
  getDefaultSystemInstruction(): string {
    return DEFAULT_SYSTEM_INSTRUCTION;
  }
}
