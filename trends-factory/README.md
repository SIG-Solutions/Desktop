# Trends Factory

An Agentic Video Production Pipeline that generates satirical trend videos using AI.

## Overview

Trends Factory is a **state-driven production pipeline** that orchestrates multiple AI agents to generate 30-45 second satirical videos about fake cultural trends. The system is designed to be:

- **Reproducible**: Each run has a unique seed for consistent behavior
- **Debuggable**: State is persisted in JSON, every step is logged
- **Extensible**: Add new agents without modifying existing ones
- **Quality-gated**: Trends must pass automated assessment before proceeding

### Core Design Principle

> This is NOT a chatbot. This is a state-driven production pipeline.
> Agents do not talk to each other. They only read/write structured state via deltas.

## Quick Start

```bash
# 1. Install dependencies
cd trends-factory
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

1. **INIT → SCRIPTED**: Synthesize trend (with quality gate), plan escalating scenes with global continuity
2. **SCRIPTED → VISUALIZED**: Generate visual prompts and concept images (enforcing continuity)
3. **VISUALIZED → VIDEO_GENERATED**: Generate video clips with cross-scene continuity chaining
4. **VIDEO_GENERATED → ASSEMBLED**: Stitch clips into final video

### The Agents

| Agent | Model | Responsibility |
|-------|-------|----------------|
| Trend Synthesizer | Gemini Pro | Generate research-backed fake trends with quality gate |
| Escalation Planner | Gemini Pro | Convert trend → 4-6 scenes with global continuity constraints |
| Visual Locker | Gemini Flash + Imagen | Generate visual prompts enforcing continuity |
| Video Generator | Veo 3.1 | Generate scene clips with explicit constraint injection |
| Continuity Editor | FFmpeg | Extract frames, normalize, stitch final video |

### Project State

All state is stored in `project.state.json`:

```typescript
interface ProjectState {
  // Identity & Reproducibility
  projectId: string;
  runId: string;           // Unique per execution
  seed: number;            // For reproducibility

  // Stage tracking
  stage: "INIT" | "SCRIPTED" | "VISUALIZED" | "VIDEO_GENERATED" | "ASSEMBLED";

  // Research & Quality
  patternAnalysis: PatternAnalysis | null;  // Research backing
  trend: Trend | null;
  trendQuality: TrendQuality | null;        // Quality gate result

  // Content
  scenes: Scene[];
  globalContinuity: ContinuityConstraints | null;  // Enforced on all scenes

  // Meta
  regenerationCount: number;  // Track quality rejections
  error: string | null;
}
```

### Agent Delta Pattern

Agents do NOT mutate state directly. They return typed deltas:

```typescript
// Agents return deltas
type AgentDelta =
  | { type: "TREND_SYNTHESIZED"; payload: TrendSynthesizerDelta }
  | { type: "TREND_QUALITY_ASSESSED"; payload: TrendQualityDelta }
  | { type: "ESCALATION_PLANNED"; payload: EscalationPlannerDelta }
  | { type: "SCENE_VISUALIZED"; payload: VisualLockerDelta }
  | { type: "SCENE_VIDEO_GENERATED"; payload: VideoGeneratorDelta };

// Orchestrator applies them
state = applyDelta(state, delta, baseDir);
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
│   ├── trendSynthesizer.ts    # Research-backed trend generation + quality gate
│   ├── escalationPlanner.ts   # Scene planning with global continuity
│   ├── visualLocker.ts        # Visual prompts with enforced constraints
│   ├── videoGenerator.ts      # Video generation with constraint injection
│   └── continuityEditor.ts    # Frame extraction & final assembly
│
├── orchestrator/
│   ├── stateMachine.ts        # Delta-based pipeline orchestration
│   ├── projectState.ts        # State types, deltas, and mutations
│   └── validators.ts          # JSON schema validation utilities
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

1. **Research Analysis**: Identify format patterns, behavior patterns, algorithmic incentives
2. **Trend Synthesis**: Generate a trend grounded in research with clear lifecycle
3. **Quality Gate**: Assess plausibility, cloneability, lifecycle completeness (auto-reject weak trends)
4. **Escalation Planning**: Create 4-6 scenes with global continuity constraints
5. **Visual Locking**: Generate prompts that ENFORCE continuity constraints verbatim
6. **Video Generation**: Generate clips with explicit constraint injection + cross-scene continuity
7. **Assembly**: Normalize and stitch with optional transitions

The humor emerges from **escalation**, not jokes. Each scene is slightly more absurd than the last, until the final scene reveals the logical endpoint of the trend.

## Known Limitations

This section is important for understanding what this system can and cannot do:

### Reproducibility
- **Seed-based, not fully deterministic**: The seed influences LLM temperature but LLM outputs are inherently stochastic
- **Same seed ≠ identical output**: LLM behavior varies even with identical prompts
- **For true determinism**: Would require API-level seed support (not currently available)

### Continuity
- **Constraint injection, not enforcement**: We inject continuity constraints verbatim into prompts, but Veo may still drift
- **5-6 scene limit**: Continuity degrades over longer sequences
- **No automated continuity verification**: Visual consistency is attempted, not guaranteed

### Quality
- **Automated quality gate**: Rejects weak trends, but assessment is LLM-based
- **No human review loop**: Factory produces whatever passes the automated gate
- **Occasional slop**: Weak trends can still slip through

### Operational
- **No batch mode**: Single project at a time
- **No rate limiting logic**: Relies on API retry behavior
- **No partial failure recovery within stages**: Stage failures require full stage restart
- **API quota exhaustion**: Not handled gracefully

### What Would Make This Production-Ready
1. Human review interface for trend approval
2. Visual continuity verification (CLIP/perceptual similarity)
3. Batch processing with job queues
4. Graceful quota management
5. Monitoring and alerting

## Debugging

### Check Current State

```bash
npm run generate -- --status
```

Example output:
```
TRENDS FACTORY - Pipeline Status
==================================================
Project ID:       trends_1234567890
Run ID:           a1b2c3d4e5f6g7h8
Seed:             1234567890
Stage:            SCRIPTED
Trend:            "Inbox Zero Living"
Quality Score:    7.5/10
Scenes:           5
Regenerations:    1
==================================================
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
2. Define delta type in `projectState.ts`
3. Implement agent as a pure function returning the delta
4. Add delta handler in `applyDelta()` function
5. Call agent from stage handler in `stateMachine.ts`

### Agent Contract

All agents must:
- Accept structured input (validated via Zod)
- Return typed delta (not full state)
- NOT communicate with other agents directly
- NOT mutate any state
- Log progress to console
- Validate all outputs before returning

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

### "Failed to generate quality trend after 3 attempts"
The quality threshold is strict. Try adjusting `QUALITY_THRESHOLD` in `trendSynthesizer.ts`.

### API Rate Limits
The pipeline includes automatic retries with exponential backoff. If issues persist, increase `POLLING_INTERVAL_MS`.

### Continuity Drift
If videos don't flow well together, the continuity constraints may not be specific enough. Check `globalContinuity` in state file and consider more explicit constraints in `escalationPlanner.ts`.

## License

MIT
