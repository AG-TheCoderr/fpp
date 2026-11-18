import * as THREE from 'three';

const BLUR_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform mat4 uReproject;
  uniform vec2 uTexelSize;
  uniform float uBlurScale;
  uniform float uSpeedRatio;
  uniform float uFrameJitter;
  uniform float uSampleCount;

  varying vec2 vUv;

  // Jorge Jimenez Interleaved Gradient Noise — eliminates motion-blur tap banding
  float ign(vec2 pixel) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(pixel, magic.xy)));
  }

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  // Lightweight directional edge AA so crisp concrete & roof edges stay silky when blur is low
  vec3 sampleAA(vec2 uv) {
    vec3 rgbM = texture2D(tColor, uv).rgb;
    vec3 rgbN = texture2D(tColor, uv + vec2(0.0, uTexelSize.y)).rgb;
    vec3 rgbS = texture2D(tColor, uv - vec2(0.0, uTexelSize.y)).rgb;
    vec3 rgbE = texture2D(tColor, uv + vec2(uTexelSize.x, 0.0)).rgb;
    vec3 rgbW = texture2D(tColor, uv - vec2(uTexelSize.x, 0.0)).rgb;

    float lM = luma(rgbM);
    float lN = luma(rgbN);
    float lS = luma(rgbS);
    float lE = luma(rgbE);
    float lW = luma(rgbW);

    float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
    float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
    float contrast = lMax - lMin;
    if (contrast < max(0.035, lMax * 0.1)) {
      return rgbM;
    }

    vec2 dir;
    dir.x = -((lN + lE) - (lS + lW));
    dir.y =  ((lN + lW) - (lS + lE));
    float dirReduce = max((lN + lS + lE + lW) * 0.03125, 0.0078125);
    float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpMin, vec2(-4.0), vec2(4.0)) * uTexelSize;

    vec3 rgbA = 0.5 * (
      texture2D(tColor, clamp(uv + dir * -0.1667, 0.001, 0.999)).rgb +
      texture2D(tColor, clamp(uv + dir *  0.1667, 0.001, 0.999)).rgb
    );
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
      texture2D(tColor, clamp(uv + dir * -0.5, 0.001, 0.999)).rgb +
      texture2D(tColor, clamp(uv + dir *  0.5, 0.001, 0.999)).rgb
    );
    float lB = luma(rgbB);
    return (lB < lMin || lB > lMax) ? rgbA : rgbB;
  }

  void main() {
    float centerDepth = texture2D(tDepth, vUv).r;

    // Reconstruct exact per-pixel screen velocity from depth + 3D movement matrix
    vec4 currNDC = vec4(vUv * 2.0 - 1.0, centerDepth * 2.0 - 1.0, 1.0);
    vec4 prevClip = uReproject * currNDC;
    vec2 vel = vec2(0.0);
    if (prevClip.w > 0.001) {
      vec2 prevNDC = prevClip.xy / prevClip.w;
      vel = (currNDC.xy - prevNDC) * 0.5 * uBlurScale;
    }

    // Keep sky dome subtle (clouds/horizon barely blur compared to rushing nearby rooftops!)
    if (centerDepth > 0.9997) {
      vel *= 0.22;
    }

    // Foveal gaze stabilization: keep crosshair & target ledge crisp while periphery streaks!
    vec2 fromCenter = (vUv - 0.5) * vec2(1.0, 0.85);
    float radial = length(fromCenter);
    float foveaMask = mix(0.28, 1.05, smoothstep(0.05, 0.46, radial));
    vel *= foveaMask;

    // Clamp max UV blur length so close wall-runs feel blazing fast, never muddy
    float len = length(vel);
    const float MAX_BLUR = 0.028;
    if (len > MAX_BLUR) {
      vel *= MAX_BLUR / len;
      len = MAX_BLUR;
    }

    vec3 color;
    float pixelLen = len / max(uTexelSize.x, uTexelSize.y);

    if (pixelLen < 0.75) {
      color = sampleAA(vUv);
    } else {
      vec3 baseCol = texture2D(tColor, vUv).rgb;
      float jitter = ign(gl_FragCoord.xy + vec2(uFrameJitter * 71.0, uFrameJitter * 37.0)) - 0.5;

      // 12-tap jittered velocity reconstruction in linear HDR space
      int SAMPLES = int(uSampleCount + 0.5);
      vec3 accum = baseCol * 1.35;
      float wSum = 1.35;

      for (int i = 0; i < 12; i++) {
        if (i >= SAMPLES) break;
        float t = ((float(i) + 0.5 + jitter * 0.85) / float(SAMPLES)) - 0.5;
        vec2 sampleUv = clamp(vUv + vel * t, vec2(0.001), vec2(0.999));
        float sDepth = texture2D(tDepth, sampleUv).r;

        // Soft depth-aware weight: prevents sharp foreground bars from bleeding wildly onto far sky,
        // while allowing nearby rushing floors and wall-run panels to streak seamlessly!
        float skyGuard = (centerDepth > 0.9995 && sDepth < 0.995) ? 0.35 : 1.0;
        // Gaussian-like bell taper so streaks feather like a real cinema shutter
        float bell = 1.0 - abs(t) * 0.75;
        float w = bell * skyGuard;

        accum += texture2D(tColor, sampleUv).rgb * w;
        wSum += w;
      }
      color = accum / wSum;
    }

    // Whisper-subtle optical edge focus only at very high momentum (> 17 m/s)
    float edgeDarken = 1.0 - smoothstep(0.42, 0.92, radial) * uSpeedRatio * 0.11;
    color *= edgeDarken;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class VelocityMotionBlur {
  private target: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;

  // Scratch matrices & vectors (zero per-frame heap allocations!)
  private currViewProj = new THREE.Matrix4();
  private invCurrViewProj = new THREE.Matrix4();
  private prevWorld = new THREE.Matrix4();
  private prevView = new THREE.Matrix4();
  private prevViewProj = new THREE.Matrix4();
  private reproject = new THREE.Matrix4();
  private prevPos = new THREE.Vector3();
  private prevEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private prevQuat = new THREE.Quaternion();
  private unitScale = new THREE.Vector3(1, 1, 1);
  private smoothVel = new THREE.Vector3();
  private frameCounter = 0;
  private renderScale = 1;
  private sampleCount = 12;
  private dprCap = 2;

  constructor(private renderer: THREE.WebGLRenderer) {
    const size = this.getBufferSize();
    this.target = this.createTarget(size.x, size.y);

    this.material = new THREE.ShaderMaterial({
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uReproject: { value: new THREE.Matrix4() },
        uTexelSize: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
        uBlurScale: { value: 1.0 },
        uSpeedRatio: { value: 0.0 },
        uFrameJitter: { value: 0.0 },
        uSampleCount: { value: 12 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });

    // Single oversized full-screen triangle (faster than 2-triangle quad, zero diagonal seam!)
    const triGeo = new THREE.BufferGeometry();
    triGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
    );
    triGeo.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2)
    );
    const quad = new THREE.Mesh(triGeo, this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  setQuality(graphics: 'low' | 'medium' | 'high'): void {
    if (graphics === 'low') {
      this.renderScale = 0.72;
      this.sampleCount = 6;
      this.dprCap = 1;
    } else if (graphics === 'medium') {
      this.renderScale = 0.88;
      this.sampleCount = 8;
      this.dprCap = 1.5;
    } else {
      this.renderScale = 1;
      this.sampleCount = 12;
      this.dprCap = 2;
    }
    this.resize();
  }

  private getBufferSize(): THREE.Vector2 {
    const dpr = Math.min(this.renderer.getPixelRatio(), this.dprCap) * this.renderScale;
    return new THREE.Vector2(
      Math.max(1, Math.floor(window.innerWidth * dpr)),
      Math.max(1, Math.floor(window.innerHeight * dpr))
    );
  }

  private createTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const depthTex = new THREE.DepthTexture(w, h);
    depthTex.format = THREE.DepthFormat;
    depthTex.type = THREE.UnsignedIntType;
    depthTex.minFilter = THREE.NearestFilter;
    depthTex.magFilter = THREE.NearestFilter;

    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rt.depthTexture = depthTex;
    return rt;
  }

  resize(): void {
    const size = this.getBufferSize();
    this.target.setSize(size.x, size.y);
    this.target.depthTexture?.dispose();
    const depthTex = new THREE.DepthTexture(size.x, size.y);
    depthTex.format = THREE.DepthFormat;
    depthTex.type = THREE.UnsignedIntType;
    depthTex.minFilter = THREE.NearestFilter;
    depthTex.magFilter = THREE.NearestFilter;
    this.target.depthTexture = depthTex;
    this.material.uniforms.tDepth.value = depthTex;
    this.material.uniforms.uTexelSize.value.set(1 / size.x, 1 / size.y);
  }

  resetVelocity(): void {
    this.smoothVel.set(0, 0, 0);
  }

  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    vx: number,
    vy: number,
    vz: number,
    angVelYaw: number,
    angVelPitch: number,
    angVelRoll: number,
    blurSetting: number,
    dt: number,
    enableBlur: boolean
  ): void {
    // Fast bypass when blur is disabled or on menu/pause screens (uses native MSAA backbuffer)
    if (!enableBlur || blurSetting <= 0.01) {
      this.smoothVel.set(0, 0, 0);
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }

    // Smooth 3D velocity slightly so blur trails feel fluid and cinema-grade
    const vBlend = Math.min(1, 18 * Math.max(0.001, dt));
    this.smoothVel.x += (vx - this.smoothVel.x) * vBlend;
    this.smoothVel.y += (vy - this.smoothVel.y) * vBlend;
    this.smoothVel.z += (vz - this.smoothVel.z) * vBlend;

    const speed = this.smoothVel.length();
    // Gate cleanly: zero translational blur when idle/slow, scales richly from 8 -> 25 m/s!
    const speedGate = smoothstep(7.2, 13.5, speed);
    const highBoost = 1.0 + smoothstep(14.5, 25.0, speed) * 0.55;
    // Frame-rate independent virtual shutter duration (~1/95s at normal run, ~1/62s at 25 m/s)
    const transShutter = 0.0108 * speedGate * highBoost * blurSetting;

    // Subtle clamped camera-rotation blur (adds silkiness on turns/wall-kicks, NEVER smears flicks!)
    const clampRot = (r: number, m: number) => Math.max(-m, Math.min(m, r));
    const rotGate = 0.25 + 0.75 * speedGate;
    const rotShutter = 0.0022 * rotGate * blurSetting;
    const rYaw = clampRot(angVelYaw, 3.2) * rotShutter;
    const rPitch = clampRot(angVelPitch, 2.6) * rotShutter;
    const rRoll = clampRot(angVelRoll, 3.2) * rotShutter;

    // Skip offscreen pass entirely when essentially stationary (saves GPU + keeps native MSAA!)
    if (
      speed * transShutter < 0.015 &&
      Math.abs(rYaw) + Math.abs(rPitch) + Math.abs(rRoll) < 0.0015
    ) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }

    // Compute exact current -> shutter-open clip reprojection matrix
    camera.updateMatrixWorld();
    this.currViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.invCurrViewProj.copy(this.currViewProj).invert();

    this.prevPos
      .copy(camera.position)
      .addScaledVector(this.smoothVel, -transShutter);
    this.prevEuler.set(
      camera.rotation.x - rPitch,
      camera.rotation.y - rYaw,
      camera.rotation.z - rRoll,
      'YXZ'
    );
    this.prevQuat.setFromEuler(this.prevEuler);
    this.prevWorld.compose(this.prevPos, this.prevQuat, this.unitScale);
    this.prevView.copy(this.prevWorld).invert();
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, this.prevView);
    this.reproject.multiplyMatrices(this.prevViewProj, this.invCurrViewProj);

    this.frameCounter = (this.frameCounter + 1) % 64;
    this.material.uniforms.uReproject.value.copy(this.reproject);
    this.material.uniforms.uBlurScale.value = 1.0;
    this.material.uniforms.uSpeedRatio.value =
      smoothstep(15.5, 25.0, speed) * Math.min(1.2, blurSetting);
    this.material.uniforms.uFrameJitter.value = this.frameCounter / 64;
    this.material.uniforms.uSampleCount.value = this.sampleCount;

    // Pass 1: Render 3D world to HDR + Depth target
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    // Pass 2: Fullscreen per-pixel velocity motion blur + ACES tone map to screen
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
