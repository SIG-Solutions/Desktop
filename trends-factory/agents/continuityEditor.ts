import {
  extractLastFrame,
  stitchVideos,
  normalizeVideo,
  getVideoInfo,
  type StitchVideosOptions,
} from "../tools/ffmpeg.js";
import type { Scene, ProjectState } from "../orchestrator/projectState.js";
import * as path from "node:path";
import * as fs from "node:fs";

// ============================================================================
// CONTINUITY EDITOR AGENT
// ============================================================================
// Responsibilities:
// 1. Extract final frame from each clip
// 2. Feed that frame + delta prompt into Veo (via VideoGenerator)
// 3. Enforce: lighting, camera axis, motion energy
// 4. Stitch clips using ffmpeg
//
// This agent makes the output feel INTENTIONAL.
// ============================================================================

/**
 * Configuration for continuity editing
 */
export interface ContinuityEditorConfig {
  outputDir: string;
  transitionType?: "none" | "fade" | "dissolve";
  transitionDuration?: number;
  normalizeVideos?: boolean;
}

/**
 * Result of continuity frame extraction
 */
export interface ContinuityFrameResult {
  sceneId: string;
  framePath: string;
}

/**
 * Result of final assembly
 */
export interface AssemblyResult {
  finalVideoPath: string;
  totalDuration: number;
  sceneCount: number;
}

/**
 * Extract continuity frames from all scene clips
 *
 * This is the first step in the continuity pipeline.
 * For each scene's video clip, extract the last frame.
 * This frame will be used as input for the next scene's video generation.
 */
export async function extractContinuityFrames(
  scenes: Scene[],
  config: ContinuityEditorConfig
): Promise<ContinuityFrameResult[]> {
  console.log(`[ContinuityEditor] Extracting continuity frames from ${scenes.length} scenes...`);

  const results: ContinuityFrameResult[] = [];

  for (const scene of scenes) {
    if (!scene.videoClipPath) {
      console.warn(`[ContinuityEditor] Scene ${scene.sceneId} has no video clip, skipping`);
      continue;
    }

    if (!fs.existsSync(scene.videoClipPath)) {
      throw new Error(`Video clip not found: ${scene.videoClipPath}`);
    }

    const framePath = path.join(
      config.outputDir,
      "scenes",
      `${scene.sceneId}_continuity_frame.png`
    );

    await extractLastFrame(scene.videoClipPath, framePath);

    results.push({
      sceneId: scene.sceneId,
      framePath,
    });

    console.log(`[ContinuityEditor] Extracted frame: ${framePath}`);
  }

  console.log(`[ContinuityEditor] Extracted ${results.length} continuity frames`);
  return results;
}

/**
 * Analyze continuity between scenes
 *
 * This checks for potential visual discontinuities:
 * - Lighting changes
 * - Camera axis breaks
 * - Motion energy mismatches
 */
export interface ContinuityAnalysis {
  sceneId: string;
  nextSceneId?: string;
  issues: string[];
  severity: "low" | "medium" | "high";
}

export async function analyzeContinuity(
  scenes: Scene[]
): Promise<ContinuityAnalysis[]> {
  console.log(`[ContinuityEditor] Analyzing continuity across ${scenes.length} scenes...`);

  const analyses: ContinuityAnalysis[] = [];

  for (let i = 0; i < scenes.length - 1; i++) {
    const current = scenes[i];
    const next = scenes[i + 1];

    const issues: string[] = [];

    // Check for absurdity level jumps
    const absurdityDelta = next.absurdityLevel - current.absurdityLevel;
    if (absurdityDelta > 3) {
      issues.push(`Large absurdity jump (${absurdityDelta} levels) may cause visual discontinuity`);
    }

    // Analyze visual prompts for consistency markers
    if (current.visualPrompt && next.visualPrompt) {
      // Check for location changes
      const locationWords = ["room", "office", "kitchen", "street", "park", "home"];
      const currentLocation = locationWords.find((w) =>
        current.visualPrompt!.toLowerCase().includes(w)
      );
      const nextLocation = locationWords.find((w) =>
        next.visualPrompt!.toLowerCase().includes(w)
      );

      if (currentLocation && nextLocation && currentLocation !== nextLocation) {
        issues.push(`Location change detected: ${currentLocation} -> ${nextLocation}`);
      }

      // Check for lighting changes
      const lightingWords = ["morning", "evening", "night", "dark", "bright", "sunlight"];
      const currentLighting = lightingWords.find((w) =>
        current.visualPrompt!.toLowerCase().includes(w)
      );
      const nextLighting = lightingWords.find((w) =>
        next.visualPrompt!.toLowerCase().includes(w)
      );

      if (currentLighting && nextLighting && currentLighting !== nextLighting) {
        issues.push(`Lighting change detected: ${currentLighting} -> ${nextLighting}`);
      }
    }

    // Determine severity
    let severity: "low" | "medium" | "high" = "low";
    if (issues.length >= 3) severity = "high";
    else if (issues.length >= 1) severity = "medium";

    analyses.push({
      sceneId: current.sceneId,
      nextSceneId: next.sceneId,
      issues,
      severity,
    });
  }

  // Log any medium/high severity issues
  for (const analysis of analyses) {
    if (analysis.severity !== "low") {
      console.warn(
        `[ContinuityEditor] ${analysis.severity.toUpperCase()} continuity issues between ${analysis.sceneId} and ${analysis.nextSceneId}:`
      );
      for (const issue of analysis.issues) {
        console.warn(`  - ${issue}`);
      }
    }
  }

  return analyses;
}

/**
 * Normalize all video clips for consistent stitching
 *
 * Ensures all clips have:
 * - Same resolution (1920x1080)
 * - Same frame rate (30fps)
 * - Same codec settings
 */
export async function normalizeAllClips(
  scenes: Scene[],
  config: ContinuityEditorConfig
): Promise<Map<string, string>> {
  console.log(`[ContinuityEditor] Normalizing ${scenes.length} video clips...`);

  const normalizedPaths = new Map<string, string>();

  for (const scene of scenes) {
    if (!scene.videoClipPath || !fs.existsSync(scene.videoClipPath)) {
      throw new Error(`Video clip not found for scene ${scene.sceneId}`);
    }

    const normalizedPath = path.join(
      config.outputDir,
      "scenes",
      `${scene.sceneId}_normalized.mp4`
    );

    await normalizeVideo({
      inputPath: scene.videoClipPath,
      outputPath: normalizedPath,
      width: 1920,
      height: 1080,
      fps: 30,
    });

    normalizedPaths.set(scene.sceneId, normalizedPath);
    console.log(`[ContinuityEditor] Normalized ${scene.sceneId}`);
  }

  return normalizedPaths;
}

/**
 * Stitch all scene clips into final video
 *
 * This is the final step of the pipeline.
 */
export async function assembleFinalVideo(
  scenes: Scene[],
  config: ContinuityEditorConfig,
  projectId: string
): Promise<AssemblyResult> {
  console.log(`[ContinuityEditor] Assembling final video...`);

  // Validate all scenes have video clips
  for (const scene of scenes) {
    if (!scene.videoClipPath) {
      throw new Error(`Scene ${scene.sceneId} is missing video clip path`);
    }
    if (!fs.existsSync(scene.videoClipPath)) {
      throw new Error(`Video clip not found: ${scene.videoClipPath}`);
    }
  }

  // Optionally normalize clips first
  let inputPaths: string[];

  if (config.normalizeVideos) {
    const normalizedPaths = await normalizeAllClips(scenes, config);
    inputPaths = scenes.map((s) => normalizedPaths.get(s.sceneId)!);
  } else {
    inputPaths = scenes.map((s) => s.videoClipPath!);
  }

  // Output path for final video
  const finalPath = path.join(config.outputDir, "final", `${projectId}.mp4`);

  // Ensure final directory exists
  const finalDir = path.dirname(finalPath);
  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true });
  }

  // Stitch videos
  const stitchOptions: StitchVideosOptions = {
    inputPaths,
    outputPath: finalPath,
    transition: config.transitionType || "none",
    transitionDuration: config.transitionDuration || 0.5,
  };

  await stitchVideos(stitchOptions);

  // Get final video info
  const videoInfo = getVideoInfo(finalPath);

  console.log(`[ContinuityEditor] Final video assembled: ${finalPath}`);
  console.log(`  - Duration: ${videoInfo.duration.toFixed(2)}s`);
  console.log(`  - Resolution: ${videoInfo.width}x${videoInfo.height}`);
  console.log(`  - Scenes: ${scenes.length}`);

  return {
    finalVideoPath: finalPath,
    totalDuration: videoInfo.duration,
    sceneCount: scenes.length,
  };
}

/**
 * Full continuity edit pipeline
 *
 * This runs the complete continuity editing process:
 * 1. Analyze continuity issues
 * 2. Extract continuity frames
 * 3. Assemble final video
 */
export async function runContinuityPipeline(
  state: ProjectState,
  config: ContinuityEditorConfig
): Promise<AssemblyResult> {
  console.log(`[ContinuityEditor] Starting continuity pipeline...`);

  // Step 1: Analyze continuity
  const analysis = await analyzeContinuity(state.scenes);
  const highSeverityIssues = analysis.filter((a) => a.severity === "high");

  if (highSeverityIssues.length > 0) {
    console.warn(
      `[ContinuityEditor] WARNING: ${highSeverityIssues.length} high-severity continuity issues detected`
    );
  }

  // Step 2: Extract continuity frames (for potential re-generation)
  const continuityFrames = await extractContinuityFrames(state.scenes, config);
  console.log(`[ContinuityEditor] Extracted ${continuityFrames.length} continuity frames`);

  // Step 3: Assemble final video
  const result = await assembleFinalVideo(state.scenes, config, state.projectId);

  return result;
}
