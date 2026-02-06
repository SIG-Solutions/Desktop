import { GoogleGenerativeAI, GenerativeModel, Part } from "@google/generative-ai";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface GeminiConfig {
  apiKey: string;
  proModel?: string;
  flashModel?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

const DEFAULT_PRO_MODEL = "gemini-2.0-flash";
const DEFAULT_FLASH_MODEL = "gemini-2.0-flash";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

// ============================================================================
// CLIENT SINGLETON
// ============================================================================

let client: GoogleGenerativeAI | null = null;
let config: GeminiConfig | null = null;

export function initializeGeminiClient(cfg: GeminiConfig): void {
  if (!cfg.apiKey) {
    throw new Error("Gemini API key is required. Set GEMINI_API_KEY in .env");
  }

  client = new GoogleGenerativeAI(cfg.apiKey);
  config = {
    ...cfg,
    proModel: cfg.proModel || DEFAULT_PRO_MODEL,
    flashModel: cfg.flashModel || DEFAULT_FLASH_MODEL,
    maxRetries: cfg.maxRetries || DEFAULT_MAX_RETRIES,
    retryDelayMs: cfg.retryDelayMs || DEFAULT_RETRY_DELAY_MS,
  };

  console.log(`[GeminiClient] Initialized with models: Pro=${config.proModel}, Flash=${config.flashModel}`);
}

function getClient(): GoogleGenerativeAI {
  if (!client || !config) {
    throw new Error("Gemini client not initialized. Call initializeGeminiClient first.");
  }
  return client;
}

function getConfig(): GeminiConfig {
  if (!config) {
    throw new Error("Gemini client not initialized. Call initializeGeminiClient first.");
  }
  return config;
}

// ============================================================================
// MODEL ACCESSORS
// ============================================================================

export function getProModel(): GenerativeModel {
  const cfg = getConfig();
  return getClient().getGenerativeModel({ model: cfg.proModel! });
}

export function getFlashModel(): GenerativeModel {
  const cfg = getConfig();
  return getClient().getGenerativeModel({ model: cfg.flashModel! });
}

// ============================================================================
// GENERATION FUNCTIONS
// ============================================================================

export interface GenerateTextOptions {
  model: "pro" | "flash";
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Generate text completion using Gemini
 * Returns raw text response
 */
export async function generateText(options: GenerateTextOptions): Promise<string> {
  const cfg = getConfig();
  const model = options.model === "pro" ? getProModel() : getFlashModel();

  const generationConfig = {
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: options.maxOutputTokens ?? 8192,
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= cfg.maxRetries!; attempt++) {
    try {
      console.log(`[GeminiClient] Generating text (attempt ${attempt}/${cfg.maxRetries})...`);

      const chat = model.startChat({
        generationConfig,
        history: options.systemInstruction
          ? [
              {
                role: "user",
                parts: [{ text: options.systemInstruction }],
              },
              {
                role: "model",
                parts: [{ text: "Understood. I will follow these instructions." }],
              },
            ]
          : [],
      });

      const result = await chat.sendMessage(options.prompt);
      const response = result.response;
      const text = response.text();

      if (!text || text.trim().length === 0) {
        throw new Error("Empty response from Gemini");
      }

      console.log(`[GeminiClient] Generated ${text.length} characters`);
      return text;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[GeminiClient] Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < cfg.maxRetries!) {
        const delay = cfg.retryDelayMs! * Math.pow(2, attempt - 1);
        console.log(`[GeminiClient] Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to generate text after ${cfg.maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Generate structured JSON output using Gemini
 * Wraps the response extraction and basic JSON validation
 */
export async function generateJson<T>(
  options: GenerateTextOptions & { jsonSchema?: string }
): Promise<T> {
  const enhancedPrompt = options.jsonSchema
    ? `${options.prompt}\n\nYou MUST respond with valid JSON matching this schema:\n${options.jsonSchema}\n\nRespond ONLY with the JSON object, no additional text or markdown.`
    : `${options.prompt}\n\nRespond ONLY with valid JSON, no additional text or markdown.`;

  const response = await generateText({
    ...options,
    prompt: enhancedPrompt,
    temperature: options.temperature ?? 0.3, // Lower temperature for structured output
  });

  // Extract JSON from response (handles markdown code blocks)
  const jsonStr = extractJson(response);

  try {
    return JSON.parse(jsonStr) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from Gemini response:\n${error instanceof Error ? error.message : String(error)}\n\nRaw response:\n${response}`
    );
  }
}

// ============================================================================
// IMAGE GENERATION (using Gemini's image generation capabilities)
// ============================================================================

export interface GenerateImageOptions {
  prompt: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  outputPath: string;
}

/**
 * Generate an image using Gemini's image generation
 * Note: This uses the Imagen model through Gemini API
 */
export async function generateImage(options: GenerateImageOptions): Promise<string> {
  const cfg = getConfig();

  // Use the imagen model for image generation
  const imageModel = getClient().getGenerativeModel({
    model: "imagen-3.0-generate-002"
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= cfg.maxRetries!; attempt++) {
    try {
      console.log(`[GeminiClient] Generating image (attempt ${attempt}/${cfg.maxRetries})...`);
      console.log(`[GeminiClient] Prompt: ${options.prompt.substring(0, 100)}...`);

      const result = await imageModel.generateContent({
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        generationConfig: {
          responseModalities: ["image", "text"],
          responseMimeType: "image/png",
        } as any,
      });

      const response = result.response;

      // Extract image data from response
      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) {
        throw new Error("No image data in response");
      }

      const imagePart = candidate.content.parts.find(
        (part: Part) => part.inlineData?.mimeType?.startsWith("image/")
      );

      if (!imagePart?.inlineData?.data) {
        throw new Error("No inline image data found in response");
      }

      // Save the image
      const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");

      // Ensure output directory exists
      const outputDir = path.dirname(options.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.writeFileSync(options.outputPath, imageBuffer);
      console.log(`[GeminiClient] Image saved to ${options.outputPath}`);

      return options.outputPath;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[GeminiClient] Image generation attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < cfg.maxRetries!) {
        const delay = cfg.retryDelayMs! * Math.pow(2, attempt - 1);
        console.log(`[GeminiClient] Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to generate image after ${cfg.maxRetries} attempts: ${lastError?.message}`);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function extractJson(response: string): string {
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

  // Return as-is
  return response.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export async function healthCheck(): Promise<boolean> {
  try {
    const response = await generateText({
      model: "flash",
      prompt: "Respond with exactly: OK",
      maxOutputTokens: 10,
    });
    return response.includes("OK");
  } catch {
    return false;
  }
}
