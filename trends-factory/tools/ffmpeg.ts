import { spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface FFmpegConfig {
  ffmpegPath?: string;
  ffprobePath?: string;
  verbose?: boolean;
}

let config: FFmpegConfig = {
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe",
  verbose: false,
};

export function initializeFFmpeg(cfg: FFmpegConfig = {}): void {
  config = { ...config, ...cfg };

  // Verify ffmpeg is available
  try {
    execSync(`${config.ffmpegPath} -version`, { stdio: "pipe" });
    console.log(`[FFmpeg] Initialized with ffmpeg at ${config.ffmpegPath}`);
  } catch {
    throw new Error(
      `ffmpeg not found at ${config.ffmpegPath}. Please install ffmpeg and ensure it's in PATH.`
    );
  }
}

// ============================================================================
// VIDEO INFORMATION
// ============================================================================

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

/**
 * Get information about a video file
 */
export function getVideoInfo(videoPath: string): VideoInfo {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const cmd = `${config.ffprobePath} -v quiet -print_format json -show_format -show_streams "${videoPath}"`;

  try {
    const output = execSync(cmd, { encoding: "utf-8" });
    const data = JSON.parse(output);

    const videoStream = data.streams?.find(
      (s: { codec_type: string }) => s.codec_type === "video"
    );

    if (!videoStream) {
      throw new Error("No video stream found");
    }

    // Parse frame rate (e.g., "30/1" or "29.97")
    let fps = 30;
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
      fps = den ? num / den : num;
    }

    return {
      duration: parseFloat(data.format?.duration || "0"),
      width: videoStream.width || 1920,
      height: videoStream.height || 1080,
      fps,
      codec: videoStream.codec_name || "h264",
    };
  } catch (error) {
    throw new Error(
      `Failed to get video info: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// FRAME EXTRACTION
// ============================================================================

export interface ExtractFrameOptions {
  videoPath: string;
  outputPath: string;
  timestamp?: number | "last";
  quality?: number; // 1-31, lower is better
}

/**
 * Extract a single frame from a video
 */
export async function extractFrame(options: ExtractFrameOptions): Promise<string> {
  const { videoPath, outputPath, timestamp = "last", quality = 2 } = options;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let seekTime: string;

  if (timestamp === "last") {
    // Get video duration and seek to near the end
    const info = getVideoInfo(videoPath);
    const seekSeconds = Math.max(0, info.duration - 0.1);
    seekTime = seekSeconds.toFixed(3);
  } else {
    seekTime = timestamp.toFixed(3);
  }

  const args = [
    "-y", // Overwrite output
    "-ss", seekTime, // Seek position
    "-i", videoPath, // Input file
    "-vframes", "1", // Extract 1 frame
    "-q:v", quality.toString(), // Quality
    outputPath, // Output file
  ];

  await runFFmpeg(args);

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Failed to extract frame: output file not created`);
  }

  console.log(`[FFmpeg] Extracted frame to ${outputPath}`);
  return outputPath;
}

/**
 * Extract the last frame of a video
 */
export async function extractLastFrame(
  videoPath: string,
  outputPath: string
): Promise<string> {
  return extractFrame({
    videoPath,
    outputPath,
    timestamp: "last",
    quality: 2,
  });
}

// ============================================================================
// VIDEO STITCHING
// ============================================================================

export interface StitchVideosOptions {
  inputPaths: string[];
  outputPath: string;
  transition?: "none" | "fade" | "dissolve";
  transitionDuration?: number;
}

/**
 * Stitch multiple video clips into a single video
 */
export async function stitchVideos(options: StitchVideosOptions): Promise<string> {
  const {
    inputPaths,
    outputPath,
    transition = "none",
    transitionDuration = 0.5,
  } = options;

  if (inputPaths.length === 0) {
    throw new Error("No input videos provided");
  }

  // Verify all input files exist
  for (const inputPath of inputPaths) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input video not found: ${inputPath}`);
    }
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (inputPaths.length === 1) {
    // Just copy the single file
    fs.copyFileSync(inputPaths[0], outputPath);
    return outputPath;
  }

  if (transition === "none") {
    // Simple concatenation using concat demuxer
    return await concatVideos(inputPaths, outputPath);
  } else {
    // Complex filter for transitions
    return await concatWithTransitions(
      inputPaths,
      outputPath,
      transition,
      transitionDuration
    );
  }
}

/**
 * Simple concatenation without transitions
 */
async function concatVideos(
  inputPaths: string[],
  outputPath: string
): Promise<string> {
  // Create a temporary file list
  const listPath = outputPath + ".txt";
  const listContent = inputPaths
    .map((p) => `file '${path.resolve(p)}'`)
    .join("\n");

  fs.writeFileSync(listPath, listContent);

  try {
    const args = [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      outputPath,
    ];

    await runFFmpeg(args);
  } finally {
    // Clean up temp file
    if (fs.existsSync(listPath)) {
      fs.unlinkSync(listPath);
    }
  }

  console.log(`[FFmpeg] Stitched ${inputPaths.length} videos to ${outputPath}`);
  return outputPath;
}

/**
 * Concatenation with crossfade transitions
 */
async function concatWithTransitions(
  inputPaths: string[],
  outputPath: string,
  transition: "fade" | "dissolve",
  duration: number
): Promise<string> {
  // Get durations of all videos
  const infos = inputPaths.map((p) => getVideoInfo(p));

  // Build filter complex
  const inputs: string[] = [];
  const filters: string[] = [];

  // Add input arguments
  for (let i = 0; i < inputPaths.length; i++) {
    inputs.push("-i", inputPaths[i]);
  }

  // First, normalize all videos to same format
  for (let i = 0; i < inputPaths.length; i++) {
    filters.push(
      `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
    );
  }

  // Build crossfade chain
  if (inputPaths.length === 2) {
    const offset = Math.max(0, infos[0].duration - duration);
    filters.push(
      `[v0][v1]xfade=transition=${transition}:duration=${duration}:offset=${offset}[outv]`
    );
  } else {
    // Chain multiple crossfades
    let currentLabel = "v0";
    let currentOffset = 0;

    for (let i = 1; i < inputPaths.length; i++) {
      const outputLabel = i === inputPaths.length - 1 ? "outv" : `xf${i}`;
      const clipDuration = infos[i - 1].duration;
      currentOffset += clipDuration - duration;

      filters.push(
        `[${currentLabel}][v${i}]xfade=transition=${transition}:duration=${duration}:offset=${currentOffset.toFixed(3)}[${outputLabel}]`
      );
      currentLabel = outputLabel;
    }
  }

  // Handle audio (simple concatenation)
  const audioInputs = inputPaths.map((_, i) => `[${i}:a]`).join("");
  filters.push(`${audioInputs}concat=n=${inputPaths.length}:v=0:a=1[outa]`);

  const filterComplex = filters.join(";");

  const args = [
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[outv]",
    "-map", "[outa]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "192k",
    outputPath,
  ];

  await runFFmpeg(args);

  console.log(
    `[FFmpeg] Stitched ${inputPaths.length} videos with ${transition} transitions to ${outputPath}`
  );
  return outputPath;
}

// ============================================================================
// VIDEO PROCESSING
// ============================================================================

export interface NormalizeVideoOptions {
  inputPath: string;
  outputPath: string;
  width?: number;
  height?: number;
  fps?: number;
}

/**
 * Normalize a video to consistent format
 */
export async function normalizeVideo(
  options: NormalizeVideoOptions
): Promise<string> {
  const {
    inputPath,
    outputPath,
    width = 1920,
    height = 1080,
    fps = 30,
  } = options;

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input video not found: ${inputPath}`);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const args = [
    "-y",
    "-i", inputPath,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-ac", "2",
    outputPath,
  ];

  await runFFmpeg(args);

  console.log(`[FFmpeg] Normalized video to ${outputPath}`);
  return outputPath;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(config.ffmpegPath!, args, {
      stdio: config.verbose ? "inherit" : "pipe",
    });

    let stderr = "";

    if (!config.verbose && ffmpeg.stderr) {
      ffmpeg.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`ffmpeg exited with code ${code}${stderr ? `\n${stderr}` : ""}`)
        );
      }
    });

    ffmpeg.on("error", (err) => {
      reject(new Error(`Failed to run ffmpeg: ${err.message}`));
    });
  });
}

/**
 * Check if ffmpeg is available
 */
export function isFFmpegAvailable(): boolean {
  try {
    execSync(`${config.ffmpegPath} -version`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get ffmpeg version
 */
export function getFFmpegVersion(): string {
  try {
    const output = execSync(`${config.ffmpegPath} -version`, {
      encoding: "utf-8",
    });
    const match = output.match(/ffmpeg version (\S+)/);
    return match ? match[1] : "unknown";
  } catch {
    return "not installed";
  }
}
