import { generateJson } from "../services/geminiClient.js";
import { z } from "zod";
import {
  type EscalationPlannerDelta,
  type Trend,
  type Scene,
  type ContinuityConstraints,
  SceneSchema,
  ContinuityConstraintsSchema,
} from "../orchestrator/projectState.js";

// ============================================================================
// ESCALATION PLANNER AGENT
// ============================================================================
// Model: Gemini Pro
// Responsibility: Convert trend into 4-6 escalating scenes WITH continuity
// Input: Validated Trend object, seed
// Output: EscalationPlannerDelta (scenes + globalContinuity)
//
// CRITICAL: This agent establishes GLOBAL continuity constraints
// that all subsequent agents must respect.
// ============================================================================

/**
 * System instruction for the Escalation Planner Agent
 */
const SYSTEM_INSTRUCTION = `You are an Escalation Planner Agent for a satirical video production pipeline.

Your task is to take a cultural trend and plan a 4-6 scene video that ESCALATES the trend to its logical extreme.

ESCALATION PRINCIPLES:
1. Start NORMAL - Scene 1 should be completely believable
2. Each scene BUILDS on the previous one
3. The escalation must feel INEVITABLE, not random
4. The final scene reaches the "collapse point" where absurdity is undeniable
5. NO JOKES - The humor comes from the escalation itself

SCENE REQUIREMENTS:
- Each scene is 5-8 seconds of video
- NO DIALOGUE - This is visual storytelling only
- Each scene shows a BEHAVIOR, not a concept
- Absurdity levels must strictly increase (1-10 scale)

CONTINUITY REQUIREMENTS:
You MUST establish GLOBAL continuity constraints that apply to ALL scenes:
- LIGHTING: Consistent light source direction, quality, color temperature
- CAMERA AXIS: Consistent camera height and angle philosophy
- MOTION ENERGY: The pacing/energy level that escalates appropriately
- COLOR PALETTE: Consistent color grading across all scenes
- ENVIRONMENT TYPE: The type of setting (can evolve but should feel connected)

These constraints will be ENFORCED in video generation. Be specific.

OUTPUT FORMAT:
{
  "globalContinuity": {
    "lighting": "Specific lighting description (e.g., 'soft key light camera-left, fill from window, warm color temperature 5500K')",
    "cameraAxis": "Specific camera philosophy (e.g., 'eye-level, locked tripod, subtle dolly movements only')",
    "motionEnergy": "Energy description (e.g., 'deliberate, measured movements, no fast cuts, building tension')",
    "colorPalette": "Color description (e.g., 'warm neutrals, slight desaturation, earth tones')",
    "environmentType": "Setting description (e.g., 'modern urban apartment, clean minimalist aesthetic')"
  },
  "scenes": [
    {
      "sceneId": "scene_01",
      "intent": "Detailed description of what happens (2-3 sentences)",
      "absurdityLevel": 2
    },
    ...
  ]
}`;

/**
 * Full escalation output schema
 */
const EscalationOutputSchema = z.object({
  globalContinuity: ContinuityConstraintsSchema,
  scenes: z
    .array(
      z.object({
        sceneId: z.string().min(1),
        intent: z.string().min(1),
        absurdityLevel: z.number().min(1).max(10),
      })
    )
    .min(4)
    .max(6),
});

/**
 * Input for escalation planning
 */
export interface EscalationPlannerInput {
  trend: Trend;
  seed: number;
  sceneCount?: number; // 4-6, defaults to 5
}

/**
 * Plan escalating scenes for a trend
 *
 * This is a PURE FUNCTION that:
 * 1. Takes a validated Trend object and seed
 * 2. Generates global continuity constraints
 * 3. Generates 4-6 escalating scene descriptions
 * 4. Validates all output
 * 5. Returns EscalationPlannerDelta
 *
 * NO STATE MUTATION. Returns delta only.
 */
export async function planEscalation(input: EscalationPlannerInput): Promise<EscalationPlannerDelta> {
  console.log(`[EscalationPlanner] Planning escalation for trend: "${input.trend.name}" (seed: ${input.seed})`);

  const sceneCount = input.sceneCount || 5;

  const prompt = `Plan a ${sceneCount}-scene video escalation for this trend:

TREND: ${input.trend.name}
PROMISE: ${input.trend.promise}
BEHAVIOR PATTERN: ${input.trend.behaviorPattern}
ALGORITHMIC HOOK: ${input.trend.algorithmicHook}
COLLAPSE POINT: ${input.trend.collapsePoint}

Seed for this generation: ${input.seed}

Create exactly ${sceneCount} scenes that escalate from "believable behavior" to "collapse point".

CRITICAL REQUIREMENTS:
1. You MUST define globalContinuity constraints FIRST
2. Scene IDs must be: scene_01, scene_02, scene_03, etc.
3. Absurdity levels must strictly increase from scene to scene
4. Start around level 2-3, end at level 9-10
5. Each intent must describe a specific VISUAL moment
6. NO dialogue, NO text, NO narration

The globalContinuity you define will be ENFORCED during video generation.
Be specific and consistent.

Output ONLY the JSON object.`;

  // Call Gemini Pro
  const rawOutput = await generateJson<unknown>({
    model: "pro",
    prompt,
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.6 + (input.seed % 100) / 500,
    maxOutputTokens: 2048,
  });

  // Validate the output
  const result = EscalationOutputSchema.safeParse(rawOutput);
  if (!result.success) {
    throw new Error(
      `Escalation Planner output validation failed:\n${JSON.stringify(result.error.issues, null, 2)}\n\nRaw output:\n${JSON.stringify(rawOutput, null, 2)}`
    );
  }

  const { globalContinuity, scenes: rawScenes } = result.data;

  // Additional validation: absurdity levels must escalate
  for (let i = 1; i < rawScenes.length; i++) {
    if (rawScenes[i].absurdityLevel <= rawScenes[i - 1].absurdityLevel) {
      throw new Error(
        `Absurdity must escalate: ${rawScenes[i - 1].sceneId} (${rawScenes[i - 1].absurdityLevel}) >= ${rawScenes[i].sceneId} (${rawScenes[i].absurdityLevel})`
      );
    }
  }

  // Validate scene IDs are sequential
  for (let i = 0; i < rawScenes.length; i++) {
    const expectedId = `scene_${String(i + 1).padStart(2, "0")}`;
    if (rawScenes[i].sceneId !== expectedId) {
      throw new Error(
        `Invalid scene ID: expected ${expectedId}, got ${rawScenes[i].sceneId}`
      );
    }
  }

  // Convert to Scene objects (without optional fields yet)
  const scenes: Scene[] = rawScenes.map((s) => ({
    sceneId: s.sceneId,
    intent: s.intent,
    absurdityLevel: s.absurdityLevel,
  }));

  console.log(`[EscalationPlanner] Planned ${scenes.length} scenes with global continuity:`);
  console.log(`  - Lighting: ${globalContinuity.lighting}`);
  console.log(`  - Camera: ${globalContinuity.cameraAxis}`);
  console.log(`  - Motion: ${globalContinuity.motionEnergy}`);
  console.log(`  - Palette: ${globalContinuity.colorPalette}`);
  console.log(`  - Environment: ${globalContinuity.environmentType}`);

  for (const scene of scenes) {
    console.log(
      `  - ${scene.sceneId} (absurdity: ${scene.absurdityLevel}): ${scene.intent.substring(0, 50)}...`
    );
  }

  // Return delta - orchestrator will apply it
  return {
    scenes,
    globalContinuity,
  };
}
