import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface VeoConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  pollingIntervalMs?: number;
  maxPollingAttempts?: number;
}

const DEFAULT_MODEL = "veo-2.0-generate-001";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_POLLING_INTERVAL_MS = 5000;
const DEFAULT_MAX_POLLING_ATTEMPTS = 120; // 10 minutes with 5s interval

const VEO_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ============================================================================
// CLIENT STATE
// ============================================================================

let config: VeoConfig | null = null;

export function initializeVeoClient(cfg: VeoConfig): void {
  if (!cfg.apiKey) {
    throw new Error("Veo API key is required. Set GEMINI_API_KEY in .env");
  }

  config = {
    ...cfg,
    model: cfg.model || DEFAULT_MODEL,
    maxRetries: cfg.maxRetries || DEFAULT_MAX_RETRIES,
    pollingIntervalMs: cfg.pollingIntervalMs || DEFAULT_POLLING_INTERVAL_MS,
    maxPollingAttempts: cfg.maxPollingAttempts || DEFAULT_MAX_POLLING_ATTEMPTS,
  };

  console.log(`[VeoClient] Initialized with model: ${config.model}`);
}

function getConfig(): VeoConfig {
  if (!config) {
    throw new Error("Veo client not initialized. Call initializeVeoClient first.");
  }
  return config;
}

// ============================================================================
// VIDEO GENERATION TYPES
// ============================================================================

export interface VideoGenerationRequest {
  prompt: string;
  imagePath?: string;
  durationSeconds?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  outputPath: string;
}

interface VeoGenerateRequest {
  model: string;
  contents: Array<{
    role: string;
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  }>;
  generationConfig: {
    responseModalities: string[];
    videoDuration?: string;
  };
}

interface VeoOperation {
  name: string;
  done: boolean;
  error?: { code: number; message: string };
  response?: {
    candidates?: Array<{
      content: {
        parts: Array<{
          inlineData?: { mimeType: string; data: string };
          fileData?: { mimeType: string; fileUri: string };
        }>;
      };
    }>;
  };
}

// ============================================================================
// VIDEO GENERATION
// ============================================================================

/**
 * Generate a video using the Veo API
 * This initiates generation and polls until complete
 */
export async function generateVideo(request: VideoGenerationRequest): Promise<string> {
  const cfg = getConfig();

  console.log(`[VeoClient] Starting video generation...`);
  console.log(`[VeoClient] Prompt: ${request.prompt.substring(0, 100)}...`);

  // Build the request
  const parts: VeoGenerateRequest["contents"][0]["parts"] = [];

  // Add image if provided (image-to-video)
  if (request.imagePath) {
    if (!fs.existsSync(request.imagePath)) {
      throw new Error(`Image file not found: ${request.imagePath}`);
    }

    const imageData = fs.readFileSync(request.imagePath);
    const base64Image = imageData.toString("base64");
    const mimeType = getMimeType(request.imagePath);

    parts.push({
      inlineData: {
        mimeType,
        data: base64Image,
      },
    });

    console.log(`[VeoClient] Using image-to-video mode with ${request.imagePath}`);
  }

  // Add text prompt
  parts.push({ text: request.prompt });

  const veoRequest: VeoGenerateRequest = {
    model: `models/${cfg.model}`,
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["video"],
      videoDuration: `${request.durationSeconds || 6}s`,
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= cfg.maxRetries!; attempt++) {
    try {
      // Start the generation
      const operation = await startGeneration(veoRequest);
      console.log(`[VeoClient] Operation started: ${operation.name}`);

      // Poll until complete
      const result = await pollOperation(operation.name);

      // Extract and save the video
      const videoPath = await saveVideoFromResult(result, request.outputPath);
      console.log(`[VeoClient] Video saved to ${videoPath}`);

      return videoPath;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[VeoClient] Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < cfg.maxRetries!) {
        const delay = cfg.pollingIntervalMs! * Math.pow(2, attempt - 1);
        console.log(`[VeoClient] Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to generate video after ${cfg.maxRetries} attempts: ${lastError?.message}`);
}

// ============================================================================
// API CALLS
// ============================================================================

async function startGeneration(request: VeoGenerateRequest): Promise<VeoOperation> {
  const cfg = getConfig();

  const url = `${VEO_API_BASE}/${request.model}:generateContent?key=${cfg.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: request.contents,
      generationConfig: request.generationConfig,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Veo API error (${response.status}): ${errorText}`);
  }

  const result = await response.json() as Record<string, unknown>;

  // For synchronous responses, convert to operation format
  if (result.candidates) {
    return {
      name: "direct-response",
      done: true,
      response: result as VeoOperation["response"],
    };
  }

  // For async operations
  if (result.name) {
    return result as unknown as VeoOperation;
  }

  throw new Error(`Unexpected Veo API response: ${JSON.stringify(result)}`);
}

async function pollOperation(operationName: string): Promise<VeoOperation> {
  // If it was a direct response, return immediately
  if (operationName === "direct-response") {
    throw new Error("Direct response should have been handled already");
  }

  const cfg = getConfig();
  let attempts = 0;

  while (attempts < cfg.maxPollingAttempts!) {
    attempts++;

    const url = `${VEO_API_BASE}/operations/${operationName}?key=${cfg.apiKey}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Veo polling error (${response.status}): ${errorText}`);
    }

    const operation = (await response.json()) as VeoOperation;

    if (operation.done) {
      if (operation.error) {
        throw new Error(`Veo generation failed: ${operation.error.message}`);
      }
      return operation;
    }

    console.log(
      `[VeoClient] Polling... (attempt ${attempts}/${cfg.maxPollingAttempts})`
    );
    await sleep(cfg.pollingIntervalMs!);
  }

  throw new Error(`Video generation timed out after ${cfg.maxPollingAttempts} polling attempts`);
}

async function saveVideoFromResult(operation: VeoOperation, outputPath: string): Promise<string> {
  const candidates = operation.response?.candidates;

  if (!candidates || candidates.length === 0) {
    throw new Error("No video candidates in response");
  }

  const videoPart = candidates[0].content.parts.find(
    (part) => part.inlineData?.mimeType?.startsWith("video/") || part.fileData?.mimeType?.startsWith("video/")
  );

  if (!videoPart) {
    throw new Error("No video data found in response");
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Handle inline data (base64 encoded)
  if (videoPart.inlineData?.data) {
    const videoBuffer = Buffer.from(videoPart.inlineData.data, "base64");
    fs.writeFileSync(outputPath, videoBuffer);
    return outputPath;
  }

  // Handle file URI (need to download)
  if (videoPart.fileData?.fileUri) {
    await downloadFile(videoPart.fileData.fileUri, outputPath);
    return outputPath;
  }

  throw new Error("Could not extract video data from response");
}

async function downloadFile(uri: string, outputPath: string): Promise<void> {
  const cfg = getConfig();

  // Append API key if needed
  const url = uri.includes("?") ? `${uri}&key=${cfg.apiKey}` : `${uri}?key=${cfg.apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "image/png";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export async function healthCheck(): Promise<boolean> {
  try {
    const cfg = getConfig();
    const url = `${VEO_API_BASE}/models/${cfg.model}?key=${cfg.apiKey}`;

    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}
