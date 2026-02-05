import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { OpenAIService } from './openai.service';
import { OpenAIFileHandlerService } from './openai-file-handler.service';
import {
  IVideoAnalyzer,
  AnalysisOptions,
  IndexingOptions,
  YouTubeAnalysisOptions,
} from '../providers/interfaces';
import {
  VideoAnalysisResult,
  TimestampRange,
  ConfidenceLevel,
  FrameDescription,
} from '../gemini/interfaces';
import {
  AdvancedVideoAnalysisResult,
  AdvancedFrameData,
  PersonMetadata,
  ObjectMetadata,
  SceneMetadata,
  TextOnScreenMetadata,
} from '../lancedb/interfaces';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * JSON schema for structured video analysis output
 */
const ANALYSIS_RESPONSE_SCHEMA = {
  type: 'object' as const,
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
          start: { type: 'string', description: 'Start time in MM:SS format' },
          end: { type: 'string', description: 'End time in MM:SS format' },
          description: {
            type: 'string',
            description: 'Description of what happens during this timestamp',
          },
        },
        required: ['start', 'end', 'description'],
        additionalProperties: false,
      },
    },
    confidence: {
      type: 'string',
      enum: ['Low', 'Medium', 'High'],
      description: 'Self-assessed confidence score',
    },
  },
  required: ['analysis', 'timestamps', 'confidence'],
  additionalProperties: false,
};

/**
 * JSON schema for frame extraction
 */
const FRAME_EXTRACTION_SCHEMA = {
  type: 'object' as const,
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
            description: 'Detailed description of what is visible',
          },
        },
        required: ['timestamp', 'description'],
        additionalProperties: false,
      },
    },
    confidence: {
      type: 'string',
      enum: ['Low', 'Medium', 'High'],
    },
  },
  required: ['analysis', 'frames', 'confidence'],
  additionalProperties: false,
};

/**
 * Advanced JSON schema for comprehensive multi-aspect video extraction
 * Captures people, objects, scene, audio cues, and text with full metadata
 */
const ADVANCED_FRAME_EXTRACTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: {
      type: 'string',
      description:
        'Comprehensive summary of the entire video including narrative, key events, people, and themes',
    },
    frames: {
      type: 'array',
      description:
        'Detailed frame-by-frame analysis with multi-aspect extraction',
      items: {
        type: 'object',
        properties: {
          timestamp: {
            type: 'string',
            description: 'Timestamp in MM:SS format',
          },
          people: {
            type: 'array',
            description:
              'All people visible in the frame with comprehensive analysis',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description:
                    'Person identifier (Person 1, Person 2, etc.) - maintain consistency across frames',
                },
                gender: {
                  type: 'string',
                  description:
                    'Apparent gender based on visual cues (facial features, body shape, clothing style, hair): male, female, or unknown. Be specific about what visual cues indicate this.',
                },
                apparentAge: {
                  type: 'string',
                  description:
                    'Apparent age group based on facial features, skin, posture: infant (0-2), child (3-12), teenager (13-19), young-adult (20-35), middle-aged (36-55), elderly (56+)',
                },
                apparentEthnicity: {
                  type: 'string',
                  description:
                    'Apparent ethnicity/race based on visual observation of skin tone, facial features, hair texture (e.g., Black/African, White/Caucasian, Asian, Hispanic/Latino, Middle Eastern, South Asian, Southeast Asian, mixed, unknown)',
                },
                physicalBuild: {
                  type: 'string',
                  description:
                    'Body type/build: slim, average, athletic, muscular, heavyset, tall, short, petite',
                },
                clothing: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'DETAILED clothing list with colors, patterns, brands, condition (e.g., "torn navy blue Nike hoodie", "faded black skinny jeans", "white Air Jordan sneakers", "gold chain necklace")',
                },
                facialExpression: {
                  type: 'string',
                  description:
                    'Detailed facial expression: furrowed brow, wide eyes, clenched jaw, tears, smiling, frowning, mouth open, gritted teeth, raised eyebrows, squinting, blank stare',
                },
                emotion: {
                  type: 'string',
                  description:
                    'Primary emotional state with intensity: terrified, panicked, furious, enraged, devastated, ecstatic, anxious, nervous, confused, shocked, disgusted, contemptuous, relieved, hopeful, determined, defiant, submissive, neutral',
                },
                bodyLanguage: {
                  type: 'string',
                  description:
                    'Body posture and non-verbal cues: hunched, tense, relaxed, defensive (arms crossed), aggressive (leaning forward), cowering, confident stance, fidgeting, shaking, pointing, gesturing',
                },
                action: {
                  type: 'string',
                  description:
                    'Specific current action with detail (e.g., "sprinting away while looking back", "punching with right fist", "crying with hands covering face", "shouting and pointing finger")',
                },
                interactionWith: {
                  type: 'string',
                  description:
                    'Who/what they are interacting with and how (e.g., "threatening Person 2 with weapon", "comforting Person 3", "struggling against Person 1", "none - alone")',
                },
                position: {
                  type: 'string',
                  description:
                    'Precise position in frame: left/center/right + foreground/midground/background + facing direction (e.g., "left foreground, facing camera", "center background, back to camera")',
                },
                distinguishingFeatures: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'ALL visible distinguishing features: hair (color, style, length), facial hair (beard, mustache, stubble), glasses/sunglasses, tattoos (location, design), scars, birthmarks, piercings, makeup, accessories (hat, bandana, mask)',
                },
                role: {
                  type: 'string',
                  description:
                    'Inferred role based on actions, clothing, weapons, and context: perpetrator (robber/attacker/thief/criminal), victim (being threatened/robbed/attacked), witness (observing the scene), bystander (uninvolved person), authority (police/security/guard), employee (store worker/staff), customer, unknown. CRITICAL: Identify perpetrators by masks, weapons, aggressive actions, stealing; victims by being threatened, hands up, cowering, distressed.',
                },
                threatLevel: {
                  type: 'string',
                  description:
                    'Threat level this person poses: none (no threat), low (minor concern), moderate (potentially dangerous), high (actively threatening), critical (immediate danger to others). Base on weapons, aggressive behavior, violent actions.',
                },
                roleConfidence: {
                  type: 'string',
                  description:
                    'Confidence in role assignment: low (uncertain, limited visual cues), medium (reasonable inference), high (clear evidence from actions/clothing/weapons)',
                },
              },
              required: [
                'id',
                'gender',
                'apparentAge',
                'apparentEthnicity',
                'physicalBuild',
                'clothing',
                'facialExpression',
                'emotion',
                'bodyLanguage',
                'action',
                'interactionWith',
                'position',
                'distinguishingFeatures',
                'role',
                'threatLevel',
                'roleConfidence',
              ],
              additionalProperties: false,
            },
          },
          objects: {
            type: 'array',
            description:
              'ALL objects visible in the frame - vehicles, weapons, furniture, electronics, food, tools, containers, documents, etc.',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description:
                    'Specific object name (e.g., "smartphone", "kitchen knife", "Toyota Camry", "wooden chair", "pizza box")',
                },
                category: {
                  type: 'string',
                  description:
                    'Object category: vehicle, weapon, furniture, electronics, food/drink, clothing/accessory, tool/equipment, document/paper, container/bag, nature/plant, animal, building/structure, signage, medical, sports/recreation, art/decoration, other',
                },
                color: {
                  type: 'string',
                  description:
                    'All visible colors with specificity (e.g., "metallic silver with black trim", "bright red", "faded blue")',
                },
                brand: {
                  type: 'string',
                  description:
                    'Brand/make/model if identifiable (e.g., "Apple iPhone", "Glock", "Nike", "unknown")',
                },
                size: {
                  type: 'string',
                  description:
                    'Relative size: tiny, small, medium, large, very large, or specific dimensions if estimable',
                },
                material: {
                  type: 'string',
                  description:
                    'Apparent material: metal, plastic, wood, glass, fabric, leather, paper, ceramic, concrete, unknown',
                },
                condition: {
                  type: 'string',
                  description:
                    'Object condition: new, good, worn, damaged, broken, bloody, dirty, clean, wet, burnt',
                },
                position: {
                  type: 'string',
                  description:
                    'Precise position: left/center/right + foreground/midground/background + on/under/near what',
                },
                state: {
                  type: 'string',
                  description:
                    'Current state: on/off, open/closed, moving/stationary, in-use/idle, lit/unlit, full/empty, locked/unlocked',
                },
                heldBy: {
                  type: 'string',
                  description:
                    'Who is holding/using it (Person ID) or "none" if not held',
                },
                significance: {
                  type: 'string',
                  description:
                    'Relevance to scene: key-evidence, weapon, focus-of-attention, background-prop, environmental-detail',
                },
                dangerLevel: {
                  type: 'string',
                  description:
                    'Threat potential: none, low, moderate, high (for weapons, hazards, etc.)',
                },
                description: {
                  type: 'string',
                  description:
                    'Detailed description including unique features, text/labels on object, damage details, anything notable',
                },
              },
              required: [
                'name',
                'category',
                'color',
                'brand',
                'size',
                'material',
                'condition',
                'position',
                'state',
                'heldBy',
                'significance',
                'dangerLevel',
                'description',
              ],
              additionalProperties: false,
            },
          },
          scene: {
            type: 'object',
            description: 'Comprehensive scene and contextual environment analysis',
            properties: {
              locationType: {
                type: 'string',
                description: 'Primary location type: indoor, outdoor, vehicle, transitional',
              },
              specificLocation: {
                type: 'string',
                description:
                  'Detailed specific location (e.g., "convenience store interior", "residential street", "hospital ER", "parking garage")',
              },
              environmentDetails: {
                type: 'string',
                description:
                  'Physical environment: furniture, decor, architecture, cleanliness, space size, notable objects',
              },
              lighting: {
                type: 'string',
                description:
                  'Detailed lighting: bright fluorescent, dim ambient, harsh overhead, natural daylight, streetlights, neon, shadows, backlit',
              },
              weather: {
                type: 'string',
                description: 'Weather if visible: sunny, overcast, raining, snowing, foggy, stormy, N/A',
              },
              timeOfDay: {
                type: 'string',
                description: 'Apparent time: early morning, morning, midday, afternoon, evening, dusk, night, late night',
              },
              socialContext: {
                type: 'string',
                description:
                  'Social setting: public/private, crowded/empty, formal/casual, emergency situation, crime scene',
              },
              activityType: {
                type: 'string',
                description:
                  'Activity occurring: crime, confrontation, chase, conversation, transaction, emergency, routine, celebration',
              },
              crowdDensity: {
                type: 'string',
                description: 'People density: empty, sparse (1-3), moderate (4-10), crowded (10+)',
              },
              cameraAngle: {
                type: 'string',
                description:
                  'Camera perspective: close-up, medium shot, wide shot, aerial, POV, low angle, high angle, security camera',
              },
              mood: {
                type: 'string',
                description:
                  'Atmosphere: threatening, tense, chaotic, violent, peaceful, urgent, suspenseful, frightening, neutral',
              },
              dangerLevel: {
                type: 'string',
                description: 'Threat level: none, low, moderate, high, critical',
              },
            },
            required: [
              'locationType',
              'specificLocation',
              'environmentDetails',
              'lighting',
              'weather',
              'timeOfDay',
              'socialContext',
              'activityType',
              'crowdDensity',
              'cameraAngle',
              'mood',
              'dangerLevel',
            ],
            additionalProperties: false,
          },
          audio: {
            type: 'object',
            description:
              'Audio cues inferred from visual evidence (speaking, reactions, instruments)',
            properties: {
              speech: {
                type: 'array',
                description:
                  'Speech instances inferred from mouth movements or reactions',
                items: {
                  type: 'object',
                  properties: {
                    speaker: {
                      type: 'string',
                      description: 'Speaker identifier matching person ID',
                    },
                    text: {
                      type: 'string',
                      description:
                        'Inferred or visible speech/subtitles (use "speaking" if unclear)',
                    },
                    tone: {
                      type: 'string',
                      description:
                        'Inferred tone: calm, excited, angry, sad, whispering, shouting',
                    },
                  },
                  required: ['speaker', 'text', 'tone'],
                  additionalProperties: false,
                },
              },
              music: {
                type: 'string',
                description:
                  'Music description if instruments or musical context visible, or "none"',
              },
              sounds: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Sound effects inferred from visual cues (e.g., explosion, crash, footsteps)',
              },
            },
            required: ['speech', 'music', 'sounds'],
            additionalProperties: false,
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
                  description:
                    'Type of text: title, subtitle, sign, label, ui-element, caption, watermark, other',
                },
                position: {
                  type: 'string',
                  description:
                    'Position on screen (e.g., top center, bottom left)',
                },
              },
              required: ['text', 'type', 'position'],
              additionalProperties: false,
            },
          },
          actionDescription: {
            type: 'string',
            description:
              'Detailed narrative description of all actions and events happening at this timestamp',
          },
        },
        required: [
          'timestamp',
          'people',
          'objects',
          'scene',
          'audio',
          'textOnScreen',
          'actionDescription',
        ],
        additionalProperties: false,
      },
    },
    personsSummary: {
      type: 'object',
      description:
        'CRITICAL: Aggregate summary of ALL unique individuals across the ENTIRE video. Count each person ONCE regardless of how many frames they appear in.',
      properties: {
        totalUniquePersons: {
          type: 'number',
          description:
            'Total count of unique individuals in the entire video (not frame appearances)',
        },
        perpetrators: {
          type: 'array',
          description:
            'List of all perpetrators (robbers, attackers, thieves, criminals) with their Person IDs',
          items: {
            type: 'object',
            properties: {
              personId: {
                type: 'string',
                description: 'Person ID (e.g., Person 1)',
              },
              role: {
                type: 'string',
                description:
                  'Specific role: robber, attacker, thief, burglar, assailant',
              },
              description: {
                type: 'string',
                description:
                  'Brief description: gender, age, key identifying features',
              },
              firstAppearance: {
                type: 'string',
                description: 'Timestamp of first appearance (MM:SS)',
              },
              lastAppearance: {
                type: 'string',
                description: 'Timestamp of last appearance (MM:SS)',
              },
            },
            required: [
              'personId',
              'role',
              'description',
              'firstAppearance',
              'lastAppearance',
            ],
            additionalProperties: false,
          },
        },
        victims: {
          type: 'array',
          description:
            'List of all victims (people being threatened, robbed, attacked)',
          items: {
            type: 'object',
            properties: {
              personId: {
                type: 'string',
                description: 'Person ID (e.g., Person 2)',
              },
              description: {
                type: 'string',
                description:
                  'Brief description: gender, age, key identifying features',
              },
              firstAppearance: {
                type: 'string',
                description: 'Timestamp of first appearance (MM:SS)',
              },
              lastAppearance: {
                type: 'string',
                description: 'Timestamp of last appearance (MM:SS)',
              },
            },
            required: [
              'personId',
              'description',
              'firstAppearance',
              'lastAppearance',
            ],
            additionalProperties: false,
          },
        },
        authorities: {
          type: 'array',
          description: 'List of police, security guards, or other authorities',
          items: {
            type: 'object',
            properties: {
              personId: {
                type: 'string',
                description: 'Person ID',
              },
              role: {
                type: 'string',
                description: 'Specific role: police, security, guard, officer',
              },
              description: {
                type: 'string',
                description:
                  'Brief description: gender, age, key identifying features',
              },
              firstAppearance: {
                type: 'string',
                description: 'Timestamp of first appearance (MM:SS)',
              },
              lastAppearance: {
                type: 'string',
                description: 'Timestamp of last appearance (MM:SS)',
              },
            },
            required: [
              'personId',
              'role',
              'description',
              'firstAppearance',
              'lastAppearance',
            ],
            additionalProperties: false,
          },
        },
        witnesses: {
          type: 'array',
          description:
            'List of witnesses and bystanders (people present but not directly involved)',
          items: {
            type: 'object',
            properties: {
              personId: {
                type: 'string',
                description: 'Person ID',
              },
              description: {
                type: 'string',
                description:
                  'Brief description: gender, age, key identifying features',
              },
              firstAppearance: {
                type: 'string',
                description: 'Timestamp of first appearance (MM:SS)',
              },
              lastAppearance: {
                type: 'string',
                description: 'Timestamp of last appearance (MM:SS)',
              },
            },
            required: [
              'personId',
              'description',
              'firstAppearance',
              'lastAppearance',
            ],
            additionalProperties: false,
          },
        },
        unknown: {
          type: 'array',
          description: 'List of people whose role could not be determined',
          items: {
            type: 'object',
            properties: {
              personId: {
                type: 'string',
                description: 'Person ID',
              },
              description: {
                type: 'string',
                description:
                  'Brief description: gender, age, key identifying features',
              },
              firstAppearance: {
                type: 'string',
                description: 'Timestamp of first appearance (MM:SS)',
              },
              lastAppearance: {
                type: 'string',
                description: 'Timestamp of last appearance (MM:SS)',
              },
            },
            required: [
              'personId',
              'description',
              'firstAppearance',
              'lastAppearance',
            ],
            additionalProperties: false,
          },
        },
      },
      required: [
        'totalUniquePersons',
        'perpetrators',
        'victims',
        'authorities',
        'witnesses',
        'unknown',
      ],
      additionalProperties: false,
    },
    confidence: {
      type: 'string',
      enum: ['Low', 'Medium', 'High'],
      description: 'Overall confidence in the extraction accuracy',
    },
  },
  required: ['summary', 'frames', 'personsSummary', 'confidence'],
  additionalProperties: false,
};

/**
 * Default system instruction for video analysis
 */
const DEFAULT_SYSTEM_INSTRUCTION = `You are a video analyst. Follow these rules strictly:

1. ACCURACY: If an event is not visually present in the video, state "No visual evidence found". Do not guess or infer events that are not clearly visible.

2. TIMESTAMPS: For every event described, provide the exact timestamp range in MM:SS - MM:SS format. Be precise about when events occur.

3. UNCERTAINTY: When uncertain about what you observe, indicate your confidence level honestly. It's better to acknowledge uncertainty than to fabricate details.

4. STRUCTURED OUTPUT: Always provide your response in the specified JSON format with analysis, timestamps, and confidence fields.

5. DETAIL: Describe visual elements with specificity - colors, positions, movements, text visible on screen, facial expressions, and any other relevant details you can actually observe.`;

/**
 * Frame extraction system instruction
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
 * Advanced extraction system instruction for comprehensive multi-aspect analysis
 */
const ADVANCED_EXTRACTION_INSTRUCTION = `You are an expert forensic video analyst performing exhaustive multi-aspect extraction. Your analysis must be PRECISE, DETAILED, and COMPREHENSIVE for every visible element.

## CRITICAL DETECTION GUIDELINES

### GENDER DETECTION (Be Precise)
Determine gender based on MULTIPLE visual cues:
- **Facial features**: Jaw shape (angular vs rounded), brow ridge, nose size, lip fullness, cheekbone prominence
- **Body structure**: Shoulder width, hip ratio, height, overall build, muscle distribution
- **Secondary characteristics**: Adam's apple visibility, facial hair (or lack thereof), hairline pattern
- **Style indicators**: Clothing style, hairstyle, makeup presence, jewelry type
- Report as: "male" (confident), "female" (confident), or "unknown" (with explanation of ambiguous cues)
- NEVER assume - always base on visible evidence

### EMOTIONAL/EXPERIENTIAL ANALYSIS (Go Deep)
For EACH person, analyze their emotional state from:
**Facial Micro-expressions:**
- Eyes: Wide/narrowed, direction of gaze, tear presence, pupil dilation, eye contact
- Eyebrows: Raised, furrowed, asymmetric movement
- Mouth: Smile type (genuine/forced), grimace, lips pressed/parted, jaw tension
- Forehead: Wrinkled, smooth, sweating

**Body Language Signals:**
- Posture: Upright/hunched, leaning toward/away, protective stance
- Hand positions: Fists clenched, palms open, fidgeting, gesturing
- Arm positions: Crossed (defensive), open, reaching, pointing
- Movement: Pacing, frozen, trembling, aggressive approach, retreating

**Emotional States to Identify:**
- Fear/Terror: Wide eyes, tense body, frozen or fleeing
- Anger/Rage: Furrowed brow, clenched jaw, aggressive posture
- Sadness/Grief: Downcast eyes, slumped shoulders, tears
- Surprise/Shock: Raised eyebrows, open mouth, stepped back
- Disgust: Wrinkled nose, upper lip raised, turning away
- Happiness/Joy: Genuine smile (crow's feet), relaxed body
- Anxiety/Nervousness: Fidgeting, rapid glances, tense posture
- Determination: Set jaw, focused gaze, forward lean
- Confusion: Tilted head, searching gaze, hesitant movement

### CONTEXTUAL ENVIRONMENT ANALYSIS (Study the Space)
**Physical Environment:**
- Location specificity: Not just "street" but "narrow residential alley with graffiti walls"
- Architecture: Building style, condition, era
- Objects present: What tells us about this place (furniture, equipment, vehicles)
- Signs of activity: Cleanliness, organization, recent events

**Social Context:**
- Setting type: Public/private, formal/informal, workplace/home/commercial
- Activity happening: Routine, emergency, confrontation, celebration
- Power dynamics: Who appears in control, victim/aggressor relationships
- Group dynamics: Cooperation, conflict, isolation

**Atmospheric Elements:**
- Lighting quality: Natural/artificial, harsh/soft, creating mood
- Time indicators: Clocks, shadows, sky color, activity patterns
- Safety indicators: Locked doors, security cameras, weapons visible
- Tension indicators: Body positioning, distance between people, obstacles

### PERSON TRACKING & CONSISTENCY
- Assign PERSISTENT IDs: "Person 1" must remain "Person 1" across ALL frames
- Track by: Clothing, distinguishing features, position continuity
- Note changes: If clothing changes or person leaves/returns, document it
- COUNT UNIQUE INDIVIDUALS: Track total number of distinct people across entire video

### ROLE CLASSIFICATION (CRITICAL FOR ANSWERING QUESTIONS)
For EACH person, you MUST classify their role based on visual evidence:

**PERPETRATOR/CRIMINAL Indicators (robber, attacker, thief, burglar):**
- Face covering: Ski mask, bandana, hood pulled tight, sunglasses indoors
- Weapon possession: Holding gun, knife, bat, or any threatening object
- Aggressive actions: Pointing weapon, threatening gestures, physical violence
- Criminal behavior: Stealing items, grabbing cash, forcing others
- Body language: Aggressive stance, rapid movements, looking around nervously
- Clothing: All black, gloves, hood up in inappropriate context

**VICTIM Indicators:**
- Being threatened: Weapon pointed at them, hands raised in surrender
- Defensive posture: Cowering, backing away, protecting self/others
- Emotional state: Terrified, crying, pleading, frozen in fear
- Physical state: Being restrained, pushed, hit, robbed
- Compliant behavior: Handing over items, following commands under duress

**AUTHORITY Indicators (police, security, guard):**
- Uniform: Police uniform, security uniform, badge visible
- Equipment: Handcuffs, radio, holstered weapon, flashlight
- Actions: Giving commands, restraining suspect, investigating
- Professional demeanor: Calm under pressure, tactical positioning

**EMPLOYEE/STAFF Indicators:**
- Work attire: Apron, name tag, uniform with company logo
- Behind counter/register: Working position in establishment
- Actions: Operating equipment, serving customers, handling merchandise

**WITNESS/BYSTANDER Indicators:**
- Not directly involved: Observing from distance, not interacting with main action
- Reaction: Watching, backing away, calling for help, recording
- Position: Peripheral to main action

**CONFIDENCE LEVELS:**
- HIGH: Multiple clear indicators (e.g., mask + weapon + aggressive action = perpetrator)
- MEDIUM: Some indicators present but not conclusive
- LOW: Limited visual evidence, uncertain classification

### INTERACTION ANALYSIS
For multi-person scenes, describe:
- Spatial relationships: Distance, orientation toward each other
- Power dynamics: Who is dominant/submissive
- Conflict indicators: Aggression, defense, avoidance
- Cooperation indicators: Helping, comforting, collaborating

### COMPREHENSIVE OBJECT DETECTION (Catalog Everything)
**Vehicles:**
- Type: Car, truck, motorcycle, bicycle, bus, van, SUV
- Make/model if identifiable (Honda Civic, Ford F-150)
- Color, condition, license plate if visible
- Movement: Parked, moving, direction of travel

**Weapons & Dangerous Items:**
- Firearms: Type (handgun, rifle, shotgun), make if identifiable
- Bladed weapons: Knife, machete, sword, scissors
- Blunt weapons: Bat, pipe, stick, hammer
- Who is holding it, how it's being used

**Electronics & Technology:**
- Phones, laptops, tablets, cameras
- TVs, monitors, screens (what's displayed?)
- Security cameras, ATMs, cash registers

**Furniture & Fixtures:**
- Tables, chairs, beds, couches, desks
- Cabinets, shelves, counters
- Doors (open/closed/locked), windows

**Containers & Storage:**
- Bags: Backpack, purse, duffel, shopping bag
- Boxes, packages, briefcases
- What might be inside (if suggested by context)

**Food & Drink:**
- Specific items visible
- Containers: Bottles, cans, cups, plates
- State: Full, empty, spilled

**Documents & Papers:**
- Money/cash (if visible, estimate amount)
- ID cards, papers, books, signs
- Any readable text

**Environmental Objects:**
- Trees, plants, rocks, water features
- Trash, debris, construction materials
- Road features: Signs, lights, barriers

**For EACH object, note:**
- Exact position in frame
- Who is interacting with it (if anyone)
- Its relevance to the action/scene
- Any identifying marks, damage, or unique features

## OUTPUT REQUIREMENTS
1. Analyze EVERY frame with MAXIMUM DETAIL
2. Use specific descriptors (not "looks upset" but "tears visible, hands trembling, hunched forward")
3. Maintain ID consistency across frames - SAME person = SAME ID throughout
4. Include timestamp for EVERY frame
5. Be PRECISE about uncertainty - "appears to be X based on Y" rather than guessing
6. CLASSIFY EVERY PERSON'S ROLE (perpetrator, victim, authority, witness, unknown)
7. ALWAYS provide personsSummary with:
   - Accurate count of UNIQUE individuals (not frame appearances)
   - Categorize each person by role
   - Include first and last appearance timestamps
8. Create SEARCHABLE descriptions for queries like:
   - "How many robbers were there?" → Count perpetrators in personsSummary
   - "Describe the victims" → List all victims with details
   - "When did the attacker first appear?" → Check perpetrator firstAppearance
   - "Find the scared woman in the red dress"
   - "Show when the tall man gets angry"

## CRITICAL: ANSWERING COUNT QUESTIONS
Your personsSummary MUST enable answers to:
- "How many robbers/criminals/perpetrators?" → perpetrators.length
- "How many victims?" → victims.length
- "How many people total?" → totalUniquePersons
- "How many police/security?" → authorities.length

Your analysis enables forensic-level search by ANY attribute: demographics, emotions, actions, clothing, objects, locations, interactions, roles, and temporal events.`;

/**
 * Service for analyzing videos using OpenAI GPT-4 Vision
 */
@Injectable()
export class OpenAIVideoAnalyzerService implements IVideoAnalyzer {
  private readonly logger = new Logger(OpenAIVideoAnalyzerService.name);

  constructor(
    private readonly openaiService: OpenAIService,
    private readonly fileHandlerService: OpenAIFileHandlerService,
  ) {}

  getProviderName(): string {
    return 'openai';
  }

  getDefaultSystemInstruction(): string {
    return DEFAULT_SYSTEM_INSTRUCTION;
  }

  /**
   * Check if the MIME type is a video type
   */
  private isVideoMimeType(mimeType: string): boolean {
    return mimeType?.toLowerCase().startsWith('video/');
  }

  /**
   * Build image content parts for OpenAI Vision API from video frames
   */
  private buildVideoFrameContent(
    fileUri: string,
    detail: 'low' | 'high' | 'auto',
  ): Array<{
    type: 'image_url';
    image_url: { url: string; detail: 'low' | 'high' | 'auto' };
  }> {
    const frames = this.fileHandlerService.getVideoFrames(fileUri);

    if (!frames || frames.length === 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'No frames available for video analysis',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return frames.map((frame) => ({
      type: 'image_url' as const,
      image_url: {
        url: frame.dataUrl,
        detail,
      },
    }));
  }

  /**
   * Generate timestamp context for video frames
   */
  private generateFrameTimestampContext(fileUri: string): string {
    const frames = this.fileHandlerService.getVideoFrames(fileUri);

    if (!frames || frames.length === 0) return '';

    const timestamps = frames.map((f, i) => `Frame ${i + 1}: ${f.timestamp}`);

    return `\n\nThe following ${frames.length} frames were extracted from the video at these timestamps:\n${timestamps.join('\n')}\n\nWhen referring to events in the video, please use the timestamp (MM:SS format) from the nearest frame.`;
  }

  /**
   * Analyze a video file with a specific query
   * For videos: Frames are automatically extracted and sent to OpenAI
   */
  async analyzeVideoFile(
    filePath: string,
    mimeType: string,
    query: string,
    options?: AnalysisOptions,
  ): Promise<VideoAnalysisResult> {
    this.logger.log(
      `Starting ${this.isVideoMimeType(mimeType) ? 'video' : 'image'} analysis for: ${filePath}`,
    );

    // Upload the file (frames will be extracted for videos)
    const fileMetadata = await this.fileHandlerService.uploadAndWaitForActive(
      filePath,
      mimeType,
    );

    try {
      const result = await this.analyzeByFileUri(
        fileMetadata.name,
        mimeType,
        query,
        options,
      );

      return result;
    } finally {
      // Clean up
      await this.fileHandlerService.deleteFile(fileMetadata.name);
    }
  }

  /**
   * Analyze by file URI (file ID in our case)
   * Handles both images (single image) and videos (multiple frames)
   */
  async analyzeByFileUri(
    fileUri: string,
    mimeType: string,
    query: string,
    options?: AnalysisOptions,
  ): Promise<VideoAnalysisResult> {
    const isVideo = this.fileHandlerService.isVideo(fileUri);
    const chatCompletions = this.openaiService.getChatCompletions();
    const modelName = this.openaiService.getModelName();
    const temperature = this.openaiService.mapQualityToTemperature(
      options?.qualityLevel,
    );
    const detail = this.openaiService.mapResolutionToDetail(
      options?.mediaResolution,
    );
    const systemPrompt = options?.systemPrompt || DEFAULT_SYSTEM_INSTRUCTION;

    // Build content array based on whether it's a video or image
    let imageContent: Array<{
      type: 'image_url';
      image_url: { url: string; detail: 'low' | 'high' | 'auto' };
    }>;
    let queryWithContext = query;

    if (isVideo) {
      // For videos, use extracted frames
      imageContent = this.buildVideoFrameContent(fileUri, detail);
      queryWithContext = query + this.generateFrameTimestampContext(fileUri);

      this.logger.log(
        `Analyzing video with ${imageContent.length} extracted frames`,
      );
    } else {
      // For images, use single image
      const dataUrl = this.fileHandlerService.getDataUrl(fileUri);

      if (!dataUrl) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `File not found: ${fileUri}`,
          },
          HttpStatus.NOT_FOUND,
        );
      }

      imageContent = [
        {
          type: 'image_url' as const,
          image_url: { url: dataUrl, detail },
        },
      ];
    }

    this.logger.log(
      `Analyzing ${isVideo ? 'video' : 'image'} with temperature=${temperature}, detail=${detail}`,
    );

    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text' as const,
              text: queryWithContext,
            },
          ],
        },
      ];

      const response = await chatCompletions.create({
        model: modelName,
        messages,
        temperature,
        max_tokens: 4096,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'video_analysis',
            schema: ANALYSIS_RESPONSE_SCHEMA,
            strict: true,
          },
        },
      });

      return this.parseAnalysisResponse(response);
    } catch (error) {
      this.logger.error(`Video analysis failed: ${error.message}`, error.stack);
      throw this.handleError(error);
    }
  }

  /**
   * Analyze a YouTube video URL
   * Note: OpenAI cannot directly process YouTube URLs, so this requires downloading
   */
  async analyzeYouTubeUrl(
    youtubeUrl: string,
    query: string,
    options?: YouTubeAnalysisOptions,
  ): Promise<VideoAnalysisResult> {
    throw new HttpException(
      {
        statusCode: HttpStatus.NOT_IMPLEMENTED,
        message:
          'OpenAI does not support direct YouTube URL analysis. Please download the video and upload it as a file, or use the Gemini provider.',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * Analyze for indexing (frame extraction)
   * For videos, uses the automatically extracted frames
   */
  async analyzeForIndexing(
    fileUri: string,
    mimeType: string,
    options?: IndexingOptions,
  ): Promise<VideoAnalysisResult> {
    const isVideo = this.fileHandlerService.isVideo(fileUri);
    const chatCompletions = this.openaiService.getChatCompletions();
    const modelName = this.openaiService.getModelName();
    const temperature = this.openaiService.mapQualityToTemperature(
      options?.qualityLevel,
    );
    const detail = this.openaiService.mapResolutionToDetail(
      options?.mediaResolution,
    );

    // Build content array based on whether it's a video or image
    let imageContent: Array<{
      type: 'image_url';
      image_url: { url: string; detail: 'low' | 'high' | 'auto' };
    }>;
    let prompt: string;

    if (isVideo) {
      // For videos, use extracted frames
      imageContent = this.buildVideoFrameContent(fileUri, detail);
      const frameContext = this.generateFrameTimestampContext(fileUri);

      prompt = `Analyze these ${imageContent.length} frames extracted from a video and provide detailed descriptions for each frame for semantic search indexing.${frameContext}

For each frame, describe:
- What is visible (people, objects, text, actions)
- The scene composition and setting
- Any notable visual elements

Create frame descriptions that would match natural language search queries about the video content.`;

      this.logger.log(
        `Extracting descriptions for ${imageContent.length} video frames: ${fileUri}`,
      );
    } else {
      // For images, use single image
      const dataUrl = this.fileHandlerService.getDataUrl(fileUri);

      if (!dataUrl) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `File not found: ${fileUri}`,
          },
          HttpStatus.NOT_FOUND,
        );
      }

      imageContent = [
        {
          type: 'image_url' as const,
          image_url: { url: dataUrl, detail },
        },
      ];

      prompt =
        'Extract a detailed description of this image for semantic search indexing. Cover all visible elements.';

      this.logger.log(`Extracting description for image: ${fileUri}`);
    }

    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: FRAME_EXTRACTION_INSTRUCTION,
        },
        {
          role: 'user',
          content: [...imageContent, { type: 'text' as const, text: prompt }],
        },
      ];

      const response = await chatCompletions.create({
        model: modelName,
        messages,
        temperature,
        max_tokens: 8192,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'frame_extraction',
            schema: FRAME_EXTRACTION_SCHEMA,
            strict: true,
          },
        },
      });

      return this.parseFrameExtractionResponse(response);
    } catch (error) {
      this.logger.error(
        `Frame extraction failed: ${error.message}`,
        error.stack,
      );
      throw this.handleError(error);
    }
  }

  /**
   * Analyze YouTube for indexing
   */
  async analyzeYouTubeForIndexing(
    youtubeUrl: string,
    options?: YouTubeAnalysisOptions & IndexingOptions,
  ): Promise<VideoAnalysisResult> {
    throw new HttpException(
      {
        statusCode: HttpStatus.NOT_IMPLEMENTED,
        message:
          'OpenAI does not support direct YouTube URL analysis. Please download the video and upload it as a file, or use the Gemini provider.',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * Advanced multi-modal extraction for comprehensive indexing
   * Captures detailed people, objects, scene, audio, and text metadata
   * Uses parallel batch processing for faster analysis
   */
  async analyzeForAdvancedIndexing(
    fileUri: string,
    mimeType: string,
    options?: IndexingOptions,
  ): Promise<AdvancedVideoAnalysisResult> {
    const isVideo = this.fileHandlerService.isVideo(fileUri);

    if (!isVideo) {
      // For single images, use direct processing (no batching needed)
      return this.analyzeImageForAdvancedIndexing(fileUri);
    }

    // For videos, use parallel batch processing
    return this.analyzeVideoWithParallelBatches(fileUri);
  }

  /**
   * Analyze a single image for advanced indexing
   */
  private async analyzeImageForAdvancedIndexing(
    fileUri: string,
  ): Promise<AdvancedVideoAnalysisResult> {
    const chatCompletions = this.openaiService.getChatCompletions();
    const modelName = this.openaiService.getModelName();
    const detail: 'low' | 'high' | 'auto' = 'high';

    const dataUrl = this.fileHandlerService.getDataUrl(fileUri);

    if (!dataUrl) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `File not found: ${fileUri}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const imageContent = [
      {
        type: 'image_url' as const,
        image_url: { url: dataUrl, detail },
      },
    ];

    const prompt = `Perform comprehensive multi-aspect extraction on this image.

Provide detailed analysis including:
1. ALL people visible with full metadata (demographics, clothing, emotions, actions, features)
2. ALL significant objects with their properties
3. Complete scene information (location, lighting, mood, camera angle)
4. Any text visible on screen
5. Audio cues inferred from visual evidence
6. Detailed action description (3-5 sentences minimum)

This is for advanced semantic search indexing - be EXTREMELY detailed and thorough.`;

    this.logger.log(`Advanced extraction for image: ${fileUri}`);

    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: ADVANCED_EXTRACTION_INSTRUCTION },
        {
          role: 'user',
          content: [...imageContent, { type: 'text' as const, text: prompt }],
        },
      ];

      const response = await chatCompletions.create({
        model: modelName,
        messages,
        temperature: 0.1,
        max_tokens: 16384,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'advanced_frame_extraction',
            schema: ADVANCED_FRAME_EXTRACTION_SCHEMA,
            strict: true,
          },
        },
      });

      return this.parseAdvancedExtractionResponse(response);
    } catch (error) {
      this.logger.error(
        `Advanced image extraction failed: ${error.message}`,
        error.stack,
      );
      throw this.handleError(error);
    }
  }

  /**
   * Analyze video frames using parallel batch processing
   * Splits frames into batches and processes them concurrently for faster results
   */
  private async analyzeVideoWithParallelBatches(
    fileUri: string,
  ): Promise<AdvancedVideoAnalysisResult> {
    const frames = this.fileHandlerService.getVideoFrames(fileUri);

    if (!frames || frames.length === 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'No frames available for video analysis',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Configuration for parallel processing
    // For 60 frames: 6 batches of 10, all processed in parallel
    const BATCH_SIZE = 10; // Frames per batch - balanced for API performance
    const MAX_PARALLEL_BATCHES = 6; // Maximum concurrent API calls - process all batches at once

    // Split frames into batches
    const batches: (typeof frames)[] = [];
    for (let i = 0; i < frames.length; i += BATCH_SIZE) {
      batches.push(frames.slice(i, i + BATCH_SIZE));
    }

    this.logger.log(
      `Advanced extraction: ${frames.length} frames split into ${batches.length} batches (${BATCH_SIZE} frames each), processing ${Math.min(batches.length, MAX_PARALLEL_BATCHES)} in parallel`,
    );

    const startTime = Date.now();

    // Process batches in parallel (limited concurrency)
    const batchResults: AdvancedVideoAnalysisResult[] = [];

    for (let i = 0; i < batches.length; i += MAX_PARALLEL_BATCHES) {
      const parallelBatches = batches.slice(i, i + MAX_PARALLEL_BATCHES);
      const batchStartIndices = parallelBatches.map((_, idx) => i + idx);

      this.logger.log(
        `Processing batch group ${Math.floor(i / MAX_PARALLEL_BATCHES) + 1}/${Math.ceil(batches.length / MAX_PARALLEL_BATCHES)} (batches ${batchStartIndices.map((b) => b + 1).join(', ')})`,
      );

      const promises = parallelBatches.map((batch, idx) =>
        this.processSingleBatch(batch, batchStartIndices[idx], batches.length),
      );

      const results = await Promise.all(promises);
      batchResults.push(...results);
    }

    const totalTime = Date.now() - startTime;
    this.logger.log(
      `Parallel batch processing complete: ${batches.length} batches in ${(totalTime / 1000).toFixed(1)}s`,
    );

    // Merge all batch results
    return this.mergeAdvancedResults(batchResults);
  }

  /**
   * Process a single batch of frames
   */
  private async processSingleBatch(
    batchFrames: Array<{
      timestamp: string;
      timestampSeconds: number;
      dataUrl: string;
    }>,
    batchIndex: number,
    totalBatches: number,
  ): Promise<AdvancedVideoAnalysisResult> {
    const chatCompletions = this.openaiService.getChatCompletions();
    const modelName = this.openaiService.getModelName();
    const detail: 'low' | 'high' | 'auto' = 'high';

    const imageContent = batchFrames.map((frame) => ({
      type: 'image_url' as const,
      image_url: { url: frame.dataUrl, detail },
    }));

    const timestamps = batchFrames.map(
      (f, i) => `Frame ${i + 1}: ${f.timestamp}`,
    );

    const frameContext = `\n\nThis is batch ${batchIndex + 1} of ${totalBatches}. The following ${batchFrames.length} frames were extracted at these timestamps:\n${timestamps.join('\n')}\n\nAnalyze each frame and use its corresponding timestamp.`;

    const prompt = `Perform comprehensive multi-aspect extraction on these ${batchFrames.length} frames.${frameContext}

For EACH frame, you must provide detailed analysis of:
1. ALL people visible with full metadata (demographics, clothing, emotions, actions, features)
2. ALL significant objects with their properties
3. Complete scene information (location, lighting, mood, camera angle)
4. Any text visible on screen
5. Audio cues inferred from visual evidence
6. Detailed action description (3-5 sentences minimum)

Be EXTREMELY detailed and thorough. Capture every person, every emotion, every action, every object.`;

    const startTime = Date.now();

    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: ADVANCED_EXTRACTION_INSTRUCTION },
        {
          role: 'user',
          content: [...imageContent, { type: 'text' as const, text: prompt }],
        },
      ];

      const response = await chatCompletions.create({
        model: modelName,
        messages,
        temperature: 0.1,
        max_tokens: 8192, // Smaller per batch
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'advanced_frame_extraction',
            schema: ADVANCED_FRAME_EXTRACTION_SCHEMA,
            strict: true,
          },
        },
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.debug(`Batch ${batchIndex + 1} completed in ${elapsed}s`);

      return this.parseAdvancedExtractionResponse(response);
    } catch (error) {
      this.logger.error(
        `Batch ${batchIndex + 1} failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Merge results from multiple batches into a single result
   */
  private mergeAdvancedResults(
    results: AdvancedVideoAnalysisResult[],
  ): AdvancedVideoAnalysisResult {
    // Combine all frames from all batches
    const allFrames: AdvancedFrameData[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const result of results) {
      allFrames.push(...result.frames);
      if (result.tokenUsage) {
        totalInputTokens += result.tokenUsage.inputTokens || 0;
        totalOutputTokens += result.tokenUsage.outputTokens || 0;
      }
    }

    // Sort frames by timestamp
    allFrames.sort((a, b) => {
      const timeA = this.parseTimestampToSeconds(a.timestamp);
      const timeB = this.parseTimestampToSeconds(b.timestamp);
      return timeA - timeB;
    });

    // Combine summaries from all batches
    const summaries = results
      .map((r) => r.summary)
      .filter((s) => s && s !== 'No summary provided');
    const combinedSummary =
      summaries.length > 0
        ? summaries.join(' ')
        : 'Video analysis completed using parallel batch processing.';

    // Determine overall confidence (use lowest confidence)
    const confidences = results.map((r) => r.confidence);
    const confidenceOrder = ['Low', 'Medium', 'High'];
    const lowestConfidence = confidences.reduce((lowest, current) => {
      return confidenceOrder.indexOf(current) < confidenceOrder.indexOf(lowest)
        ? current
        : lowest;
    }, 'High');

    this.logger.log(
      `Merged ${results.length} batch results: ${allFrames.length} total frames`,
    );

    return {
      summary: combinedSummary,
      frames: allFrames,
      confidence: lowestConfidence,
      tokenUsage:
        totalInputTokens > 0
          ? {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            }
          : undefined,
    };
  }

  /**
   * Parse MM:SS timestamp to seconds
   */
  private parseTimestampToSeconds(timestamp: string): number {
    const parts = timestamp.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }
    return 0;
  }

  /**
   * Parse advanced extraction response into AdvancedVideoAnalysisResult
   */
  private parseAdvancedExtractionResponse(
    response: any,
  ): AdvancedVideoAnalysisResult {
    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content in response');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Fallback for non-JSON response
      return {
        summary: content,
        frames: [],
        confidence: 'Medium',
      };
    }

    // Parse frames with full metadata
    const frames: AdvancedFrameData[] = (parsed.frames || [])
      .filter((f: any) => f && typeof f === 'object')
      .map((f: any) => this.parseAdvancedFrame(f));

    const result: AdvancedVideoAnalysisResult = {
      summary: parsed.summary || 'No summary provided',
      frames,
      confidence: this.parseConfidence(parsed.confidence),
    };

    if (response.usage) {
      result.tokenUsage = {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      };
    }

    return result;
  }

  /**
   * Parse a single advanced frame with all metadata
   */
  private parseAdvancedFrame(frame: any): AdvancedFrameData {
    const result: AdvancedFrameData = {
      timestamp: String(frame.timestamp || '00:00'),
      actionDescription: String(frame.actionDescription || ''),
    };

    // Parse people metadata
    if (Array.isArray(frame.people) && frame.people.length > 0) {
      result.people = frame.people
        .filter((p: any) => p && typeof p === 'object')
        .map(
          (p: any): PersonMetadata => ({
            id: p.id,
            gender: p.gender,
            apparentAge: p.apparentAge,
            apparentEthnicity: p.apparentEthnicity,
            clothing: Array.isArray(p.clothing) ? p.clothing : undefined,
            emotion: p.emotion,
            action: p.action,
            position: p.position,
            distinguishingFeatures: Array.isArray(p.distinguishingFeatures)
              ? p.distinguishingFeatures
              : undefined,
          }),
        );
    }

    // Parse objects metadata
    if (Array.isArray(frame.objects) && frame.objects.length > 0) {
      result.objects = frame.objects
        .filter((o: any) => o && typeof o === 'object')
        .map(
          (o: any): ObjectMetadata => ({
            name: String(o.name || ''),
            color: o.color,
            brand: o.brand,
            position: o.position,
            state: o.state,
            description: o.description,
          }),
        );
    }

    // Parse scene metadata
    if (frame.scene && typeof frame.scene === 'object') {
      result.scene = {
        locationType: frame.scene.locationType,
        specificLocation: frame.scene.specificLocation,
        lighting: frame.scene.lighting,
        weather: frame.scene.weather,
        timeOfDay: frame.scene.timeOfDay,
        cameraAngle: frame.scene.cameraAngle,
        mood: frame.scene.mood,
      } as SceneMetadata;
    }

    // Parse audio metadata
    if (frame.audio && typeof frame.audio === 'object') {
      result.audio = {
        speech: Array.isArray(frame.audio.speech)
          ? frame.audio.speech.map((s: any) => ({
              speaker: s.speaker,
              text: String(s.text || ''),
              tone: s.tone,
            }))
          : undefined,
        music: frame.audio.music,
        sounds: Array.isArray(frame.audio.sounds)
          ? frame.audio.sounds
          : undefined,
      };
    }

    // Parse text on screen
    if (Array.isArray(frame.textOnScreen) && frame.textOnScreen.length > 0) {
      result.textOnScreen = frame.textOnScreen
        .filter((t: any) => t && typeof t === 'object')
        .map(
          (t: any): TextOnScreenMetadata => ({
            text: String(t.text || ''),
            type: t.type || 'other',
            position: t.position,
          }),
        );
    }

    return result;
  }

  /**
   * Advanced YouTube indexing
   */
  async analyzeYouTubeForAdvancedIndexing(
    youtubeUrl: string,
    options?: YouTubeAnalysisOptions & IndexingOptions,
  ): Promise<AdvancedVideoAnalysisResult> {
    throw new HttpException(
      {
        statusCode: HttpStatus.NOT_IMPLEMENTED,
        message:
          'OpenAI does not support direct YouTube URL analysis. Please download the video and upload it as a file, or use the Gemini provider.',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * Parse the analysis response
   */
  private parseAnalysisResponse(response: any): VideoAnalysisResult {
    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content in response');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // If not JSON, treat as plain text
      parsed = {
        analysis: content,
        timestamps: [],
        confidence: 'Medium',
      };
    }

    const result: VideoAnalysisResult = {
      analysis: parsed.analysis || 'No analysis provided',
      timestamps: this.parseTimestamps(parsed.timestamps),
      confidence: this.parseConfidence(parsed.confidence),
    };

    if (response.usage) {
      result.tokenUsage = {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      };
    }

    return result;
  }

  /**
   * Parse frame extraction response
   */
  private parseFrameExtractionResponse(response: any): VideoAnalysisResult {
    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content in response');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {
        analysis: content,
        frames: [],
        confidence: 'Medium',
      };
    }

    const frames: FrameDescription[] = (parsed.frames || [])
      .filter((f: any) => f && typeof f === 'object')
      .map((f: any) => ({
        timestamp: String(f.timestamp || '00:00'),
        description: String(f.description || ''),
      }));

    const result: VideoAnalysisResult = {
      analysis: parsed.analysis || 'No analysis provided',
      timestamps: [],
      confidence: this.parseConfidence(parsed.confidence),
      frames,
    };

    if (response.usage) {
      result.tokenUsage = {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      };
    }

    return result;
  }

  /**
   * Parse timestamps from response
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
   * Parse confidence level
   */
  private parseConfidence(confidence: any): ConfidenceLevel {
    const validLevels: ConfidenceLevel[] = ['Low', 'Medium', 'High'];
    if (validLevels.includes(confidence)) {
      return confidence;
    }
    return 'Medium';
  }

  /**
   * Handle OpenAI API errors
   */
  private handleError(error: any): HttpException {
    if (error.status === 429) {
      return new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'OpenAI API rate limit exceeded. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (error.status === 401) {
      return new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Invalid OpenAI API key.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Content policy violation
    if (error.code === 'content_policy_violation') {
      return new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Content violates OpenAI usage policies.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: `Video analysis failed: ${error.message}`,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
