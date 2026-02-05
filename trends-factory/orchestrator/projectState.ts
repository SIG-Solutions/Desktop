import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ============================================================================
// CORE TYPE DEFINITIONS - NON-NEGOTIABLE
// ============================================================================

export const StageSchema = z.enum([
  "INIT",
  "SCRIPTED",
  "VISUALIZED",
  "VIDEO_GENERATED",
  "ASSEMBLED",
]);

export type Stage = z.infer<typeof StageSchema>;

// ============================================================================
// TREND ANALYSIS SCHEMA (ENFORCED RESEARCH STRUCTURE)
// ============================================================================

export const PatternAnalysisSchema = z.object({
  formatPatterns: z.array(z.string()).min(1),
  behaviorPatterns: z.array(z.string()).min(1),
  algorithmicIncentives: z.array(z.string()).min(1),
  lifecycleMapping: z.array(z.string()).min(1),
});

export type PatternAnalysis = z.infer<typeof PatternAnalysisSchema>;

export const TrendSchema = z.object({
  name: z.string().min(1),
  promise: z.string().min(1),
  behaviorPattern: z.string().min(1),
  algorithmicHook: z.string().min(1), // NEW: What makes this spread
  collapsePoint: z.string().min(1),
});

export type Trend = z.infer<typeof TrendSchema>;

// Quality metrics for trend rejection gate
export const TrendQualitySchema = z.object({
  plausibilityScore: z.number().min(0).max(10),
  cloneabilityScore: z.number().min(0).max(10),
  lifecycleCompletenessScore: z.number().min(0).max(10),
  overallScore: z.number().min(0).max(10),
  passesThreshold: z.boolean(),
  rejectionReason: z.string().nullable(),
});

export type TrendQuality = z.infer<typeof TrendQualitySchema>;

// ============================================================================
// CONTINUITY CONSTRAINTS SCHEMA
// ============================================================================

export const ContinuityConstraintsSchema = z.object({
  lighting: z.string().min(1), // e.g., "soft key, camera-left, low contrast"
  cameraAxis: z.string().min(1), // e.g., "locked, eye-level"
  motionEnergy: z.string().min(1), // e.g., "moderate, no acceleration"
  colorPalette: z.string().min(1), // e.g., "warm neutrals, desaturated"
  environmentType: z.string().min(1), // e.g., "modern apartment interior"
});

export type ContinuityConstraints = z.infer<typeof ContinuityConstraintsSchema>;

// ============================================================================
// SCENE SCHEMA
// ============================================================================

export const SceneSchema = z.object({
  sceneId: z.string().min(1),
  intent: z.string().min(1),
  absurdityLevel: z.number().min(1).max(10),
  visualPrompt: z.string().optional(),
  continuityConstraints: ContinuityConstraintsSchema.optional(),
  conceptImagePath: z.string().optional(),
  videoClipPath: z.string().optional(),
  continuityFramePath: z.string().optional(),
});

export type Scene = z.infer<typeof SceneSchema>;

// ============================================================================
// PROJECT STATE SCHEMA
// ============================================================================

export const ProjectStateSchema = z.object({
  // Identity
  projectId: z.string().min(1),
  runId: z.string().min(1), // NEW: Unique run identifier
  seed: z.number().int(), // NEW: Seed for determinism

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // Stage
  stage: StageSchema,

  // Content (only modified by specific stages)
  patternAnalysis: PatternAnalysisSchema.nullable(), // NEW: Research backing
  trend: TrendSchema.nullable(),
  trendQuality: TrendQualitySchema.nullable(), // NEW: Quality gate result
  scenes: z.array(SceneSchema),
  globalContinuity: ContinuityConstraintsSchema.nullable(), // NEW: Global constraints

  // Meta
  error: z.string().nullable().optional(),
  regenerationCount: z.number().int().default(0), // NEW: Track rejections
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;

// ============================================================================
// AGENT DELTA TYPES - AGENTS RETURN THESE, NOT FULL STATE
// ============================================================================

export type TrendSynthesizerDelta = {
  patternAnalysis: PatternAnalysis;
  trend: Trend;
};

export type TrendQualityDelta = {
  trendQuality: TrendQuality;
};

export type EscalationPlannerDelta = {
  scenes: Scene[];
  globalContinuity: ContinuityConstraints;
};

export type VisualLockerDelta = {
  sceneId: string;
  visualPrompt: string;
  continuityConstraints: ContinuityConstraints;
  conceptImagePath: string;
};

export type VideoGeneratorDelta = {
  sceneId: string;
  videoClipPath: string;
  continuityFramePath?: string;
};

// Union type for all deltas
export type AgentDelta =
  | { type: "TREND_SYNTHESIZED"; payload: TrendSynthesizerDelta }
  | { type: "TREND_QUALITY_ASSESSED"; payload: TrendQualityDelta }
  | { type: "ESCALATION_PLANNED"; payload: EscalationPlannerDelta }
  | { type: "SCENE_VISUALIZED"; payload: VisualLockerDelta }
  | { type: "SCENE_VIDEO_GENERATED"; payload: VideoGeneratorDelta };

// ============================================================================
// STATE FILE MANAGEMENT
// ============================================================================

const STATE_FILE = "project.state.json";

export function getStateFilePath(baseDir: string = process.cwd()): string {
  return path.join(baseDir, STATE_FILE);
}

export function generateSeed(): number {
  return crypto.randomInt(0, 2147483647);
}

export function generateRunId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function createInitialState(seed?: number): ProjectState {
  const now = new Date().toISOString();
  const actualSeed = seed ?? generateSeed();

  return {
    projectId: `trends_${Date.now()}`,
    runId: generateRunId(),
    seed: actualSeed,
    createdAt: now,
    updatedAt: now,
    stage: "INIT",
    patternAnalysis: null,
    trend: null,
    trendQuality: null,
    scenes: [],
    globalContinuity: null,
    error: null,
    regenerationCount: 0,
  };
}

export function loadState(baseDir: string = process.cwd()): ProjectState {
  const statePath = getStateFilePath(baseDir);

  if (!fs.existsSync(statePath)) {
    const initialState = createInitialState();
    saveState(initialState, baseDir);
    return initialState;
  }

  const raw = fs.readFileSync(statePath, "utf-8");
  const parsed = JSON.parse(raw);

  const result = ProjectStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid state file: ${JSON.stringify(result.error.issues, null, 2)}`
    );
  }

  return result.data;
}

export function saveState(
  state: ProjectState,
  baseDir: string = process.cwd()
): void {
  // Validate before saving - never save invalid state
  const result = ProjectStateSchema.safeParse(state);
  if (!result.success) {
    throw new Error(
      `Attempted to save invalid state: ${JSON.stringify(result.error.issues, null, 2)}`
    );
  }

  const statePath = getStateFilePath(baseDir);
  const updatedState: ProjectState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(statePath, JSON.stringify(updatedState, null, 2), "utf-8");
}

export function resetState(baseDir: string = process.cwd(), seed?: number): ProjectState {
  const initialState = createInitialState(seed);
  saveState(initialState, baseDir);
  return initialState;
}

// ============================================================================
// STAGE TRANSITION RULES
// ============================================================================

const VALID_TRANSITIONS: Record<Stage, Stage[]> = {
  INIT: ["SCRIPTED"],
  SCRIPTED: ["VISUALIZED"],
  VISUALIZED: ["VIDEO_GENERATED"],
  VIDEO_GENERATED: ["ASSEMBLED"],
  ASSEMBLED: [], // Terminal state
};

export function canTransition(from: Stage, to: Stage): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: Stage, to: Stage): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid stage transition: ${from} -> ${to}. Valid transitions from ${from}: [${VALID_TRANSITIONS[from].join(", ")}]`
    );
  }
}

// ============================================================================
// DELTA APPLICATION - ONLY WAY TO MODIFY STATE
// ============================================================================

/**
 * Apply an agent delta to the current state
 * This is the ONLY way agents can modify state
 * Agents return deltas, orchestrator applies them
 */
export function applyDelta(
  state: ProjectState,
  delta: AgentDelta,
  baseDir: string = process.cwd()
): ProjectState {
  let newState: ProjectState;

  switch (delta.type) {
    case "TREND_SYNTHESIZED":
      if (state.stage !== "INIT") {
        throw new Error(`Cannot apply TREND_SYNTHESIZED in stage ${state.stage}`);
      }
      newState = {
        ...state,
        patternAnalysis: delta.payload.patternAnalysis,
        trend: delta.payload.trend,
      };
      break;

    case "TREND_QUALITY_ASSESSED":
      if (state.stage !== "INIT") {
        throw new Error(`Cannot apply TREND_QUALITY_ASSESSED in stage ${state.stage}`);
      }
      newState = {
        ...state,
        trendQuality: delta.payload.trendQuality,
        regenerationCount: delta.payload.trendQuality.passesThreshold
          ? state.regenerationCount
          : state.regenerationCount + 1,
      };
      break;

    case "ESCALATION_PLANNED":
      if (state.stage !== "INIT") {
        throw new Error(`Cannot apply ESCALATION_PLANNED in stage ${state.stage}`);
      }
      newState = {
        ...state,
        scenes: delta.payload.scenes,
        globalContinuity: delta.payload.globalContinuity,
      };
      break;

    case "SCENE_VISUALIZED":
      if (state.stage !== "SCRIPTED") {
        throw new Error(`Cannot apply SCENE_VISUALIZED in stage ${state.stage}`);
      }
      const visualizedSceneIndex = state.scenes.findIndex(
        (s) => s.sceneId === delta.payload.sceneId
      );
      if (visualizedSceneIndex === -1) {
        throw new Error(`Scene not found: ${delta.payload.sceneId}`);
      }
      const visualizedScenes = [...state.scenes];
      visualizedScenes[visualizedSceneIndex] = {
        ...visualizedScenes[visualizedSceneIndex],
        visualPrompt: delta.payload.visualPrompt,
        continuityConstraints: delta.payload.continuityConstraints,
        conceptImagePath: delta.payload.conceptImagePath,
      };
      newState = { ...state, scenes: visualizedScenes };
      break;

    case "SCENE_VIDEO_GENERATED":
      if (state.stage !== "VISUALIZED") {
        throw new Error(`Cannot apply SCENE_VIDEO_GENERATED in stage ${state.stage}`);
      }
      const videoSceneIndex = state.scenes.findIndex(
        (s) => s.sceneId === delta.payload.sceneId
      );
      if (videoSceneIndex === -1) {
        throw new Error(`Scene not found: ${delta.payload.sceneId}`);
      }
      const videoScenes = [...state.scenes];
      videoScenes[videoSceneIndex] = {
        ...videoScenes[videoSceneIndex],
        videoClipPath: delta.payload.videoClipPath,
        continuityFramePath: delta.payload.continuityFramePath,
      };
      newState = { ...state, scenes: videoScenes };
      break;

    default:
      throw new Error(`Unknown delta type: ${(delta as AgentDelta).type}`);
  }

  saveState(newState, baseDir);
  return newState;
}

/**
 * Transition to a new stage (separate from delta application)
 */
export function transitionStage(
  state: ProjectState,
  to: Stage,
  baseDir: string = process.cwd()
): ProjectState {
  assertValidTransition(state.stage, to);

  const newState: ProjectState = {
    ...state,
    stage: to,
    error: null,
  };

  saveState(newState, baseDir);
  return newState;
}

/**
 * Set error on state
 */
export function setError(
  state: ProjectState,
  error: string,
  baseDir: string = process.cwd()
): ProjectState {
  const newState: ProjectState = {
    ...state,
    error,
  };

  saveState(newState, baseDir);
  return newState;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function validateHasTrend(state: ProjectState): asserts state is ProjectState & { trend: Trend } {
  if (!state.trend) {
    throw new Error("State is missing required trend data");
  }
}

export function validateHasScenes(state: ProjectState): void {
  if (state.scenes.length === 0) {
    throw new Error("State is missing required scenes data");
  }
}

export function validateTrendQualityPassed(state: ProjectState): void {
  if (!state.trendQuality?.passesThreshold) {
    throw new Error("Trend did not pass quality gate");
  }
}
