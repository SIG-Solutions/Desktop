import {
  type ProjectState,
  type Stage,
  loadState,
  resetState,
  applyDelta,
  transitionStage,
  setError,
  validateHasTrend,
  validateHasScenes,
  validateTrendQualityPassed,
} from "./projectState.js";

import { synthesizeTrendWithQualityGate } from "../agents/trendSynthesizer.js";
import { planEscalation } from "../agents/escalationPlanner.js";
import { lockAllVisuals } from "../agents/visualLocker.js";
import { generateAllSceneVideos, validateScenesForVideoGeneration } from "../agents/videoGenerator.js";
import { assembleFinalVideo, type ContinuityEditorConfig } from "../agents/continuityEditor.js";

// ============================================================================
// STATE MACHINE ORCHESTRATOR
// ============================================================================
// This is the brain of the Trends Factory.
//
// CRITICAL DESIGN:
// - Agents return DELTAS, not full state
// - Orchestrator applies deltas via applyDelta()
// - This ensures single source of truth
// - This enables partial reruns without corruption
//
// It enforces:
// - Stage validation
// - Stage locking (only one stage writes at a time)
// - Delta-based state mutation
// - Deterministic execution with seed
// ============================================================================

/**
 * Configuration for the state machine
 */
export interface StateMachineConfig {
  baseDir: string;
  outputDir: string;
  seed?: number; // Optional override seed
  clipDuration?: number;
  useImageToVideo?: boolean;
  transitionType?: "none" | "fade" | "dissolve";
  transitionDuration?: number;
}

/**
 * Stage handler function signature
 * Returns the modified state after applying all deltas for that stage
 */
type StageHandler = (
  state: ProjectState,
  config: StateMachineConfig
) => Promise<ProjectState>;

/**
 * Stage handlers map
 */
const STAGE_HANDLERS: Record<Stage, StageHandler | null> = {
  INIT: handleInit,
  SCRIPTED: handleScripted,
  VISUALIZED: handleVisualized,
  VIDEO_GENERATED: handleVideoGenerated,
  ASSEMBLED: null, // Terminal state - no handler
};

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

/**
 * Run the complete pipeline from current state to completion
 */
export async function runPipeline(config: StateMachineConfig): Promise<ProjectState> {
  console.log("=".repeat(60));
  console.log("TRENDS FACTORY - PRODUCTION PIPELINE");
  console.log("=".repeat(60));

  let state = loadState(config.baseDir);
  console.log(`[Orchestrator] Loaded state:`);
  console.log(`  - Stage: ${state.stage}`);
  console.log(`  - Project ID: ${state.projectId}`);
  console.log(`  - Run ID: ${state.runId}`);
  console.log(`  - Seed: ${state.seed}`);

  // Run through stages until we reach ASSEMBLED
  while (state.stage !== "ASSEMBLED") {
    const handler = STAGE_HANDLERS[state.stage];

    if (!handler) {
      throw new Error(`No handler for stage: ${state.stage}`);
    }

    console.log("");
    console.log("-".repeat(60));
    console.log(`[Orchestrator] STAGE: ${state.stage}`);
    console.log("-".repeat(60));

    try {
      state = await handler(state, config);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Orchestrator] ERROR in stage ${state.stage}: ${errorMessage}`);

      // Save error to state
      state = setError(state, errorMessage, config.baseDir);

      // Re-throw to stop pipeline
      throw error;
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("[Orchestrator] PIPELINE COMPLETE");
  console.log(`[Orchestrator] Final video: ${config.outputDir}/final/${state.projectId}.mp4`);
  console.log("=".repeat(60));

  return state;
}

/**
 * Run pipeline from a specific stage
 * Useful for partial reruns
 */
export async function runFromStage(
  fromStage: Stage,
  config: StateMachineConfig
): Promise<ProjectState> {
  let state = loadState(config.baseDir);

  // Validate we can start from this stage
  if (getStageOrder(state.stage) < getStageOrder(fromStage)) {
    throw new Error(
      `Cannot run from stage ${fromStage}: current state is only at ${state.stage}`
    );
  }

  // For partial reruns, we need to set stage back
  // But we preserve all existing data
  console.log(`[Orchestrator] Resetting stage from ${state.stage} to ${getPreviousStage(fromStage)}`);

  // Directly modify stage for rerun (bypasses normal transition)
  state = {
    ...state,
    stage: getPreviousStage(fromStage),
  };

  // Save the modified state
  const { saveState } = await import("./projectState.js");
  saveState(state, config.baseDir);

  return runPipeline(config);
}

/**
 * Reset pipeline and start fresh
 */
export async function resetAndRun(config: StateMachineConfig): Promise<ProjectState> {
  console.log("[Orchestrator] Resetting state and starting fresh...");
  resetState(config.baseDir, config.seed);
  return runPipeline(config);
}

// ============================================================================
// STAGE HANDLERS - DELTA-BASED
// ============================================================================

/**
 * INIT -> SCRIPTED
 *
 * 1. Synthesize trend with quality gate (may retry)
 * 2. Apply TREND_SYNTHESIZED delta
 * 3. Apply TREND_QUALITY_ASSESSED delta
 * 4. Plan escalation with global continuity
 * 5. Apply ESCALATION_PLANNED delta
 * 6. Transition to SCRIPTED
 */
async function handleInit(
  state: ProjectState,
  config: StateMachineConfig
): Promise<ProjectState> {
  console.log("[Stage:INIT] Synthesizing trend with quality gate...");

  // Step 1 & 2: Synthesize trend with automatic quality gate
  console.log("[Stage:INIT] Step 1/3: Synthesizing trend with quality gate...");
  const { synthesis, quality } = await synthesizeTrendWithQualityGate({
    seed: state.seed,
  });

  // Apply deltas
  state = applyDelta(
    state,
    { type: "TREND_SYNTHESIZED", payload: synthesis },
    config.baseDir
  );

  state = applyDelta(
    state,
    { type: "TREND_QUALITY_ASSESSED", payload: quality },
    config.baseDir
  );

  // Validate quality passed (should always pass if we got here)
  validateTrendQualityPassed(state);

  // Step 3: Plan escalation
  console.log("[Stage:INIT] Step 2/3: Planning escalation...");
  validateHasTrend(state);

  const escalationDelta = await planEscalation({
    trend: state.trend,
    seed: state.seed,
  });

  state = applyDelta(
    state,
    { type: "ESCALATION_PLANNED", payload: escalationDelta },
    config.baseDir
  );

  // Step 4: Transition to SCRIPTED
  console.log("[Stage:INIT] Step 3/3: Transitioning to SCRIPTED...");
  state = transitionStage(state, "SCRIPTED", config.baseDir);

  console.log("[Stage:INIT] Complete -> SCRIPTED");
  console.log(`  - Trend: "${state.trend?.name}"`);
  console.log(`  - Scenes: ${state.scenes.length}`);
  console.log(`  - Quality score: ${state.trendQuality?.overallScore}/10`);

  return state;
}

/**
 * SCRIPTED -> VISUALIZED
 *
 * 1. Lock visuals for each scene (applies global continuity)
 * 2. Apply SCENE_VISUALIZED delta for each scene
 * 3. Transition to VISUALIZED
 */
async function handleScripted(
  state: ProjectState,
  config: StateMachineConfig
): Promise<ProjectState> {
  console.log("[Stage:SCRIPTED] Locking visuals for all scenes...");

  validateHasTrend(state);
  validateHasScenes(state);

  if (!state.globalContinuity) {
    throw new Error("State is missing global continuity constraints");
  }

  // Lock visuals for all scenes
  const visualDeltas = await lockAllVisuals(
    state.trend,
    state.scenes,
    state.globalContinuity,
    {
      outputDir: config.outputDir,
      seed: state.seed,
    }
  );

  // Apply deltas for each scene
  for (const delta of visualDeltas) {
    state = applyDelta(
      state,
      { type: "SCENE_VISUALIZED", payload: delta },
      config.baseDir
    );
  }

  // Transition to VISUALIZED
  state = transitionStage(state, "VISUALIZED", config.baseDir);

  console.log("[Stage:SCRIPTED] Complete -> VISUALIZED");
  console.log(`  - ${visualDeltas.length} scenes visualized`);

  return state;
}

/**
 * VISUALIZED -> VIDEO_GENERATED
 *
 * 1. Validate all scenes have visual prompts
 * 2. Generate videos for each scene (with continuity chaining)
 * 3. Apply SCENE_VIDEO_GENERATED delta for each scene
 * 4. Transition to VIDEO_GENERATED
 */
async function handleVisualized(
  state: ProjectState,
  config: StateMachineConfig
): Promise<ProjectState> {
  console.log("[Stage:VISUALIZED] Generating video clips...");

  validateHasTrend(state);
  validateScenesForVideoGeneration(state.scenes);

  if (!state.globalContinuity) {
    throw new Error("State is missing global continuity constraints");
  }

  // Generate videos with continuity chaining
  const videoDeltas = await generateAllSceneVideos(
    state.trend,
    state.scenes,
    state.globalContinuity,
    {
      outputDir: config.outputDir,
      seed: state.seed,
      clipDuration: config.clipDuration || 6,
      useImageToVideo: config.useImageToVideo ?? true,
    }
  );

  // Apply deltas for each scene
  for (const delta of videoDeltas) {
    state = applyDelta(
      state,
      { type: "SCENE_VIDEO_GENERATED", payload: delta },
      config.baseDir
    );
  }

  // Transition to VIDEO_GENERATED
  state = transitionStage(state, "VIDEO_GENERATED", config.baseDir);

  console.log("[Stage:VISUALIZED] Complete -> VIDEO_GENERATED");
  console.log(`  - ${videoDeltas.length} videos generated`);

  return state;
}

/**
 * VIDEO_GENERATED -> ASSEMBLED
 *
 * 1. Validate all scenes have video clips
 * 2. Assemble final video
 * 3. Transition to ASSEMBLED
 */
async function handleVideoGenerated(
  state: ProjectState,
  config: StateMachineConfig
): Promise<ProjectState> {
  console.log("[Stage:VIDEO_GENERATED] Assembling final video...");

  // Validate all scenes have video clips
  for (const scene of state.scenes) {
    if (!scene.videoClipPath) {
      throw new Error(`Scene ${scene.sceneId} is missing video clip`);
    }
  }

  // Assemble final video
  const continuityConfig: ContinuityEditorConfig = {
    outputDir: config.outputDir,
    transitionType: config.transitionType || "none",
    transitionDuration: config.transitionDuration || 0.5,
    normalizeVideos: true,
  };

  const result = await assembleFinalVideo(state.scenes, continuityConfig, state.projectId);

  console.log(`[Stage:VIDEO_GENERATED] Final video: ${result.finalVideoPath}`);
  console.log(`[Stage:VIDEO_GENERATED] Total duration: ${result.totalDuration.toFixed(2)}s`);

  // Transition to ASSEMBLED (terminal state)
  state = transitionStage(state, "ASSEMBLED", config.baseDir);

  console.log("[Stage:VIDEO_GENERATED] Complete -> ASSEMBLED");

  return state;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const STAGE_ORDER: Stage[] = ["INIT", "SCRIPTED", "VISUALIZED", "VIDEO_GENERATED", "ASSEMBLED"];

function getStageOrder(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

function getPreviousStage(stage: Stage): Stage {
  const index = getStageOrder(stage);
  if (index <= 0) return "INIT";
  return STAGE_ORDER[index - 1];
}

/**
 * Get current pipeline status
 */
export function getPipelineStatus(config: StateMachineConfig): {
  stage: Stage;
  projectId: string;
  runId: string;
  seed: number;
  sceneCount: number;
  trendName: string | null;
  qualityScore: number | null;
  regenerationCount: number;
  error: string | null;
} {
  const state = loadState(config.baseDir);
  return {
    stage: state.stage,
    projectId: state.projectId,
    runId: state.runId,
    seed: state.seed,
    sceneCount: state.scenes.length,
    trendName: state.trend?.name || null,
    qualityScore: state.trendQuality?.overallScore || null,
    regenerationCount: state.regenerationCount,
    error: state.error || null,
  };
}
