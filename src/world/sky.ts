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
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = rot * p * 2.07;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float y = dir.y;

    // Crisp Mirror's Edge City of Glass cobalt-to-cerulean-to-warm-haze sky
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
      // Bright airy metropolitan haze in the street canyon far below
      col = mix(horizonCol, abyssCol, clamp(-y * 3.0, 0.0, 1.0));
    }

    // Subtle high-altitude windswept cirrus clouds
    if (y > 0.04) {
      vec2 cloudUV = dir.xz / (y + 0.18) * 1.45 + vec2(uTime * 0.008, -uTime * 0.005);
      // Stretch along wind direction
      cloudUV.x *= 0.55;
      float c = fbm(cloudUV);
      float wisps = smoothstep(0.54, 0.82, c) * smoothstep(0.04, 0.24, y) * (1.0 - smoothstep(0.65, 0.98, y));
      col = mix(col, vec3(0.97, 0.985, 1.0), wisps * 0.36);
    }

    // Warm atmospheric Mie scatter around sun + crisp solar disc
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    col += vec3(1.0, 0.93, 0.80) * pow(sunDot, 7.0) * 0.22;
    col += vec3(1.0, 0.97, 0.90) * pow(sunDot, 64.0) * 0.55;
    col += vec3(1.0, 0.99, 0.95) * smoothstep(0.9985, 0.9996, sunDot) * 2.2;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class SkySystem {
  readonly group = new THREE.Group();
  private skyMesh: THREE.Mesh;
  private uniforms: {
    uSunDir: { value: THREE.Vector3 };
    uTime: { value: number };
  };
  private birds: {
    mesh: THREE.Group;
    leftWing: THREE.Mesh;
    rightWing: THREE.Mesh;
    centerX: number;
    centerZ: number;
    y: number;
    radius: number;
    speed: number;
    phase: number;
  }[] = [];

  constructor() {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, -0.4).normalize() },
      uTime: { value: 0 },
    };

    const geo = new THREE.SphereGeometry(750, 32, 20);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });

    this.skyMesh = new THREE.Mesh(geo, mat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    this.group.add(this.skyMesh);

    // Subtle soaring rooftop birds (classic Mirror's Edge sky detail!)
    const wingGeo = new THREE.PlaneGeometry(0.55, 0.18);
    const birdMat = new THREE.MeshBasicMaterial({
      color: '#1e2836',
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 10; i++) {
      const bGroup = new THREE.Group();
      const lw = new THREE.Mesh(wingGeo, birdMat);
      lw.position.x = -0.26;
      const rw = new THREE.Mesh(wingGeo, birdMat);
      rw.position.x = 0.26;
      bGroup.add(lw, rw);
      this.group.add(bGroup);
      this.birds.push({
        mesh: bGroup,
        leftWing: lw,
        rightWing: rw,
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

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.uniforms.uTime.value += dt;
    this.skyMesh.position.copy(cameraPos);

    const t = this.uniforms.uTime.value;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const a = t * b.speed + b.phase;
      const nx = b.centerX + Math.cos(a) * b.radius;
      const nz = b.centerZ + Math.sin(a) * b.radius;
      const ny = b.y + Math.sin(a * 2.0) * 1.2;
      b.mesh.position.set(nx, ny, nz);
      b.mesh.rotation.y = -a;
      const flap = Math.sin(t * 7.5 + b.phase * 3.0) * 0.48;
      b.leftWing.rotation.z = flap;
      b.rightWing.rotation.z = -flap;
    }
  }
}
