import { generateJson } from "../services/geminiClient.js";
import { validateTrendOutput } from "../orchestrator/validators.js";
import type { Trend } from "../orchestrator/projectState.js";

// ============================================================================
// TREND SYNTHESIZER AGENT
// ============================================================================
// Model: Gemini Pro
// Responsibility: Generate fake but believable trends
// Input: None (or optional seed/theme)
// Output: Strict JSON trend object
// ============================================================================

/**
 * System instruction for the Trend Synthesizer Agent
 * This agent generates satirical but believable cultural/social trends
 */
const SYSTEM_INSTRUCTION = `You are a Trend Synthesizer Agent for a satirical video production pipeline.

Your task is to generate FAKE but BELIEVABLE cultural, social, or lifestyle trends. These trends should:

1. Sound plausible enough that someone might think they're real
2. Have an internal logic that makes sense initially
3. Contain a subtle absurdity that becomes apparent upon reflection
4. Reference real cultural phenomena without being directly tied to them

CRITICAL RULES:
- NO JOKES. The humor comes from the escalation, not from being funny.
- NO EXAGGERATION. The trend should sound like a real New York Times trend piece.
- NO POP CULTURE REFERENCES. This is about behavioral patterns, not fandoms.
- Be specific. Use precise language and concrete examples.

OUTPUT FORMAT:
You must output ONLY a valid JSON object with these exact fields:
{
  "name": "Short, catchy trend name (2-4 words)",
  "promise": "What the trend claims to deliver (1-2 sentences)",
  "behaviorPattern": "The specific actions adherents take (2-3 sentences)",
  "collapsePoint": "The logical endpoint where the trend breaks down (1-2 sentences)"
}

EXAMPLES OF GOOD TRENDS:
- "Inbox Zero Living" - Applying email management to physical possessions
- "Scheduled Spontaneity" - Planning random moments to feel more alive
- "Authentic Personal Branding" - Being your true self, but optimized

EXAMPLES OF BAD TRENDS (DO NOT DO):
- Anything involving influencers or social media specifically
- Trends that are obviously jokes
- Trends that are too on-the-nose political`;

/**
 * Optional theme/seed for trend generation
 */
export interface TrendSynthesizerInput {
  theme?: string;
  avoid?: string[];
}

/**
 * Synthesize a new trend
 *
 * This is a pure function that:
 * 1. Takes optional input parameters
 * 2. Calls Gemini Pro with structured prompts
 * 3. Validates the output
 * 4. Returns a validated Trend object
 *
 * No side effects. No state mutation.
 */
export async function synthesizeTrend(input: TrendSynthesizerInput = {}): Promise<Trend> {
  console.log("[TrendSynthesizer] Starting trend synthesis...");

  // Build the prompt
  let prompt = "Generate a new satirical but believable cultural trend.";

  if (input.theme) {
    prompt += `\n\nTheme hint: ${input.theme}`;
  }

  if (input.avoid && input.avoid.length > 0) {
    prompt += `\n\nAvoid these topics: ${input.avoid.join(", ")}`;
  }

  prompt += `

Generate one trend now. Output ONLY the JSON object, nothing else.`;

  // Call Gemini Pro
  const rawOutput = await generateJson<unknown>({
    model: "pro",
    prompt,
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.8, // Higher temp for creativity
    maxOutputTokens: 1024,
  });

  // Validate the output - will throw if invalid
  const trend = validateTrendOutput(rawOutput);

  console.log(`[TrendSynthesizer] Generated trend: "${trend.name}"`);
  console.log(`[TrendSynthesizer] Promise: ${trend.promise}`);

  return trend;
}

/**
 * Generate multiple trend options and select the best one
 * Useful for getting variety without manual intervention
 */
export async function synthesizeTrendWithVariants(
  input: TrendSynthesizerInput = {},
  variants: number = 3
): Promise<{ selected: Trend; alternatives: Trend[] }> {
  console.log(`[TrendSynthesizer] Generating ${variants} trend variants...`);

  const trends: Trend[] = [];

  for (let i = 0; i < variants; i++) {
    const trend = await synthesizeTrend({
      ...input,
      // Add previous trends to avoid list to get variety
      avoid: [...(input.avoid || []), ...trends.map((t) => t.name)],
    });
    trends.push(trend);
  }

  // For now, just select the first one
  // In the future, could add ranking logic
  const [selected, ...alternatives] = trends;

  console.log(`[TrendSynthesizer] Selected trend: "${selected.name}"`);

  return { selected, alternatives };
}
