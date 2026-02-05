import { generateVideo, type VideoGenerationRequest } from "../services/veoClient.js";
import type { Scene, Trend } from "../orchestrator/projectState.js";
import * as path from "node:path";
import * as fs from "node:fs";

// ============================================================================
// VIDEO GENERATOR AGENT
// ============================================================================
// Model: Veo 3.1
// Responsibility: Generate scene-atomic video clips
// Input: Scene with visual prompt and concept image
// Output: MP4 video clip for each scene
// ============================================================================

/**
 * Configuration for video generation
 */
export interface VideoGeneratorConfig {
  outputDir: string;
  clipDuration?: number; // 5-10 seconds, default 6
  useImageToVideo?: boolean; // Whether to use concept images as input
}

/**
 * Input for video generation
 */
export interface VideoGeneratorInput {
  trend: Trend;
  scene: Scene;
  config: VideoGeneratorConfig;
  previousFramePath?: string; // For continuity
}

/**
 * Result of video generation
 */
export interface VideoGeneratorResult {
  sceneId: string;
  videoClipPath: string;
  durationSeconds: number;
}

/**
 * Build the video generation prompt
 *
 * This creates a prompt optimized for Veo that:
 * 1. Describes the action clearly
 * 2. Specifies camera movement
 * 3. Maintains visual consistency
 */
function buildVideoPrompt(
  trend: Trend,
  scene: Scene,
  hasPreviousFrame: boolean
): string {
  const parts: string[] = [];

  // Core visual description
  if (scene.visualPrompt) {
    parts.push(scene.visualPrompt);
  } else {
    parts.push(scene.intent);
  }

  // Camera and motion guidance based on absurdity level
  if (scene.absurdityLevel <= 3) {
    parts.push("Steady camera. Documentary style. Natural movement. Calm pacing.");
  } else if (scene.absurdityLevel <= 6) {
    parts.push("Subtle camera drift. Heightened attention to detail. Deliberate movement.");
  } else {
    parts.push("Slow, purposeful camera movement. Slightly surreal atmosphere. Tension in stillness.");
  }

  // Continuity guidance
  if (hasPreviousFrame) {
    parts.push("Maintain visual continuity with the previous frame. Same lighting conditions. Same visual style.");
  }

  // Quality markers
  parts.push("High quality. Cinematic. 4K. Professional cinematography.");

  return parts.join(" ");
}

/**
 * Generate video for a single scene
 *
 * Pure function - only writes to specified output path
 */
export async function generateSceneVideo(
  input: VideoGeneratorInput
): Promise<VideoGeneratorResult> {
  const { trend, scene, config, previousFramePath } = input;

  console.log(`[VideoGenerator] Generating video for ${scene.sceneId}...`);
  console.log(`  - Absurdity level: ${scene.absurdityLevel}`);
  console.log(`  - Using concept image: ${config.useImageToVideo && scene.conceptImagePath ? "yes" : "no"}`);
  console.log(`  - Using previous frame: ${previousFramePath ? "yes" : "no"}`);

  // Build the prompt
  const prompt = buildVideoPrompt(trend, scene, !!previousFramePath);

  // Determine which image to use (if any)
  let imagePath: string | undefined;

  if (previousFramePath && fs.existsSync(previousFramePath)) {
    // Prioritize continuity frame
    imagePath = previousFramePath;
    console.log(`  - Using continuity frame: ${previousFramePath}`);
  } else if (config.useImageToVideo && scene.conceptImagePath && fs.existsSync(scene.conceptImagePath)) {
    // Fall back to concept image
    imagePath = scene.conceptImagePath;
    console.log(`  - Using concept image: ${scene.conceptImagePath}`);
  }

  // Output path
  const outputPath = path.join(config.outputDir, "scenes", `${scene.sceneId}_clip.mp4`);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate the video
  const request: VideoGenerationRequest = {
    prompt,
    imagePath,
    durationSeconds: config.clipDuration || 6,
    aspectRatio: "16:9",
    outputPath,
  };

  const videoPath = await generateVideo(request);

  console.log(`[VideoGenerator] Generated video: ${videoPath}`);

  return {
    sceneId: scene.sceneId,
    videoClipPath: videoPath,
    durationSeconds: config.clipDuration || 6,
  };
}

/**
 * Generate videos for all scenes
 *
 * Processes sequentially to allow for continuity
 * Uses the Continuity Editor's extracted frames when available
 */
export async function generateAllSceneVideos(
  trend: Trend,
  scenes: Scene[],
  config: VideoGeneratorConfig
): Promise<VideoGeneratorResult[]> {
  console.log(`[VideoGenerator] Generating videos for ${scenes.length} scenes...`);

  const results: VideoGeneratorResult[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];

    // Get previous scene's continuity frame if available
    const previousScene = i > 0 ? scenes[i - 1] : null;
    const previousFramePath = previousScene?.continuityFramePath;

    const result = await generateSceneVideo({
      trend,
      scene,
      config,
      previousFramePath,
    });

    results.push(result);
  }

  console.log(`[VideoGenerator] All videos generated`);
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
  }
  console.log("[VideoGenerator] Scene validation passed");
}
