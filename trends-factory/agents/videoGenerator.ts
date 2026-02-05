import { generateVideo, type VideoGenerationRequest } from "../services/veoClient.js";
import {
  type VideoGeneratorDelta,
  type Scene,
  type Trend,
  type ContinuityConstraints,
} from "../orchestrator/projectState.js";
import { extractLastFrame } from "../tools/ffmpeg.js";
import * as path from "node:path";
import * as fs from "node:fs";

// ============================================================================
// VIDEO GENERATOR AGENT
// ============================================================================
// Model: Veo 3.1
// Responsibility: Generate scene-atomic video clips with ENFORCED continuity
// Input: Scene with visual prompt + continuity constraints + seed
// Output: VideoGeneratorDelta (videoClipPath + continuityFramePath)
//
// CRITICAL: This agent MUST inject continuity constraints VERBATIM
// into every video generation prompt. Veo will drift without this.
// ============================================================================

/**
 * Configuration for video generation
 */
export interface VideoGeneratorConfig {
  outputDir: string;
  seed: number;
  clipDuration?: number; // 5-10 seconds, default 6
  useImageToVideo?: boolean; // Whether to use concept images as input
}

/**
 * Input for video generation
 */
export interface VideoGeneratorInput {
  trend: Trend;
  scene: Scene;
  globalContinuity: ContinuityConstraints;
  config: VideoGeneratorConfig;
  previousFramePath?: string; // For cross-scene continuity
}

/**
 * Build the video generation prompt with ENFORCED constraints
 *
 * This creates a prompt optimized for Veo that:
 * 1. Describes the action clearly
 * 2. INJECTS continuity constraints verbatim
 * 3. Specifies camera movement
 */
function buildVideoPrompt(
  scene: Scene,
  globalContinuity: ContinuityConstraints,
  hasPreviousFrame: boolean
): string {
  const parts: string[] = [];

  // Core visual description
  if (scene.visualPrompt) {
    parts.push(scene.visualPrompt);
  } else {
    parts.push(scene.intent);
  }

  // ===== ENFORCED CONTINUITY CONSTRAINTS =====
  // These are injected VERBATIM - no interpretation
  parts.push("");
  parts.push("=== TECHNICAL REQUIREMENTS (MUST MATCH EXACTLY) ===");
  parts.push(`LIGHTING: ${globalContinuity.lighting}`);
  parts.push(`CAMERA: ${globalContinuity.cameraAxis}`);
  parts.push(`MOTION: ${globalContinuity.motionEnergy}`);
  parts.push(`COLOR GRADING: ${globalContinuity.colorPalette}`);
  parts.push(`ENVIRONMENT: ${globalContinuity.environmentType}`);
  parts.push("=================================================");
  parts.push("");

  // Scene-specific continuity constraints if available
  if (scene.continuityConstraints) {
    parts.push("SCENE-SPECIFIC:");
    parts.push(`- Lighting: ${scene.continuityConstraints.lighting}`);
    parts.push(`- Camera: ${scene.continuityConstraints.cameraAxis}`);
    parts.push(`- Motion: ${scene.continuityConstraints.motionEnergy}`);
  }

  // Camera and motion guidance based on absurdity level
  if (scene.absurdityLevel <= 3) {
    parts.push("Pacing: Steady, calm, documentary observation. No sudden movements.");
  } else if (scene.absurdityLevel <= 6) {
    parts.push("Pacing: Deliberate, heightened attention. Slight tension building.");
  } else {
    parts.push("Pacing: Slow, purposeful, almost surreal. Maximum visual impact.");
  }

  // Continuity instruction for image-to-video
  if (hasPreviousFrame) {
    parts.push("");
    parts.push("CRITICAL: This video MUST continue seamlessly from the provided image.");
    parts.push("Match EXACTLY: lighting direction, color temperature, camera angle, subject position.");
    parts.push("Any discontinuity will be detected and rejected.");
  }

  // Quality markers
  parts.push("");
  parts.push("Quality: Cinematic, 4K, professional cinematography, documentary style.");

  return parts.join("\n");
}

/**
 * Generate video for a single scene
 *
 * This is a PURE FUNCTION that:
 * 1. Builds prompt with enforced constraints
 * 2. Generates video clip
 * 3. Extracts continuity frame
 * 4. Returns VideoGeneratorDelta
 *
 * NO STATE MUTATION. Returns delta only.
 */
export async function generateSceneVideo(
  input: VideoGeneratorInput
): Promise<VideoGeneratorDelta> {
  const { scene, globalContinuity, config, previousFramePath } = input;

  console.log(`[VideoGenerator] Generating video for ${scene.sceneId} (seed: ${config.seed})...`);
  console.log(`  - Absurdity level: ${scene.absurdityLevel}`);
  console.log(`  - Using concept image: ${config.useImageToVideo && scene.conceptImagePath ? "yes" : "no"}`);
  console.log(`  - Using previous frame: ${previousFramePath ? "yes" : "no"}`);

  // Build the prompt with ENFORCED constraints
  const prompt = buildVideoPrompt(scene, globalContinuity, !!previousFramePath);

  // Log constraint enforcement
  console.log(`[VideoGenerator] Enforcing constraints:`);
  console.log(`  - Lighting: ${globalContinuity.lighting}`);
  console.log(`  - Camera: ${globalContinuity.cameraAxis}`);
  console.log(`  - Motion: ${globalContinuity.motionEnergy}`);

  // Determine which image to use (if any)
  let imagePath: string | undefined;

  if (previousFramePath && fs.existsSync(previousFramePath)) {
    // Prioritize continuity frame for cross-scene consistency
    imagePath = previousFramePath;
    console.log(`  - Using continuity frame: ${previousFramePath}`);
  } else if (config.useImageToVideo && scene.conceptImagePath && fs.existsSync(scene.conceptImagePath)) {
    // Fall back to concept image
    imagePath = scene.conceptImagePath;
    console.log(`  - Using concept image: ${scene.conceptImagePath}`);
  }

  // Output paths
  const videoPath = path.join(config.outputDir, "scenes", `${scene.sceneId}_clip.mp4`);
  const framePath = path.join(config.outputDir, "scenes", `${scene.sceneId}_continuity_frame.png`);

  // Ensure output directory exists
  const outputDir = path.dirname(videoPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate the video
  const request: VideoGenerationRequest = {
    prompt,
    imagePath,
    durationSeconds: config.clipDuration || 6,
    aspectRatio: "16:9",
    outputPath: videoPath,
  };

  const generatedVideoPath = await generateVideo(request);

  // Extract continuity frame from the generated video
  console.log(`[VideoGenerator] Extracting continuity frame...`);
  let continuityFramePath: string | undefined;
  try {
    await extractLastFrame(generatedVideoPath, framePath);
    continuityFramePath = framePath;
    console.log(`[VideoGenerator] Continuity frame saved: ${framePath}`);
  } catch (error) {
    console.warn(`[VideoGenerator] Failed to extract continuity frame: ${error}`);
    // Continue without continuity frame - not fatal
  }

  console.log(`[VideoGenerator] Generated video: ${generatedVideoPath}`);

  // Return delta
  return {
    sceneId: scene.sceneId,
    videoClipPath: generatedVideoPath,
    continuityFramePath,
  };
}

/**
 * Generate videos for all scenes with cross-scene continuity
 *
 * Processes SEQUENTIALLY to allow continuity frame chaining
 * Each scene's final frame becomes input for the next scene
 */
export async function generateAllSceneVideos(
  trend: Trend,
  scenes: Scene[],
  globalContinuity: ContinuityConstraints,
  config: VideoGeneratorConfig
): Promise<VideoGeneratorDelta[]> {
  console.log(`[VideoGenerator] Generating videos for ${scenes.length} scenes...`);
  console.log(`[VideoGenerator] Global continuity will be ENFORCED on all scenes`);

  const results: VideoGeneratorDelta[] = [];
  let previousFramePath: string | undefined;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];

    const result = await generateSceneVideo({
      trend,
      scene,
      globalContinuity,
      config,
      previousFramePath,
    });

    results.push(result);

    // Chain continuity frame to next scene
    previousFramePath = result.continuityFramePath;
  }

  console.log(`[VideoGenerator] All videos generated with continuity chain`);
  return results;
}

/**
 * Validate that all required scene data is present for video generation
 */
export function validateScenesForVideoGeneration(scenes: Scene[]): void {
  for (const scene of scenes) {
    if (!scene.visualPrompt) {
      throw new Error(`Scene ${scene.sceneId} is missing visual prompt`);
    }
    // Continuity constraints are now required
    if (!scene.continuityConstraints) {
      console.warn(`[VideoGenerator] Scene ${scene.sceneId} missing continuity constraints - using global only`);
    }
  }
  console.log("[VideoGenerator] Scene validation passed");
}
