import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// CORE TYPE DEFINITIONS - NON-NEGOTIABLE
// ============================================================================

export const StageSchema = z.enum([
  "INIT",
  "SCRIPTED",
  "VISUALIZED",
  "VIDEO_GENERATED",
  "ASSEMBLED",
]);

export type Stage = z.infer<typeof StageSchema>;

export const TrendSchema = z.object({
  name: z.string().min(1),
  promise: z.string().min(1),
  behaviorPattern: z.string().min(1),
  collapsePoint: z.string().min(1),
});

export type Trend = z.infer<typeof TrendSchema>;

export const SceneSchema = z.object({
  sceneId: z.string().min(1),
  intent: z.string().min(1),
  absurdityLevel: z.number().min(1).max(10),
  visualPrompt: z.string().optional(),
  conceptImagePath: z.string().optional(),
  videoClipPath: z.string().optional(),
  continuityFramePath: z.string().optional(),
});

export type Scene = z.infer<typeof SceneSchema>;

export const ProjectStateSchema = z.object({
  projectId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  trend: TrendSchema.nullable(),
  scenes: z.array(SceneSchema),
  stage: StageSchema,
  error: z.string().nullable().optional(),
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;

// ============================================================================
// STATE FILE MANAGEMENT
// ============================================================================

const STATE_FILE = "project.state.json";

export function getStateFilePath(baseDir: string = process.cwd()): string {
  return path.join(baseDir, STATE_FILE);
}

export function createInitialState(): ProjectState {
  const now = new Date().toISOString();
  return {
    projectId: `trends_${Date.now()}`,
    createdAt: now,
    updatedAt: now,
    trend: null,
    scenes: [],
    stage: "INIT",
    error: null,
  };
}

export function loadState(baseDir: string = process.cwd()): ProjectState {
  const statePath = getStateFilePath(baseDir);

  if (!fs.existsSync(statePath)) {
    const initialState = createInitialState();
    saveState(initialState, baseDir);
    return initialState;
  }

  const raw = fs.readFileSync(statePath, "utf-8");
  const parsed = JSON.parse(raw);

  const result = ProjectStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid state file: ${JSON.stringify(result.error.issues, null, 2)}`
    );
  }

  return result.data;
}

export function saveState(
  state: ProjectState,
  baseDir: string = process.cwd()
): void {
  // Validate before saving - never save invalid state
  const result = ProjectStateSchema.safeParse(state);
  if (!result.success) {
    throw new Error(
      `Attempted to save invalid state: ${JSON.stringify(result.error.issues, null, 2)}`
    );
  }

  const statePath = getStateFilePath(baseDir);
  const updatedState: ProjectState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(statePath, JSON.stringify(updatedState, null, 2), "utf-8");
}

export function resetState(baseDir: string = process.cwd()): ProjectState {
  const initialState = createInitialState();
  saveState(initialState, baseDir);
  return initialState;
}

// ============================================================================
// STAGE TRANSITION RULES
// ============================================================================

const VALID_TRANSITIONS: Record<Stage, Stage[]> = {
  INIT: ["SCRIPTED"],
  SCRIPTED: ["VISUALIZED"],
  VISUALIZED: ["VIDEO_GENERATED"],
  VIDEO_GENERATED: ["ASSEMBLED"],
  ASSEMBLED: [], // Terminal state
};

export function canTransition(from: Stage, to: Stage): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: Stage, to: Stage): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid stage transition: ${from} -> ${to}. Valid transitions from ${from}: [${VALID_TRANSITIONS[from].join(", ")}]`
    );
  }
}

export function transitionState(
  state: ProjectState,
  to: Stage,
  baseDir: string = process.cwd()
): ProjectState {
  assertValidTransition(state.stage, to);

  const newState: ProjectState = {
    ...state,
    stage: to,
    error: null,
  };

  saveState(newState, baseDir);
  return newState;
}

// ============================================================================
// STATE MUTATION HELPERS
// ============================================================================

export function setTrend(
  state: ProjectState,
  trend: Trend,
  baseDir: string = process.cwd()
): ProjectState {
  if (state.stage !== "INIT") {
    throw new Error(`Cannot set trend in stage ${state.stage}. Must be INIT.`);
  }

  const validatedTrend = TrendSchema.parse(trend);

  const newState: ProjectState = {
    ...state,
    trend: validatedTrend,
  };

  saveState(newState, baseDir);
  return newState;
}

export function setScenes(
  state: ProjectState,
  scenes: Scene[],
  baseDir: string = process.cwd()
): ProjectState {
  if (state.stage !== "INIT") {
    throw new Error(
      `Cannot set scenes in stage ${state.stage}. Must be INIT.`
    );
  }

  const validatedScenes = z.array(SceneSchema).parse(scenes);

  const newState: ProjectState = {
    ...state,
    scenes: validatedScenes,
  };

  saveState(newState, baseDir);
  return newState;
}

export function updateScene(
  state: ProjectState,
  sceneId: string,
  updates: Partial<Scene>,
  baseDir: string = process.cwd()
): ProjectState {
  const sceneIndex = state.scenes.findIndex((s) => s.sceneId === sceneId);
  if (sceneIndex === -1) {
    throw new Error(`Scene not found: ${sceneId}`);
  }

  const updatedScene = { ...state.scenes[sceneIndex], ...updates };
  const validatedScene = SceneSchema.parse(updatedScene);

  const newScenes = [...state.scenes];
  newScenes[sceneIndex] = validatedScene;

  const newState: ProjectState = {
    ...state,
    scenes: newScenes,
  };

  saveState(newState, baseDir);
  return newState;
}

export function setError(
  state: ProjectState,
  error: string,
  baseDir: string = process.cwd()
): ProjectState {
  const newState: ProjectState = {
    ...state,
    error,
  };

  saveState(newState, baseDir);
  return newState;
}
