import { generateJson } from "../services/geminiClient.js";
import {
  validateEscalationOutput,
  type EscalationOutput,
} from "../orchestrator/validators.js";
import type { Trend, Scene } from "../orchestrator/projectState.js";

// ============================================================================
// ESCALATION PLANNER AGENT
// ============================================================================
// Model: Gemini Pro
// Responsibility: Convert trend into 4-6 escalating scenes
// Input: Validated Trend object
// Output: Array of Scene objects with escalating absurdity
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

VISUAL STORYTELLING:
- Think like a documentary filmmaker
- Each scene should be a single, clear visual moment
- Focus on a PERSON doing a SPECIFIC THING
- Include environmental details that reinforce the escalation

OUTPUT FORMAT:
{
  "scenes": [
    {
      "sceneId": "scene_01",
      "intent": "Detailed description of what happens in this scene (2-3 sentences)",
      "absurdityLevel": 2
    },
    ...
  ]
}

ESCALATION EXAMPLE (for "Inbox Zero Living"):
Scene 1 (absurdity: 2): Person labels all items in their home with "processed" stickers
Scene 2 (absurdity: 4): Person has a "daily review" of their physical possessions, archiving items
Scene 3 (absurdity: 6): Person's home is nearly empty, everything in labeled storage bins
Scene 4 (absurdity: 8): Person wears a label maker around their neck, tags their food before eating
Scene 5 (absurdity: 10): Person stands in an empty white room with only a single chair, looking peaceful`;

/**
 * Input for escalation planning
 */
export interface EscalationPlannerInput {
  trend: Trend;
  sceneCount?: number; // 4-6, defaults to 5
}

/**
 * Plan escalating scenes for a trend
 *
 * This is a pure function that:
 * 1. Takes a validated Trend object
 * 2. Generates 4-6 escalating scene descriptions
 * 3. Validates output structure and escalation logic
 * 4. Returns validated Scene array
 *
 * No side effects. No state mutation.
 */
export async function planEscalation(input: EscalationPlannerInput): Promise<Scene[]> {
  console.log(`[EscalationPlanner] Planning escalation for trend: "${input.trend.name}"`);

  const sceneCount = input.sceneCount || 5;

  const prompt = `Plan a ${sceneCount}-scene video escalation for this trend:

TREND: ${input.trend.name}
PROMISE: ${input.trend.promise}
BEHAVIOR PATTERN: ${input.trend.behaviorPattern}
COLLAPSE POINT: ${input.trend.collapsePoint}

Create exactly ${sceneCount} scenes that escalate from "believable behavior" to "collapse point".

Requirements:
- Scene IDs must be: scene_01, scene_02, scene_03, etc.
- Absurdity levels must strictly increase from scene to scene
- Start around level 2-3, end at level 9-10
- Each intent must describe a specific VISUAL moment
- NO dialogue, NO text, NO narration

Output ONLY the JSON object.`;

  // Call Gemini Pro
  const rawOutput = await generateJson<unknown>({
    model: "pro",
    prompt,
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.7,
    maxOutputTokens: 2048,
  });

  // Validate the output
  const escalation = validateEscalationOutput(rawOutput);

  // Convert to Scene objects
  const scenes: Scene[] = escalation.scenes.map((s) => ({
    sceneId: s.sceneId,
    intent: s.intent,
    absurdityLevel: s.absurdityLevel,
  }));

  console.log(`[EscalationPlanner] Planned ${scenes.length} scenes`);
  for (const scene of scenes) {
    console.log(
      `  - ${scene.sceneId} (absurdity: ${scene.absurdityLevel}): ${scene.intent.substring(0, 60)}...`
    );
  }

  return scenes;
}

/**
 * Validate that scenes follow proper escalation
 * Can be used as an additional check
 */
export function validateEscalationLogic(scenes: Scene[]): void {
  if (scenes.length < 4 || scenes.length > 6) {
    throw new Error(`Invalid scene count: ${scenes.length}. Must be 4-6 scenes.`);
  }

  // Check absurdity escalation
  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i].absurdityLevel <= scenes[i - 1].absurdityLevel) {
      throw new Error(
        `Absurdity must escalate: ${scenes[i - 1].sceneId} (${scenes[i - 1].absurdityLevel}) >= ${scenes[i].sceneId} (${scenes[i].absurdityLevel})`
      );
    }
  }

  // Check scene IDs are sequential
  for (let i = 0; i < scenes.length; i++) {
    const expectedId = `scene_${String(i + 1).padStart(2, "0")}`;
    if (scenes[i].sceneId !== expectedId) {
      throw new Error(
        `Invalid scene ID: expected ${expectedId}, got ${scenes[i].sceneId}`
      );
    }
  }

  console.log("[EscalationPlanner] Escalation logic validated");
}
