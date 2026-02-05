#!/usr/bin/env node

import * as dotenv from "dotenv";
import * as path from "node:path";
import * as fs from "node:fs";

import { initializeGeminiClient, healthCheck as geminiHealthCheck } from "./services/geminiClient.js";
import { initializeVeoClient, healthCheck as veoHealthCheck } from "./services/veoClient.js";
import { initializeFFmpeg, isFFmpegAvailable, getFFmpegVersion } from "./tools/ffmpeg.js";
import {
  runPipeline,
  resetAndRun,
  runFromStage,
  getPipelineStatus,
  type StateMachineConfig,
} from "./orchestrator/stateMachine.js";
import type { Stage } from "./orchestrator/projectState.js";

// ============================================================================
// TRENDS FACTORY - MAIN ENTRY POINT
// ============================================================================
// A state-driven production pipeline for generating satirical trend videos.
//
// Usage:
//   npm run generate          # Run full pipeline
//   npm run generate -- --reset  # Reset and start fresh
//   npm run generate -- --from STAGE  # Resume from specific stage
//   npm run generate -- --status  # Show current status
// ============================================================================

// Load environment variables
dotenv.config();

// Configuration
const BASE_DIR = process.cwd();
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(BASE_DIR, "output");

/**
 * Parse command line arguments
 */
function parseArgs(): {
  reset: boolean;
  fromStage: Stage | null;
  status: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);

  const result = {
    reset: false,
    fromStage: null as Stage | null,
    status: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--reset" || arg === "-r") {
      result.reset = true;
    } else if (arg === "--from" || arg === "-f") {
      const stage = args[++i]?.toUpperCase() as Stage;
      if (!["INIT", "SCRIPTED", "VISUALIZED", "VIDEO_GENERATED"].includes(stage)) {
        console.error(`Invalid stage: ${stage}`);
        console.error("Valid stages: INIT, SCRIPTED, VISUALIZED, VIDEO_GENERATED");
        process.exit(1);
      }
      result.fromStage = stage;
    } else if (arg === "--status" || arg === "-s") {
      result.status = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    }
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
TRENDS FACTORY - Agentic Video Production Pipeline

Usage:
  npm run generate              Run full pipeline from current state
  npm run generate -- --reset   Reset state and start fresh
  npm run generate -- --from STAGE   Resume from specific stage
  npm run generate -- --status  Show current pipeline status
  npm run generate -- --help    Show this help message

Stages:
  INIT            Initial state (will run full pipeline)
  SCRIPTED        After trend/scenes generated (will generate visuals)
  VISUALIZED      After visuals locked (will generate videos)
  VIDEO_GENERATED After videos created (will assemble final)
  ASSEMBLED       Complete (terminal state)

Environment Variables:
  GEMINI_API_KEY  Required. Your Gemini API key.
  OUTPUT_DIR      Optional. Output directory (default: ./output)

Example:
  # Full run
  npm run generate

  # Reset and regenerate everything
  npm run generate -- --reset

  # Re-run just the video generation and assembly
  npm run generate -- --from VISUALIZED
`);
}

/**
 * Print current status
 */
function printStatus(config: StateMachineConfig): void {
  const status = getPipelineStatus(config);

  console.log("");
  console.log("TRENDS FACTORY - Pipeline Status");
  console.log("=".repeat(40));
  console.log(`Project ID:  ${status.projectId}`);
  console.log(`Stage:       ${status.stage}`);
  console.log(`Trend:       ${status.trendName || "(not set)"}`);
  console.log(`Scenes:      ${status.sceneCount}`);

  if (status.error) {
    console.log(`Error:       ${status.error}`);
  }

  console.log("=".repeat(40));
  console.log("");
}

/**
 * Initialize all services
 */
async function initializeServices(): Promise<void> {
  console.log("[Init] Initializing services...");

  // Check for API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is required.\n" +
      "Create a .env file with:\n" +
      "GEMINI_API_KEY=your_api_key_here"
    );
  }

  // Initialize Gemini client
  initializeGeminiClient({
    apiKey,
    proModel: process.env.GEMINI_PRO_MODEL,
    flashModel: process.env.GEMINI_FLASH_MODEL,
    maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
  });

  // Initialize Veo client (same API key)
  initializeVeoClient({
    apiKey,
    model: process.env.VEO_MODEL,
    pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS || "5000", 10),
  });

  // Initialize FFmpeg
  if (!isFFmpegAvailable()) {
    throw new Error(
      "FFmpeg is not available.\n" +
      "Please install FFmpeg: https://ffmpeg.org/download.html"
    );
  }

  initializeFFmpeg({ verbose: false });
  console.log(`[Init] FFmpeg version: ${getFFmpegVersion()}`);

  // Health checks
  console.log("[Init] Running health checks...");

  const geminiOk = await geminiHealthCheck();
  if (!geminiOk) {
    console.warn("[Init] WARNING: Gemini health check failed. API may be unavailable.");
  } else {
    console.log("[Init] Gemini API: OK");
  }

  // Note: Veo health check may fail if model isn't available yet
  // We'll proceed anyway and let it fail at video generation if needed

  // Ensure output directories exist
  const scenesDir = path.join(OUTPUT_DIR, "scenes");
  const finalDir = path.join(OUTPUT_DIR, "final");

  if (!fs.existsSync(scenesDir)) {
    fs.mkdirSync(scenesDir, { recursive: true });
  }
  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true });
  }

  console.log("[Init] Services initialized successfully");
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  // Handle help
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Build configuration
  const config: StateMachineConfig = {
    baseDir: BASE_DIR,
    outputDir: OUTPUT_DIR,
    clipDuration: 6,
    useImageToVideo: true,
    transitionType: "none",
    transitionDuration: 0.5,
  };

  // Handle status
  if (args.status) {
    printStatus(config);
    process.exit(0);
  }

  // Initialize services
  await initializeServices();

  console.log("");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║           TRENDS FACTORY - PRODUCTION PIPELINE             ║");
  console.log("║                                                            ║");
  console.log("║  Agents do not talk to each other.                         ║");
  console.log("║  They only read/write structured state.                    ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");

  try {
    let finalState;

    if (args.reset) {
      console.log("[Main] Resetting state and starting fresh pipeline...");
      finalState = await resetAndRun(config);
    } else if (args.fromStage) {
      console.log(`[Main] Running pipeline from stage: ${args.fromStage}`);
      finalState = await runFromStage(args.fromStage, config);
    } else {
      console.log("[Main] Running pipeline from current state...");
      finalState = await runPipeline(config);
    }

    // Success!
    console.log("");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                    PIPELINE COMPLETE                       ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`Trend: "${finalState.trend?.name}"`);
    console.log(`Scenes: ${finalState.scenes.length}`);
    console.log(`Output: ${OUTPUT_DIR}/final/${finalState.projectId}.mp4`);
    console.log("");

    process.exit(0);
  } catch (error) {
    console.error("");
    console.error("╔════════════════════════════════════════════════════════════╗");
    console.error("║                    PIPELINE FAILED                         ║");
    console.error("╚════════════════════════════════════════════════════════════╝");
    console.error("");
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error("");
    console.error("Run with --status to see current state");
    console.error("Run with --from STAGE to resume from a specific stage");
    console.error("");

    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
