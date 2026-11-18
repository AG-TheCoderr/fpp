import { CourseRecord, GhostFrame, Rank, RankTimes, Settings } from './types';

const SETTINGS_KEY = 'stride_settings_v1';
const RECORDS_KEY = 'stride_records_v1';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1.0,
  fov: 96,
  volume: 0.75,
  motionBlur: 1.0,
  headBob: 1.0,
  showGhost: true,
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
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      sensitivity: clamp(Number(parsed.sensitivity ?? DEFAULT_SETTINGS.sensitivity), 0.2, 2.5),
      fov: clamp(Number(parsed.fov ?? DEFAULT_SETTINGS.fov), 80, 115),
      volume: clamp(Number(parsed.volume ?? DEFAULT_SETTINGS.volume), 0, 1),
      motionBlur: clamp(Number(parsed.motionBlur ?? DEFAULT_SETTINGS.motionBlur), 0, 1.5),
      headBob: clamp(Number(parsed.headBob ?? DEFAULT_SETTINGS.headBob), 0, 1.5),
      showGhost: typeof parsed.showGhost === 'boolean' ? parsed.showGhost : true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota / iframe privacy restrictions
  }
}

export function loadAllRecords(): Record<string, CourseRecord> {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, CourseRecord>;
    }
    return {};
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
    localStorage.setItem(RECORDS_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage failure
  }
}

export function clearAllRecords(): void {
  try {
    localStorage.removeItem(RECORDS_KEY);
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

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
