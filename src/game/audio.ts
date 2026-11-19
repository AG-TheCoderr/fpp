/**
 * Quiet procedural SFX. Wind is a low rumble, hits are short sine/triangle —
 * no screaming bandpass noise on every step.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;

  private windPanner: PannerNode | null = null;
  private cityLPanner: PannerNode | null = null;
  private cityRPanner: PannerNode | null = null;
  private skyPanner: PannerNode | null = null;
  private cityLGain: GainNode | null = null;
  private cityRGain: GainNode | null = null;
  private skyGain: GainNode | null = null;

  private volume = 0.75;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume * 0.7, this.ctx.currentTime, 0.03);
    }
  }

  unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.setupGraph();
      } catch {
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private setupGraph(): void {
    const ctx = this.ctx!;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.volume * 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    this.masterGain.connect(comp);
    comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.998 * b0 + white * 0.02;
      data[i] = b0 * 0.55;
    }

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 280;
    this.windFilter.Q.value = 0.4;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.008;
    this.windPanner = this.makePanner(18, 140);
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.windPanner);
    this.windPanner.connect(this.masterGain);
    windSrc.start();

    const slideSrc = ctx.createBufferSource();
    slideSrc.buffer = this.noiseBuffer;
    slideSrc.loop = true;
    this.slideFilter = ctx.createBiquadFilter();
    this.slideFilter.type = 'lowpass';
    this.slideFilter.frequency.value = 520;
    this.slideFilter.Q.value = 0.5;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    slideSrc.connect(this.slideFilter);
    this.slideFilter.connect(this.slideGain);
    this.slideGain.connect(this.masterGain);
    slideSrc.start();

    this.cityLPanner = this.makePanner(22, 160);
    this.cityRPanner = this.makePanner(22, 160);
    this.skyPanner = this.makePanner(28, 200);
    this.cityLGain = ctx.createGain();
    this.cityRGain = ctx.createGain();
    this.skyGain = ctx.createGain();
    this.cityLGain.gain.value = 0.018;
    this.cityRGain.gain.value = 0.016;
    this.skyGain.gain.value = 0.012;

    const humL = this.makeHum(62, 0.35);
    const humR = this.makeHum(78, 0.32);
    const air = this.makeAirBed();
    humL.connect(this.cityLGain);
    this.cityLGain.connect(this.cityLPanner);
    this.cityLPanner.connect(this.masterGain);
    humR.connect(this.cityRGain);
    this.cityRGain.connect(this.cityRPanner);
    this.cityRPanner.connect(this.masterGain);
    air.connect(this.skyGain);
    this.skyGain.connect(this.skyPanner);
    this.skyPanner.connect(this.masterGain);
  }

  private makePanner(ref: number, max: number): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = max;
    p.rolloffFactor = 0.85;
    p.coneInnerAngle = 360;
    p.coneOuterAngle = 360;
    return p;
  }

  private makeHum(freq: number, mix: number): GainNode {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const g = ctx.createGain();
    g.gain.value = mix * 0.04;
    osc.connect(lp);
    lp.connect(g);
    osc.start();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = 220;
    const ng = ctx.createGain();
    ng.gain.value = 0.012;
    src.connect(nlp);
    nlp.connect(ng);
    ng.connect(g);
    src.start();
    return g;
  }

  private makeAirBed(): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 640;
    bp.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.value = 1;
    src.connect(bp);
    bp.connect(g);
    src.start();
    return g;
  }

  /** Place listener at the camera; park wind/city/sky around the runner. */
  updateListener(
    x: number,
    y: number,
    z: number,
    fx: number,
    fy: number,
    fz: number,
    ux: number,
    uy: number,
    uz: number,
    sx: number,
    sy: number,
    sz: number,
    active: boolean
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const l = this.ctx.listener;
    const set = (
      param: AudioParam | undefined,
      v: number,
      fallback: () => void
    ) => {
      if (param) param.setTargetAtTime(v, now, 0.04);
      else fallback();
    };
    set(l.positionX, x, () => l.setPosition(x, y, z));
    set(l.positionY, y, () => {});
    set(l.positionZ, z, () => {});
    if (l.forwardX) {
      l.forwardX.setTargetAtTime(fx, now, 0.04);
      l.forwardY.setTargetAtTime(fy, now, 0.04);
      l.forwardZ.setTargetAtTime(fz, now, 0.04);
      l.upX.setTargetAtTime(ux, now, 0.04);
      l.upY.setTargetAtTime(uy, now, 0.04);
      l.upZ.setTargetAtTime(uz, now, 0.04);
    } else if (typeof l.setOrientation === 'function') {
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }

    const rx = fy * uz - fz * uy;
    const ry = fz * ux - fx * uz;
    const rz = fx * uy - fy * ux;
    const rlen = Math.hypot(rx, ry, rz) || 1;

    this.setPanner(this.windPanner, x + sx * 22, y + sy * 22 + 4, z + sz * 22);
    this.setPanner(
      this.cityLPanner,
      x - (rx / rlen) * 36,
      y - 6,
      z - (rz / rlen) * 36
    );
    this.setPanner(
      this.cityRPanner,
      x + (rx / rlen) * 40,
      y - 4,
      z + (rz / rlen) * 40
    );
    this.setPanner(this.skyPanner, x + fx * 8, y + 28, z + fz * 8);

    const bed = active ? 1 : 0.35;
    this.cityLGain?.gain.setTargetAtTime(0.018 * bed, now, 0.12);
    this.cityRGain?.gain.setTargetAtTime(0.016 * bed, now, 0.12);
    this.skyGain?.gain.setTargetAtTime(0.012 * bed, now, 0.12);
  }

  private setPanner(p: PannerNode | null, x: number, y: number, z: number): void {
    if (!p || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, now, 0.05);
      p.positionY.setTargetAtTime(y, now, 0.05);
      p.positionZ.setTargetAtTime(z, now, 0.05);
    } else {
      p.setPosition(x, y, z);
    }
  }

  updateContinuous(
    totalSpeed: number,
    sliding: boolean,
    slideCarve = 0,
    slideBraking = false,
    active = true
  ): void {
    if (!this.ctx || !this.windGain || !this.windFilter || !this.slideGain || !this.slideFilter) {
      return;
    }
    const now = this.ctx.currentTime;

    if (!active) {
      this.windGain.gain.setTargetAtTime(0.004, now, 0.18);
      this.windFilter.frequency.setTargetAtTime(220, now, 0.18);
      this.slideGain.gain.setTargetAtTime(0, now, 0.06);
      return;
    }

    const sNorm = Math.max(0, Math.min(1, (totalSpeed - 8) / 18));
    this.windGain.gain.setTargetAtTime(0.006 + sNorm * sNorm * 0.045, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(240 + sNorm * 380, now, 0.1);

    if (sliding && totalSpeed > 1.5) {
      const slideNorm = Math.max(0.2, Math.min(1, totalSpeed / 20));
      const bite = 1 + Math.abs(slideCarve) * 0.12 + (slideBraking ? 0.2 : 0);
      this.slideGain.gain.setTargetAtTime(Math.min(0.07, 0.035 * slideNorm * bite), now, 0.04);
      this.slideFilter.frequency.setTargetAtTime(380 + slideNorm * 280, now, 0.05);
    } else {
      this.slideGain.gain.setTargetAtTime(0, now, 0.05);
    }
  }

  playFootstep(speed: number, isWall: boolean, foot: -1 | 1 = 1): void {
    const vol = Math.min(0.11, (0.04 + (speed / 24) * 0.06) * (isWall ? 0.8 : 1));
    const f = (isWall ? 148 : 92) * (foot < 0 ? 0.97 : 1.03);
    this.playThump(f, vol, 0.05, foot * 0.28);
  }

  playPivot(intensity: number): void {
    this.playThump(70, 0.04 + intensity * 0.04, 0.06);
  }

  playJump(boosted: boolean): void {
    this.playToneSweep(140, 210, 0.07, boosted ? 0.07 : 0.045, 'sine');
  }

  playLand(impact: number, intoSlide: boolean): void {
    const strength = Math.max(0.12, Math.min(0.7, impact / 24));
    this.playThump(72, (intoSlide ? 0.06 : 0.12) * strength, 0.08);
  }

  playSlideStart(slopeSlam = false): void {
    this.playThump(slopeSlam ? 90 : 110, slopeSlam ? 0.08 : 0.05, 0.07);
  }

  playVault(spring: boolean): void {
    this.playToneSweep(180, 90, 0.06, 0.07, 'sine');
    if (spring) this.playToneSweep(240, 360, 0.09, 0.04, 'sine');
  }

  playMantle(): void {
    this.playThump(88, 0.07, 0.08);
  }

  playWallRunStart(): void {
    this.playToneSweep(160, 200, 0.06, 0.04, 'sine');
  }

  playWallKick(): void {
    this.playThump(100, 0.08, 0.06);
    this.playToneSweep(200, 320, 0.08, 0.04, 'sine');
  }

  playGrappleAttach(): void {
    this.playToneSweep(520, 280, 0.07, 0.08, 'sine');
    this.playToneSweep(260, 420, 0.12, 0.05, 'sine');
  }

  playGrappleRelease(slingshot: boolean): void {
    if (slingshot) this.playToneSweep(280, 420, 0.1, 0.05, 'sine');
    else this.playToneSweep(360, 220, 0.05, 0.035, 'sine');
  }

  playLaunchPad(): void {
    this.playToneSweep(90, 280, 0.22, 0.08, 'sine');
  }

  playCheckpoint(aheadOfPb: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const f1 = aheadOfPb ? 659.25 : 523.25;
    const f2 = aheadOfPb ? 830.61 : 659.25;
    this.playChimeNote(f1, now, 0.18, 0.07);
    this.playChimeNote(f2, now + 0.07, 0.24, 0.07);
  }

  playFinish(isNewBest: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const chord = isNewBest
      ? [523.25, 659.25, 783.99]
      : [392.0, 493.88, 587.33];
    chord.forEach((f, i) => {
      this.playChimeNote(f, now + i * 0.07, 0.45, 0.07);
    });
  }

  playReset(): void {
    this.playToneSweep(240, 140, 0.06, 0.04, 'sine');
  }

  playUiClick(accent = false): void {
    this.unlock();
    this.playToneSweep(accent ? 620 : 440, accent ? 740 : 380, 0.035, 0.035, 'sine');
  }

  private playThump(freq: number, vol: number, dur: number, pan = 0): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    const stereo = this.ctx.createStereoPanner();
    stereo.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, pan)), now);
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(28, freq * 0.35), now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    osc.connect(lp);
    lp.connect(g);
    g.connect(stereo);
    stereo.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private playChimeNote(freq: number, startTime: number, dur: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(vol, startTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, startTime + dur);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  private playToneSweep(
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    type: OscillatorType
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.015);
  }
}
