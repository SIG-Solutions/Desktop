import {
  type ProjectState,
  type Stage,
  type Scene,
  loadState,
  saveState,
  resetState,
  setTrend,
  setScenes,
  updateScene,
  transitionState,
  setError,
} from "./projectState.js";

import {
  validateHasTrend,
  validateHasScenes,
  validateScenesHaveVisualPrompts,
  validateScenesHaveConceptImages,
  validateScenesHaveVideoClips,
} from "./validators.js";

import { synthesizeTrend } from "../agents/trendSynthesizer.js";
import { planEscalation, validateEscalationLogic } from "../agents/escalationPlanner.js";
import { lockAllVisuals } from "../agents/visualLocker.js";
import { generateSceneVideo, validateScenesForVideoGeneration } from "../agents/videoGenerator.js";
import {
  extractContinuityFrames,
  assembleFinalVideo,
  type ContinuityEditorConfig,
} from "../agents/continuityEditor.js";

// ============================================================================
// STATE MACHINE ORCHESTRATOR
// ============================================================================
// This is the brain of the Trends Factory.
// It enforces:
// - Stage validation
// - Stage locking (only one stage writes at a time)
// - Partial reruns
// - Deterministic execution
// ============================================================================

/**
 * Configuration for the state machine
 */
export interface StateMachineConfig {
  baseDir: string;
  outputDir: string;
  clipDuration?: number;
  useImageToVideo?: boolean;
  transitionType?: "none" | "fade" | "dissolve";
  transitionDuration?: number;
}

/**
 * Stage handler function signature
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
  console.log(`[Orchestrator] Loaded state: stage=${state.stage}, projectId=${state.projectId}`);

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

  // Reset stage to the requested starting point
  // This is a special override for reruns
  state = {
    ...state,
    stage: getPreviousStage(fromStage),
  };
  saveState(state, config.baseDir);

  return runPipeline(config);
}

/**
 * Reset pipeline and start fresh
 */
export async function resetAndRun(config: StateMachineConfig): Promise<ProjectState> {
  console.log("[Orchestrator] Resetting state and starting fresh...");
  resetState(config.baseDir);
  return runPipeline(config);
}

// ============================================================================
// STAGE HANDLERS
// ============================================================================

/**
 * INIT -> SCRIPTED
 * - Synthesize trend
 * - Plan escalation
 * - Transition to SCRIPTED
 */
async function handleInit(
  state: ProjectState,
  config: StateMachineConfig
): Promise<ProjectState> {
  console.log("[Stage:INIT] Synthesizing trend and planning escalation...");

  // Step 1: Synthesize trend
  console.log("[Stage:INIT] Step 1/2: Synthesizing trend...");
  const trend = await synthesizeTrend();
  state = setTrend(state, trend, config.baseDir);

  // Step 2: Plan escalation
  console.log("[Stage:INIT] Step 2/2: Planning escalation...");
  const scenes = await planEscalation({ trend });
  validateEscalationLogic(scenes);
  state = setScenes(state, scenes, config.baseDir);

  // Transition to SCRIPTED
  state = transitionState(state, "SCRIPTED", config.baseDir);

  console.log("[Stage:INIT] Complete -> SCRIPTED");
  return state;
}

/**
 * SCRIPTED -> VISUALIZED
 * - Generate visual prompts
 * - Generate concept images
 * - Transition to VISUALIZED
 */
async function handleScripted(
  state: ProjectState,
  config: StateMachineConfig
): Promise<ProjectState> {
  console.log("[Stage:SCRIPTED] Locking visuals for all scenes...");

  validateHasTrend(state);
  validateHasScenes(state);

  // Lock visuals for all scenes
  const results = await lockAllVisuals({
    trend: state.trend,
    scenes: state.scenes,
    config: {
      outputDir: config.outputDir,
      imageAspectRatio: "16:9",
    },
  });

  // Update scenes with visual data
  for (const result of results) {
    state = updateScene(
      state,
      result.sceneId,
      {
        visualPrompt: result.visualPrompt,
        conceptImagePath: result.conceptImagePath,
      },
      config.baseDir
    );
  }

  // Transition to VISUALIZED
  state = transitionState(state, "VISUALIZED", config.baseDir);

  console.log("[Stage:SCRIPTED] Complete -> VISUALIZED");
  return state;
}

/**
 * VISUALIZED -> VIDEO_GENERATED
 * - Generate video clips for each scene
 * - Extract continuity frames
 * - Transition to VIDEO_GENERATED
 */
async function handleVisualized(
  state: ProjectState,
  config: StateMachineConfig
): Promise<ProjectState> {
  console.log("[Stage:VISUALIZED] Generating video clips...");

  validateHasTrend(state);
  validateScenesHaveVisualPrompts(state);

  // Generate videos for each scene
  // Process sequentially to allow continuity frame usage
  for (let i = 0; i < state.scenes.length; i++) {
    const scene = state.scenes[i];
    console.log(`[Stage:VISUALIZED] Generating video ${i + 1}/${state.scenes.length}...`);

    // Get previous scene's continuity frame if available
    const previousScene = i > 0 ? state.scenes[i - 1] : null;

    const result = await generateSceneVideo({
      trend: state.trend,
      scene,
      config: {
        outputDir: config.outputDir,
        clipDuration: config.clipDuration || 6,
        useImageToVideo: config.useImageToVideo ?? true,
      },
      previousFramePath: previousScene?.continuityFramePath,
    });

    // Update scene with video path
    state = updateScene(
      state,
      scene.sceneId,
      { videoClipPath: result.videoClipPath },
      config.baseDir
    );

    // Extract continuity frame for next scene (except for last scene)
    if (i < state.scenes.length - 1) {
      const continuityConfig: ContinuityEditorConfig = {
        outputDir: config.outputDir,
      };

      const frames = await extractContinuityFrames([state.scenes[i]], continuityConfig);

      if (frames.length > 0) {
        state = updateScene(
          state,
          scene.sceneId,
          { continuityFramePath: frames[0].framePath },
          config.baseDir
        );
      }
    }
  }

  // Transition to VIDEO_GENERATED
  state = transitionState(state, "VIDEO_GENERATED", config.baseDir);

  console.log("[Stage:VISUALIZED] Complete -> VIDEO_GENERATED");
  return state;
}

/**
 * VIDEO_GENERATED -> ASSEMBLED
 * - Stitch all clips into final video
 * - Transition to ASSEMBLED
 */
async function handleVideoGenerated(
  state: ProjectState,
  config: StateMachineConfig
): Promise<ProjectState> {
  console.log("[Stage:VIDEO_GENERATED] Assembling final video...");

  validateScenesHaveVideoClips(state);

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

  // Transition to ASSEMBLED
  state = transitionState(state, "ASSEMBLED", config.baseDir);

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
  sceneCount: number;
  trendName: string | null;
  error: string | null;
} {
  const state = loadState(config.baseDir);
  return {
    stage: state.stage,
    projectId: state.projectId,
    sceneCount: state.scenes.length,
    trendName: state.trend?.name || null,
    error: state.error || null,
  };
}
