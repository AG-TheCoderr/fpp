import * as THREE from 'three';

const BIRD_COUNT = 10;

export class SkySystem {
  readonly group = new THREE.Group();
  private skyMesh: THREE.Mesh;
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
    const geo = new THREE.SphereGeometry(2800, 64, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: '#8ec4f0',
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.skyMesh = new THREE.Mesh(geo, mat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    this.group.add(this.skyMesh);

    const base = import.meta.env.BASE_URL || './';
    const url = `${base}sky/day-pano.jpg`;
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      this.pano = tex;

      mat.map = tex;
      mat.color.set('#ffffff');
      mat.needsUpdate = true;

      const mapped = tex.clone();
      mapped.mapping = THREE.EquirectangularReflectionMapping;
      mapped.colorSpace = THREE.SRGBColorSpace;
      mapped.needsUpdate = true;

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      const env = pmrem.fromEquirectangular(mapped).texture;
      this.scene.environment = env;
      if ('environmentIntensity' in this.scene) {
        (this.scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = 0.5;
      }
      pmrem.dispose();

      this.alignSun();
    });

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

  private alignSun(): void {
    // Photo sun sits ~35° from zenith, ~50° azimuth in the frame — yaw the dome to match gameplay sun.
    const yaw = Math.atan2(this.sunDir.x, this.sunDir.z);
    this.skyMesh.rotation.set(0, yaw - 0.55, 0);
  }

  setSunDirection(dir: THREE.Vector3): void {
    this.sunDir.copy(dir).normalize();
    this.alignSun();
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
