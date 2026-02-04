import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Type for the pipeline function
type FeatureExtractionPipeline = any;

/**
 * Service for generating embeddings using local transformers.js model
 * Uses Xenova/all-MiniLM-L6-v2 for 384-dimensional embeddings
 */
@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private extractor: FeatureExtractionPipeline;
  private modelName: string;
  private isReady = false;

  constructor(private readonly configService: ConfigService) {
    this.modelName = this.configService.get<string>(
      'EMBEDDING_MODEL',
      'Xenova/all-MiniLM-L6-v2',
    );
  }

  async onModuleInit() {
    await this.initialize();
  }

  /**
   * Initialize the embedding model
   * Downloads and caches the model on first run
   */
  private async initialize(): Promise<void> {
    this.logger.log(`Loading embedding model: ${this.modelName}...`);
    
    try {
      // Dynamic import for ESM compatibility
      const { pipeline } = await import('@huggingface/transformers');
      
      this.extractor = await pipeline('feature-extraction', this.modelName, {
        dtype: 'fp32',
        // Use CPU for compatibility
        device: 'cpu',
      });
      
      this.isReady = true;
      this.logger.log(`Embedding model loaded successfully: ${this.modelName}`);
      
      // Warm up the model with a test embedding
      await this.embed('test');
      this.logger.log('Embedding model warmed up and ready');
    } catch (error) {
      this.logger.error(`Failed to load embedding model: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Check if the embedding service is ready
   */
  isInitialized(): boolean {
    return this.isReady;
  }

  /**
   * Generate embedding for a single text
   * @param text Text to embed
   * @returns 384-dimensional embedding vector
   */
  async embed(text: string): Promise<number[]> {
    if (!this.isReady) {
      throw new Error('Embedding service not initialized');
    }

    const startTime = Date.now();
    
    try {
      const output = await this.extractor(text, {
        pooling: 'mean',
        normalize: true,
      });
      
      // Convert tensor to array
      const embedding = Array.from(output.data as Float32Array);
      
      const latency = Date.now() - startTime;
      this.logger.debug(`Generated embedding in ${latency}ms`);
      
      return embedding;
    } catch (error) {
      this.logger.error(`Failed to generate embedding: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * More efficient for indexing multiple frames
   * @param texts Array of texts to embed
   * @returns Array of 384-dimensional embedding vectors
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.isReady) {
      throw new Error('Embedding service not initialized');
    }

    if (texts.length === 0) {
      return [];
    }

    const startTime = Date.now();
    this.logger.log(`Generating embeddings for ${texts.length} texts...`);

    try {
      // Process in batches to avoid memory issues
      const batchSize = 32;
      const embeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        
        // Generate embeddings for the batch
        const output = await this.extractor(batch, {
          pooling: 'mean',
          normalize: true,
        });

        // Extract embeddings from tensor
        const data = output.data as Float32Array;
        const embeddingDim = 384; // all-MiniLM-L6-v2 dimension
        
        for (let j = 0; j < batch.length; j++) {
          const start = j * embeddingDim;
          const end = start + embeddingDim;
          embeddings.push(Array.from(data.slice(start, end)));
        }

        this.logger.debug(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`);
      }

      const latency = Date.now() - startTime;
      this.logger.log(`Generated ${embeddings.length} embeddings in ${latency}ms (${(latency / texts.length).toFixed(2)}ms/text)`);

      return embeddings;
    } catch (error) {
      this.logger.error(`Failed to generate batch embeddings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the dimension of the embedding vectors
   */
  getEmbeddingDimension(): number {
    return 384; // all-MiniLM-L6-v2 produces 384-dimensional embeddings
  }

  /**
   * Get the model name being used
   */
  getModelName(): string {
    return this.modelName;
  }
}
