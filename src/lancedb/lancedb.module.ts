import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { EmbeddingService } from './embedding.service';
import { LanceDBService } from './lancedb.service';
import { VideoIndexService } from './video-index.service';
import { RAGChatService } from './rag-chat.service';
import { LanceDBController } from './lancedb.controller';
import { GeminiModule } from '../gemini/gemini.module';

/**
 * LanceDB module for vector-based video search and RAG
 * 
 * Provides:
 * - Local embedding generation using all-MiniLM-L6-v2
 * - LanceDB vector storage and search
 * - Video indexing pipeline
 * - RAG chat for fast video Q&A
 */
@Module({
  imports: [
    ConfigModule,
    MulterModule.register({
      limits: {
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB limit
      },
    }),
    GeminiModule,
  ],
  controllers: [LanceDBController],
  providers: [
    EmbeddingService,
    LanceDBService,
    VideoIndexService,
    RAGChatService,
  ],
  exports: [
    EmbeddingService,
    LanceDBService,
    VideoIndexService,
    RAGChatService,
  ],
})
export class LanceDBModule {}
