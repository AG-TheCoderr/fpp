import * as THREE from 'three';

const BIRD_COUNT = 10;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vDir = w.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform sampler2D uPano;
uniform float uHasPano;
uniform float uTurbidity;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  vec3 L = normalize(uSunDir);
  float mu = clamp(dot(d, L), -1.0, 1.0);
  float elev = max(d.y, 0.0);

  vec3 rayleigh = vec3(0.28, 0.52, 0.98) * (1.0 + mu * mu);
  float g = 0.76;
  float g2 = g * g;
  float mie = (1.0 - g2) / max(pow(1.0 + g2 - 2.0 * g * mu, 1.5), 0.02);
  vec3 mieCol = vec3(1.0, 0.92, 0.78) * mie * (0.06 + uTurbidity * 0.08);

  vec3 zenith = vec3(0.18, 0.42, 0.82);
  vec3 horizon = mix(vec3(0.92, 0.78, 0.62), vec3(0.72, 0.84, 0.94), clamp(L.y, 0.0, 1.0));
  vec3 ground = vec3(0.42, 0.46, 0.5);
  vec3 sky = mix(horizon, zenith, pow(elev, 0.55));
  sky = mix(ground, sky, smoothstep(-0.12, 0.04, d.y));
  sky += rayleigh * 0.22 * (0.35 + elev);
  sky += mieCol;
  sky += vec3(1.15, 1.02, 0.82) * smoothstep(0.9992, 0.99985, mu);

  if (uHasPano > 0.5) {
    float lon = atan(d.z, d.x);
    float lat = acos(clamp(d.y, -1.0, 1.0));
    vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.14159265);
    vec3 pano = texture2D(uPano, uv).rgb;
    float cloud = smoothstep(0.42, 0.78, dot(pano, vec3(0.33)));
    sky = mix(sky, sky * (0.82 + 0.4 * pano) + pano * 0.12, 0.28 + cloud * 0.18);
  }

  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  sky += (n - 0.5) / 220.0;
  gl_FragColor = vec4(sky, 1.0);
}
`;

export class SkySystem {
  readonly group = new THREE.Group();
  private skyMesh: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private pano: THREE.Texture | null = null;
  private sunDir = new THREE.Vector3(0.5, 0.7, -0.4).normalize();
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
  private time = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene
  ) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uSunDir: { value: this.sunDir.clone() },
        uPano: { value: null },
        uHasPano: { value: 0 },
        uTurbidity: { value: 1.0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const geo = new THREE.SphereGeometry(1, 24, 16);
    this.skyMesh = new THREE.Mesh(geo, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    this.skyMesh.scale.setScalar(400);
    this.group.add(this.skyMesh);

    const base = import.meta.env.BASE_URL || './';
    const url = `${base}sky/day-pano.jpg`;
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      this.pano = tex;
      this.skyMat.uniforms.uPano.value = tex;
      this.skyMat.uniforms.uHasPano.value = 1;

      const mapped = tex.clone();
      mapped.mapping = THREE.EquirectangularReflectionMapping;
      mapped.colorSpace = THREE.SRGBColorSpace;
      mapped.needsUpdate = true;

      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        pmrem.compileEquirectangularShader();
        const env = pmrem.fromEquirectangular(mapped).texture;
        this.scene.environment = env;
        pmrem.dispose();
      } catch {
        /* env map is optional */
      }
    });

    const wingGeo = new THREE.PlaneGeometry(1.05, 0.18);
    const birdMat = new THREE.MeshBasicMaterial({
      color: '#1e2836',
      side: THREE.DoubleSide,
      fog: true,
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
            float s = sin(side * flap);
            transformed.y += abs(position.x) * s * 0.85;
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
    this.sunDir.copy(dir).normalize();
    this.skyMat.uniforms.uSunDir.value.copy(this.sunDir);
    const elev = THREE.MathUtils.clamp(this.sunDir.y, 0, 1);
    this.skyMat.uniforms.uTurbidity.value = 0.7 + (1 - elev) * 1.4;
  }

  update(dt: number, cameraPos: THREE.Vector3, birdsEnabled = true): void {
    this.time += dt;
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

    this.birdFlap.value = this.time * 7.5;
    const dummy = this.birdDummy;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const a = this.time * b.speed + b.phase;
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
