import { generateJson, generateImage } from "../services/geminiClient.js";
import { z } from "zod";
import {
  type VisualLockerDelta,
  type Scene,
  type Trend,
  type ContinuityConstraints,
  ContinuityConstraintsSchema,
} from "../orchestrator/projectState.js";
import * as path from "node:path";

// ============================================================================
// VISUAL LOCKER AGENT
// ============================================================================
// Model: Gemini Flash for prompts, Imagen for images
// Responsibility: Generate visual prompts and concept art with ENFORCED continuity
// Input: Scene + globalContinuity + seed
// Output: VisualLockerDelta (visualPrompt + sceneConstraints + conceptImagePath)
//
// CRITICAL: This agent MUST incorporate global continuity constraints
// into every visual prompt. No creativity allowed - only execution.
// ============================================================================

/**
 * System instruction for visual prompt generation
 */
const VISUAL_PROMPT_SYSTEM = `You are a Visual Prompt Engineer for a video production pipeline.

Your task is to convert scene intents into precise, cinematic visual prompts.

CRITICAL: You will be given GLOBAL CONTINUITY CONSTRAINTS.
You MUST incorporate these constraints VERBATIM into your visual prompt.
No interpretation. No creativity. Just execution.

VISUAL PROMPT STRUCTURE:
1. SHOT TYPE: Wide/Medium/Close-up (based on absurdity level)
2. SUBJECT: Who/what is in frame, exact pose/action
3. SETTING: Matches globalContinuity.environmentType
4. LIGHTING: Matches globalContinuity.lighting EXACTLY
5. CAMERA: Matches globalContinuity.cameraAxis EXACTLY
6. MOTION: Matches globalContinuity.motionEnergy
7. COLOR: Matches globalContinuity.colorPalette EXACTLY

You must ALSO output the scene-specific continuity constraints.
These MUST be consistent with global constraints but specific to this scene.

OUTPUT FORMAT:
{
  "sceneId": "scene_XX",
  "visualPrompt": "Your detailed visual prompt (80-120 words)",
  "sceneConstraints": {
    "lighting": "Scene-specific lighting that matches global",
    "cameraAxis": "Scene-specific camera that matches global",
    "motionEnergy": "Scene-specific motion",
    "colorPalette": "Scene-specific colors that match global",
    "environmentType": "Scene-specific environment"
  }
}`;

/**
 * Output schema for visual prompt generation
 */
const VisualPromptOutputSchema = z.object({
  sceneId: z.string().min(1),
  visualPrompt: z.string().min(50),
  sceneConstraints: ContinuityConstraintsSchema,
});

/**
 * Configuration for visual generation
 */
export interface VisualLockerConfig {
  outputDir: string;
  seed: number;
}

/**
 * Input for visual locking
 */
export interface VisualLockerInput {
  trend: Trend;
  scene: Scene;
  allScenes: Scene[];
  globalContinuity: ContinuityConstraints;
  config: VisualLockerConfig;
}

/**
 * Lock visuals for a single scene
 *
 * This is a PURE FUNCTION that:
 * 1. Takes scene + global continuity constraints
 * 2. Generates visual prompt that ENFORCES constraints
 * 3. Generates concept image
 * 4. Returns VisualLockerDelta
 *
 * NO STATE MUTATION. Returns delta only.
 */
export async function lockSceneVisuals(input: VisualLockerInput): Promise<VisualLockerDelta> {
  const { trend, scene, allScenes, globalContinuity, config } = input;

  console.log(`[VisualLocker] Locking visuals for ${scene.sceneId} (seed: ${config.seed})...`);

  const sceneIndex = allScenes.findIndex((s) => s.sceneId === scene.sceneId);
  const totalScenes = allScenes.length;

  // Build prompt with ENFORCED constraints
  const prompt = `Generate a visual prompt for this scene.

TREND CONTEXT:
- Name: ${trend.name}
- Promise: ${trend.promise}

SCENE DETAILS:
- Scene ${sceneIndex + 1} of ${totalScenes}
- Scene ID: ${scene.sceneId}
- Intent: ${scene.intent}
- Absurdity Level: ${scene.absurdityLevel}/10

===== GLOBAL CONTINUITY CONSTRAINTS (MUST MATCH EXACTLY) =====
LIGHTING: ${globalContinuity.lighting}
CAMERA AXIS: ${globalContinuity.cameraAxis}
MOTION ENERGY: ${globalContinuity.motionEnergy}
COLOR PALETTE: ${globalContinuity.colorPalette}
ENVIRONMENT TYPE: ${globalContinuity.environmentType}
===============================================================

${sceneIndex > 0 ? `PREVIOUS SCENE: ${allScenes[sceneIndex - 1].intent}` : "FIRST SCENE"}
${sceneIndex < totalScenes - 1 ? `NEXT SCENE: ${allScenes[sceneIndex + 1].intent}` : "FINAL SCENE"}

Seed: ${config.seed}

REQUIREMENTS:
1. Your visualPrompt MUST incorporate ALL global constraints verbatim
2. Your sceneConstraints MUST be consistent with global constraints
3. Shot type should match absurdity level:
   - Level 1-3: Wide shot (establishing)
   - Level 4-6: Medium shot (building)
   - Level 7-10: Close-up or medium-close (intensity)

Output ONLY the JSON object.`;

  // Call Gemini Flash
  const rawOutput = await generateJson<unknown>({
    model: "flash",
    prompt,
    systemInstruction: VISUAL_PROMPT_SYSTEM,
    temperature: 0.4 + (config.seed % 100) / 1000, // Low temp for consistency
    maxOutputTokens: 1024,
  });

  // Validate output
  const result = VisualPromptOutputSchema.safeParse({
    ...(rawOutput as object),
    sceneId: scene.sceneId, // Ensure correct scene ID
  });

  if (!result.success) {
    throw new Error(
      `Visual Locker output validation failed:\n${JSON.stringify(result.error.issues, null, 2)}\n\nRaw output:\n${JSON.stringify(rawOutput, null, 2)}`
    );
  }

  const { visualPrompt, sceneConstraints } = result.data;

  // Validate that scene constraints are consistent with global
  validateConstraintConsistency(sceneConstraints, globalContinuity, scene.sceneId);

  // Generate concept image
  const imagePath = path.join(config.outputDir, "scenes", `${scene.sceneId}_concept.png`);
  const imagePrompt = buildImagePrompt(visualPrompt, globalContinuity);

  console.log(`[VisualLocker] Generating concept image for ${scene.sceneId}...`);
  const conceptImagePath = await generateImage({
    prompt: imagePrompt,
    outputPath: imagePath,
    aspectRatio: "16:9",
  });

  console.log(`[VisualLocker] Locked ${scene.sceneId}:`);
  console.log(`  - Prompt: ${visualPrompt.substring(0, 60)}...`);
  console.log(`  - Image: ${conceptImagePath}`);
  console.log(`  - Constraints validated against global`);

  // Return delta
  return {
    sceneId: scene.sceneId,
    visualPrompt,
    continuityConstraints: sceneConstraints,
    conceptImagePath,
  };
}

/**
 * Build image generation prompt with enforced constraints
 */
function buildImagePrompt(visualPrompt: string, globalContinuity: ContinuityConstraints): string {
  return `Cinematic still frame. ${visualPrompt}

TECHNICAL REQUIREMENTS:
- Lighting: ${globalContinuity.lighting}
- Camera: ${globalContinuity.cameraAxis}
- Color grading: ${globalContinuity.colorPalette}
- Environment: ${globalContinuity.environmentType}

High quality, 8K resolution, photorealistic, professional cinematography, documentary style.`;
}

/**
 * Validate that scene constraints don't contradict global constraints
 */
function validateConstraintConsistency(
  scene: ContinuityConstraints,
  global: ContinuityConstraints,
  sceneId: string
): void {
  // Check for obvious contradictions
  const checks = [
    {
      field: "lighting",
      sceneValue: scene.lighting.toLowerCase(),
      globalValue: global.lighting.toLowerCase(),
    },
    {
      field: "colorPalette",
      sceneValue: scene.colorPalette.toLowerCase(),
      globalValue: global.colorPalette.toLowerCase(),
    },
    {
      field: "environmentType",
      sceneValue: scene.environmentType.toLowerCase(),
      globalValue: global.environmentType.toLowerCase(),
    },
  ];

  // Check for contradictory keywords
  const contradictoryPairs = [
    ["warm", "cold"],
    ["bright", "dark"],
    ["indoor", "outdoor"],
    ["natural", "artificial"],
    ["soft", "harsh"],
  ];

  for (const check of checks) {
    for (const [word1, word2] of contradictoryPairs) {
      const globalHas1 = check.globalValue.includes(word1);
      const globalHas2 = check.globalValue.includes(word2);
      const sceneHas1 = check.sceneValue.includes(word1);
      const sceneHas2 = check.sceneValue.includes(word2);

      if ((globalHas1 && sceneHas2) || (globalHas2 && sceneHas1)) {
        console.warn(
          `[VisualLocker] WARNING: Potential constraint contradiction in ${sceneId}.${check.field}: ` +
          `global="${check.globalValue}" vs scene="${check.sceneValue}"`
        );
      }
    }
  }
}

/**
 * Lock visuals for all scenes
 *
 * Processes scenes SEQUENTIALLY to maintain consistency
 * Returns array of deltas
 */
export async function lockAllVisuals(
  trend: Trend,
  scenes: Scene[],
  globalContinuity: ContinuityConstraints,
  config: VisualLockerConfig
): Promise<VisualLockerDelta[]> {
  console.log(`[VisualLocker] Locking visuals for ${scenes.length} scenes...`);

  const results: VisualLockerDelta[] = [];

  // Process sequentially for consistency
  for (const scene of scenes) {
    const result = await lockSceneVisuals({
      trend,
      scene,
      allScenes: scenes,
      globalContinuity,
      config,
    });
    results.push(result);
  }

  console.log(`[VisualLocker] All visuals locked with global continuity enforced`);
  return results;
}
