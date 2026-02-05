import { generateJson, generateImage } from "../services/geminiClient.js";
import { validateVisualPromptOutput } from "../orchestrator/validators.js";
import type { Scene, Trend } from "../orchestrator/projectState.js";
import * as path from "node:path";

// ============================================================================
// VISUAL LOCKER AGENT
// ============================================================================
// Model: Gemini Flash for prompts, Imagen for images
// Responsibility: Generate visual prompts and concept art for each scene
// Input: Scene array with intents
// Output: Visual prompts and PNG concept images
// ============================================================================

/**
 * System instruction for visual prompt generation
 */
const VISUAL_PROMPT_SYSTEM = `You are a Visual Prompt Engineer for a video production pipeline.

Your task is to convert scene intents into precise, cinematic visual prompts for image and video generation.

VISUAL PROMPT PRINCIPLES:
1. Be SPECIFIC - Every element must be describable
2. Be CINEMATIC - Think like a cinematographer
3. Be CONSISTENT - Maintain visual language across scenes
4. NO ABSTRACTION - Describe what the CAMERA SEES

PROMPT STRUCTURE:
1. SHOT TYPE: Wide/Medium/Close-up/Extreme close-up
2. SUBJECT: Who/what is in frame, their pose/action
3. SETTING: Where this takes place, time of day
4. LIGHTING: Natural/artificial, mood, shadows
5. STYLE: Documentary/cinematic/surreal, color palette

VISUAL STYLE GUIDELINES:
- Modern documentary aesthetic
- Slightly desaturated colors
- Natural lighting preferred
- Clean, minimalist environments
- Subtle visual tension in later scenes

OUTPUT FORMAT:
{
  "sceneId": "scene_01",
  "visualPrompt": "Your detailed visual prompt here (50-100 words)"
}

EXAMPLE:
Intent: "Person labels all items in their home with 'processed' stickers"
Visual Prompt: "Medium shot, well-lit modern apartment kitchen. A person in casual clothes methodically applies small white labels to items in their cabinet. Morning sunlight through window. Clean, minimalist aesthetic. Documentary style. Soft focus on background revealing more labeled items. Neutral color palette with white and light wood tones."`;

/**
 * Configuration for visual generation
 */
export interface VisualLockerConfig {
  outputDir: string;
  imageAspectRatio?: "1:1" | "16:9" | "9:16";
}

/**
 * Input for visual locking
 */
export interface VisualLockerInput {
  trend: Trend;
  scenes: Scene[];
  config: VisualLockerConfig;
}

/**
 * Result of visual locking for a single scene
 */
export interface VisualLockerResult {
  sceneId: string;
  visualPrompt: string;
  conceptImagePath: string;
}

/**
 * Generate visual prompt for a single scene
 *
 * Pure function - no state mutation
 */
async function generateVisualPrompt(
  trend: Trend,
  scene: Scene,
  allScenes: Scene[]
): Promise<string> {
  console.log(`[VisualLocker] Generating visual prompt for ${scene.sceneId}...`);

  const sceneIndex = allScenes.findIndex((s) => s.sceneId === scene.sceneId);
  const totalScenes = allScenes.length;

  const prompt = `Generate a visual prompt for this scene:

TREND CONTEXT:
- Name: ${trend.name}
- Promise: ${trend.promise}
- Behavior: ${trend.behaviorPattern}

SCENE DETAILS:
- Scene ${sceneIndex + 1} of ${totalScenes}
- Scene ID: ${scene.sceneId}
- Intent: ${scene.intent}
- Absurdity Level: ${scene.absurdityLevel}/10

${sceneIndex > 0 ? `PREVIOUS SCENE: ${allScenes[sceneIndex - 1].intent}` : ""}
${sceneIndex < totalScenes - 1 ? `NEXT SCENE: ${allScenes[sceneIndex + 1].intent}` : ""}

Generate a detailed visual prompt that:
1. Captures this specific moment
2. Uses ${scene.absurdityLevel <= 4 ? "documentary realism" : scene.absurdityLevel <= 7 ? "heightened realism" : "subtle surrealism"}
3. Maintains visual continuity with other scenes
4. Is optimized for AI image generation

Output ONLY the JSON object.`;

  const rawOutput = await generateJson<unknown>({
    model: "flash",
    prompt,
    systemInstruction: VISUAL_PROMPT_SYSTEM,
    temperature: 0.5,
    maxOutputTokens: 512,
  });

  const result = validateVisualPromptOutput({
    ...(rawOutput as object),
    sceneId: scene.sceneId,
  });

  return result.visualPrompt;
}

/**
 * Generate concept image for a scene
 *
 * Pure function - only writes to specified output path
 */
async function generateConceptImage(
  visualPrompt: string,
  outputPath: string
): Promise<string> {
  console.log(`[VisualLocker] Generating concept image...`);

  // Enhance prompt for image generation
  const imagePrompt = `Cinematic still frame. ${visualPrompt}. High quality, 8K, photorealistic, professional photography.`;

  const imagePath = await generateImage({
    prompt: imagePrompt,
    outputPath,
    aspectRatio: "16:9",
  });

  return imagePath;
}

/**
 * Lock visuals for a single scene
 */
export async function lockSceneVisuals(
  trend: Trend,
  scene: Scene,
  allScenes: Scene[],
  config: VisualLockerConfig
): Promise<VisualLockerResult> {
  console.log(`[VisualLocker] Locking visuals for ${scene.sceneId}...`);

  // Generate visual prompt
  const visualPrompt = await generateVisualPrompt(trend, scene, allScenes);

  // Generate concept image
  const imagePath = path.join(config.outputDir, "scenes", `${scene.sceneId}_concept.png`);
  const conceptImagePath = await generateConceptImage(visualPrompt, imagePath);

  console.log(`[VisualLocker] Locked ${scene.sceneId}:`);
  console.log(`  - Prompt: ${visualPrompt.substring(0, 80)}...`);
  console.log(`  - Image: ${conceptImagePath}`);

  return {
    sceneId: scene.sceneId,
    visualPrompt,
    conceptImagePath,
  };
}

/**
 * Lock visuals for all scenes
 *
 * Processes scenes sequentially to maintain consistency
 */
export async function lockAllVisuals(
  input: VisualLockerInput
): Promise<VisualLockerResult[]> {
  console.log(`[VisualLocker] Locking visuals for ${input.scenes.length} scenes...`);

  const results: VisualLockerResult[] = [];

  // Process sequentially for consistency
  for (const scene of input.scenes) {
    const result = await lockSceneVisuals(
      input.trend,
      scene,
      input.scenes,
      input.config
    );
    results.push(result);
  }

  console.log(`[VisualLocker] All visuals locked`);
  return results;
}
