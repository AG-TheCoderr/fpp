/**
 * Procedural Web Audio synthesizer for STRIDE:
 * Left/right alternating concrete footsteps, rubber pivot scuffs, wall-run taps, palm vaults,
 * landing thuds, carve/brake-modulated slide friction, velocity wind roar, grapple latch/zip,
 * updraft launch turbine, and checkpoint/finish chimes.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;

  private volume = 0.75;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
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
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.18) * 1.7));
    }

    // Continuous velocity-coupled rooftop wind
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 260;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.015;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    windSrc.start();

    // Continuous speed/carve/brake-modulated concrete slide scrape
    const slideSrc = ctx.createBufferSource();
    slideSrc.buffer = this.noiseBuffer;
    slideSrc.loop = true;
    this.slideFilter = ctx.createBiquadFilter();
    this.slideFilter.type = 'bandpass';
    this.slideFilter.frequency.value = 1450;
    this.slideFilter.Q.value = 1.15;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    slideSrc.connect(this.slideFilter);
    this.slideFilter.connect(this.slideGain);
    this.slideGain.connect(this.masterGain);
    slideSrc.start();
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
      this.windGain.gain.setTargetAtTime(0.012, now, 0.12);
      this.windFilter.frequency.setTargetAtTime(220, now, 0.12);
      this.slideGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    // Rooftop wind opens quadratically with velocity
    const sNorm = Math.max(0, Math.min(1, (totalSpeed - 6.5) / 19));
    const targetWindVol = 0.015 + sNorm * sNorm * 0.23;
    const targetWindFreq = 235 + sNorm * 1200;
    this.windGain.gain.setTargetAtTime(targetWindVol, now, 0.07);
    this.windFilter.frequency.setTargetAtTime(targetWindFreq, now, 0.07);

    // Tactile slide texture responds dynamically to speed, A/D edge carving, and S heel-braking!
    if (sliding && totalSpeed > 1.0) {
      const slideNorm = Math.max(0.15, Math.min(1.15, totalSpeed / 19));
      const edgeBite = 1 + Math.abs(slideCarve) * 0.28 + (slideBraking ? 0.52 : 0);
      const vol = Math.min(0.26, 0.15 * slideNorm * edgeBite);
      const freq =
        900 +
        slideNorm * 1050 +
        Math.abs(slideCarve) * 320 +
        (slideBraking ? 520 : 0);
      this.slideGain.gain.setTargetAtTime(vol, now, 0.028);
      this.slideFilter.frequency.setTargetAtTime(freq, now, 0.04);
    } else {
      this.slideGain.gain.setTargetAtTime(0, now, 0.045);
    }
  }

  playFootstep(speed: number, isWall: boolean, foot: -1 | 1 = 1): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Subtle left/right acoustic asymmetry makes stride feel genuinely human
    const footTint = foot < 0 ? 0.96 : 1.04;
    const jitter = (0.93 + Math.random() * 0.14) * footTint;
    const vol = Math.min(0.22, (0.075 + (speed / 22) * 0.115) * (isWall ? 0.85 : 1.0));

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'triangle';
    const baseF = (isWall ? 136 : 96) * jitter;
    osc.frequency.setValueAtTime(baseF, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.055);
    og.gain.setValueAtTime(vol, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(og);
    og.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.065);

    this.playNoiseBurst(
      isWall ? 1680 * jitter : 1260 * jitter,
      1.6,
      vol * 0.72,
      0.045
    );
  }

  playPivot(intensity: number): void {
    // Crisp rubber-sole concrete cut scuff on fast direction reversals!
    const v = 0.07 + intensity * 0.09;
    this.playNoiseBurst(1850, 2.2, v, 0.085);
    this.playToneSweep(120, 48, 0.065, v * 0.85, 'triangle');
  }

  playJump(boosted: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    this.playNoiseBurst(boosted ? 920 : 620, 0.9, boosted ? 0.18 : 0.12, 0.14);
    if (boosted) {
      this.playToneSweep(165, 330, 0.11, 0.08, 'sine');
    }
  }

  playLand(impact: number, intoSlide: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    const strength = Math.max(0.15, Math.min(1, impact / 22));
    const vol = (intoSlide ? 0.15 : 0.28) * strength;
    this.playToneSweep(105, 34, 0.11, vol, 'triangle');
    this.playNoiseBurst(780, 1.1, vol * 0.85, 0.09);
  }

  playSlideStart(slopeSlam = false): void {
    this.playNoiseBurst(slopeSlam ? 1900 : 1600, 0.8, slopeSlam ? 0.24 : 0.18, 0.14);
    this.playToneSweep(slopeSlam ? 175 : 140, 58, 0.12, slopeSlam ? 0.16 : 0.11, 'sine');
  }

  playVault(spring: boolean): void {
    this.playToneSweep(175, 62, 0.075, 0.2, 'triangle');
    this.playNoiseBurst(1100, 1.0, 0.17, 0.13);
    if (spring) {
      this.playToneSweep(260, 520, 0.14, 0.09, 'sine');
    }
  }

  playMantle(): void {
    this.playToneSweep(145, 58, 0.09, 0.18, 'triangle');
    this.playNoiseBurst(850, 1.2, 0.14, 0.16);
  }

  playWallRunStart(): void {
    this.playNoiseBurst(1350, 1.4, 0.15, 0.1);
    this.playToneSweep(190, 250, 0.09, 0.07, 'sine');
  }

  playWallKick(): void {
    this.playToneSweep(150, 55, 0.07, 0.18, 'triangle');
    this.playToneSweep(220, 410, 0.12, 0.08, 'sine');
    this.playNoiseBurst(1150, 0.9, 0.17, 0.13);
  }

  playGrappleAttach(): void {
    if (!this.ctx || !this.masterGain) return;
    this.playToneSweep(920, 380, 0.045, 0.15, 'square');
    this.playToneSweep(280, 860, 0.18, 0.11, 'sawtooth', 1800);
    this.playNoiseBurst(2200, 1.8, 0.14, 0.12);
  }

  playGrappleRelease(slingshot: boolean): void {
    if (slingshot) {
      this.playToneSweep(340, 640, 0.13, 0.09, 'sine');
      this.playNoiseBurst(1100, 0.8, 0.16, 0.15);
    } else {
      this.playToneSweep(420, 240, 0.05, 0.06, 'sine');
    }
  }

  playLaunchPad(): void {
    this.playToneSweep(95, 480, 0.34, 0.18, 'sine');
    this.playToneSweep(190, 720, 0.32, 0.09, 'triangle');
    this.playNoiseBurst(950, 0.6, 0.26, 0.36);
  }

  playCheckpoint(aheadOfPb: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const f1 = aheadOfPb ? 659.25 : 587.33;
    const f2 = aheadOfPb ? 987.77 : 783.99;
    this.playChimeNote(f1, now, 0.22, 0.12);
    this.playChimeNote(f2, now + 0.065, 0.32, 0.13);
  }

  playFinish(isNewBest: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const chord = isNewBest
      ? [523.25, 659.25, 783.99, 1046.5]
      : [440.0, 554.37, 659.25, 880.0];
    chord.forEach((f, i) => {
      this.playChimeNote(f, now + i * 0.055, 0.65, 0.12);
    });
    this.playNoiseBurst(700, 0.6, 0.16, 0.35);
  }

  playReset(): void {
    this.playNoiseBurst(1200, 1.4, 0.09, 0.08);
    this.playToneSweep(380, 220, 0.07, 0.07, 'sine');
  }

  playUiClick(accent = false): void {
    this.unlock();
    this.playToneSweep(accent ? 680 : 520, accent ? 880 : 420, 0.04, 0.06, 'sine');
  }

  private playChimeNote(freq: number, startTime: number, dur: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(vol, startTime + 0.01);
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
    type: OscillatorType,
    lpFreq?: number
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

    if (lpFreq) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lpFreq;
      osc.connect(lp);
      lp.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.015);
  }

  private playNoiseBurst(freq: number, q: number, vol: number, dur: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    const randomOffset = Math.random() * 1.2;
    src.start(now, randomOffset, dur + 0.02);
  }
}
