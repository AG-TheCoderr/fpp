import {
  CourseRecord,
  FoliageDensity,
  GhostFrame,
  GraphicsQuality,
  Rank,
  RankTimes,
  Settings,
} from './types';

const DEVICE_KEY = 'stride_device_id';
const LEGACY_SETTINGS = 'stride_settings_v1';
const LEGACY_RECORDS = 'stride_records_v1';

/** One id per browser profile — times never live in the app files or on the server. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (id && id.length >= 8) return id;
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'memory';
  }
}

function settingsKey(): string {
  return `stride_${getDeviceId()}_settings`;
}

function recordsKey(): string {
  return `stride_${getDeviceId()}_records`;
}

function migrateLegacy(): void {
  try {
    const sk = settingsKey();
    const rk = recordsKey();
    if (!localStorage.getItem(sk)) {
      const old = localStorage.getItem(LEGACY_SETTINGS);
      if (old) localStorage.setItem(sk, old);
    }
    if (!localStorage.getItem(rk)) {
      const old = localStorage.getItem(LEGACY_RECORDS);
      if (old) localStorage.setItem(rk, old);
    }
  } catch {
    /* private mode */
  }
}

migrateLegacy();

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1.0,
  fov: 96,
  volume: 0.75,
  motionBlur: 1.0,
  headBob: 1.0,
  graphics: 'high',
  foliage: 'high',
  showGhost: true,
  showFps: false,
  touchSize: 1,
  touchOpacity: 0.78,
  stickX: 4,
  stickY: 8,
  actionsX: 3,
  actionsY: 6,
  sysY: 3,
};

export function computeRank(time: number, ranks: RankTimes): Rank {
  if (time <= ranks.S) return 'S';
  if (time <= ranks.A) return 'A';
  if (time <= ranks.B) return 'B';
  return 'C';
}

export function formatTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const mins = Math.floor(clamped / 60);
  const rem = clamped - mins * 60;
  const whole = Math.floor(rem);
  const hundredths = Math.floor((rem - whole) * 100 + 1e-6);
  const mm = mins < 10 ? `0${mins}` : `${mins}`;
  const ss = whole < 10 ? `0${whole}` : `${whole}`;
  const cc = hundredths < 10 ? `0${hundredths}` : `${hundredths}`;
  return `${mm}:${ss}.${cc}`;
}

export function formatSplit(delta: number): string {
  const sign = delta <= 0 ? '-' : '+';
  const abs = Math.abs(delta);
  return `${sign}${abs.toFixed(2)}`;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(settingsKey());
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      sensitivity: clamp(Number(parsed.sensitivity ?? DEFAULT_SETTINGS.sensitivity), 0.2, 2.5),
      fov: clamp(Number(parsed.fov ?? DEFAULT_SETTINGS.fov), 80, 115),
      volume: clamp(Number(parsed.volume ?? DEFAULT_SETTINGS.volume), 0, 1),
      motionBlur: clamp(Number(parsed.motionBlur ?? DEFAULT_SETTINGS.motionBlur), 0, 1.5),
      headBob: clamp(Number(parsed.headBob ?? DEFAULT_SETTINGS.headBob), 0, 1.5),
      graphics: isGraphicsQuality(parsed.graphics) ? parsed.graphics : 'high',
      foliage: isFoliageDensity(parsed.foliage) ? parsed.foliage : 'high',
      showGhost: typeof parsed.showGhost === 'boolean' ? parsed.showGhost : true,
      showFps: typeof parsed.showFps === 'boolean' ? parsed.showFps : false,
      touchSize: clamp(Number(parsed.touchSize ?? DEFAULT_SETTINGS.touchSize), 0.7, 1.5),
      touchOpacity: clamp(Number(parsed.touchOpacity ?? DEFAULT_SETTINGS.touchOpacity), 0.2, 1),
      stickX: clamp(Number(parsed.stickX ?? DEFAULT_SETTINGS.stickX), 0, 28),
      stickY: clamp(Number(parsed.stickY ?? DEFAULT_SETTINGS.stickY), 0, 40),
      actionsX: clamp(Number(parsed.actionsX ?? DEFAULT_SETTINGS.actionsX), 0, 28),
      actionsY: clamp(Number(parsed.actionsY ?? DEFAULT_SETTINGS.actionsY), 0, 40),
      sysY: clamp(Number(parsed.sysY ?? DEFAULT_SETTINGS.sysY), 0, 80),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(settingsKey(), JSON.stringify(settings));
  } catch {
    // Ignore storage quota / iframe privacy restrictions
  }
}

export function loadAllRecords(): Record<string, CourseRecord> {
  try {
    const raw = localStorage.getItem(recordsKey());
    if (!raw || raw.length > 2_000_000) return {};
    const parsed = JSON.parse(raw);
    return sanitizeRecords(parsed);
  } catch {
    return {};
  }
}

export function loadCourseRecord(courseId: string): CourseRecord | null {
  const all = loadAllRecords();
  return all[courseId] ?? null;
}

export function saveCourseRecord(courseId: string, record: CourseRecord): void {
  try {
    const all = loadAllRecords();
    all[courseId] = record;
    localStorage.setItem(recordsKey(), JSON.stringify(all));
  } catch {
    // Ignore storage failure
  }
}

export function clearAllRecords(): void {
  try {
    localStorage.removeItem(recordsKey());
  } catch {
    // Ignore
  }
}

export function encodeGhost(frames: GhostFrame[]): number[] {
  // Cap at ~1800 frames (90s @ 20Hz) so localStorage stays tiny
  const stride = frames.length > 1800 ? Math.ceil(frames.length / 1800) : 1;
  const out: number[] = [];
  for (let i = 0; i < frames.length; i += stride) {
    const f = frames[i];
    out.push(
      Math.round(f.t * 1000),
      Math.round(f.x * 50),
      Math.round(f.y * 50),
      Math.round(f.z * 50),
      Math.round(f.yaw * 100),
      f.state
    );
  }
  // Always ensure the final frame is included
  if (frames.length > 1 && (frames.length - 1) % stride !== 0) {
    const f = frames[frames.length - 1];
    out.push(
      Math.round(f.t * 1000),
      Math.round(f.x * 50),
      Math.round(f.y * 50),
      Math.round(f.z * 50),
      Math.round(f.yaw * 100),
      f.state
    );
  }
  return out;
}

export function decodeGhost(data: number[]): GhostFrame[] {
  const frames: GhostFrame[] = [];
  for (let i = 0; i + 5 < data.length; i += 6) {
    frames.push({
      t: data[i] / 1000,
      x: data[i + 1] / 50,
      y: data[i + 2] / 50,
      z: data[i + 3] / 50,
      yaw: data[i + 4] / 100,
      state: data[i + 5],
    });
  }
  return frames;
}

function sanitizeRecords(parsed: unknown): Record<string, CourseRecord> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, CourseRecord> = {};
  const src = parsed as Record<string, unknown>;
  const keys = Object.keys(src).slice(0, 64);
  for (const id of keys) {
    if (!/^[a-z0-9_-]{1,32}$/i.test(id)) continue;
    const rec = src[id];
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const r = rec as Record<string, unknown>;
    const bestTime = Number(r.bestTime);
    const peakSpeed = Number(r.peakSpeed);
    const rank = r.rank;
    if (!Number.isFinite(bestTime) || bestTime < 0 || bestTime > 3600) continue;
    if (rank !== 'S' && rank !== 'A' && rank !== 'B' && rank !== 'C') continue;
    const splits = Array.isArray(r.splits)
      ? r.splits.map((n) => Number(n)).filter((n) => Number.isFinite(n)).slice(0, 16)
      : [];
    const ghost = Array.isArray(r.ghost)
      ? r.ghost.map((n) => Number(n)).filter((n) => Number.isFinite(n)).slice(0, 12_000)
      : [];
    out[id] = {
      bestTime,
      rank,
      peakSpeed: Number.isFinite(peakSpeed) ? Math.max(0, Math.min(80, peakSpeed)) : 0,
      splits,
      ghost,
    };
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function isGraphicsQuality(v: unknown): v is GraphicsQuality {
  return v === 'low' || v === 'medium' || v === 'high';
}

function isFoliageDensity(v: unknown): v is FoliageDensity {
  return v === 'off' || v === 'low' || v === 'high';
}
