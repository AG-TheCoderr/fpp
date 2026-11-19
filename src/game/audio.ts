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
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
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
    this.playThump(f, vol, 0.05);
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

  private playThump(freq: number, vol: number, dur: number): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(28, freq * 0.35), now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
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
