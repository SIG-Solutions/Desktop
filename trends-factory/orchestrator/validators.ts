import { z } from "zod";
import {
  TrendSchema,
  SceneSchema,
  ProjectState,
  Trend,
  Scene,
} from "./projectState.js";

// ============================================================================
// AGENT OUTPUT VALIDATORS
// ============================================================================

/**
 * Validates output from the Trend Synthesizer Agent
 */
export function validateTrendOutput(data: unknown): Trend {
  const result = TrendSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Trend Synthesizer output validation failed:\n${formatZodError(result.error)}`
    );
  }
  return result.data;
}

/**
 * Scene escalation output schema - what the Escalation Planner produces
 */
export const EscalationOutputSchema = z.object({
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

export type EscalationOutput = z.infer<typeof EscalationOutputSchema>;

/**
 * Validates output from the Escalation Planner Agent
 */
export function validateEscalationOutput(data: unknown): EscalationOutput {
  const result = EscalationOutputSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Escalation Planner output validation failed:\n${formatZodError(result.error)}`
    );
  }

  // Additional validation: absurdity levels must escalate
  const scenes = result.data.scenes;
  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i].absurdityLevel < scenes[i - 1].absurdityLevel) {
      throw new Error(
        `Absurdity levels must escalate: scene ${scenes[i].sceneId} (level ${scenes[i].absurdityLevel}) is lower than scene ${scenes[i - 1].sceneId} (level ${scenes[i - 1].absurdityLevel})`
      );
    }
  }

  return result.data;
}

/**
 * Visual prompt output schema - what the Visual Locker produces per scene
 */
export const VisualPromptOutputSchema = z.object({
  sceneId: z.string().min(1),
  visualPrompt: z.string().min(10),
});

export type VisualPromptOutput = z.infer<typeof VisualPromptOutputSchema>;

/**
 * Validates output from the Visual Locker Agent
 */
export function validateVisualPromptOutput(data: unknown): VisualPromptOutput {
  const result = VisualPromptOutputSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Visual Locker output validation failed:\n${formatZodError(result.error)}`
    );
  }
  return result.data;
}

/**
 * Video generation parameters schema
 */
export const VideoGenerationParamsSchema = z.object({
  sceneId: z.string().min(1),
  prompt: z.string().min(1),
  imagePath: z.string().optional(),
  durationSeconds: z.number().min(5).max(10).default(6),
});

export type VideoGenerationParams = z.infer<typeof VideoGenerationParamsSchema>;

/**
 * Validates video generation parameters
 */
export function validateVideoGenerationParams(
  data: unknown
): VideoGenerationParams {
  const result = VideoGenerationParamsSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Video generation params validation failed:\n${formatZodError(result.error)}`
    );
  }
  return result.data;
}

// ============================================================================
// STATE VALIDATION HELPERS
// ============================================================================

/**
 * Validates that state is ready for a specific stage
 */
export function validateStateForStage(
  state: ProjectState,
  requiredStage: ProjectState["stage"]
): void {
  if (state.stage !== requiredStage) {
    throw new Error(
      `Invalid state: expected stage ${requiredStage}, got ${state.stage}`
    );
  }
}

/**
 * Validates that state has a trend defined
 */
export function validateHasTrend(state: ProjectState): asserts state is ProjectState & { trend: Trend } {
  if (!state.trend) {
    throw new Error("State is missing required trend data");
  }
}

/**
 * Validates that state has scenes defined
 */
export function validateHasScenes(state: ProjectState): void {
  if (state.scenes.length === 0) {
    throw new Error("State is missing required scenes data");
  }
}

/**
 * Validates that all scenes have visual prompts
 */
export function validateScenesHaveVisualPrompts(state: ProjectState): void {
  for (const scene of state.scenes) {
    if (!scene.visualPrompt) {
      throw new Error(`Scene ${scene.sceneId} is missing visual prompt`);
    }
  }
}

/**
 * Validates that all scenes have concept images
 */
export function validateScenesHaveConceptImages(state: ProjectState): void {
  for (const scene of state.scenes) {
    if (!scene.conceptImagePath) {
      throw new Error(`Scene ${scene.sceneId} is missing concept image`);
    }
  }
}

/**
 * Validates that all scenes have video clips
 */
export function validateScenesHaveVideoClips(state: ProjectState): void {
  for (const scene of state.scenes) {
    if (!scene.videoClipPath) {
      throw new Error(`Scene ${scene.sceneId} is missing video clip`);
    }
  }
}

// ============================================================================
// ERROR FORMATTING
// ============================================================================

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return `  - ${path ? `${path}: ` : ""}${issue.message}`;
    })
    .join("\n");
}

// ============================================================================
// JSON PARSING WITH VALIDATION
// ============================================================================

/**
 * Safely parses JSON and validates against a schema
 */
export function parseAndValidate<T>(
  json: string,
  schema: z.ZodSchema<T>,
  context: string
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from ${context}: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Validation failed for ${context}:\n${formatZodError(result.error)}\n\nReceived: ${JSON.stringify(parsed, null, 2)}`
    );
  }

  return result.data;
}

/**
 * Extracts JSON from LLM response (handles markdown code blocks)
 */
export function extractJsonFromResponse(response: string): string {
  // Try to find JSON in code blocks first
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON object or array
  const jsonMatch = response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  // Return as-is and let JSON.parse fail with a meaningful error
  return response.trim();
}
