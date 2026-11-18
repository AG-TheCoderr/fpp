import { BoxDef, CourseDef, RampDir } from '../types';

/** Walkable skyscraper rooftop whose exact TOP surface is `topY`. */
function roof(
  x: number,
  topY: number,
  z: number,
  w: number,
  d: number,
  opts: Partial<BoxDef> = {}
): BoxDef {
  const slabH = 2.0;
  return {
    x,
    y: topY - slabH,
    z,
    w,
    h: slabH,
    d,
    style: 'rooftop',
    ...opts,
  };
}

/** Suspended deck / elevated platform whose exact TOP surface is `topY`. */
function deck(
  x: number,
  topY: number,
  z: number,
  w: number,
  d: number,
  opts: Partial<BoxDef> = {}
): BoxDef {
  const h = opts.h ?? 0.9;
  return {
    x,
    y: topY - h,
    z,
    w,
    h,
    d,
    style: 'deck',
    ...opts,
  };
}

/** Narrow speedrunner shortcut catwalk whose exact TOP surface is `topY`. */
function catwalk(
  x: number,
  topY: number,
  z: number,
  w: number,
  d: number,
  guideDir?: RampDir
): BoxDef {
  return {
    x,
    y: topY - 0.45,
    z,
    w,
    h: 0.45,
    d,
    style: 'catwalk',
    guideDir,
  };
}

/** Waist-high signal-red vault block resting on `floorY`. */
function vault(
  x: number,
  floorY: number,
  z: number,
  w: number,
  d: number,
  h = 1.02
): BoxDef {
  return {
    x,
    y: floorY,
    z,
    w,
    h,
    d,
    style: 'vault',
    vaultable: true,
  };
}

/** Overhead red/white industrial barrier with open slide gap beneath it on `floorY`. */
function slideGate(
  x: number,
  floorY: number,
  z: number,
  w: number,
  d: number,
  clearance = 1.18,
  beamH = 1.75
): BoxDef {
  return {
    x,
    y: floorY + clearance,
    z,
    w,
    h: beamH,
    d,
    style: 'slide',
  };
}

/** Dedicated signal-red wall-run panel. `bottomY` is panel bottom, `h` is panel height. */
function wallPanel(
  id: string,
  x: number,
  bottomY: number,
  z: number,
  w: number,
  h: number,
  d: number,
  wallFace: BoxDef['wallFace']
): BoxDef {
  return {
    id,
    x,
    y: bottomY,
    z,
    w,
    h,
    d,
    style: 'wallrun',
    wallRun: true,
    wallFace,
  };
}

/** Concrete step / raised terrace block resting on `floorY` rising by `h`. */
function block(
  x: number,
  floorY: number,
  z: number,
  w: number,
  h: number,
  d: number,
  style: BoxDef['style'] = 'concrete',
  opts: Partial<BoxDef> = {}
): BoxDef {
  return {
    x,
    y: floorY,
    z,
    w,
    h,
    d,
    style,
    ...opts,
  };
}

// ============================================================================
// COURSE 01 — ROOFTOP
// Pure flow fundamentals: Sprint -> Vault -> Jump -> Slide -> Ramp -> Downhill Slide -> Mantle -> Finish
// Includes right-side catwalk shortcut over slide gate & left vault-skip onto elevated penthouse.
// ============================================================================
const COURSE_01: CourseDef = {
  id: 'rooftop',
  code: '01',
  name: 'ROOFTOP',
  spawn: [0, 0, -2],
  spawnYaw: 0, // facing -Z
  killY: -28,
  sunAzimuth: 0.62,
  sunElevation: 0.68,
  ranks: {
    S: 14.0,
    A: 16.5,
    B: 20.5,
    C: 27.0,
  },
  boxes: [
    // --- B1: Start Rooftop (z: +6 to -30, topY = 0) ---
    roof(0, 0, -12, 16, 36, { guideDir: '-z', label: 'R-01' }),
    // Architectural framing bulkheads behind & flanking start
    block(-6.4, 0, -5, 2.8, 3.6, 8, 'dark'),
    block(6.4, 0, -5, 2.8, 2.8, 7, 'concrete'),
    // First waist-high red vault block (auto-hurdle speed boost!)
    vault(0, 0, -15.5, 6.5, 1.1, 1.0),

    // --- Gap 1: 7.5m (z: -30 to -37.5), slight drop to -0.5 for forgiving feel ---
    // --- B2: Duct Barrier & Ramp Rooftop (z: -37.5 to -74, topY = -0.5) ---
    roof(0, -0.5, -55.75, 16, 36.5, { guideDir: '-z', label: 'R-02' }),
    // Slide gate across main lane
    slideGate(0, -0.5, -49.5, 11.2, 2.2, 1.18, 1.9),
    // Flanking concrete walls framing slide gate cleanly (with right-side pro shortcut!)
    block(-6.8, -0.5, -49.5, 2.4, 3.1, 2.6, 'dark'),
    // Pro Shortcut: narrow right-side elevated vault -> catwalk bypassing the slide gate!
    vault(6.5, -0.5, -43.5, 2.2, 1.1, 1.15),
    catwalk(6.5, 1.15, -51.2, 2.2, 13.4, '-z'),

    // --- Gap 2: 12.5m (z: -74 to -86.5) launched off red ramp (crest at y = +1.7) ---
    // --- B3: Checkpoint 1 + Downhill Slide Rooftop (z: -86.5 to -104, topY = 0.5) ---
    roof(0, 0.5, -95.25, 16, 17.5, { guideDir: '-z', label: 'R-03' }),
    // Downhill slide roof slab sits from z = -104 (y = 0.5) down to z = -124 (y = -4.5) via rampConcrete!
    // Structural building base beneath the sloped slide chute:
    roof(0, -4.5, -118.5, 16, 29, { guideDir: '-z', cleanRoof: true }),
    // Flat runout at bottom of slope: z = -124 to -133 (topY = -4.5)
    slideGate(0, -4.5, -126.5, 12.0, 1.8, 1.2, 1.9), // Rewards staying in downhill slide!

    // --- Gap 3: 11.5m (z: -133 to -144.5), landing at topY = -5.0 (high-speed slide-hop clears by miles!) ---
    // --- B4: Checkpoint 2 + Penthouse Step & Double Vault (z: -144.5 to -186, topY = -5.0) ---
    roof(0, -5.0, -165.25, 16, 41.5, { guideDir: '-z', label: 'R-04' }),
    // Raised penthouse terrace from z = -157 to -186, topY = -3.35 (+1.65m step -> auto-mantle OR left red vault box!)
    block(0, -5.0, -171.5, 15.2, 1.65, 29.0, 'concrete', { guideDir: '-z' }),
    // Fast-line red vault unit right in front of the step (left-center) so smart runners spring-vault up without slowing!
    vault(-3.2, -5.0, -156.1, 3.8, 1.4, 1.25),
    // Rhythm double-vault on penthouse
    vault(0, -3.35, -166.5, 7.5, 1.1, 1.0),
    vault(0, -3.35, -176.5, 7.5, 1.1, 1.0),

    // --- Gap 4: 12.0m (z: -186 to -198) off final red jump ramp -> Finish Rooftop! ---
    // --- B5: Finish Plaza (z: -198 to -226, topY = -2.5) ---
    roof(0, -2.5, -212, 18, 28, { guideDir: '-z', label: 'FIN' }),
    block(-7.2, -2.5, -218, 3.0, 4.5, 9.0, 'dark'),
    block(7.2, -2.5, -218, 3.0, 4.5, 9.0, 'dark'),
  ],
  ramps: [
    // Red launch ramp at end of B2 (z: -66 to -74, rises from -0.5 to +1.75)
    { x: 0, y: -0.5, z: -70.0, w: 7.2, h: 2.25, d: 8.0, dir: '-z', style: 'rampRed' },
    // Steep downhill concrete slide chute on B3 (z: -104 to -124, drops from +0.5 down to -4.5)
    { x: 0, y: -4.5, z: -114.0, w: 12.0, h: 5.0, d: 20.0, dir: '+z', style: 'rampConcrete' },
    // Final red launch ramp at end of B4 penthouse (z: -180 to -186, rises from -3.35 to -1.55)
    { x: 0, y: -3.35, z: -183.0, w: 7.6, h: 1.8, d: 6.0, dir: '-z', style: 'rampRed' },
  ],
  launchPads: [],
  grapples: [],
  checkpoints: [
    { index: 0, x: 0, y: 0.5, z: -92, w: 14, d: 3.5, spawnYaw: 0, axis: 'z' },
    { index: 1, x: 0, y: -5.0, z: -148.5, w: 14, d: 3.5, spawnYaw: 0, axis: 'z' },
  ],
  finish: { x: 0, y: -2.5, z: -207, w: 14, d: 4.0, axis: 'z' },
  prompts: [
    { x: 0, y: 2.2, z: -29.0, key: 'SPACE', action: 'JUMP', radius: 14 },
    { x: 0, y: 2.3, z: -48.5, key: 'SHIFT', action: 'SLIDE', radius: 16 },
    { x: 0, y: 2.6, z: -105.5, key: 'SHIFT', action: 'SLIDE BOOST', radius: 15 },
  ],
  flyover: [
    {
      from: [18, 12, 8],
      to: [14, 9, -58],
      lookFrom: [0, 1, -28],
      lookTo: [0, 0, -90],
      duration: 9.0,
    },
    {
      from: [-16, 7, -96],
      to: [-13, 4, -175],
      lookFrom: [0, -2, -125],
      lookTo: [0, -2, -208],
      duration: 9.0,
    },
  ],
};

// ============================================================================
// COURSE 02 — ALLEY
// Wall-run chains, twin-canyon kicks, turbine launch pad, 90-degree skyline turn.
// ============================================================================
const COURSE_02: CourseDef = {
  id: 'alley',
  code: '02',
  name: 'ALLEY',
  spawn: [0, 0, -2],
  spawnYaw: 0,
  killY: -30,
  sunAzimuth: -0.55,
  sunElevation: 0.58,
  ranks: {
    S: 15.5,
    A: 19.0,
    B: 24.5,
    C: 32.0,
  },
  boxes: [
    // --- S1: Start Roof (z: +6 to -24, topY = 0) ---
    roof(0, 0, -9, 14, 30, { guideDir: '-z', label: 'A-01' }),
    slideGate(0, 0, -14, 10, 2.0, 1.18, 1.85),

    // --- Single Right-Side Billboard Wall-Run (z: -23.5 to -41.5) ---
    // Inner face at x = +3.3 (easy natural step right from z=-24 along the bold red billboard!)
    wallPanel('a_wr1', 4.1, -3.2, -32.5, 1.6, 8.2, 18.0, '-x'),
    // Backing building tower behind right wall so it looks like a real skyscraper facade!
    roof(13.0, 7.5, -32.5, 15.5, 22, { noCollide: true, cleanRoof: true }),

    // --- S2: Landing Roof + Checkpoint 1 + Downhill Chute (z: -40.5 to -60, topY = -0.5) ---
    roof(0, -0.5, -50.25, 15, 19.5, { guideDir: '-z', label: 'A-02' }),
    // Base under downhill ramp (z: -60 to -78, dropping from -0.5 to -4.5)
    roof(0, -4.5, -72, 15, 24, { guideDir: '-z', cleanRoof: true }),

    // --- Twin Canyon Wall-Run Chain (z: -83.5 to -114)! ---
    // Left Wall #1: z: -83.0 to -100.0, inner face at x = -3.4
    wallPanel('a_wr2_L', -4.2, -7.8, -91.5, 1.6, 8.8, 17.5, '+x'),
    roof(-13.2, 4.0, -91.5, 16.4, 20, { noCollide: true, cleanRoof: true }),
    // Right Wall #2: z: -96.0 to -114.0, inner face at x = +3.4 (4m overlap for effortless wall-kick!)
    wallPanel('a_wr2_R', 4.2, -7.8, -105.0, 1.6, 9.0, 18.0, '-x'),
    roof(13.2, 4.5, -105.0, 16.4, 21, { noCollide: true, cleanRoof: true }),

    // --- S3: Corner Hub Roof + CP 2 (turns 90° RIGHT toward +X!) ---
    // z: -112.5 to -134, x: -7 to +22, topY = -4.5
    roof(7.5, -4.5, -123.25, 29, 21.5, { guideDir: '+x', label: 'A-03' }),
    // Visual corner backstop billboard with bold signal-red right-turn chevrons guiding player +X!
    block(1.5, -4.5, -133.2, 22, 4.8, 1.5, 'dark', { guideDir: '+x' }),
    // Vault block heading +X into Launch Pad!
    vault(12.0, -4.5, -123.5, 1.1, 7.0, 1.0),

    // --- Turbine Launch Pad at (19.5, -4.5, -123.5) launches player +X and UP onto High Terrace (topY = +4.0)! ---
    // --- S4: Upper Penthouse Terrace + CP 3 (x: 35 to 68, z: -123.5, topY = +4.0) ---
    roof(51.5, 4.0, -123.5, 33, 16, { guideDir: '+x', label: 'A-04' }),
    // Double rhythm: slide gate -> vault block heading +X
    slideGate(50.0, 4.0, -123.5, 2.0, 11.0, 1.18, 1.85),
    vault(60.5, 4.0, -123.5, 1.1, 7.5, 1.02),
    // Pro Shortcut: elevated left beam (z = -129.5) skips slide gate!
    catwalk(52.0, 5.2, -129.8, 18.0, 2.0, '+x'),

    // --- Triple Wall-Run Finale heading +X (x: 68 to 112, centered on z = -123.5)! ---
    // Wall A (left side = -Z, inner face at z = -126.5): x: 67.0 to 85.0
    wallPanel('a_wr3_L1', 76.0, 0.5, -127.3, 18.0, 9.0, 1.6, '+z'),
    roof(76.0, 12.0, -136.4, 19, 16, { noCollide: true, cleanRoof: true }),
    // Wall B (right side = +Z, inner face at z = -120.5): x: 81.0 to 98.5
    wallPanel('a_wr3_R1', 89.75, 0.8, -119.7, 17.5, 9.0, 1.6, '-z'),
    roof(89.75, 12.5, -110.6, 20, 16, { noCollide: true, cleanRoof: true }),
    // Wall C (left side = -Z, inner face at z = -126.5): x: 94.5 to 112.0
    wallPanel('a_wr3_L2', 103.25, 1.0, -127.3, 17.5, 9.2, 1.6, '+z'),
    roof(103.25, 13.0, -136.4, 20, 16, { noCollide: true, cleanRoof: true }),

    // --- S5: Finish Rooftop (x: 111 to 142, z: -123.5, topY = +3.5) ---
    roof(126.5, 3.5, -123.5, 31, 18, { guideDir: '+x', label: 'FIN' }),
    block(136, 3.5, -130.5, 8, 4.5, 2.8, 'dark'),
    block(136, 3.5, -116.5, 8, 4.5, 2.8, 'dark'),
  ],
  ramps: [
    // Downhill slide chute on S2 (z: -60 to -78, drops from -0.5 to -4.5)
    { x: 0, y: -4.5, z: -69.0, w: 11.0, h: 4.0, d: 18.0, dir: '+z', style: 'rampConcrete' },
  ],
  launchPads: [
    // Launches player cleanly from (19.5, -4.5, -123.5) up to (38, +4.0, -123.5)
    { x: 19.5, y: -4.5, z: -123.5, w: 3.6, d: 4.4, vx: 16.8, vy: 18.2, vz: 0 },
  ],
  grapples: [],
  checkpoints: [
    { index: 0, x: 0, y: -0.5, z: -47.0, w: 13, d: 3.5, spawnYaw: 0, axis: 'z' },
    { index: 1, x: 2.0, y: -4.5, z: -120.0, w: 13, d: 4.0, spawnYaw: -Math.PI / 2, axis: 'z' },
    { index: 2, x: 41.0, y: 4.0, z: -123.5, w: 3.5, d: 14, spawnYaw: -Math.PI / 2, axis: 'x' },
  ],
  finish: { x: 124.0, y: 3.5, z: -123.5, w: 4.0, d: 14, axis: 'x' },
  prompts: [
    { x: 3.6, y: 2.8, z: -25.5, key: 'SPACE', action: 'WALL RUN', radius: 16 },
    { x: -3.6, y: -1.4, z: -86.0, key: 'SPACE', action: 'WALL KICK', radius: 16 },
  ],
  flyover: [
    {
      from: [-12, 10, -12],
      to: [-8, 6, -98],
      lookFrom: [4, 2, -38],
      lookTo: [4, -1, -118],
      duration: 9.0,
    },
    {
      from: [28, 14, -108],
      to: [98, 12, -112],
      lookFrom: [55, 5, -123.5],
      lookTo: [128, 5, -123.5],
      duration: 9.0,
    },
  ],
};

// ============================================================================
// COURSE 03 — SKYHOOK
// High-altitude crane grapple swings, wall-run -> grapple combos, double skyhook chasm!
// ============================================================================
const COURSE_03: CourseDef = {
  id: 'skyhook',
  code: '03',
  name: 'SKYHOOK',
  spawn: [0, 0, -2],
  spawnYaw: 0,
  killY: -34,
  sunAzimuth: 0.92,
  sunElevation: 0.52,
  ranks: {
    S: 16.0,
    A: 20.0,
    B: 26.0,
    C: 35.0,
  },
  boxes: [
    // --- T1: Start Skyscraper (z: +6 to -26, topY = 0) ---
    roof(0, 0, -10, 16, 32, { guideDir: '-z', label: 'S-01' }),
    vault(0, 0, -16, 7.0, 1.1, 1.0),

    // --- Chasm 1: 23m gap (z: -26 to -49) bridged by Crane Grapple Hook #1 at (0, 9.2, -37.5) ---
    // --- T2: CP 1 + Slide Ramp into Wall-Run-Grapple Combo (z: -49 to -84, topY = 0) ---
    roof(0, 0, -58, 16, 18, { guideDir: '-z', label: 'S-02' }),
    roof(0, -3.5, -76, 16, 18, { guideDir: '-z', cleanRoof: true }),

    // Right wall-run panel (z: -84.5 to -102.5, inner face x = +3.4) leading directly into Grapple Hook #2!
    wallPanel('s_wr1', 4.2, -6.5, -93.5, 1.6, 8.8, 18.0, '-x'),
    roof(13.2, 6.0, -93.5, 16, 21, { noCollide: true, cleanRoof: true }),

    // --- Grapple Hook #2 at (0, 6.2, -112) swings across to T3 (z: -124) ---
    // --- T3: CP 2 + Double Skyhook Overlook (z: -124 to -150, topY = -2.0) ---
    roof(0, -2.0, -137, 16, 26, { guideDir: '-z', label: 'S-03' }),
    slideGate(0, -2.0, -139, 11.5, 2.0, 1.18, 1.85),

    // --- Chasm 3: Massive 45m Double-Skyhook Canyon (z: -150 to -195)! ---
    // Hook #3A at (0, 7.8, -161.5) -> Hook #3B at (0, 8.8, -182.5)
    // Optional lower safe rest deck mid-canyon so newer players can land & re-hook, while pros chain A->B nonstop!
    deck(0, -4.2, -172.5, 9.0, 8.5, { guideDir: '-z' }),

    // --- T4: CP 3 + Turbine Ascent into High Skyhook Finale (z: -195 to -224, topY = -1.0) ---
    roof(0, -1.0, -209.5, 16, 29, { guideDir: '-z', label: 'S-04' }),
    vault(0, -1.0, -208, 7.5, 1.1, 1.02),
    // Launch pad at (0, -1.0, -221) shoots player high up to catch High Hook #4 at (0, 16.5, -238)!

    // --- T5: Elevated Skybridge Finish Tower (z: -248 to -284, topY = +6.5) ---
    roof(0, 6.5, -266, 18, 36, { guideDir: '-z', label: 'FIN' }),
    vault(0, 6.5, -258, 8.0, 1.1, 1.0),
    block(-7.2, 6.5, -276, 3.0, 5.0, 9.0, 'dark'),
    block(7.2, 6.5, -276, 3.0, 5.0, 9.0, 'dark'),
  ],
  ramps: [
    // Downhill speed ramp on T2 (z: -67 to -81, drops from 0 down to -3.5)
    { x: 0, y: -3.5, z: -74.0, w: 11.5, h: 3.5, d: 14.0, dir: '+z', style: 'rampConcrete' },
  ],
  launchPads: [
    { x: 0, y: -1.0, z: -221.0, w: 4.2, d: 4.0, vx: 0, vy: 19.5, vz: -15.5 },
  ],
  grapples: [
    { id: 'g1', x: 0, y: 9.2, z: -37.5, radius: 27, mountSide: '+x' },
    { id: 'g2', x: 0, y: 6.2, z: -112.0, radius: 28, mountSide: '-x' },
    { id: 'g3a', x: 0, y: 7.8, z: -161.5, radius: 28, mountSide: '+x' },
    { id: 'g3b', x: 0, y: 8.8, z: -182.5, radius: 28, mountSide: '-x' },
    { id: 'g4', x: 0, y: 17.5, z: -238.5, radius: 29, mountSide: 'arch' },
  ],
  checkpoints: [
    { index: 0, x: 0, y: 0, z: -54.0, w: 14, d: 3.5, spawnYaw: 0, axis: 'z' },
    { index: 1, x: 0, y: -2.0, z: -129.0, w: 14, d: 3.5, spawnYaw: 0, axis: 'z' },
    { index: 2, x: 0, y: -1.0, z: -200.0, w: 14, d: 3.5, spawnYaw: 0, axis: 'z' },
  ],
  finish: { x: 0, y: 6.5, z: -271.0, w: 14, d: 4.0, axis: 'z' },
  prompts: [
    { x: 0, y: 7.4, z: -37.5, key: 'RMB / E', action: 'GRAPPLE', radius: 28 },
  ],
  flyover: [
    {
      from: [-18, 12, -16],
      to: [-16, 10, -110],
      lookFrom: [0, 6, -38],
      lookTo: [0, 3, -135],
      duration: 9.5,
    },
    {
      from: [19, 11, -145],
      to: [16, 18, -245],
      lookFrom: [0, 5, -172],
      lookTo: [0, 9, -271],
      duration: 9.5,
    },
  ],
};

// ============================================================================
// COURSE 04 — CIRCUIT
// The ultimate skyline gauntlet combining every single mechanic at full speed:
// Downhill Drop-In -> Vault -> Wall-Run -> Grapple -> Chicane/Shortcut -> Twin Kick ->
// 90° Left Turn -> Launch Pad -> Air Wall-Run -> Grapple -> Slide Blast Gate -> Ramp Finish!
// ============================================================================
const COURSE_04: CourseDef = {
  id: 'circuit',
  code: '04',
  name: 'CIRCUIT',
  spawn: [0, 6.0, -1],
  spawnYaw: 0,
  killY: -34,
  sunAzimuth: -0.82,
  sunElevation: 0.48,
  ranks: {
    S: 21.5,
    A: 26.0,
    B: 33.0,
    C: 44.0,
  },
  boxes: [
    // --- C1: High Drop-In Start Pad (z: +6 to -8, topY = +6.0) ---
    roof(0, 6.0, -1, 14, 14, { guideDir: '-z', label: 'C-01' }),
    // Steep downhill drop-in ramp (z: -8 to -28, drops +6.0 -> 0.0) into instant high speed!
    roof(0, 0, -25, 15, 34, { guideDir: '-z', cleanRoof: true }),
    // Spring-vault right at cliff lip (z = -37)
    vault(0, 0, -37.0, 7.5, 1.1, 1.0),

    // --- Left Wall-Run (z: -41.5 to -59.5) straight into Grapple Hook #1 (z: -69) ---
    wallPanel('c_wr1', -3.9, -3.5, -50.5, 1.6, 8.8, 18.0, '+x'),
    roof(-12.9, 9.0, -50.5, 16, 22, { noCollide: true, cleanRoof: true }),

    // --- C2: Sector B Chicane Rooftop + CP 1 (z: -79 to -126, topY = 0) ---
    roof(0, 0, -102.5, 16, 47, { guideDir: '-z', label: 'C-02' }),
    // Main lane rhythm: Slide -> Vault -> Slide
    slideGate(0, 0, -96.0, 10.5, 2.0, 1.18, 1.85),
    vault(0, 0, -107.0, 8.0, 1.1, 1.02),
    slideGate(0, 0, -118.0, 10.5, 2.0, 1.18, 1.85),
    // Pro Shortcut: left-side high red spine catwalk above the entire chicane!
    vault(-6.4, 0, -90.5, 2.2, 1.1, 1.15),
    catwalk(-6.4, 1.55, -106.5, 2.0, 26.0, '-z'),

    // --- Twin Wall-Run Climb (z: -125.5 to -156.5) ---
    wallPanel('c_wr2_R', 4.2, -3.2, -134.5, 1.6, 8.8, 18.0, '-x'),
    roof(13.2, 9.5, -134.5, 16, 20, { noCollide: true, cleanRoof: true }),
    wallPanel('c_wr2_L', -4.2, -2.8, -148.0, 1.6, 9.0, 18.0, '+x'),
    roof(-13.2, 10.0, -148.0, 16, 20, { noCollide: true, cleanRoof: true }),

    // --- C3: Corner Plaza + CP 2 — 90° LEFT TURN heading -X! ---
    // z: -155.5 to -176, x: +7 to -24, topY = +0.5
    roof(-8.5, 0.5, -165.75, 31, 20.5, { guideDir: '-x', label: 'C-03' }),
    block(-2.5, 0.5, -175.2, 22, 4.8, 1.5, 'dark', { guideDir: '-x' }), // Bold signal-red left-turn billboard!

    // --- Launch Pad at (-21.0, +0.5, -166.25) blasts player -X into high Sky Wall-Run + Grapple! ---
    // High right-side wall-run heading -X (right side when facing -X is -Z! inner face z = -169.8)
    wallPanel('c_wr3_air', -48.5, 3.2, -170.6, 19.0, 9.2, 1.6, '+z'),
    roof(-48.5, 16.0, -179.5, 22, 16, { noCollide: true, cleanRoof: true }),
    // Forgiving deck just before wall so player lands cleanly from launch pad
    deck(-37.0, 6.5, -166.25, 11.0, 11.0, { guideDir: '-x' }),

    // --- Grapple Hook #2 at (-66.5, 15.5, -166.25) swings onto C4 ---
    // --- C4: CP 3 + Final Speed Stretch heading -X (x: -76.5 to -132) ---
    roof(-86.25, 6.5, -166.25, 19.5, 16, { guideDir: '-x', label: 'C-04' }),
    // Downhill slide chute from x = -96 (y = +6.5) down to x = -116 (y = +1.5), then flat to x = -132!
    roof(-114.0, 1.5, -166.25, 36, 16, { guideDir: '-x', cleanRoof: true }),
    // Low blast gate right at bottom of slide chute — duck at 22 m/s!
    slideGate(-119.5, 1.5, -166.25, 2.2, 12.0, 1.18, 2.1),

    // --- Final Red Launch Ramp (x: -125 to -132) -> Grapple Hook #3 (-144, 12.2) -> Grand Finish! ---
    // --- C5: Grand Finish Tower (x: -155 to -192, z: -166.25, topY = +3.0) ---
    roof(-173.5, 3.0, -166.25, 37, 20, { guideDir: '-x', label: 'FIN' }),
    vault(-163.5, 3.0, -166.25, 1.1, 8.5, 1.0),
    block(-184.0, 3.0, -174.0, 9.0, 5.5, 3.0, 'dark'),
    block(-184.0, 3.0, -158.5, 9.0, 5.5, 3.0, 'dark'),
  ],
  ramps: [
    // Opening downhill drop-in ramp (z: -8 to -28, +6.0 down to 0.0 -> dir: '+z')
    { x: 0, y: 0, z: -18.0, w: 11.5, h: 6.0, d: 20.0, dir: '+z', style: 'rampConcrete' },
    // Final downhill speed chute heading -X (x: -96 to -116, +6.5 down to +1.5 -> ascends '+x')
    { x: -106.0, y: 1.5, z: -166.25, w: 20.0, h: 5.0, d: 12.0, dir: '+x', style: 'rampConcrete' },
    // Final red launch ramp heading -X (x: -125 to -132, rises +1.5 -> +3.6)
    { x: -128.5, y: 1.5, z: -166.25, w: 7.0, h: 2.1, d: 8.0, dir: '-x', style: 'rampRed' },
  ],
  launchPads: [
    { x: -21.0, y: 0.5, z: -166.25, w: 4.0, d: 4.4, vx: -17.5, vy: 16.5, vz: 0 },
  ],
  grapples: [
    { id: 'cg1', x: 0, y: 9.6, z: -69.0, radius: 29, mountSide: '-x' },
    { id: 'cg2', x: -66.0, y: 15.8, z: -166.25, radius: 29, mountSide: '-z' },
    { id: 'cg3', x: -144.0, y: 12.2, z: -166.25, radius: 29, mountSide: 'arch' },
  ],
  checkpoints: [
    { index: 0, x: 0, y: 0, z: -85.5, w: 14, d: 3.5, spawnYaw: 0, axis: 'z' },
    { index: 1, x: -3.0, y: 0.5, z: -163.0, w: 14, d: 4.0, spawnYaw: Math.PI / 2, axis: 'z' },
    { index: 2, x: -83.0, y: 6.5, z: -166.25, w: 3.5, d: 14, spawnYaw: Math.PI / 2, axis: 'x' },
  ],
  finish: { x: -175.0, y: 3.0, z: -166.25, w: 4.0, d: 15, axis: 'x' },
  prompts: [],
  flyover: [
    {
      from: [16, 14, -10],
      to: [15, 10, -135],
      lookFrom: [0, 3, -45],
      lookTo: [0, 2, -165],
      duration: 9.5,
    },
    {
      from: [-30, 18, -148],
      to: [-140, 14, -150],
      lookFrom: [-66, 9, -166.25],
      lookTo: [-176, 5, -166.25],
      duration: 9.5,
    },
  ],
};

export const COURSES: CourseDef[] = [COURSE_01, COURSE_02, COURSE_03, COURSE_04];
