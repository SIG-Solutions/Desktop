import { generateJson } from "../services/geminiClient.js";
import { z } from "zod";
import {
  type TrendSynthesizerDelta,
  type TrendQualityDelta,
  PatternAnalysisSchema,
  TrendSchema,
  TrendQualitySchema,
  type PatternAnalysis,
  type Trend,
  type TrendQuality,
} from "../orchestrator/projectState.js";

// ============================================================================
// TREND SYNTHESIZER AGENT
// ============================================================================
// Model: Gemini Pro
// Responsibility: Generate fake but believable trends WITH research backing
// Input: Seed for determinism, optional theme
// Output: TrendSynthesizerDelta (patternAnalysis + trend)
//
// CRITICAL: This agent MUST produce two layers:
// 1. patternAnalysis - The research backing (validated, then discarded)
// 2. trend - The actual trend (persisted)
// ============================================================================

const QUALITY_THRESHOLD = 6.5;
const MAX_REGENERATION_ATTEMPTS = 3;

/**
 * System instruction for research-backed trend synthesis
 */
const SYSTEM_INSTRUCTION = `You are a Trend Synthesizer Agent for a satirical video production pipeline.

Your task is to generate FAKE but BELIEVABLE cultural, social, or lifestyle trends.

CRITICAL: You must perform RESEARCH ANALYSIS before generating a trend.

RESEARCH PHASE (required):
1. FORMAT PATTERNS: What content formats succeed on social media?
2. BEHAVIOR PATTERNS: What human behaviors are being optimized/performed?
3. ALGORITHMIC INCENTIVES: What gets rewarded by platform algorithms?
4. LIFECYCLE MAPPING: How do trends emerge, peak, and collapse?

Only AFTER this analysis should you generate a trend.

TREND REQUIREMENTS:
- Sound plausible enough that someone might think it's real
- Have an internal logic that makes sense initially
- Contain a subtle absurdity that becomes apparent upon reflection
- Have a clear "algorithmic hook" - why would this spread?
- Have a clear "collapse point" - where does this break down?

CRITICAL RULES:
- NO JOKES. The humor comes from the escalation, not from being funny.
- NO EXAGGERATION. The trend should sound like a real New York Times trend piece.
- NO POP CULTURE REFERENCES. This is about behavioral patterns, not fandoms.
- Be specific. Use precise language and concrete examples.

OUTPUT FORMAT (strict JSON):
{
  "patternAnalysis": {
    "formatPatterns": ["list of relevant content format observations"],
    "behaviorPatterns": ["list of relevant human behavior patterns"],
    "algorithmicIncentives": ["list of what algorithms reward"],
    "lifecycleMapping": ["list of trend lifecycle observations"]
  },
  "trend": {
    "name": "Short, catchy trend name (2-4 words)",
    "promise": "What the trend claims to deliver (1-2 sentences)",
    "behaviorPattern": "The specific actions adherents take (2-3 sentences)",
    "algorithmicHook": "Why this would spread on platforms (1-2 sentences)",
    "collapsePoint": "The logical endpoint where the trend breaks down (1-2 sentences)"
  }
}`;

/**
 * System instruction for quality assessment
 */
const QUALITY_ASSESSMENT_SYSTEM = `You are a Trend Quality Assessor for a satirical video production pipeline.

Your task is to evaluate a generated trend against strict quality criteria.

EVALUATION CRITERIA:

1. PLAUSIBILITY (0-10):
   - Does this sound like something that could actually happen?
   - Would a New York Times journalist write about this seriously?
   - Is it grounded in real human behavior?

2. CLONEABILITY (0-10):
   - Can regular people easily adopt this behavior?
   - Is it visually demonstrable?
   - Does it have a clear "before/after" or "doing it right/wrong"?

3. LIFECYCLE COMPLETENESS (0-10):
   - Is there a clear beginning (discovery)?
   - Is there a clear peak (mass adoption)?
   - Is there a clear collapse (absurdity revealed)?

SCORING:
- 8-10: Excellent, publishable quality
- 6-7: Acceptable, minor issues
- 4-5: Weak, significant issues
- 0-3: Reject, fundamental problems

OUTPUT FORMAT (strict JSON):
{
  "plausibilityScore": <number>,
  "cloneabilityScore": <number>,
  "lifecycleCompletenessScore": <number>,
  "overallScore": <number>,
  "passesThreshold": <boolean>,
  "rejectionReason": "<string or null>"
}`;

/**
 * Combined output schema for trend synthesis
 */
const TrendSynthesisOutputSchema = z.object({
  patternAnalysis: PatternAnalysisSchema,
  trend: TrendSchema,
});

/**
 * Input for trend synthesis
 */
export interface TrendSynthesizerInput {
  seed: number;
  theme?: string;
  avoid?: string[];
}

/**
 * Synthesize a new trend with research backing
 *
 * This is a PURE FUNCTION that:
 * 1. Takes seed and optional parameters
 * 2. Generates pattern analysis + trend
 * 3. Validates both layers
 * 4. Returns a TrendSynthesizerDelta
 *
 * NO STATE MUTATION. Returns delta only.
 */
export async function synthesizeTrend(input: TrendSynthesizerInput): Promise<TrendSynthesizerDelta> {
  console.log(`[TrendSynthesizer] Starting trend synthesis (seed: ${input.seed})...`);

  // Build the prompt with seed for reproducibility note
  let prompt = `Generate a new satirical but believable cultural trend.

Seed for this generation: ${input.seed}
(Use this seed to inform randomness in your analysis)`;

  if (input.theme) {
    prompt += `\n\nTheme hint: ${input.theme}`;
  }

  if (input.avoid && input.avoid.length > 0) {
    prompt += `\n\nAvoid these topics: ${input.avoid.join(", ")}`;
  }

  prompt += `

IMPORTANT: You MUST include the patternAnalysis section with your research backing.
This is not optional - it proves you've done the analytical work.

Generate now. Output ONLY the JSON object.`;

  // Call Gemini Pro with lower temperature for consistency
  const rawOutput = await generateJson<unknown>({
    model: "pro",
    prompt,
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.7 + (input.seed % 100) / 500, // Slight variation based on seed
    maxOutputTokens: 2048,
  });

  // Validate both layers - will throw if invalid
  const result = TrendSynthesisOutputSchema.safeParse(rawOutput);
  if (!result.success) {
    throw new Error(
      `Trend Synthesizer output validation failed:\n${JSON.stringify(result.error.issues, null, 2)}\n\nRaw output:\n${JSON.stringify(rawOutput, null, 2)}`
    );
  }

  const { patternAnalysis, trend } = result.data;

  console.log(`[TrendSynthesizer] Generated trend: "${trend.name}"`);
  console.log(`[TrendSynthesizer] Pattern analysis validated with ${patternAnalysis.formatPatterns.length} format patterns`);
  console.log(`[TrendSynthesizer] Algorithmic hook: ${trend.algorithmicHook}`);

  // Return delta - orchestrator will apply it
  return {
    patternAnalysis,
    trend,
  };
}

/**
 * Assess trend quality for the rejection gate
 *
 * PURE FUNCTION - returns TrendQualityDelta
 */
export async function assessTrendQuality(
  trend: Trend,
  patternAnalysis: PatternAnalysis
): Promise<TrendQualityDelta> {
  console.log(`[TrendSynthesizer] Assessing quality for trend: "${trend.name}"...`);

  const prompt = `Evaluate this trend:

TREND:
- Name: ${trend.name}
- Promise: ${trend.promise}
- Behavior Pattern: ${trend.behaviorPattern}
- Algorithmic Hook: ${trend.algorithmicHook}
- Collapse Point: ${trend.collapsePoint}

RESEARCH BACKING:
- Format Patterns: ${patternAnalysis.formatPatterns.join("; ")}
- Behavior Patterns: ${patternAnalysis.behaviorPatterns.join("; ")}
- Algorithmic Incentives: ${patternAnalysis.algorithmicIncentives.join("; ")}
- Lifecycle Mapping: ${patternAnalysis.lifecycleMapping.join("; ")}

Evaluate against all criteria. Be harsh but fair.
Threshold for passing: ${QUALITY_THRESHOLD}/10 overall.

Output ONLY the JSON object.`;

  const rawOutput = await generateJson<unknown>({
    model: "pro",
    prompt,
    systemInstruction: QUALITY_ASSESSMENT_SYSTEM,
    temperature: 0.3, // Low temperature for consistent evaluation
    maxOutputTokens: 512,
  });

  const result = TrendQualitySchema.safeParse(rawOutput);
  if (!result.success) {
    throw new Error(
      `Quality assessment validation failed:\n${JSON.stringify(result.error.issues, null, 2)}`
    );
  }

  const quality = result.data;

  // Override passesThreshold based on our threshold
  quality.passesThreshold = quality.overallScore >= QUALITY_THRESHOLD;

  if (!quality.passesThreshold && !quality.rejectionReason) {
    quality.rejectionReason = `Overall score ${quality.overallScore} below threshold ${QUALITY_THRESHOLD}`;
  }

  console.log(`[TrendSynthesizer] Quality scores:`);
  console.log(`  - Plausibility: ${quality.plausibilityScore}/10`);
  console.log(`  - Cloneability: ${quality.cloneabilityScore}/10`);
  console.log(`  - Lifecycle: ${quality.lifecycleCompletenessScore}/10`);
  console.log(`  - Overall: ${quality.overallScore}/10`);
  console.log(`  - Passes: ${quality.passesThreshold ? "YES" : "NO"}`);

  if (!quality.passesThreshold) {
    console.log(`  - Rejection reason: ${quality.rejectionReason}`);
  }

  return { trendQuality: quality };
}

/**
 * Synthesize trend with quality gate (rejection loop)
 *
 * This combines synthesis + assessment with automatic regeneration
 * Returns both deltas for the orchestrator to apply
 */
export async function synthesizeTrendWithQualityGate(
  input: TrendSynthesizerInput
): Promise<{ synthesis: TrendSynthesizerDelta; quality: TrendQualityDelta }> {
  let attempts = 0;
  let currentSeed = input.seed;

  while (attempts < MAX_REGENERATION_ATTEMPTS) {
    attempts++;
    console.log(`[TrendSynthesizer] Synthesis attempt ${attempts}/${MAX_REGENERATION_ATTEMPTS}...`);

    // Synthesize
    const synthesis = await synthesizeTrend({
      ...input,
      seed: currentSeed,
      avoid: [
        ...(input.avoid || []),
        // Add previously rejected trend names to avoid list
      ],
    });

    // Assess
    const quality = await assessTrendQuality(synthesis.trend, synthesis.patternAnalysis);

    if (quality.trendQuality.passesThreshold) {
      console.log(`[TrendSynthesizer] Trend passed quality gate on attempt ${attempts}`);
      return { synthesis, quality };
    }

    console.log(`[TrendSynthesizer] Trend rejected, regenerating...`);
    // Modify seed for next attempt
    currentSeed = currentSeed + 1000 + attempts;
  }

  throw new Error(
    `Failed to generate quality trend after ${MAX_REGENERATION_ATTEMPTS} attempts. ` +
    `Consider adjusting quality threshold (current: ${QUALITY_THRESHOLD})`
  );
}
