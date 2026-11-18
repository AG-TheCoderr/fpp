import * as THREE from 'three';

const SKY_VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = position;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uTime;
  varying vec3 vWorldDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = rot * p * 2.07;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float y = dir.y;

    vec3 zenithCol = vec3(0.09, 0.34, 0.78);
    vec3 midSkyCol = vec3(0.32, 0.62, 0.94);
    vec3 horizonCol = vec3(0.84, 0.91, 0.97);
    vec3 abyssCol = vec3(0.76, 0.85, 0.94);

    vec3 col;
    if (y >= 0.0) {
      float t1 = pow(clamp(y, 0.0, 1.0), 0.42);
      col = mix(horizonCol, midSkyCol, smoothstep(0.0, 0.55, t1));
      col = mix(col, zenithCol, smoothstep(0.35, 1.0, t1));
    } else {
      col = mix(horizonCol, abyssCol, clamp(-y * 3.0, 0.0, 1.0));
    }

    if (y > 0.04) {
      vec2 cloudUV = dir.xz / (y + 0.18) * 1.45 + vec2(uTime * 0.008, -uTime * 0.005);
      cloudUV.x *= 0.55;
      float c = fbm(cloudUV);
      float wisps = smoothstep(0.54, 0.82, c) * smoothstep(0.04, 0.24, y) * (1.0 - smoothstep(0.65, 0.98, y));
      col = mix(col, vec3(0.97, 0.985, 1.0), wisps * 0.36);
    }

    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    col += vec3(1.0, 0.93, 0.80) * pow(sunDot, 7.0) * 0.22;
    col += vec3(1.0, 0.97, 0.90) * pow(sunDot, 64.0) * 0.55;
    col += vec3(1.0, 0.99, 0.95) * smoothstep(0.9985, 0.9996, sunDot) * 2.2;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const BIRD_COUNT = 10;

export class SkySystem {
  readonly group = new THREE.Group();
  private skyMesh: THREE.Mesh;
  private uniforms: {
    uSunDir: { value: THREE.Vector3 };
    uTime: { value: number };
  };
  private birdMesh: THREE.InstancedMesh;
  private birdDummy = new THREE.Object3D();
  private birdFlap = { value: 0 };
  private birds: {
    centerX: number;
    centerZ: number;
    y: number;
    radius: number;
    speed: number;
    phase: number;
  }[] = [];
  private birdVisible = true;

  constructor() {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, -0.4).normalize() },
      uTime: { value: 0 },
    };

    const geo = new THREE.SphereGeometry(2800, 48, 28);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    this.skyMesh = new THREE.Mesh(geo, mat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    this.group.add(this.skyMesh);

    const wingGeo = new THREE.PlaneGeometry(1.05, 0.18);
    const birdMat = new THREE.MeshBasicMaterial({
      color: '#1e2836',
      side: THREE.DoubleSide,
    });
    birdMat.customProgramCacheKey = () => 'stride-bird-flap-v1';
    this.birdFlap = { value: 0 };
    birdMat.onBeforeCompile = (shader) => {
      shader.uniforms.uFlap = this.birdFlap;
      shader.vertexShader =
        `uniform float uFlap;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          {
            float side = sign(position.x);
            float flap = sin(uFlap + instanceMatrix[3].x * 0.4) * 0.48;
            float c = cos(side * flap);
            float s = sin(side * flap);
            vec3 p = transformed;
            transformed.y = p.y * c - p.x * s * 0.0 + abs(p.x) * s * 0.85;
          }
          `
        );
    };

    this.birdMesh = new THREE.InstancedMesh(wingGeo, birdMat, BIRD_COUNT);
    this.birdMesh.frustumCulled = false;
    this.birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.birdMesh);

    for (let i = 0; i < BIRD_COUNT; i++) {
      this.birds.push({
        centerX: (i % 2 === 0 ? 1 : -1) * (24 + i * 4),
        centerZ: -45 - i * 22,
        y: 26 + (i % 4) * 6,
        radius: 18 + (i % 3) * 7,
        speed: 0.22 + (i % 3) * 0.05,
        phase: i * 1.37,
      });
    }
  }

  setSunDirection(dir: THREE.Vector3): void {
    this.uniforms.uSunDir.value.copy(dir).normalize();
  }

  update(dt: number, cameraPos: THREE.Vector3, birdsEnabled = true): void {
    this.uniforms.uTime.value += dt;
    this.skyMesh.position.copy(cameraPos);

    if (!birdsEnabled) {
      if (this.birdVisible) {
        this.birdMesh.visible = false;
        this.birdVisible = false;
      }
      return;
    }
    if (!this.birdVisible) {
      this.birdMesh.visible = true;
      this.birdVisible = true;
    }

    this.birdFlap.value = this.uniforms.uTime.value * 7.5;
    const t = this.uniforms.uTime.value;
    const dummy = this.birdDummy;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const a = t * b.speed + b.phase;
      dummy.position.set(
        cameraPos.x + b.centerX + Math.cos(a) * b.radius,
        cameraPos.y + b.y + Math.sin(a * 2.0) * 1.2,
        cameraPos.z + b.centerZ + Math.sin(a) * b.radius
      );
      dummy.rotation.set(0, -a, 0);
      dummy.updateMatrix();
      this.birdMesh.setMatrixAt(i, dummy.matrix);
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;
  }
}
