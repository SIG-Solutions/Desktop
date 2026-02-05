# Trends Factory

An Agentic Video Production Pipeline that generates satirical trend videos using AI.

## Overview

Trends Factory is a **state-driven production pipeline** that orchestrates multiple AI agents to generate 30-45 second satirical videos about fake cultural trends. The system is designed to be:

- **Deterministic**: Same inputs produce same outputs
- **Debuggable**: State is persisted in JSON, every step is logged
- **Extensible**: Add new agents without modifying existing ones

### Core Design Principle

> This is NOT a chatbot. This is a state-driven production pipeline.
> Agents do not talk to each other. They only read/write structured state.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create .env file with your Gemini API key
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# 3. Run the factory
npm run generate
```

Output will be saved to: `output/final/trends_episode_xxx.mp4`

## Requirements

- **Node.js 20+**
- **FFmpeg** (installed and in PATH)
- **Gemini API Key** (with access to Pro, Flash, Imagen, and Veo models)

### Installing FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html

## How It Works

### Pipeline Stages

```
INIT → SCRIPTED → VISUALIZED → VIDEO_GENERATED → ASSEMBLED
```

1. **INIT → SCRIPTED**: Synthesize trend, plan escalating scenes
2. **SCRIPTED → VISUALIZED**: Generate visual prompts and concept images
3. **VISUALIZED → VIDEO_GENERATED**: Generate video clips with continuity
4. **VIDEO_GENERATED → ASSEMBLED**: Stitch clips into final video

### The Agents

| Agent | Model | Responsibility |
|-------|-------|----------------|
| Trend Synthesizer | Gemini Pro | Generate fake but believable trends |
| Escalation Planner | Gemini Pro | Convert trend → 4-6 escalating scenes |
| Visual Locker | Gemini Flash + Imagen | Generate visual prompts and concept art |
| Video Generator | Veo 3.1 | Generate scene-atomic video clips |
| Continuity Editor | FFmpeg | Extract frames, stitch final video |

### Project State

All state is stored in `project.state.json`:

```typescript
interface ProjectState {
  projectId: string;
  stage: "INIT" | "SCRIPTED" | "VISUALIZED" | "VIDEO_GENERATED" | "ASSEMBLED";
  trend: {
    name: string;
    promise: string;
    behaviorPattern: string;
    collapsePoint: string;
  } | null;
  scenes: Array<{
    sceneId: string;
    intent: string;
    absurdityLevel: number;
    visualPrompt?: string;
    conceptImagePath?: string;
    videoClipPath?: string;
    continuityFramePath?: string;
  }>;
}
```

## CLI Usage

```bash
# Run full pipeline
npm run generate

# Reset and start fresh
npm run generate -- --reset

# Resume from specific stage
npm run generate -- --from VISUALIZED

# Check current status
npm run generate -- --status

# Show help
npm run generate -- --help
```

### Stages for `--from` flag

- `INIT` - Start from beginning
- `SCRIPTED` - Re-generate visuals and videos
- `VISUALIZED` - Re-generate videos only
- `VIDEO_GENERATED` - Re-assemble final video

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Your Gemini API key |
| `GEMINI_PRO_MODEL` | No | Override Pro model (default: gemini-1.5-pro) |
| `GEMINI_FLASH_MODEL` | No | Override Flash model (default: gemini-2.0-flash-exp) |
| `VEO_MODEL` | No | Override Veo model (default: veo-2.0-generate-001) |
| `OUTPUT_DIR` | No | Output directory (default: ./output) |
| `MAX_RETRIES` | No | API retry attempts (default: 3) |
| `POLLING_INTERVAL_MS` | No | Veo polling interval (default: 5000) |

## Project Structure

```
trends-factory/
├── agents/
│   ├── trendSynthesizer.ts    # Generates fake trends
│   ├── escalationPlanner.ts   # Plans scene escalation
│   ├── visualLocker.ts        # Generates visual prompts & images
│   ├── videoGenerator.ts      # Generates video clips
│   └── continuityEditor.ts    # Handles frame extraction & stitching
│
├── orchestrator/
│   ├── stateMachine.ts        # Pipeline orchestration
│   ├── projectState.ts        # State management & types
│   └── validators.ts          # JSON schema validation
│
├── services/
│   ├── geminiClient.ts        # Gemini API wrapper
│   └── veoClient.ts           # Veo API wrapper
│
├── tools/
│   └── ffmpeg.ts              # FFmpeg operations
│
├── output/
│   ├── scenes/                # Intermediate scene files
│   └── final/                 # Final assembled videos
│
├── index.ts                   # Main entry point
├── project.state.json         # Pipeline state (generated)
└── .env                       # Configuration (create this)
```

## How Satire Works (The Algorithm)

1. **Trend Synthesis**: Generate a trend that sounds plausible but has an inherent absurdity
2. **Escalation Planning**: Create 4-6 scenes that gradually reveal the absurdity
3. **Visual Locking**: Establish consistent visual language across all scenes
4. **Video Generation**: Generate clips with increasing visual tension
5. **Continuity Editing**: Ensure smooth transitions between escalating scenes

The humor emerges from **escalation**, not jokes. Each scene is slightly more absurd than the last, until the final scene reveals the logical endpoint of the trend.

## Debugging

### Check Current State

```bash
npm run generate -- --status
```

### View State File

```bash
cat project.state.json | jq
```

### Resume After Failure

If the pipeline fails mid-execution, it saves state. Simply run again to resume:

```bash
npm run generate
```

Or force a specific stage:

```bash
npm run generate -- --from VISUALIZED
```

### Full Reset

```bash
npm run generate -- --reset
```

## Extending the System

### Adding a New Agent

1. Create `agents/yourAgent.ts`
2. Define input/output types
3. Implement as a pure function
4. Add to state machine in `orchestrator/stateMachine.ts`

### Agent Contract

All agents must:
- Accept structured input (validated via Zod)
- Return structured output (validated via Zod)
- Not communicate with other agents directly
- Not mutate global state
- Log progress to console

## Troubleshooting

### "GEMINI_API_KEY environment variable is required"
Create a `.env` file with your API key:
```
GEMINI_API_KEY=your_key_here
```

### "FFmpeg is not available"
Install FFmpeg and ensure it's in your PATH.

### "Invalid stage transition"
The pipeline must progress linearly. Use `--reset` to start over.

### API Rate Limits
The pipeline includes automatic retries with exponential backoff. If issues persist, increase `POLLING_INTERVAL_MS`.

## License

MIT
