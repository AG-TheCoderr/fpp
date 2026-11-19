import * as THREE from 'three';

let patched = false;

/** Height-weighted exp2 fog so distant rooftops vanish and we can pull camera.far. */
export function installHeightFog(): void {
  if (patched) return;
  patched = true;

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogWorldY;
#endif
`;

  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
#endif
`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogWorldY;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogFactor;
  #ifdef FOG_EXP2
    float h = exp(-0.045 * max(vFogWorldY + 6.0, 0.0));
    fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * (0.45 + 0.55 * h));
  #else
    fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(fogFactor, 0.0, 1.0));
#endif
`;
}

export function fogColorFromSun(sunDir: THREE.Vector3): THREE.Color {
  const elev = THREE.MathUtils.clamp(sunDir.y, 0, 1);
  const zenith = new THREE.Color('#7eb6e8');
  const dusk = new THREE.Color('#c99a78');
  const haze = new THREE.Color('#d7e6f4');
  const c = haze.clone().lerp(zenith, elev * 0.55).lerp(dusk, (1 - elev) * 0.45);
  return c;
}

export function fogDensityForQuality(q: 'low' | 'medium' | 'high'): number {
  if (q === 'low') return 0.0044;
  if (q === 'medium') return 0.0034;
  return 0.0027;
}

export function cameraFarForQuality(q: 'low' | 'medium' | 'high'): number {
  if (q === 'low') return 520;
  if (q === 'medium') return 780;
  return 1100;
}
