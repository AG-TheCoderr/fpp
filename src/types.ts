export type Vec3 = [number, number, number];

export type RampDir = '+x' | '-x' | '+z' | '-z';

export type SurfaceStyle =
  | 'rooftop'       // Main walkable building roof (extrudes skyscraper downward!)
  | 'deck'          // Elevated platform/bridge without full skyscraper shaft (supports/truss)
  | 'concrete'      // Solid white brutalist block / step / wall
  | 'dark'          // Dark structural concrete block / bulkhead
  | 'vault'         // Signal-red waist-high vault obstacle
  | 'wallrun'       // Signal-red corrugated wall-run panel (with structural backing)
  | 'slide'         // Overhead red/white industrial barrier with open gap underneath
  | 'rampRed'       // Signal-red jump ramp
  | 'rampConcrete'  // Concrete sloped roof / downhill slide chute
  | 'catwalk'       // Narrow speedrun metal/red catwalk beam
  | 'pillar';       // Support column / tower shaft

export interface BoxDef {
  id?: string;
  /** Center X, BOTTOM Y, Center Z — using bottom Y makes rooftop math exact and error-free! */
  x: number;
  y: number;
  z: number;
  /** Full extents (width X, height Y, depth Z) */
  w: number;
  h: number;
  d: number;
  style: SurfaceStyle;
  /** Can auto-vault when hit around waist height */
  vaultable?: boolean;
  /** Dedicated grip wall-run surface */
  wallRun?: boolean;
  /** Which face(s) get the red runner grip treatment on wallrun blocks */
  wallFace?: '+x' | '-x' | '+z' | '-z' | 'both-x' | 'both-z';
  /** Disable collision (purely decorative) */
  noCollide?: boolean;
  /** Disable automatic rooftop edge props on this rooftop */
  cleanRoof?: boolean;
  /** Skip skyscraper shaft / pilasters (lightweight off-track playground roofs). */
  noShaft?: boolean;
  /** Optional direction of painted runner guide strip on top */
  guideDir?: RampDir;
  /** Optional stencil code painted on roof/wall */
  label?: string;
}

export interface RampDef {
  id?: string;
  /** Center X, BOTTOM Y (low end), Center Z */
  x: number;
  y: number;
  z: number;
  w: number;
  /** Height rise from low end to high end */
  h: number;
  d: number;
  /** Direction the ramp ASCENDS toward (so sliding opposite to `dir` goes downhill!) */
  dir: RampDir;
  style: 'rampRed' | 'rampConcrete';
}

export interface LaunchPadDef {
  x: number;
  /** Surface Y where pad sits */
  y: number;
  z: number;
  w?: number;
  d?: number;
  /** Launch velocity vector applied to player */
  vx: number;
  vy: number;
  vz: number;
}

export interface GrappleDef {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Max attach distance (default 24) */
  radius?: number;
  /** Direction from which the support crane boom extends (visual grounding) */
  mountSide?: '+x' | '-x' | '+z' | '-z' | 'arch';
}

export interface CheckpointDef {
  index: number;
  /** Center X, floor Y, Center Z */
  x: number;
  y: number;
  z: number;
  /** Gate width and depth */
  w: number;
  d: number;
  /** Facing yaw in radians when respawning here (0 = facing -Z, -PI/2 = facing +X, PI/2 = facing -X, PI = facing +Z) */
  spawnYaw: number;
  /** Gate visual orientation: 'z' means player crosses along Z axis, 'x' means along X axis */
  axis: 'x' | 'z';
}

export interface FinishDef {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  axis: 'x' | 'z';
}

export interface KeyPromptDef {
  x: number;
  y: number;
  z: number;
  key: string;
  action?: string;
  radius?: number;
}

export interface CameraShot {
  from: Vec3;
  to: Vec3;
  lookFrom: Vec3;
  lookTo: Vec3;
  duration: number;
}

export type Rank = 'S' | 'A' | 'B' | 'C';

export interface RankTimes {
  S: number;
  A: number;
  B: number;
  C: number;
}

export interface CourseDef {
  id: string;
  code: string;
  name: string;
  spawn: Vec3;
  /** Yaw in radians: 0 faces -Z, -PI/2 faces +X, +PI/2 faces -X, PI faces +Z */
  spawnYaw: number;
  /** Respawn if player drops below this Y */
  killY: number;
  sunAzimuth: number;
  sunElevation: number;
  ranks: RankTimes;
  boxes: BoxDef[];
  ramps: RampDef[];
  launchPads: LaunchPadDef[];
  grapples: GrappleDef[];
  checkpoints: CheckpointDef[];
  finish: FinishDef;
  prompts: KeyPromptDef[];
  flyover: CameraShot[];
}

export type MoveState =
  | 'idle'
  | 'run'
  | 'air'
  | 'slide'
  | 'wallrun'
  | 'vault'
  | 'mantle'
  | 'grapple';

export type GameScreen =
  | 'title'
  | 'courses'
  | 'playing'
  | 'paused'
  | 'finished';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export type FoliageDensity = 'off' | 'low' | 'high';

export interface Settings {
  sensitivity: number;       // 0.2 .. 2.5, default 1.0
  fov: number;               // 80 .. 115, default 96
  volume: number;            // 0 .. 1, default 0.75
  motionBlur: number;        // 0 .. 1.5, default 1.0
  headBob: number;           // 0 .. 1.5, default 1.0
  graphics: GraphicsQuality; // default 'high'
  foliage: FoliageDensity;   // default 'high'
  showGhost: boolean;        // default true
  showFps: boolean;          // default false
}

export interface GhostFrame {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: number; // encoded MoveState index
}

export interface CourseRecord {
  bestTime: number;
  rank: Rank;
  peakSpeed: number;
  splits: number[]; // elapsed time at each checkpoint index
  ghost: number[];  // flat quantized array [dt_ms, x*100, y*100, z*100, yaw*100, state, ...]
}
