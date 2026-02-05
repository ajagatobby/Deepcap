/**
 * Video metadata stored in LanceDB
 */
export interface VideoRecord {
  /** Unique identifier (UUID) */
  id: string;
  /** YouTube URL or original file path */
  sourceUri: string;
  /** Video title or display name */
  title: string;
  /** Video duration in seconds */
  duration?: number;
  /** Complete analysis text from Gemini */
  fullAnalysis: string;
  /** Analysis confidence level */
  confidence: string;
  /** Timestamp when indexed */
  indexedAt: string;
  /** Number of frames indexed */
  frameCount: number;
  /** Optional thought summary from analysis */
  thoughtSummary?: string;
  /** Index signature for LanceDB compatibility */
  [key: string]: string | number | undefined;
}

/**
 * Aspect types for multi-modal indexing
 */
export type AspectType =
  | 'people'
  | 'objects'
  | 'scene'
  | 'audio'
  | 'action'
  | 'text';

/**
 * Frame-level record with embedding vector (legacy)
 */
export interface FrameRecord {
  /** Unique identifier (UUID) */
  id: string;
  /** Foreign key to video */
  videoId: string;
  /** Timestamp in MM:SS format */
  timestamp: string;
  /** Timestamp converted to seconds for sorting */
  timestampSeconds: number;
  /** Frame description text */
  description: string;
  /** 384-dimensional embedding vector */
  vector: number[];
  /** Index signature for LanceDB compatibility */
  [key: string]: string | number | number[] | undefined;
}

/**
 * Enhanced frame-level record with multi-aspect support
 */
export interface EnhancedFrameRecord {
  /** Unique identifier (UUID) */
  id: string;
  /** Foreign key to video */
  videoId: string;
  /** Timestamp in MM:SS format */
  timestamp: string;
  /** Timestamp converted to seconds for sorting */
  timestampSeconds: number;
  /** Aspect type for this record */
  aspectType: AspectType;
  /** Content description for this aspect */
  content: string;
  /** 384-dimensional embedding vector */
  vector: number[];
  /** JSON stringified metadata specific to aspect type */
  metadata: string;
  /** Index signature for LanceDB compatibility */
  [key: string]: string | number | number[] | undefined;
}

/**
 * Enhanced frame record without vector (for intermediate processing)
 */
export interface EnhancedFrameRecordBase {
  id: string;
  videoId: string;
  timestamp: string;
  timestampSeconds: number;
  aspectType: AspectType;
  content: string;
  metadata: string;
}

/**
 * Person metadata extracted from video
 */
export interface PersonMetadata {
  /** Person identifier within frame (Person 1, Person 2, etc.) */
  id?: string;
  /** Gender: male/female/unknown */
  gender?: string;
  /** Apparent age: infant/child/teenager/young-adult/middle-aged/elderly */
  apparentAge?: string;
  /** Apparent ethnicity/race description */
  apparentEthnicity?: string;
  /** Physical build: slim/average/athletic/muscular/heavyset */
  physicalBuild?: string;
  /** List of clothing items with colors */
  clothing?: string[];
  /** Facial expression details */
  facialExpression?: string;
  /** Emotional expression: happy/sad/angry/surprised/neutral/fearful/disgusted */
  emotion?: string;
  /** Body language description */
  bodyLanguage?: string;
  /** Current action being performed */
  action?: string;
  /** Who/what they are interacting with */
  interactionWith?: string;
  /** Position in frame: left/center/right, foreground/background */
  position?: string;
  /** Distinguishing features: glasses, beard, tattoos, hair style/color, etc. */
  distinguishingFeatures?: string[];
  /** Inferred role: perpetrator/victim/witness/bystander/authority/employee/customer/unknown */
  role?: string;
  /** Threat level: none/low/moderate/high/critical */
  threatLevel?: string;
  /** Confidence in role assignment: low/medium/high */
  roleConfidence?: string;
}

/**
 * Person summary for aggregate tracking across video
 */
export interface PersonSummaryEntry {
  /** Person ID (e.g., Person 1) */
  personId: string;
  /** Specific role if applicable */
  role?: string;
  /** Brief description */
  description: string;
  /** First appearance timestamp (MM:SS) */
  firstAppearance: string;
  /** Last appearance timestamp (MM:SS) */
  lastAppearance: string;
}

/**
 * Aggregate summary of all unique persons in the video
 */
export interface PersonsSummary {
  /** Total count of unique individuals */
  totalUniquePersons: number;
  /** List of perpetrators (robbers, attackers, etc.) */
  perpetrators: PersonSummaryEntry[];
  /** List of victims */
  victims: PersonSummaryEntry[];
  /** List of authorities (police, security) */
  authorities: PersonSummaryEntry[];
  /** List of witnesses/bystanders */
  witnesses: PersonSummaryEntry[];
  /** List of people with unknown roles */
  unknown: PersonSummaryEntry[];
}

/**
 * Object metadata extracted from video
 */
export interface ObjectMetadata {
  /** Object name */
  name: string;
  /** Object color */
  color?: string;
  /** Brand if visible */
  brand?: string;
  /** Position in frame */
  position?: string;
  /** State: open/closed/broken/on/off/etc. */
  state?: string;
  /** Additional description */
  description?: string;
}

/**
 * Scene metadata extracted from video
 */
export interface SceneMetadata {
  /** Location type: indoor/outdoor/vehicle */
  locationType?: string;
  /** Specific location: office/beach/kitchen/street/etc. */
  specificLocation?: string;
  /** Lighting: bright/dim/natural/artificial/mixed */
  lighting?: string;
  /** Weather if outdoor: sunny/cloudy/rainy/snowy */
  weather?: string;
  /** Time of day: day/night/dusk/dawn */
  timeOfDay?: string;
  /** Camera angle: close-up/medium/wide/aerial/POV */
  cameraAngle?: string;
  /** Overall mood/atmosphere: tense/calm/chaotic/romantic/etc. */
  mood?: string;
}

/**
 * Speech instance in audio
 */
export interface SpeechInstance {
  /** Speaker identifier */
  speaker?: string;
  /** Transcribed text */
  text: string;
  /** Tone of voice: calm/excited/angry/sad/whispered */
  tone?: string;
  /** Detected language */
  language?: string;
}

/**
 * Audio metadata extracted from video
 */
export interface AudioMetadata {
  /** Type of audio: speech/music/sound-effect/ambient */
  type: 'speech' | 'music' | 'sound-effect' | 'ambient';
  /** Speech instances if type is speech */
  speech?: SpeechInstance[];
  /** Music description if present */
  music?: string;
  /** Music genre */
  musicGenre?: string;
  /** Sound effects descriptions */
  sounds?: string[];
  /** Ambient sound description */
  ambientDescription?: string;
}

/**
 * Text on screen metadata
 */
export interface TextOnScreenMetadata {
  /** The actual text content */
  text: string;
  /** Type of text: title/subtitle/sign/label/ui-element/caption */
  type:
    | 'title'
    | 'subtitle'
    | 'sign'
    | 'label'
    | 'ui-element'
    | 'caption'
    | 'other';
  /** Position on screen */
  position?: string;
}

/**
 * Advanced frame data from Gemini extraction
 */
export interface AdvancedFrameData {
  /** Timestamp in MM:SS format */
  timestamp: string;
  /** People visible in frame */
  people?: PersonMetadata[];
  /** Objects visible in frame */
  objects?: ObjectMetadata[];
  /** Scene information */
  scene?: SceneMetadata;
  /** Audio at this timestamp */
  audio?: {
    speech?: SpeechInstance[];
    music?: string;
    sounds?: string[];
  };
  /** Text visible on screen */
  textOnScreen?: TextOnScreenMetadata[];
  /** Overall action description */
  actionDescription?: string;
}

/**
 * Advanced video analysis result
 */
export interface AdvancedVideoAnalysisResult {
  /** Overall video summary */
  summary: string;
  /** Detailed frame-by-frame data */
  frames: AdvancedFrameData[];
  /** Aggregate summary of all unique persons */
  personsSummary?: PersonsSummary;
  /** Analysis confidence */
  confidence: string;
  /** Thought summary from Gemini */
  thoughtSummary?: string;
  /** Token usage */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thoughtsTokens?: number;
  };
}

/**
 * Frame description from video analysis (legacy)
 */
export interface FrameDescription {
  /** Timestamp in MM:SS format */
  timestamp: string;
  /** Description of what's happening at this timestamp */
  description: string;
}

/**
 * Result of indexing operation
 */
export interface IndexResult {
  /** Video ID that was indexed */
  videoId: string;
  /** Number of frames indexed */
  frameCount: number;
  /** Time taken to index in ms */
  indexingTimeMs: number;
  /** Whether indexing was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Search result from vector search (legacy)
 */
export interface FrameSearchResult extends FrameRecord {
  /** Distance/similarity score from vector search */
  _distance?: number;
}

/**
 * Enhanced search result from vector search
 */
export interface EnhancedFrameSearchResult extends EnhancedFrameRecord {
  /** Distance/similarity score from vector search */
  _distance?: number;
}

/**
 * RAG chat response
 */
export interface RAGResponse {
  /** Generated answer */
  answer: string;
  /** Source frames used for context */
  sources: Array<{
    timestamp: string;
    description: string;
    aspectType?: AspectType;
    relevanceScore?: number;
  }>;
  /** Token usage metadata */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Response latency in ms */
  latencyMs: number;
}

/**
 * Indexed video summary
 */
export interface IndexedVideoSummary {
  id: string;
  title: string;
  sourceUri: string;
  frameCount: number;
  indexedAt: string;
  confidence: string;
}

/**
 * Query classification result for smart routing
 */
export interface QueryClassification {
  /** Detected aspect types relevant to the query */
  aspects: AspectType[];
  /** Confidence in the classification */
  confidence: number;
}
