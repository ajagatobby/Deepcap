# DeepCap - Video Understanding API

A production-ready NestJS application for deep video understanding using Google's **Gemini 3 Flash** model. This application provides REST API endpoints for analyzing videos with advanced temporal reasoning, agentic vision capabilities, multi-turn conversations, and **RAG-based semantic video search** powered by LanceDB.

## Features

### Video Analysis (Gemini-powered)
- **Video File Analysis**: Upload and analyze video files (mp4, mov, avi, etc.)
- **YouTube URL Analysis**: Directly analyze YouTube videos by URL
- **Multi-turn Chat**: Engage in conversations about videos with context preservation
- **Gemini 3 Flash Configuration**:
  - **Thinking Levels**: Control reasoning depth (minimal, low, medium, high)
  - **Media Resolution**: Configure visual acuity (low, medium, high)
  - **Code Execution**: Enable agentic vision for pixel-level inspection
  - **Thought Signatures**: Automatic handling for multi-turn reasoning continuity
- **Anti-Hallucination**: Strict system prompts requiring timestamp evidence
- **Structured Output**: JSON responses with analysis, timestamps, and confidence scores

### Video Indexing & RAG Search (LanceDB-powered)
- **Video Indexing**: Extract and embed frame descriptions for fast semantic search
- **Advanced Multi-aspect Indexing**: Extract detailed information about:
  - **People**: Gender, age, ethnicity, clothing, emotions, actions
  - **Objects**: Names, colors, brands, states
  - **Scenes**: Location, lighting, atmosphere, camera angles
  - **Audio**: Speech transcription, music, sound effects
  - **Text on Screen**: Titles, subtitles, signs, labels
  - **Actions**: Events and activities in the video
- **RAG Chat**: Ultra-fast Q&A on indexed videos without re-processing
- **Global Search**: Search across all indexed videos
- **Local Embeddings**: HuggingFace Transformers (all-MiniLM-L6-v2) for offline embedding generation

## Prerequisites

- Node.js 20 or later
- pnpm (recommended) or npm
- Google AI API key ([Get one here](https://aistudio.google.com/apikey))

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd deepcap

# Install dependencies
pnpm install

# Create environment file
cp .env.example .env

# Add your Gemini API key to .env
# GEMINI_API_KEY=your_api_key_here
```

## Configuration

Edit `.env` file with your settings:

```env
# Google Gemini API Configuration
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-3-flash-preview

# File Upload Configuration
MAX_POLL_ATTEMPTS=30
POLL_INTERVAL_MS=2000

# Server Configuration
PORT=3000

# Embedding Configuration (optional)
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2

# RAG Configuration (optional)
RAG_TOP_K=5
```

## Running the Application

```bash
# Development mode
pnpm run start:dev

# Production mode
pnpm run build
pnpm run start:prod
```

## API Endpoints

### Health Check

```
GET /health
```

Returns API status and available endpoints.

---

## Video Analysis Endpoints

### Analyze Uploaded Video

```
POST /video/analyze
Content-Type: multipart/form-data

video: <video file>
query: "Find the timestamp where the red car turns left"
thinkingLevel: "HIGH" (optional)
mediaResolution: "MEDIA_RESOLUTION_HIGH" (optional)
systemPrompt: "Custom instructions" (optional)
```

### Analyze YouTube URL

```
POST /video/analyze-url
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=...",
  "query": "Summarize this video",
  "thinkingLevel": "HIGH",
  "mediaResolution": "MEDIA_RESOLUTION_HIGH",
  "startOffset": "60s",
  "endOffset": "120s"
}
```

### Multi-turn Chat

#### Start Chat with Video File

```
POST /video/chat/start
Content-Type: multipart/form-data

video: <video file>
initialQuery: "What happens in this video?"
thinkingLevel: "HIGH" (optional)
mediaResolution: "MEDIA_RESOLUTION_HIGH" (optional)
```

#### Start Chat with YouTube URL

```
POST /video/chat/start-youtube
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=...",
  "query": "What happens in this video?"
}
```

#### Send Follow-up Message

```
POST /video/chat/message
Content-Type: application/json

{
  "sessionId": "uuid-session-id",
  "message": "What color was the car at 01:30?"
}
```

#### Get Chat History

```
GET /video/chat/:sessionId/history
```

#### End Chat Session

```
DELETE /video/chat/:sessionId
```

---

## LanceDB Video Indexing & RAG Endpoints

### Index a Video (Basic)

Index an uploaded video with frame-level descriptions.

```
POST /lancedb/index
Content-Type: multipart/form-data

video: <video file>
title: "My Video Title" (optional, auto-generated from filename)
thinkingLevel: "HIGH" (optional)
mediaResolution: "MEDIA_RESOLUTION_HIGH" (optional)
```

**Response:**
```json
{
  "videoId": "uuid-video-id",
  "frameCount": 42,
  "indexingTimeMs": 15234,
  "success": true,
  "tokenUsage": {
    "inputTokens": 12345,
    "outputTokens": 678
  }
}
```

### Index a YouTube Video (Basic)

```
POST /lancedb/index/youtube
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=...",
  "title": "My YouTube Video" (optional),
  "thinkingLevel": "HIGH",
  "mediaResolution": "MEDIA_RESOLUTION_HIGH",
  "startOffset": "0s",
  "endOffset": "300s"
}
```

### Index a Video (Advanced Multi-aspect)

Extract comprehensive information about people, objects, scenes, audio, and text.

```
POST /lancedb/index/advanced
Content-Type: multipart/form-data

video: <video file>
title: "My Video Title" (optional)
thinkingLevel: "HIGH" (optional)
mediaResolution: "MEDIA_RESOLUTION_HIGH" (optional)
```

### Index a YouTube Video (Advanced)

```
POST /lancedb/index/youtube/advanced
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=...",
  "title": "My YouTube Video" (optional),
  "thinkingLevel": "HIGH",
  "mediaResolution": "MEDIA_RESOLUTION_HIGH"
}
```

**Response:**
```json
{
  "videoId": "uuid-video-id",
  "frameCount": 156,
  "indexingTimeMs": 45678,
  "success": true,
  "analysisType": "advanced",
  "tokenUsage": { ... }
}
```

### RAG Chat (Basic)

Chat with an indexed video using semantic retrieval.

```
POST /lancedb/chat
Content-Type: application/json

{
  "videoId": "uuid-video-id",
  "query": "What happens at the beginning of the video?",
  "topK": 5 (optional, default: 5)
}
```

**Response:**
```json
{
  "answer": "At the beginning (00:00-00:15), a person enters the room and...",
  "sources": [
    {
      "timestamp": "00:05",
      "description": "Person enters from the left door",
      "relevanceScore": 0.89
    }
  ],
  "tokenUsage": { ... },
  "latencyMs": 234
}
```

### RAG Chat (Advanced)

Get detailed answers about people, speech, objects, and more.

```
POST /lancedb/chat/advanced
Content-Type: application/json

{
  "videoId": "uuid-video-id",
  "query": "Who are the people in the video and what do they say?",
  "topK": 10 (optional)
}
```

**Response:**
```json
{
  "answer": "At 00:30, a young woman with brown hair wearing a blue dress says: \"Welcome to the presentation.\" At 01:15, an older man in a gray suit responds...",
  "sources": [
    {
      "timestamp": "00:30",
      "description": "At 00:30: Person 1: female, mid-20s, appears Caucasian, wearing blue dress...",
      "aspectType": "people",
      "relevanceScore": 0.92
    },
    {
      "timestamp": "00:30",
      "description": "At 00:30: Person 1 says: \"Welcome to the presentation.\" (confident tone)",
      "aspectType": "audio",
      "relevanceScore": 0.88
    }
  ],
  "chatType": "advanced",
  "latencyMs": 312
}
```

### Global Search (Basic)

Search across all indexed videos.

```
POST /lancedb/search
Content-Type: application/json

{
  "query": "car accident scene",
  "topK": 10 (optional)
}
```

### Global Search (Advanced)

Search with multi-aspect support and aspect distribution.

```
POST /lancedb/search/advanced
Content-Type: application/json

{
  "query": "people wearing red clothing",
  "topK": 20 (optional)
}
```

**Response:**
```json
{
  "results": [...],
  "aspectDistribution": {
    "people": 15,
    "scene": 3,
    "objects": 2
  },
  "searchType": "advanced",
  "latencyMs": 156
}
```

### List Indexed Videos

```
GET /lancedb/videos
```

**Response:**
```json
{
  "videos": [
    {
      "id": "uuid-1",
      "title": "Video 1",
      "sourceUri": "https://...",
      "frameCount": 42,
      "indexedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "count": 1
}
```

### Get Video Details

```
GET /lancedb/videos/:id
```

### Delete Indexed Video

```
DELETE /lancedb/videos/:id
```

### Find Similar Content

```
GET /lancedb/similar?query=person%20running&videoId=uuid&limit=10
```

### LanceDB Statistics

```
GET /lancedb/stats
```

**Response:**
```json
{
  "videoCount": 5,
  "frameCount": 234,
  "enhancedFrameCount": 1560,
  "embeddingModel": "Xenova/all-MiniLM-L6-v2",
  "embeddingServiceReady": true
}
```

### LanceDB Health Check

```
GET /lancedb/health
```

---

## Response Format

### Video Analysis Response

```json
{
  "analysis": "Detailed analysis text...",
  "timestamps": [
    {
      "start": "00:15",
      "end": "00:23",
      "description": "A red car turns left at the intersection"
    }
  ],
  "confidence": "High",
  "thoughtSummary": "Model's reasoning process...",
  "tokenUsage": {
    "inputTokens": 1234,
    "outputTokens": 567,
    "thoughtsTokens": 890
  },
  "metadata": {
    "model": "gemini-3-flash-preview",
    "processingTimeMs": 5432
  }
}
```

---

## Configuration Options

### Thinking Level

Controls the depth of the model's reasoning:

| Level | Description | Use Case |
|-------|-------------|----------|
| `MINIMAL` | Minimal reasoning | Simple tasks, low latency |
| `LOW` | Light reasoning | Basic queries |
| `MEDIUM` | Balanced reasoning | Most tasks |
| `HIGH` | Deep reasoning | Complex analysis, temporal reasoning |

### Media Resolution

Controls token allocation per video frame:

| Resolution | Tokens/Frame | Use Case |
|------------|--------------|----------|
| `MEDIA_RESOLUTION_LOW` | 70 | Long videos, general overview |
| `MEDIA_RESOLUTION_MEDIUM` | 140 | Balanced detail |
| `MEDIA_RESOLUTION_HIGH` | 280 | Fine text, small details |

---

## Supported Video Formats

- `video/mp4`
- `video/mpeg`
- `video/mov`
- `video/avi`
- `video/x-flv`
- `video/mpg`
- `video/webm`
- `video/wmv`
- `video/3gpp`

---

## Technical Details

### File API

- Maximum file size: 2GB
- Files are automatically deleted after processing
- Polling mechanism ensures files are ready before analysis

### Thought Signatures

The application automatically handles Gemini 3's thought signatures for multi-turn conversations, maintaining reasoning context across chat turns.

### Anti-Hallucination Strategy

The default system prompt enforces:
1. Explicit timestamp evidence for all claims
2. "No visual evidence found" for uncertain observations
3. Confidence level reporting
4. Code execution for visual ambiguity resolution

### LanceDB Vector Database

- **Storage**: Disk-based, zero-copy reads for fast retrieval
- **Embedding Model**: Xenova/all-MiniLM-L6-v2 (384 dimensions)
- **Index**: Auto-created when frame count exceeds 256
- **Search**: L2 distance with optional aspect-type filtering

### Embedding Service

- **Model**: HuggingFace Transformers (local, no API calls)
- **Dimension**: 384
- **Batch Processing**: 32 texts per batch for efficiency
- **Warmup**: Model is preloaded on application startup

---

## Error Handling

| Status Code | Description |
|-------------|-------------|
| 400 | Invalid request or validation error |
| 404 | Video or session not found |
| 408 | File processing timeout |
| 409 | Video already indexed |
| 422 | File processing failed |
| 429 | API rate limit exceeded |
| 500 | Internal server error |

---

## Development

```bash
# Run tests
pnpm run test

# Run e2e tests
pnpm run test:e2e

# Lint code
pnpm run lint

# Format code
pnpm run format
```

---

## Project Structure

```
src/
├── main.ts                           # Application bootstrap
├── app.module.ts                     # Root module
├── common/
│   └── filters/
│       └── http-exception.filter.ts  # Global exception handling
├── gemini/
│   ├── gemini.module.ts
│   ├── gemini.service.ts             # GenAI client
│   ├── file-manager.service.ts       # File API operations
│   ├── video-analyze.service.ts      # Video analysis
│   ├── chat.service.ts               # Multi-turn chat
│   ├── dto/                          # Request DTOs
│   └── interfaces/                   # Type definitions
├── lancedb/
│   ├── lancedb.module.ts
│   ├── lancedb.controller.ts         # REST endpoints for indexing & RAG
│   ├── lancedb.service.ts            # LanceDB operations
│   ├── video-index.service.ts        # Video indexing pipeline
│   ├── rag-chat.service.ts           # RAG-based Q&A
│   ├── embedding.service.ts          # Local embedding generation
│   ├── dto/                          # Request DTOs
│   └── interfaces/                   # Type definitions
└── video/
    ├── video.module.ts
    └── video.controller.ts           # REST endpoints for analysis
data/
└── lancedb/                          # LanceDB storage (auto-created)
```

---

## License

UNLICENSED
