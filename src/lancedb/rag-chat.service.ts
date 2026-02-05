import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';
import { LanceDBService } from './lancedb.service';
import { AIProviderFactory, ITextGenerator, AIProvider } from '../providers';
import {
  RAGResponse,
  FrameSearchResult,
  EnhancedFrameSearchResult,
  AspectType,
  QueryClassification,
} from './interfaces';

/**
 * System instruction for RAG-based answer synthesis
 */
const RAG_SYSTEM_INSTRUCTION = `You are a video content assistant. You answer questions about videos based on the provided context from video frame descriptions.

Rules:
1. ONLY use information from the provided context to answer questions
2. If the context doesn't contain relevant information, say "I don't have information about that in the indexed video content"
3. Reference specific timestamps when relevant (format: MM:SS)
4. Be concise and direct in your answers
5. If multiple frames are relevant, synthesize them into a coherent answer
6. Do not make up or hallucinate information not present in the context`;

/**
 * Enhanced system instruction for advanced multi-aspect RAG
 */
const ADVANCED_RAG_SYSTEM_INSTRUCTION = `You are an expert forensic video analyst assistant with access to comprehensive multi-modal video data including:
- PEOPLE with ROLES: perpetrators/robbers/attackers, victims, authorities (police/security), witnesses/bystanders
- Detailed demographics: gender, age, ethnicity, physical build, clothing, emotions, actions
- THREAT LEVELS: none, low, moderate, high, critical
- Objects and their properties (including weapons)
- Scene details (location, lighting, atmosphere, danger level)
- Audio transcriptions (all speech word-for-word)
- Text visible on screen
- Actions and events with timestamps

## CRITICAL: ROLE-BASED QUERIES
When users ask about specific roles (robbers, victims, criminals, perpetrators, attackers, police, security):
1. Look for entries marked with [PERPETRATOR], [VICTIM], [AUTHORITY], [WITNESS], or [BYSTANDER]
2. "Robber", "criminal", "attacker", "thief" = look for [PERPETRATOR] markers
3. Count UNIQUE person IDs (Person 1, Person 2) - do NOT count the same person multiple times
4. Provide the EXACT count based on unique Person IDs with that role

## COUNTING QUERIES (How many X?)
For questions like "How many robbers/victims/people":
1. Identify all unique Person IDs with the requested role
2. Each Person ID = 1 individual (even if they appear in multiple timestamps)
3. State the count clearly: "There were X [role]s in the video"
4. List each person with their description and timestamps

## Rules:
1. ONLY use information from the provided context - DO NOT hallucinate
2. When asked about people, provide ALL available details: role, threat level, gender, age, ethnicity, clothing, etc.
3. When asked about speech/dialogue, quote the EXACT transcribed words
4. Reference specific timestamps (format: MM:SS) for your answers
5. Synthesize information from multiple aspects when relevant
6. If information is not available, clearly state what is not in the indexed content
7. Be specific and detailed - the user expects comprehensive forensic-quality answers
8. For role queries, ALWAYS count unique individuals, not frame appearances`;

/**
 * Keywords for query classification
 */
const ASPECT_KEYWORDS: Record<AspectType, string[]> = {
  people: [
    'person',
    'people',
    'man',
    'woman',
    'guy',
    'girl',
    'boy',
    'child',
    'kid',
    'gender',
    'male',
    'female',
    'age',
    'old',
    'young',
    'race',
    'ethnicity',
    'skin',
    'hair',
    'wearing',
    'clothes',
    'clothing',
    'dressed',
    'outfit',
    'emotion',
    'expression',
    'face',
    'facial',
    'looking',
    'appearance',
    'who',
    'somebody',
    'someone',
    'anybody',
    'anyone',
    'he',
    'she',
    'they',
    // Role-related keywords
    'robber',
    'robbers',
    'thief',
    'thieves',
    'criminal',
    'criminals',
    'perpetrator',
    'perpetrators',
    'attacker',
    'attackers',
    'suspect',
    'suspects',
    'assailant',
    'burglar',
    'burglars',
    'victim',
    'victims',
    'target',
    'hostage',
    'police',
    'officer',
    'officers',
    'cop',
    'cops',
    'security',
    'guard',
    'guards',
    'authority',
    'authorities',
    'witness',
    'witnesses',
    'bystander',
    'bystanders',
    'employee',
    'staff',
    'worker',
    'customer',
    'customers',
    // Counting keywords
    'how many',
    'count',
    'number',
    'total',
  ],
  audio: [
    'say',
    'said',
    'speak',
    'spoke',
    'talk',
    'talking',
    'voice',
    'hear',
    'sound',
    'noise',
    'music',
    'song',
    'dialogue',
    'conversation',
    'word',
    'listen',
    'audio',
    'speech',
    'mention',
    'tell',
    'told',
    'ask',
    'asked',
    'shout',
    'whisper',
    'sing',
    'language',
    'accent',
    'tone',
  ],
  objects: [
    'object',
    'thing',
    'item',
    'product',
    'brand',
    'device',
    'tool',
    'car',
    'vehicle',
    'phone',
    'computer',
    'table',
    'chair',
    'furniture',
    'food',
    'drink',
    'bottle',
    'bag',
    'box',
    'book',
    'what is',
    'what are',
  ],
  scene: [
    'where',
    'location',
    'place',
    'setting',
    'environment',
    'background',
    'indoor',
    'outdoor',
    'room',
    'building',
    'street',
    'city',
    'nature',
    'light',
    'lighting',
    'dark',
    'bright',
    'weather',
    'time of day',
    'atmosphere',
    'mood',
    'camera',
    'shot',
    'angle',
  ],
  text: [
    'text',
    'read',
    'written',
    'write',
    'sign',
    'title',
    'subtitle',
    'caption',
    'label',
    'display',
    'screen',
    'show',
    'letter',
    'word',
  ],
  action: [
    'do',
    'doing',
    'happen',
    'happening',
    'action',
    'event',
    'activity',
    'move',
    'moving',
    'walk',
    'run',
    'sit',
    'stand',
    'pick',
    'put',
    'open',
    'close',
    'start',
    'stop',
    'begin',
    'end',
    'then',
    'next',
  ],
};

/**
 * Service for RAG-based chat using indexed video content
 * Provides ultra-fast responses by avoiding video re-analysis
 */
@Injectable()
export class RAGChatService {
  private readonly logger = new Logger(RAGChatService.name);
  private readonly defaultTopK: number;
  private readonly defaultProvider: AIProvider;

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly lancedbService: LanceDBService,
    private readonly providerFactory: AIProviderFactory,
    private readonly configService: ConfigService,
  ) {
    this.defaultTopK = this.configService.get<number>('RAG_TOP_K', 5);
    this.defaultProvider = this.providerFactory.getDefaultProvider();
  }

  /**
   * Get text generator for the specified provider
   */
  private getTextGenerator(provider?: AIProvider | string): ITextGenerator {
    return this.providerFactory.getTextGenerator(provider);
  }

  /**
   * Perform RAG-based chat on an indexed video (legacy - uses simple frames)
   * @param videoId The indexed video ID
   * @param query User's question
   * @param topK Number of frames to retrieve (default: 5)
   * @param provider Optional AI provider to use for synthesis
   */
  async chat(
    videoId: string,
    query: string,
    topK?: number,
    provider?: AIProvider | string,
  ): Promise<RAGResponse> {
    const startTime = Date.now();
    const k = topK || this.defaultTopK;

    this.logger.log(
      `RAG chat for video ${videoId}: "${query.substring(0, 50)}..."`,
    );

    try {
      // 1. Verify video exists
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

      // 2. Embed the query (fast, local)
      const embedStartTime = Date.now();
      const queryVector = await this.embeddingService.embed(query);
      const embedLatency = Date.now() - embedStartTime;
      this.logger.debug(`Query embedding: ${embedLatency}ms`);

      // 3. Vector search (fast, disk-based)
      const searchStartTime = Date.now();
      const relevantFrames = await this.lancedbService.vectorSearch(
        queryVector,
        videoId,
        k,
      );
      const searchLatency = Date.now() - searchStartTime;
      this.logger.debug(
        `Vector search: ${searchLatency}ms, found ${relevantFrames.length} frames`,
      );

      if (relevantFrames.length === 0) {
        return {
          answer:
            'No relevant content found in the indexed video for this query.',
          sources: [],
          latencyMs: Date.now() - startTime,
        };
      }

      // 4. Build context from retrieved frames
      const context = this.buildContext(relevantFrames, video.title);

      // 5. Synthesize answer with AI provider (text-only, fast)
      const synthesisStartTime = Date.now();
      const answer = await this.synthesizeAnswer(query, context, provider);
      const synthesisLatency = Date.now() - synthesisStartTime;
      this.logger.debug(`Answer synthesis: ${synthesisLatency}ms`);

      const totalLatency = Date.now() - startTime;
      this.logger.log(`RAG chat completed in ${totalLatency}ms`);

      return {
        answer: answer.text,
        sources: relevantFrames.map((f) => ({
          timestamp: f.timestamp,
          description: f.description,
          relevanceScore: f._distance ? 1 - f._distance : undefined, // Convert distance to similarity
        })),
        tokenUsage: answer.tokenUsage,
        latencyMs: totalLatency,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`RAG chat failed: ${error.message}`, error.stack);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `RAG chat failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Advanced RAG chat using multi-aspect enhanced frames
   * Provides detailed answers about people, audio, objects, scenes, etc.
   * @param videoId The indexed video ID
   * @param query User's question
   * @param topK Number of frames to retrieve
   * @param provider Optional AI provider to use for synthesis
   */
  async advancedChat(
    videoId: string,
    query: string,
    topK?: number,
    provider?: AIProvider | string,
  ): Promise<RAGResponse> {
    const startTime = Date.now();
    const k = topK || this.defaultTopK * 2; // More results for comprehensive answers

    this.logger.log(
      `Advanced RAG chat for video ${videoId}: "${query.substring(0, 50)}..."`,
    );

    try {
      // 1. Verify video exists
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

      // 2. Classify query to determine relevant aspects
      const classification = this.classifyQuery(query);
      this.logger.debug(
        `Query classified to aspects: ${classification.aspects.join(', ')} (confidence: ${classification.confidence})`,
      );

      // 3. Embed the query
      const queryVector = await this.embeddingService.embed(query);

      // 4. Search enhanced frames with aspect filtering
      const searchStartTime = Date.now();
      const relevantFrames = await this.lancedbService.enhancedVectorSearch(
        queryVector,
        {
          videoId,
          aspectTypes: classification.aspects,
          limit: k,
        },
      );
      const searchLatency = Date.now() - searchStartTime;
      this.logger.debug(
        `Enhanced search: ${searchLatency}ms, found ${relevantFrames.length} frames`,
      );

      // If no results with aspect filter, try without filter
      let finalFrames = relevantFrames;
      if (relevantFrames.length === 0) {
        this.logger.debug(
          'No results with aspect filter, searching all aspects',
        );
        finalFrames = await this.lancedbService.enhancedVectorSearch(
          queryVector,
          { videoId, limit: k },
        );
      }

      if (finalFrames.length === 0) {
        // Fall back to legacy frames
        const legacyFrames = await this.lancedbService.vectorSearch(
          queryVector,
          videoId,
          k,
        );

        if (legacyFrames.length === 0) {
          return {
            answer:
              'No relevant content found in the indexed video for this query.',
            sources: [],
            latencyMs: Date.now() - startTime,
          };
        }

        // Use legacy flow
        const context = this.buildContext(legacyFrames, video.title);
        const answer = await this.synthesizeAnswer(query, context, provider);

        return {
          answer: answer.text,
          sources: legacyFrames.map((f) => ({
            timestamp: f.timestamp,
            description: f.description,
            relevanceScore: f._distance ? 1 - f._distance : undefined,
          })),
          tokenUsage: answer.tokenUsage,
          latencyMs: Date.now() - startTime,
        };
      }

      // 5. Build enhanced context with multi-aspect information
      const context = this.buildEnhancedContext(finalFrames, video.title);

      // 6. Synthesize answer with advanced prompt
      const synthesisStartTime = Date.now();
      const answer = await this.synthesizeAdvancedAnswer(query, context, provider);
      const synthesisLatency = Date.now() - synthesisStartTime;
      this.logger.debug(`Advanced synthesis: ${synthesisLatency}ms`);

      const totalLatency = Date.now() - startTime;
      this.logger.log(`Advanced RAG chat completed in ${totalLatency}ms`);

      return {
        answer: answer.text,
        sources: finalFrames.map((f) => ({
          timestamp: f.timestamp,
          description: f.content,
          aspectType: f.aspectType,
          relevanceScore: f._distance ? 1 - f._distance : undefined,
        })),
        tokenUsage: answer.tokenUsage,
        latencyMs: totalLatency,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Advanced RAG chat failed: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Advanced RAG chat failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Classify a query to determine relevant aspects
   */
  classifyQuery(query: string): QueryClassification {
    const queryLower = query.toLowerCase();
    const matchedAspects: AspectType[] = [];
    let totalMatches = 0;

    // Check each aspect's keywords
    for (const [aspect, keywords] of Object.entries(ASPECT_KEYWORDS)) {
      const matches = keywords.filter((kw) => queryLower.includes(kw)).length;
      if (matches > 0) {
        matchedAspects.push(aspect as AspectType);
        totalMatches += matches;
      }
    }

    // If no specific aspects matched, search all
    if (matchedAspects.length === 0) {
      return {
        aspects: ['people', 'objects', 'scene', 'audio', 'action', 'text'],
        confidence: 0.3,
      };
    }

    // Calculate confidence based on number of matches
    const confidence = Math.min(totalMatches / 3, 1.0);

    return {
      aspects: matchedAspects,
      confidence,
    };
  }

  /**
   * Search across all indexed videos (global search)
   * @param query User's question
   * @param topK Number of frames to retrieve
   */
  async globalSearch(
    query: string,
    topK?: number,
  ): Promise<{
    results: Array<{
      videoId: string;
      videoTitle: string;
      timestamp: string;
      description: string;
      relevanceScore?: number;
    }>;
    latencyMs: number;
  }> {
    const startTime = Date.now();
    const k = topK || this.defaultTopK * 2; // Search more for global

    this.logger.log(`Global search: "${query.substring(0, 50)}..."`);

    try {
      // 1. Embed the query
      const queryVector = await this.embeddingService.embed(query);

      // 2. Search across all videos
      const frames = await this.lancedbService.vectorSearch(
        queryVector,
        undefined,
        k,
      );

      // 3. Enrich with video titles
      const videoCache = new Map<string, string>();
      const results = await Promise.all(
        frames.map(async (f) => {
          if (!videoCache.has(f.videoId)) {
            const video = await this.lancedbService.getVideo(f.videoId);
            videoCache.set(f.videoId, video?.title || 'Unknown');
          }

          return {
            videoId: f.videoId,
            videoTitle: videoCache.get(f.videoId) || 'Unknown',
            timestamp: f.timestamp,
            description: f.description,
            relevanceScore: f._distance ? 1 - f._distance : undefined,
          };
        }),
      );

      return {
        results,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(`Global search failed: ${error.message}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Global search failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Build context string from retrieved frames (legacy)
   */
  private buildContext(
    frames: FrameSearchResult[],
    videoTitle: string,
  ): string {
    const header = `Video: "${videoTitle}"\n\nRelevant frame descriptions:\n`;

    const frameContext = frames
      .map((f, i) => {
        const score = f._distance
          ? `(relevance: ${(1 - f._distance).toFixed(3)})`
          : '';
        return `[${i + 1}] At ${f.timestamp} ${score}:\n${f.description}`;
      })
      .join('\n\n');

    return header + frameContext;
  }

  /**
   * Build enhanced context from multi-aspect frames
   */
  private buildEnhancedContext(
    frames: EnhancedFrameSearchResult[],
    videoTitle: string,
  ): string {
    const header = `Video: "${videoTitle}"\n\nComprehensive video content (organized by aspect):\n\n`;

    // Group frames by aspect type
    const byAspect: Record<string, EnhancedFrameSearchResult[]> = {};
    for (const frame of frames) {
      if (!byAspect[frame.aspectType]) {
        byAspect[frame.aspectType] = [];
      }
      byAspect[frame.aspectType].push(frame);
    }

    // Build context sections by aspect
    const sections: string[] = [];

    // People section
    if (byAspect['people']?.length > 0) {
      const peopleContent = byAspect['people']
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
        .map((f) => {
          const score = f._distance
            ? ` (relevance: ${(1 - f._distance).toFixed(2)})`
            : '';
          return `• ${f.content}${score}`;
        })
        .join('\n');
      sections.push(`## PEOPLE IN VIDEO\n${peopleContent}`);
    }

    // Audio/Speech section
    if (byAspect['audio']?.length > 0) {
      const audioContent = byAspect['audio']
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
        .map((f) => {
          const score = f._distance
            ? ` (relevance: ${(1 - f._distance).toFixed(2)})`
            : '';
          return `• ${f.content}${score}`;
        })
        .join('\n');
      sections.push(`## AUDIO & SPEECH\n${audioContent}`);
    }

    // Objects section
    if (byAspect['objects']?.length > 0) {
      const objectsContent = byAspect['objects']
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
        .map((f) => {
          const score = f._distance
            ? ` (relevance: ${(1 - f._distance).toFixed(2)})`
            : '';
          return `• ${f.content}${score}`;
        })
        .join('\n');
      sections.push(`## OBJECTS VISIBLE\n${objectsContent}`);
    }

    // Scene section
    if (byAspect['scene']?.length > 0) {
      const sceneContent = byAspect['scene']
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
        .map((f) => {
          const score = f._distance
            ? ` (relevance: ${(1 - f._distance).toFixed(2)})`
            : '';
          return `• ${f.content}${score}`;
        })
        .join('\n');
      sections.push(`## SCENE & SETTING\n${sceneContent}`);
    }

    // Text section
    if (byAspect['text']?.length > 0) {
      const textContent = byAspect['text']
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
        .map((f) => {
          const score = f._distance
            ? ` (relevance: ${(1 - f._distance).toFixed(2)})`
            : '';
          return `• ${f.content}${score}`;
        })
        .join('\n');
      sections.push(`## TEXT ON SCREEN\n${textContent}`);
    }

    // Actions section
    if (byAspect['action']?.length > 0) {
      const actionContent = byAspect['action']
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
        .map((f) => {
          const score = f._distance
            ? ` (relevance: ${(1 - f._distance).toFixed(2)})`
            : '';
          return `• ${f.content}${score}`;
        })
        .join('\n');
      sections.push(`## ACTIONS & EVENTS\n${actionContent}`);
    }

    return header + sections.join('\n\n');
  }

  /**
   * Synthesize answer using text generator with advanced multi-aspect prompt
   */
  private async synthesizeAdvancedAnswer(
    query: string,
    context: string,
    provider?: AIProvider | string,
  ): Promise<{
    text: string;
    tokenUsage?: { inputTokens: number; outputTokens: number };
  }> {
    const textGenerator = this.getTextGenerator(provider);

    const prompt = `Based on the following comprehensive video content analysis, answer the user's question in detail.

${context}

---

User Question: ${query}

Provide a detailed answer using ONLY the information from the context above. Include specific timestamps when relevant.

Answer:`;

    try {
      const result = await textGenerator.generateWithSystemInstruction(
        ADVANCED_RAG_SYSTEM_INSTRUCTION,
        prompt,
        {
          qualityLevel: 'medium', // Medium for better reasoning
          maxOutputTokens: 2048, // Allow longer responses for detailed answers
        },
      );

      return {
        text: result.text || 'Unable to generate response',
        tokenUsage: result.tokenUsage,
      };
    } catch (error) {
      this.logger.error(`Advanced synthesis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Synthesize answer using text generator with text-only prompt (legacy)
   */
  private async synthesizeAnswer(
    query: string,
    context: string,
    provider?: AIProvider | string,
  ): Promise<{
    text: string;
    tokenUsage?: { inputTokens: number; outputTokens: number };
  }> {
    const textGenerator = this.getTextGenerator(provider);

    const prompt = `Based on the following video content context, answer the user's question.

${context}

---

User Question: ${query}

Answer:`;

    try {
      const result = await textGenerator.generateWithSystemInstruction(
        RAG_SYSTEM_INSTRUCTION,
        prompt,
        {
          qualityLevel: 'low', // Use low for fast responses
          maxOutputTokens: 1024, // Limit output length for speed
        },
      );

      return {
        text: result.text || 'Unable to generate response',
        tokenUsage: result.tokenUsage,
      };
    } catch (error) {
      this.logger.error(`Synthesis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get similar frames to a given frame (legacy)
   * Useful for finding related moments in a video
   */
  async findSimilarFrames(
    videoId: string,
    timestamp: string,
    topK?: number,
  ): Promise<FrameSearchResult[]> {
    const k = topK || this.defaultTopK;

    // Get the frame at the timestamp
    const frames = await this.lancedbService.getVideoFrames(videoId);
    const targetFrame = frames.find((f) => f.timestamp === timestamp);

    if (!targetFrame) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `Frame not found at timestamp: ${timestamp}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // Search using the frame's vector
    const similar = await this.lancedbService.vectorSearch(
      targetFrame.vector,
      videoId,
      k + 1, // +1 because it will include itself
    );

    // Filter out the original frame
    return similar.filter((f) => f.timestamp !== timestamp);
  }

  /**
   * Find similar content based on a text query
   * Searches enhanced frames by default, falls back to legacy
   */
  async findSimilarByQuery(
    query: string,
    videoId?: string,
    topK?: number,
  ): Promise<
    Array<{
      timestamp: string;
      content: string;
      aspectType?: AspectType;
      relevanceScore?: number;
      videoId: string;
    }>
  > {
    const k = topK || this.defaultTopK;

    // Embed the query
    const queryVector = await this.embeddingService.embed(query);

    // Try enhanced search first
    const enhancedResults = await this.lancedbService.enhancedVectorSearch(
      queryVector,
      { videoId, limit: k },
    );

    if (enhancedResults.length > 0) {
      return enhancedResults.map((f) => ({
        timestamp: f.timestamp,
        content: f.content,
        aspectType: f.aspectType,
        relevanceScore: f._distance ? 1 - f._distance : undefined,
        videoId: f.videoId,
      }));
    }

    // Fall back to legacy search
    const legacyResults = await this.lancedbService.vectorSearch(
      queryVector,
      videoId,
      k,
    );

    return legacyResults.map((f) => ({
      timestamp: f.timestamp,
      content: f.description,
      relevanceScore: f._distance ? 1 - f._distance : undefined,
      videoId: f.videoId,
    }));
  }

  /**
   * Advanced global search across all videos with multi-aspect support
   */
  async advancedGlobalSearch(
    query: string,
    topK?: number,
  ): Promise<{
    results: Array<{
      videoId: string;
      videoTitle: string;
      timestamp: string;
      content: string;
      aspectType?: AspectType;
      relevanceScore?: number;
    }>;
    aspectDistribution: Record<string, number>;
    latencyMs: number;
  }> {
    const startTime = Date.now();
    const k = topK || this.defaultTopK * 3;

    this.logger.log(`Advanced global search: "${query.substring(0, 50)}..."`);

    try {
      // Classify query to focus search
      const classification = this.classifyQuery(query);

      // Embed query
      const queryVector = await this.embeddingService.embed(query);

      // Search enhanced frames
      const frames = await this.lancedbService.enhancedVectorSearch(
        queryVector,
        { aspectTypes: classification.aspects, limit: k },
      );

      // Get video titles
      const videoCache = new Map<string, string>();
      const results = await Promise.all(
        frames.map(async (f) => {
          if (!videoCache.has(f.videoId)) {
            const video = await this.lancedbService.getVideo(f.videoId);
            videoCache.set(f.videoId, video?.title || 'Unknown');
          }

          return {
            videoId: f.videoId,
            videoTitle: videoCache.get(f.videoId) || 'Unknown',
            timestamp: f.timestamp,
            content: f.content,
            aspectType: f.aspectType,
            relevanceScore: f._distance ? 1 - f._distance : undefined,
          };
        }),
      );

      // Calculate aspect distribution
      const aspectDistribution: Record<string, number> = {};
      for (const frame of frames) {
        aspectDistribution[frame.aspectType] =
          (aspectDistribution[frame.aspectType] || 0) + 1;
      }

      return {
        results,
        aspectDistribution,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(`Advanced global search failed: ${error.message}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Advanced global search failed: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
