import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GeminiModule } from './gemini';
import { VideoModule } from './video';
import { LanceDBModule } from './lancedb';

@Module({
  imports: [
    // Load environment variables
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // Gemini AI services
    GeminiModule,
    // Video analysis endpoints
    VideoModule,
    // LanceDB vector search and RAG
    LanceDBModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
