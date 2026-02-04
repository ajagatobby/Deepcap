import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService) {}

  getHello(): string {
    return 'DeepCap Video Understanding API - Powered by Gemini 3 Flash';
  }

  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'deepcap-video-understanding',
      version: '1.0.0',
      model: this.configService.get<string>('GEMINI_MODEL', 'gemini-3-flash-preview'),
      endpoints: {
        analyze: 'POST /video/analyze',
        analyzeUrl: 'POST /video/analyze-url',
        chatStart: 'POST /video/chat/start',
        chatStartYoutube: 'POST /video/chat/start-youtube',
        chatMessage: 'POST /video/chat/message',
        chatHistory: 'GET /video/chat/:sessionId/history',
        chatEnd: 'DELETE /video/chat/:sessionId',
      },
    };
  }
}
