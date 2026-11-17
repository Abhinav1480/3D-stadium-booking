import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { useStadiumStore, type RoofMode, type StaticSeatRecord } from '../store/useStadiumStore';
import { DEFAULT_STADIUM_SPEC } from '../shared/stadiumSpec';
import {
  QUALITY_PRESET_CONFIGS,
  buildSpatialSeatingIndex,
  clampStadiumCameraPosition,
  computeBowlRadialOffsetM,
  computeSeatViewCamera,
  computeSeatVisualHex,
  computeStandFocusCamera,
  detectRecommendedQualityPreset,
  estimateStadiumSurfaceY,
  intersectStadiumCursorRay,
  resolveSeatAvailabilityStatus,
  selectChunkLod,
  type SeatLodTier,
  type SeatSpatialChunk,
  type SpatialSeatingIndex,
} from '../shared/seatingSpatial';
import { soundEngine } from '../utils/soundEngine';
import { SeatHoverTooltip } from './SeatHoverTooltip';

const HERO_POOL_MAX = 96;
let canvasMountCounter = 0;
let canvasDisposeCounter = 0;

// Detect Software WebGL (SwiftShader / llvmpipe) once from GPU renderer string
export const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return false;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

// Pre-allocated math helpers outside the render loop (Zero GC)
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _targetCamPos = new THREE.Vector3(0, 56, 86);
const _targetLookAt = new THREE.Vector3(0, 4, -8);
const _currentLookAt = new THREE.Vector3(0, 4, -8);
const _forwardVec = new THREE.Vector3();
const _rightVec = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _rayHitVec = new THREE.Vector3();
const _ndcPointer = new THREE.Vector2();
const _zoomRaycaster = new THREE.Raycaster();
const _zoomHitVec = new THREE.Vector3();
const _zoomOffsetVec = new THREE.Vector3();
const _flyEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _lastLodCamPos = new THREE.Vector3(1e9, 1e9, 1e9);

interface ChunkRuntime {
  chunk: SeatSpatialChunk;
  shellMesh: THREE.InstancedMesh;
  frameMesh: THREE.InstancedMesh;
  hwMesh: THREE.InstancedMesh;
  statusAttr: THREE.InstancedBufferAttribute;
  wrappedGeos: {
    LOD3?: THREE.BufferGeometry;
    LOD2?: THREE.BufferGeometry;
    LOD1?: THREE.BufferGeometry;
  };
  boundingSphere: THREE.Sphere;
  currentLod: SeatLodTier;
}

function makeChunkWrappedGeo(
  baseGeo: THREE.BufferGeometry,
  statusAttr: THREE.InstancedBufferAttribute
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.index = baseGeo.index;
  g.attributes = { ...baseGeo.attributes, aStatusState: statusAttr };
  g.groups = baseGeo.groups;
  g.boundingBox = baseGeo.boundingBox;
  g.boundingSphere = baseGeo.boundingSphere;
  return g;
}

function attachSeatStatusShader(
  material: THREE.Material,
  availModeUniform: { value: number },
  statusTimeUniform: { value: number }
) {
  material.customProgramCacheKey = () => 'stadiumx-seat-status-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAvailMode = availModeUniform;
    shader.uniforms.uPulseTime = statusTimeUniform;

    shader.vertexShader =
      `
      attribute float aStatusState;
      varying float vSeatStatus;
      varying vec3 vSeatLocalPos;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vSeatStatus = aStatusState;
      vSeatLocalPos = position;
      `
    );

    shader.fragmentShader =
      `
      uniform float uAvailMode;
      uniform float uPulseTime;
      varying float vSeatStatus;
      varying vec3 vSeatLocalPos;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      int sCode = int(floor(vSeatStatus + 0.5));
      float sideEdge = smoothstep(0.145, 0.195, abs(vSeatLocalPos.x));
      float topCrest = smoothstep(0.73, 0.81, vSeatLocalPos.y);
      float frontLip = smoothstep(0.21, 0.27, vSeatLocalPos.z) * (1.0 - smoothstep(0.45, 0.54, vSeatLocalPos.y));
      float rimMask = clamp(max(sideEdge, max(topCrest, frontLip)), 0.0, 1.0);
      float pulse = 0.55 + 0.45 * sin(uPulseTime * 4.4);

      if (sCode == 0) {
        // AVAILABLE: preserve original category color in Realistic, vivid Emerald in Availability
        vec3 availGreen = vec3(0.06, 0.72, 0.48);
        vec3 rimCol = mix(diffuseColor.rgb, availGreen, rimMask * 0.62);
        diffuseColor.rgb = mix(rimCol, mix(availGreen, vec3(0.18, 0.92, 0.64), rimMask * 0.5), uAvailMode);
      } else if (sCode == 1) {
        // BOOKED: crimson red indicator + non-color diagonal hatch pattern
        float diag = step(0.54, fract((vSeatLocalPos.x + vSeatLocalPos.y * 0.85) * 14.0));
        vec3 bookedRed = vec3(0.88, 0.17, 0.22);
        vec3 darkRed = vec3(0.28, 0.06, 0.09);
        vec3 hatchCol = mix(bookedRed, darkRed, diag * 0.72);
        vec3 realCol = mix(diffuseColor.rgb * 0.72, hatchCol, clamp(rimMask * 0.88 + diag * 0.46, 0.0, 0.94));
        diffuseColor.rgb = mix(realCol, hatchCol, uAvailMode);
      } else if (sCode == 2) {
        // HELD (other user): pulsing amber indicator & crest band
        float stripe = step(0.5, fract(vSeatLocalPos.y * 12.0));
        vec3 heldAmber = vec3(0.96, 0.62, 0.04) * (0.85 + 0.28 * pulse);
        vec3 realCol = mix(diffuseColor.rgb * 0.85, heldAmber, clamp(rimMask * 0.9 + stripe * 0.32 * pulse, 0.0, 0.95));
        diffuseColor.rgb = mix(realCol, mix(heldAmber, vec3(0.55, 0.30, 0.02), stripe * 0.25), uAvailMode);
      } else if (sCode == 3) {
        // SELECTED: bright cyan/blue outline & crest highlight
        vec3 selCyan = vec3(0.02, 0.80, 0.92);
        vec3 selGlow = vec3(0.45, 0.95, 1.0);
        vec3 realCol = mix(diffuseColor.rgb * 1.08, selGlow, clamp(rimMask * 0.95 + 0.22, 0.0, 0.98));
        diffuseColor.rgb = mix(realCol, mix(selCyan, selGlow, rimMask), uAvailMode);
      } else if (sCode == 4) {
        // BLOCKED: slate grey + X cross-hatch unavailable symbol
        float h1 = step(0.58, fract((vSeatLocalPos.x + vSeatLocalPos.y) * 13.0));
        float h2 = step(0.58, fract((vSeatLocalPos.x - vSeatLocalPos.y) * 13.0));
        float crossHatch = max(h1, h2);
        vec3 slateBase = vec3(0.36, 0.42, 0.50);
        vec3 xMark = vec3(0.12, 0.15, 0.20);
        vec3 blockedCol = mix(slateBase, xMark, crossHatch * 0.82);
        vec3 realCol = mix(diffuseColor.rgb * 0.55, blockedCol, clamp(rimMask * 0.8 + crossHatch * 0.72 + 0.25, 0.0, 0.96));
        diffuseColor.rgb = mix(realCol, blockedCol, uAvailMode);
      } else if (sCode == 5) {
        // HELD_BY_CURRENT_USER: pulsing violet/purple indicator + Reserved crest
        vec3 selfPurple = vec3(0.68, 0.33, 0.98) * (0.88 + 0.28 * pulse);
        vec3 selfBright = vec3(0.88, 0.68, 1.0);
        vec3 realCol = mix(diffuseColor.rgb, mix(selfPurple, selfBright, rimMask), clamp(rimMask * 0.95 + 0.36, 0.0, 0.98));
        diffuseColor.rgb = mix(realCol, mix(selfPurple, selfBright, rimMask * 0.75), uAvailMode);
      }
      `
    );
  };
  material.needsUpdate = true;
}

const SKY_VERTEX_SHADER = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const SKY_FRAGMENT_SHADER = `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 bottomColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform float sunDiskIntensity;
  varying vec3 vWorldPosition;

  void main() {
    vec3 dir = normalize(vWorldPosition);
    float h = clamp(dir.y, -0.2, 1.0);
    vec3 sky = mix(horizonColor, topColor, pow(max(h, 0.0), 0.55));
    if (h < 0.0) {
      sky = mix(horizonColor, bottomColor, clamp(-h * 5.0, 0.0, 1.0));
    }
    float sunCos = max(dot(dir, normalize(sunDirection)), 0.0);
    float mieGlow = pow(sunCos, 12.0) * 0.35 + pow(sunCos, 180.0) * sunDiskIntensity;
    sky += sunColor * mieGlow;
    gl_FragColor = vec4(sky, 1.0);
  }
`;

function createHighResScoreboardTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#050914';
  ctx.fillRect(0, 0, 1024, 512);

  const grad = ctx.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#064E3B');
  grad.addColorStop(0.5, '#047857');
  grad.addColorStop(1, '#064E3B');
  ctx.fillStyle = grad;
  ctx.fillRect(20, 18, 984, 72);

  ctx.strokeStyle = '#10B981';
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 18, 984, 476);

  ctx.fillStyle = '#ECFDF5';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('SOVEREIGN INTERNATIONAL CRICKET ARENA  ·  ICC CHAMPIONS FINAL', 44, 64);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 88px monospace';
  ctx.fillText('IND  284 / 3', 44, 198);

  ctx.fillStyle = '#38BDF8';
  ctx.font = 'bold 40px monospace';
  ctx.fillText('OVERS: 44.2 / 50   ·   CRR: 6.41   ·   PROJ: 322', 44, 262);

  ctx.fillStyle = '#E2E8F0';
  ctx.font = 'bold 33px monospace';
  ctx.fillText('V. KOHLI*   94 (78)   [8x4, 3x6]   SR 120.5', 44, 344);
  ctx.fillText('R. PANT     48 (31)   [4x4, 3x6]   SR 154.8', 44, 398);

  ctx.fillStyle = '#FBBF24';
  ctx.font = 'bold 29px monospace';
  ctx.fillText('HAWK-EYE: 146.8 KPH  ·  SIX OVER LONG-ON (98 METRES)', 44, 464);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createCityWindowTextures(maxAnisotropy: number): {
  dayMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
} {
  const w = 128;
  const h = 256;

  // Architectural curtain-wall facade for daylight/dusk
  const dayCanvas = document.createElement('canvas');
  dayCanvas.width = w;
  dayCanvas.height = h;
  const dCtx = dayCanvas.getContext('2d')!;
  dCtx.fillStyle = '#1E293B';
  dCtx.fillRect(0, 0, w, h);

  // Subtle night-only window illumination grid
  const emCanvas = document.createElement('canvas');
  emCanvas.width = w;
  emCanvas.height = h;
  const eCtx = emCanvas.getContext('2d')!;
  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, w, h);

  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let row = 3; row < h - 3; row += 8) {
    // Structural spandrel floor band
    dCtx.fillStyle = '#273449';
    dCtx.fillRect(0, row, w, 5);
    for (let col = 2; col < w - 2; col += 8) {
      const r = rand();
      dCtx.fillStyle = r > 0.65 ? '#475569' : r > 0.3 ? '#334155' : '#263448';
      dCtx.fillRect(col, row + 1, 6, 4);
      if (r > 0.56) {
        eCtx.fillStyle = r > 0.84 ? '#FDE68A' : r > 0.7 ? '#BAE6FD' : '#FCD34D';
        eCtx.fillRect(col + 1, row + 1, 4, 3);
      }
    }
  }

  const dayMap = new THREE.CanvasTexture(dayCanvas);
  dayMap.colorSpace = THREE.SRGBColorSpace;
  dayMap.wrapS = THREE.RepeatWrapping;
  dayMap.wrapT = THREE.RepeatWrapping;
  dayMap.repeat.set(4, 10);
  dayMap.anisotropy = maxAnisotropy;

  const emissiveMap = new THREE.CanvasTexture(emCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.repeat.set(4, 10);
  emissiveMap.anisotropy = maxAnisotropy;

  return { dayMap, emissiveMap };
}

function createFloodBeamAlphaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  // v=1 (top of canvas) = tower luminaire apex; v=0 (bottom) = wide atmospheric fade
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.52)');
  grad.addColorStop(0.68, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Ultra-lean 24-tri placeholder geometry used only before seat_lod3.glb completes (~40ms). */
function buildUltraLeanPlaceholderSeatGeo(): THREE.BufferGeometry {
  const pan = new THREE.BoxGeometry(0.42, 0.075, 0.29);
  pan.translate(0, 0.39, 0.14);
  const back = new THREE.BoxGeometry(0.43, 0.44, 0.055);
  back.translate(0, 0.64, 0.01);
  const merged = BufferGeometryUtils.mergeGeometries([pan, back]);
  merged.computeVertexNormals();
  return merged;
}

function computeTextureMeanLinearLuma(img: CanvasImageSource | undefined): number | null {
  if (!img || typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    const toLin = (u: number) =>
      u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
    for (let i = 0; i < data.length; i += 4) {
      const r = toLin(data[i] / 255);
      const g = toLin(data[i + 1] / 255);
      const b = toLin(data[i + 2] / 255);
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    return Math.max(0.04, sum / (data.length / 4));
  } catch {
    return null;
  }
}

function attachMultiScaleDetailShader(
  material: THREE.MeshStandardMaterial,
  detailMap: THREE.Texture,
  repeatScale: number,
  blendStrength: number,
  detailActiveUniform: { value: number },
  neutralLumaUniform: { value: number },
  options: { cacheKey: string; isTurf?: boolean }
) {
  const isTurf = options.isTurf ? 1.0 : 0.0;
  material.customProgramCacheKey = () => `stadiumx-detail-${options.cacheKey}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailMap = { value: detailMap };
    shader.uniforms.uDetailRepeat = { value: repeatScale };
    shader.uniforms.uDetailStrength = { value: blendStrength };
    shader.uniforms.uDetailActive = detailActiveUniform;
    shader.uniforms.uNeutralLuma = neutralLumaUniform;
    shader.uniforms.uIsTurf = { value: isTurf };

    shader.fragmentShader =
      `
      uniform sampler2D uDetailMap;
      uniform float uDetailRepeat;
      uniform float uDetailStrength;
      uniform float uDetailActive;
      uniform float uNeutralLuma;
      uniform float uIsTurf;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      #ifdef USE_MAP
        if (uDetailActive > 0.5) {
          vec4 macroSample1 = texture2D(uDetailMap, vMapUv * uDetailRepeat);
          vec4 macroSample2 = texture2D(uDetailMap, vMapUv * (uDetailRepeat * 0.26) + vec2(0.37, 0.61));
          vec3 macroDetail = mix(macroSample1.rgb, macroSample2.rgb, 0.45);
          if (uIsTurf > 0.5) {
            vec4 macroSample3 = texture2D(uDetailMap, vMapUv * (uDetailRepeat * 0.085) + vec2(0.71, 0.19));
            macroDetail = mix(macroDetail, macroSample3.rgb, 0.24);
          }
          float macroLuma = dot(macroDetail, vec3(0.2126, 0.7152, 0.0722));
          float relLuma = macroLuma / max(0.04, uNeutralLuma);
          float detailFactor = clamp(0.68 + relLuma * 0.32, 0.72, 1.32);
          vec3 detailRgb = diffuseColor.rgb * detailFactor;
          if (uIsTurf > 0.5) {
            vec3 chromaShift = clamp(macroDetail / max(vec3(0.025), vec3(macroLuma)), 0.86, 1.16);
            detailRgb *= mix(vec3(1.0), chromaShift, 0.28);
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, detailRgb, uDetailStrength);
        }
      #endif
      `
    );
  };
  material.needsUpdate = true;
}

export const StadiumCanvas3D: React.FC = () => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const requestRenderRef = useRef<() => void>(() => {});
  const [sceneMountNonce, setSceneMountNonce] = useState<number>(0);
  const [chunksBuiltNonce, setChunksBuiltNonce] = useState<number>(0);
  const [blenderAssetStatus, setBlenderAssetStatus] = useState<{
    loaded: boolean;
    meshCount: number;
    vertexCount: number;
  }>({
    loaded: false,
    meshCount: 0,
    vertexCount: 0,
  });

  const seats = useStadiumStore((s) => s.seats);
  const seatInstanceVisibility = useStadiumStore((s) => s.seatInstanceVisibility);
  const is2DFallback = useStadiumStore((s) => s.is2DFallback);
  const inventoryVersion = useStadiumStore((s) => s.inventoryVersion);
  const lastSocketDelta = useStadiumStore((s) => s.lastSocketDelta);
  const selectedSeatIds = useStadiumStore((s) => s.selectedSeatIds);
  const focusedSeat = useStadiumStore((s) => s.focusedSeat);
  const activeHold = useStadiumStore((s) => s.activeHold);
  const currentUserId = useStadiumStore((s) => s.currentUser.id);
  const seatVisualMode = useStadiumStore((s) => s.seatVisualMode);
  const cameraMode = useStadiumStore((s) => s.cameraMode);
  const activeStandCode = useStadiumStore((s) => s.activeStandCode);
  const activeBlockCode = useStadiumStore((s) => s.activeBlockCode);
  const cameraResetNonce = useStadiumStore((s) => s.cameraResetNonce);
  const seatExitNonce = useStadiumStore((s) => s.seatExitNonce);
  const freeFlySpeedMps = useStadiumStore((s) => s.freeFlySpeedMps);
  const roofMode = useStadiumStore((s) => s.roofMode);
  const introPlaying = useStadiumStore((s) => s.introPlaying);
  const setIntroPlaying = useStadiumStore((s) => s.setIntroPlaying);
  const timeOfDayHours = useStadiumStore((s) => s.timeOfDayHours);
  const qualityPreset = useStadiumStore((s) => s.qualityPreset);
  const filterCategoryCode = useStadiumStore((s) => s.filterCategoryCode);
  const filterMaxPricePaise = useStadiumStore((s) => s.filterMaxPricePaise);
  const filterCoveredOnly = useStadiumStore((s) => s.filterCoveredOnly);
  const filterMinViewScore = useStadiumStore((s) => s.filterMinViewScore);
  const seatViewFov = useStadiumStore((s) => s.seatViewFov);
  const seatViewYawOffsetDeg = useStadiumStore((s) => s.seatViewYawOffsetDeg);
  const seatViewPitchOffsetDeg = useStadiumStore((s) => s.seatViewPitchOffsetDeg);
  const activeHotspot = useStadiumStore((s) => s.activeHotspot);

  const initialStore = useStadiumStore.getState();
  const stateRef = useRef({
    seats,
    seatInstanceVisibility,
    inventoryBySeatId: initialStore.inventoryBySeatId,
    priceByCategoryId: initialStore.priceByCategoryId,
    selectedSeatIds,
    hoveredSeat: initialStore.hoveredSeat,
    focusedSeat,
    activeHold,
    currentUserId,
    seatVisualMode,
    cameraMode,
    activeStandCode,
    activeBlockCode,
    roofMode,
    introPlaying,
    timeOfDayHours,
    qualityPreset,
    filterCategoryCode,
    filterMaxPricePaise,
    filterCoveredOnly,
    filterMinViewScore,
    seatViewFov,
    seatViewYawOffsetDeg,
    seatViewPitchOffsetDeg,
  });

  useEffect(() => {
    const storeNow = useStadiumStore.getState();
    stateRef.current = {
      seats,
      seatInstanceVisibility,
      inventoryBySeatId: storeNow.inventoryBySeatId,
      priceByCategoryId: storeNow.priceByCategoryId,
      selectedSeatIds,
      hoveredSeat: storeNow.hoveredSeat,
      focusedSeat,
      activeHold,
      currentUserId,
      seatVisualMode,
      cameraMode,
      activeStandCode,
      activeBlockCode,
      roofMode,
      introPlaying,
      timeOfDayHours,
      qualityPreset,
      filterCategoryCode,
      filterMaxPricePaise,
      filterCoveredOnly,
      filterMinViewScore,
      seatViewFov,
      seatViewYawOffsetDeg,
      seatViewPitchOffsetDeg,
    };
    requestRenderRef.current();
  }, [
    seats,
    seatInstanceVisibility,
    inventoryVersion,
    lastSocketDelta,
    selectedSeatIds,
    focusedSeat,
    activeHold,
    currentUserId,
    seatVisualMode,
    cameraMode,
    activeStandCode,
    activeBlockCode,
    roofMode,
    introPlaying,
    timeOfDayHours,
    qualityPreset,
    filterCategoryCode,
    filterMaxPricePaise,
    filterCoveredOnly,
    filterMinViewScore,
    seatViewFov,
    seatViewYawOffsetDeg,
    seatViewPitchOffsetDeg,
    freeFlySpeedMps,
  ]);

  // Persistent Scene Graph Refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraTransitionActiveRef = useRef<boolean>(false);

  const seatGroupRef = useRef<THREE.Group | null>(null);
  const spatialIndexRef = useRef<SpatialSeatingIndex | null>(null);
  const chunkRuntimesRef = useRef<ChunkRuntime[]>([]);

  // LOD Geometry Refs
  const lodGeosRef = useRef<{
    lod3Shell: THREE.BufferGeometry | null;
    lod2Shell: THREE.BufferGeometry | null;
    lod1Shell: THREE.BufferGeometry | null;
    lod1Frame: THREE.BufferGeometry | null;
    lod1Hw: THREE.BufferGeometry | null;
    lod0Shell: THREE.BufferGeometry | null;
    lod0Frame: THREE.BufferGeometry | null;
    lod0Hw: THREE.BufferGeometry | null;
  }>({
    lod3Shell: null,
    lod2Shell: null,
    lod1Shell: null,
    lod1Frame: null,
    lod1Hw: null,
    lod0Shell: null,
    lod0Frame: null,
    lod0Hw: null,
  });

  // LOD0 Hero Pool (nearest <= 96 seats on hardware GPU HIGH/ULTRA)
  const heroShellMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const heroFrameMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const heroHwMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const heroPromotedSlotsRef = useRef<Array<{ chunkIdx: number; localIdx: number }>>([]);

  // Shared Materials for chunks
  const seatShellPhysicalMatRef = useRef<THREE.Material | null>(null);
  const seatShellLambertMatRef = useRef<THREE.Material | null>(null);
  const seatFrameMatRef = useRef<THREE.Material | null>(null);
  const seatHwMatRef = useRef<THREE.Material | null>(null);

  // Venue & Perf Refs
  const venueMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const venueTurfMaterialsRef = useRef<Set<THREE.MeshStandardMaterial>>(new Set());
  const maxHardwareAnisoRef = useRef<number>(1);
  const seatByIdMapRef = useRef<Map<number, StaticSeatRecord>>(new Map());
  const lodDirtyRef = useRef<boolean>(true);
  const zoomImpulseRef = useRef<number>(0);
  const zoomCursorNdcRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const flyStateRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: -0.35 });
  const prevCameraModeRef = useRef<string>('ORBIT');
  const lastResetNonceRef = useRef<number>(0);
  const lastSeatExitNonceRef = useRef<number>(0);
  const lastSeatViewIdRef = useRef<number | null>(null);
  const preSeatCameraRef = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
    fov: number;
  } | null>(null);
  const seatFlyAnimRef = useRef<{
    active: boolean;
    startMs: number;
    durationMs: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromLook: THREE.Vector3;
    toLook: THREE.Vector3;
    fromFov: number;
    toFov: number;
    midArcLift: number;
  }>({
    active: false,
    startMs: 0,
    durationMs: 1200,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromLook: new THREE.Vector3(),
    toLook: new THREE.Vector3(),
    fromFov: 46,
    toFov: 64,
    midArcLift: 0,
  });
  const exitFlyAnimRef = useRef<{
    active: boolean;
    startMs: number;
    durationMs: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromLook: THREE.Vector3;
    toLook: THREE.Vector3;
    fromFov: number;
    toFov: number;
  }>({
    active: false,
    startMs: 0,
    durationMs: 1050,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromLook: new THREE.Vector3(),
    toLook: new THREE.Vector3(),
    fromFov: 64,
    toFov: 46,
  });

  // Crowd, Roof, Post-Processing & Lighting Refs
  const crowdJerseyMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const crowdBodyMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const flagMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const crowdTimeUniformRef = useRef<{ value: number }>({ value: 0 });
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const skyMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const floodlightMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const cityWindowMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const vipWarmMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const ledRibbonMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const floodConesGroupRef = useRef<THREE.Group | null>(null);
  const floodConeMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const nightSpotLightsRef = useRef<THREE.SpotLight[]>([]);
  const roofMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const roofMeshesRef = useRef<THREE.Mesh[]>([]);
  const trussMeshesRef = useRef<THREE.Mesh[]>([]);
  const roofOpacityRef = useRef<number>(0.88);

  // Seat Status & Quality Shader Uniform Refs
  const seatAvailModeUniformRef = useRef<{ value: number }>({ value: 0.0 });
  const seatStatusTimeUniformRef = useRef<{ value: number }>({ value: 0.35 });
  const detailActiveUniformRef = useRef<{ value: number }>({ value: 1.0 });
  const hasAnyHeldRef = useRef<boolean>(false);
  const heroStatusAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const hiddenCrowdSlotsRef = useRef<Array<{ idx: number; matrix: THREE.Matrix4 }>>([]);
  const prevHoldSeatIdsRef = useRef<number[]>([]);

  // Track highlighted anchor indices for O(1) dirty hover/selection updates
  const prevHoveredIdRef = useRef<number | null>(null);
  const prevSelectedSetRef = useRef<Set<number>>(new Set());
  const prevFocusedIdRef = useRef<number | null>(null);

  // Sync independent seatInstanceVisibility without touching geometry or UI state
  useEffect(() => {
    if (seatGroupRef.current) {
      seatGroupRef.current.visible = seatInstanceVisibility;
    }
    requestRenderRef.current();
  }, [seatInstanceVisibility]);

  // Re-render smoothly when returning from 2D map overlay
  useEffect(() => {
    if (!is2DFallback) {
      lodDirtyRef.current = true;
      requestRenderRef.current();
    }
  }, [is2DFallback]);

  // Sync Realism vs High-Contrast Availability Clarity Mode in 0.001ms
  useEffect(() => {
    seatAvailModeUniformRef.current.value = seatVisualMode === 'AVAILABILITY' ? 1.0 : 0.0;
    requestRenderRef.current();
  }, [seatVisualMode]);

  // Auto-detect recommended Quality Preset on first visit when no saved override exists
  useEffect(() => {
    try {
      const saved = window.localStorage?.getItem('stadiumx_quality_preset');
      if (!saved) {
        const navAny = navigator as Navigator & { deviceMemory?: number };
        const rec = detectRecommendedQualityPreset({
          isSoftwareGl,
          viewportWidth: window.innerWidth,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: navAny.deviceMemory,
        });
        useStadiumStore.getState().setQualityPreset(rec, false);
      }
    } catch {}
  }, []);

  // Sync Quality Preset dynamically across all 9 dimensions (Resolution Scale, DPR, Shadows, Bloom, AO, Crowd, Anisotropy, Macro Detail, Fill Light)
  useEffect(() => {
    const renderer = rendererRef.current;
    const sun = sunLightRef.current;
    const fill = fillLightRef.current;
    if (!renderer || !sun) return;

    const cfg = QUALITY_PRESET_CONFIGS[qualityPreset];
    const baseDpr = isSoftwareGl
      ? cfg.maxDprSoftware
      : Math.min(window.devicePixelRatio || 1, cfg.maxDpr);
    renderer.setPixelRatio(Math.max(0.5, baseDpr * cfg.resolutionScale));
    if (composerRef.current) {
      composerRef.current.setPixelRatio(Math.max(0.5, baseDpr * cfg.resolutionScale));
      if (bloomPassRef.current && canvasMountRef.current) {
        const w = canvasMountRef.current.clientWidth || window.innerWidth;
        const h = canvasMountRef.current.clientHeight || window.innerHeight;
        bloomPassRef.current.resolution.set(
          cfg.bloomHalfRes ? Math.max(1, Math.floor(w * 0.5)) : w,
          cfg.bloomHalfRes ? Math.max(1, Math.floor(h * 0.5)) : h
        );
      }
    }

    const enableShadows = !isSoftwareGl && cfg.shadowsEnabled;
    renderer.shadowMap.enabled = enableShadows;
    sun.castShadow = enableShadows;
    if (fill) {
      fill.visible = cfg.fillLightEnabled;
    }

    if (enableShadows && sun.shadow.mapSize.width !== cfg.shadowMapSize) {
      sun.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    renderer.shadowMap.needsUpdate = true;

    detailActiveUniformRef.current.value = cfg.macroDetailEnabled ? 1.0 : 0.0;

    const activeShellMat =
      isSoftwareGl || cfg.useSimpleSeatMaterial
        ? seatShellLambertMatRef.current
        : seatShellPhysicalMatRef.current;
    if (seatShellPhysicalMatRef.current instanceof THREE.MeshPhysicalMaterial) {
      seatShellPhysicalMatRef.current.aoMapIntensity = cfg.aoEnabled ? cfg.aoIntensity : 0;
    }
    if (activeShellMat) {
      for (const rt of chunkRuntimesRef.current) {
        rt.shellMesh.material = activeShellMat;
        rt.shellMesh.receiveShadow = !isSoftwareGl && cfg.seatsReceiveShadow;
      }
      if (heroShellMeshRef.current) {
        heroShellMeshRef.current.material = activeShellMat;
      }
    }

    const effectiveAniso = isSoftwareGl
      ? 1
      : Math.min(maxHardwareAnisoRef.current, cfg.maxAnisotropyCap);
    for (const mat of venueMaterialsRef.current) {
      if (venueTurfMaterialsRef.current.has(mat)) {
        mat.envMapIntensity = mat.name.includes('Outfield') ? 0.12 : 0.16;
        mat.aoMapIntensity = 0.45;
      } else {
        mat.envMapIntensity = isSoftwareGl ? 0.65 : cfg.envMapIntensity;
        mat.aoMapIntensity = cfg.aoEnabled ? cfg.aoIntensity : 0;
      }
      if (mat.map) mat.map.anisotropy = effectiveAniso;
      if (mat.normalMap) mat.normalMap.anisotropy = effectiveAniso;
      if (mat.roughnessMap) mat.roughnessMap.anisotropy = effectiveAniso;
    }

    lodDirtyRef.current = true;
    requestRenderRef.current();
  }, [qualityPreset]);

  // Camera Effect A: Smooth Cinematic First-Person Seat Fly-In & In-Seat Head Look
  useEffect(() => {
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam || cameraMode !== 'SEAT_VIEW' || !focusedSeat) return;

    const prevMode = prevCameraModeRef.current;
    const isEnteringOrSwitchingSeat =
      prevMode !== 'SEAT_VIEW' || lastSeatViewIdRef.current !== focusedSeat.id;

    if (prevMode !== 'SEAT_VIEW') {
      preSeatCameraRef.current = {
        position: cam.position.clone(),
        target: ctrls ? ctrls.target.clone() : new THREE.Vector3(0, 4, -8),
        fov: cam.fov || 46,
      };
    }

    if (ctrls) {
      ctrls.enabled = false;
    }
    zoomImpulseRef.current = 0;
    cameraTransitionActiveRef.current = false;
    exitFlyAnimRef.current.active = false;

    const view = computeSeatViewCamera(
      focusedSeat,
      seatViewYawOffsetDeg,
      seatViewPitchOffsetDeg
    );
    _targetCamPos.set(...view.position);
    _targetLookAt.set(...view.lookAt);

    if (isEnteringOrSwitchingSeat) {
      const fromPos = cam.position.clone();
      const fromLook =
        prevMode === 'SEAT_VIEW' && _currentLookAt.lengthSq() > 0.01
          ? _currentLookAt.clone()
          : ctrls
          ? ctrls.target.clone()
          : cam.position
              .clone()
              .addScaledVector(cam.getWorldDirection(_forwardVec), 45);
      const dist = fromPos.distanceTo(_targetCamPos);
      const durationMs = isSoftwareGl
        ? 850
        : Math.min(1850, Math.max(1050, 920 + dist * 5.2));
      const midArcLift = dist > 10 ? Math.min(11, dist * 0.095) : 0;

      seatFlyAnimRef.current = {
        active: true,
        startMs: performance.now(),
        durationMs,
        fromPos,
        toPos: _targetCamPos.clone(),
        fromLook,
        toLook: _targetLookAt.clone(),
        fromFov: cam.fov,
        toFov: seatViewFov,
        midArcLift,
      };
    } else if (seatFlyAnimRef.current.active) {
      seatFlyAnimRef.current.toLook.copy(_targetLookAt);
      seatFlyAnimRef.current.toFov = seatViewFov;
    } else {
      cam.fov = seatViewFov;
      cam.updateProjectionMatrix();
      cam.position.copy(_targetCamPos);
      _currentLookAt.copy(_targetLookAt);
      cam.lookAt(_currentLookAt);
      if (ctrls) {
        ctrls.target.copy(_currentLookAt);
      }
    }

    prevCameraModeRef.current = 'SEAT_VIEW';
    lastSeatViewIdRef.current = focusedSeat.id;
    lodDirtyRef.current = true;
    requestRenderRef.current();
  }, [
    cameraMode,
    focusedSeat,
    seatViewFov,
    seatViewYawOffsetDeg,
    seatViewPitchOffsetDeg,
  ]);

  // Camera Effect B: Macro Navigation Modes (ORBIT, STAND_FOCUS, FREE_FLY, TOUR & Smooth Seat Exit)
  useEffect(() => {
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam || cameraMode === 'SEAT_VIEW') return;

    const prevMode = prevCameraModeRef.current;
    prevCameraModeRef.current = cameraMode;
    lastSeatViewIdRef.current = null;
    seatFlyAnimRef.current.active = false;

    const isExplicitReset = cameraResetNonce !== lastResetNonceRef.current;
    lastResetNonceRef.current = cameraResetNonce;
    const isSeatExit = seatExitNonce !== lastSeatExitNonceRef.current;
    lastSeatExitNonceRef.current = seatExitNonce;

    zoomImpulseRef.current = 0;

    if (cameraMode === 'FREE_FLY') {
      if (cam.fov !== 46) {
        cam.fov = 46;
        cam.updateProjectionMatrix();
      }
      if (ctrls) {
        ctrls.enabled = false;
      }
      cameraTransitionActiveRef.current = false;
      exitFlyAnimRef.current.active = false;
      _flyEuler.setFromQuaternion(cam.quaternion, 'YXZ');
      flyStateRef.current.yaw = _flyEuler.y;
      flyStateRef.current.pitch = THREE.MathUtils.clamp(_flyEuler.x, -1.42, 1.42);
      const [cx, cy, cz] = clampStadiumCameraPosition(
        cam.position.x,
        cam.position.y,
        cam.position.z,
        cam.position.y
      );
      cam.position.set(cx, cy, cz);
      lodDirtyRef.current = true;
      requestRenderRef.current();
      return;
    }

    if (cameraMode === 'TOUR') {
      if (cam.fov !== 46) {
        cam.fov = 46;
        cam.updateProjectionMatrix();
      }
      if (ctrls) {
        ctrls.enabled = false;
      }
      cameraTransitionActiveRef.current = false;
      exitFlyAnimRef.current.active = false;
      lodDirtyRef.current = true;
      requestRenderRef.current();
      return;
    }

    // ORBIT or STAND_FOCUS
    if (ctrls) {
      ctrls.enabled = true;
    }

    // Smooth cinematic return when user clicks "Exit Seat View"
    if (isSeatExit && prevMode === 'SEAT_VIEW' && preSeatCameraRef.current) {
      const saved = preSeatCameraRef.current;
      exitFlyAnimRef.current = {
        active: true,
        startMs: performance.now(),
        durationMs: isSoftwareGl ? 750 : 1150,
        fromPos: cam.position.clone(),
        toPos: saved.position.clone(),
        fromLook:
          _currentLookAt.lengthSq() > 0.01
            ? _currentLookAt.clone()
            : ctrls
            ? ctrls.target.clone()
            : new THREE.Vector3(0, 1, 0),
        toLook: saved.target.clone(),
        fromFov: cam.fov,
        toFov: saved.fov || 46,
      };
      cameraTransitionActiveRef.current = false;
      lodDirtyRef.current = true;
      requestRenderRef.current();
      return;
    }

    if (cam.fov !== 46) {
      cam.fov = 46;
      cam.updateProjectionMatrix();
    }

    if (cameraMode === 'STAND_FOCUS' && activeStandCode) {
      const standSpec = DEFAULT_STADIUM_SPEC.stands.find(
        (st) => st.code === activeStandCode
      );
      if (standSpec) {
        const framing = computeStandFocusCamera(standSpec, activeBlockCode);
        _targetCamPos.set(...framing.position);
        _targetLookAt.set(...framing.target);

        if (isSoftwareGl && ctrls) {
          ctrls.enableDamping = false;
          cam.position.copy(_targetCamPos);
          ctrls.target.copy(_targetLookAt);
          cam.lookAt(_targetLookAt);
          ctrls.update();
          ctrls.enableDamping = false;
          cameraTransitionActiveRef.current = false;
        } else {
          cameraTransitionActiveRef.current = true;
        }
        lodDirtyRef.current = true;
        requestRenderRef.current();
        return;
      }
    }

    if (cameraMode === 'ORBIT') {
      if (stateRef.current.introPlaying && !isExplicitReset) {
        lodDirtyRef.current = true;
        requestRenderRef.current();
        return;
      }
      // Seamless handoff if switching directly from FREE_FLY to ORBIT without pressing Reset Camera
      if (!isExplicitReset && prevMode === 'FREE_FLY' && ctrls) {
        cam.getWorldDirection(_forwardVec).normalize();
        const hit = intersectStadiumCursorRay(
          cam.position.x,
          cam.position.y,
          cam.position.z,
          _forwardVec.x,
          _forwardVec.y,
          _forwardVec.z,
          55,
          DEFAULT_STADIUM_SPEC
        );
        const orbitDist = THREE.MathUtils.clamp(hit.distance, 12, 95);
        ctrls.target.copy(cam.position).addScaledVector(_forwardVec, orbitDist);
        ctrls.target.y = Math.max(0.2, ctrls.target.y);
        ctrls.update();
        cameraTransitionActiveRef.current = false;
      } else {
        _targetCamPos.set(0, 56, 86);
        _targetLookAt.set(0, 4, -8);
        if (isSoftwareGl && ctrls) {
          ctrls.enableDamping = false;
          cam.position.copy(_targetCamPos);
          ctrls.target.copy(_targetLookAt);
          cam.lookAt(_targetLookAt);
          ctrls.update();
          ctrls.enableDamping = false;
          cameraTransitionActiveRef.current = false;
        } else {
          cameraTransitionActiveRef.current = true;
        }
      }
      lodDirtyRef.current = true;
      requestRenderRef.current();
    }
  }, [cameraMode, activeStandCode, activeBlockCode, cameraResetNonce, seatExitNonce]);

  // Helper: Apply styling for ONE DB seat anchor (7 sub-seats) in O(7) time!
  const applyAnchorVisualState = (
    anchorSeat: StaticSeatRecord,
    spatialIdx: SpatialSeatingIndex,
    runtimes: ChunkRuntime[],
    invMap: Record<number, { status: string; holdUserId?: number | null; holdToken?: string | null; holdExpiresAt?: string | null }>,
    priceMap: Record<number, number>,
    selectedSet: Set<number>,
    hoveredId: number | null,
    focusedId: number | null,
    activeMode: string,
    standFilter: string | null,
    blockFilter: string | null,
    catFilter: string,
    maxPrice: number,
    coveredOnly: boolean,
    minViewScore: number,
    currentUserId?: number | null,
    activeHoldToken?: string | null
  ) => {
    const slot = spatialIdx.anchorSlotByInstanceIndex[anchorSeat.instanceIndex];
    if (!slot) return;
    const rt = runtimes[slot.chunkIndex];
    if (!rt) return;

    const isHovered = hoveredId === anchorSeat.id;
    const isFocused = focusedId === anchorSeat.id;
    const isSelected = selectedSet.has(anchorSeat.id);
    const inv = invMap[anchorSeat.id];
    const status = inv?.status || 'AVAILABLE';
    const pricePaise = priceMap[anchorSeat.categoryId] ?? 180000;
    const descriptor = resolveSeatAvailabilityStatus({
      rawStatus: inv?.status,
      holdUserId: inv?.holdUserId,
      holdToken: inv?.holdToken,
      holdExpiresAt: inv?.holdExpiresAt,
      currentUserId,
      activeHoldToken,
      isSelected,
    });

    // Never dim surrounding 7 stands during SEAT_VIEW
    const ignoreStandFilter = activeMode === 'SEAT_VIEW';
    const matchesFilter =
      (catFilter === 'ALL' || anchorSeat.categoryCode === catFilter) &&
      (maxPrice === 0 || pricePaise <= maxPrice) &&
      (!coveredOnly || anchorSeat.isCovered) &&
      anchorSeat.viewQualityScore >= minViewScore &&
      (ignoreStandFilter || !standFilter || anchorSeat.standCode === standFilter) &&
      (ignoreStandFilter || !blockFilter || anchorSeat.blockCode === blockFilter);

    const statusArr = rt.statusAttr.array as Float32Array;

    for (let sIdx = 0; sIdx < 7; sIdx++) {
      const localIdx = slot.localStartIdx + sIdx;
      const subSeat = rt.chunk.seats[localIdx];
      if (!subSeat) continue;

      statusArr[localIdx] = descriptor.shaderStateCode;

      // Hide only the seated user's own chair inside SEAT_VIEW so camera never clips seatback
      const hideInSeatView = activeMode === 'SEAT_VIEW' && isFocused && subSeat.isCenterAnchor;

      const vis = computeSeatVisualHex({
        seat: subSeat,
        status,
        isHovered,
        isSelected,
        isFocused,
        matchesFilter,
      });

      _color.set(vis.hex).multiplyScalar(vis.brightnessMultiplier);
      rt.shellMesh.setColorAt(localIdx, _color);

      const finalScale = hideInSeatView ? 0.0001 : vis.scale;
      _dummy.position.set(subSeat.posX, subSeat.posY, subSeat.posZ);
      _dummy.rotation.set(0, subSeat.rotY, 0);
      _dummy.scale.setScalar(finalScale);
      _dummy.updateMatrix();
      rt.shellMesh.setMatrixAt(localIdx, _dummy.matrix);
      if (rt.frameMesh.visible) rt.frameMesh.setMatrixAt(localIdx, _dummy.matrix);
      if (rt.hwMesh.visible) rt.hwMesh.setMatrixAt(localIdx, _dummy.matrix);
    }

    rt.statusAttr.needsUpdate = true;
    rt.shellMesh.instanceMatrix.needsUpdate = true;
    if (rt.frameMesh.visible) rt.frameMesh.instanceMatrix.needsUpdate = true;
    if (rt.hwMesh.visible) rt.hwMesh.instanceMatrix.needsUpdate = true;
    if (rt.shellMesh.instanceColor) rt.shellMesh.instanceColor.needsUpdate = true;
  };

  // Build 24 Spatial Chunks ONCE when `seats` load (no rebuilds on hover/filter!)
  useEffect(() => {
    const group = seatGroupRef.current;
    const cfg = QUALITY_PRESET_CONFIGS[stateRef.current.qualityPreset];
    const shellMat =
      isSoftwareGl || cfg.useSimpleSeatMaterial
        ? seatShellLambertMatRef.current
        : seatShellPhysicalMatRef.current;
    const frameMat = seatFrameMatRef.current;
    const hwMat = seatHwMatRef.current;
    if (!group || !shellMat || !frameMat || !hwMat || seats.length === 0) return;

    const idMap = new Map<number, StaticSeatRecord>();
    for (let i = 0; i < seats.length; i++) {
      idMap.set(seats[i].id, seats[i]);
    }
    seatByIdMapRef.current = idMap;

    while (group.children.length > 0) {
      const ch = group.children[0] as THREE.InstancedMesh;
      group.remove(ch);
    }

    const spatialIndex = buildSpatialSeatingIndex(seats, DEFAULT_STADIUM_SPEC);
    spatialIndexRef.current = spatialIndex;

    const fallbackGeo = buildUltraLeanPlaceholderSeatGeo();
    const runtimes: ChunkRuntime[] = [];

    for (const chunk of spatialIndex.chunks) {
      const count = chunk.seats.length;
      const bSphere = new THREE.Sphere(
        new THREE.Vector3(
          chunk.boundingSphere.centerX,
          chunk.boundingSphere.centerY,
          chunk.boundingSphere.centerZ
        ),
        chunk.boundingSphere.radius
      );

      const statusAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
      const wrappedGeos: ChunkRuntime['wrappedGeos'] = {};
      if (lodGeosRef.current.lod3Shell) {
        wrappedGeos.LOD3 = makeChunkWrappedGeo(lodGeosRef.current.lod3Shell, statusAttr);
      }
      if (lodGeosRef.current.lod2Shell) {
        wrappedGeos.LOD2 = makeChunkWrappedGeo(lodGeosRef.current.lod2Shell, statusAttr);
      }
      if (lodGeosRef.current.lod1Shell) {
        wrappedGeos.LOD1 = makeChunkWrappedGeo(lodGeosRef.current.lod1Shell, statusAttr);
      }
      const initialGeo =
        wrappedGeos.LOD3 || wrappedGeos.LOD2 || makeChunkWrappedGeo(fallbackGeo, statusAttr);

      const shellMesh = new THREE.InstancedMesh(initialGeo, shellMat, count);
      shellMesh.name = `SEAT_CHUNK_SHELL_${chunk.blockCode}`;
      shellMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 3),
        3
      );
      shellMesh.boundingSphere = bSphere.clone();
      shellMesh.frustumCulled = true;
      shellMesh.castShadow = !isSoftwareGl;
      shellMesh.receiveShadow = !isSoftwareGl && cfg.seatsReceiveShadow;
      shellMesh.userData = { chunkIndex: chunk.chunkIndex };

      const frameGeo = lodGeosRef.current.lod1Frame || fallbackGeo;
      const frameMesh = new THREE.InstancedMesh(frameGeo, frameMat, count);
      frameMesh.name = `SEAT_CHUNK_FRAME_${chunk.blockCode}`;
      frameMesh.boundingSphere = bSphere.clone();
      frameMesh.frustumCulled = true;
      frameMesh.visible = false;

      const hwGeo = lodGeosRef.current.lod1Hw || fallbackGeo;
      const hwMesh = new THREE.InstancedMesh(hwGeo, hwMat, count);
      hwMesh.name = `SEAT_CHUNK_HW_${chunk.blockCode}`;
      hwMesh.boundingSphere = bSphere.clone();
      hwMesh.frustumCulled = true;
      hwMesh.visible = false;

      for (let idx = 0; idx < count; idx++) {
        const seatRef = chunk.seats[idx];
        _dummy.position.set(seatRef.posX, seatRef.posY, seatRef.posZ);
        _dummy.rotation.set(0, seatRef.rotY, 0);
        _dummy.scale.setScalar(1);
        _dummy.updateMatrix();
        shellMesh.setMatrixAt(idx, _dummy.matrix);
        frameMesh.setMatrixAt(idx, _dummy.matrix);
        hwMesh.setMatrixAt(idx, _dummy.matrix);
      }

      shellMesh.instanceMatrix.needsUpdate = true;
      frameMesh.instanceMatrix.needsUpdate = true;
      hwMesh.instanceMatrix.needsUpdate = true;

      group.add(shellMesh);
      group.add(frameMesh);
      group.add(hwMesh);

      runtimes.push({
        chunk,
        shellMesh,
        frameMesh,
        hwMesh,
        statusAttr,
        wrappedGeos,
        boundingSphere: bSphere,
        currentLod: 'LOD3',
      });
    }

    group.visible = stateRef.current.seatInstanceVisibility;
    chunkRuntimesRef.current = runtimes;
    lodDirtyRef.current = true;
    setChunksBuiltNonce((n) => n + 1);
    if (rendererRef.current) rendererRef.current.shadowMap.needsUpdate = true;
    requestRenderRef.current();
  }, [seats, sceneMountNonce]);

  // Color, Availability Status Shader & Crowd Bulk Sync (NEVER runs on hover, focus, or Socket delta!)
  useEffect(() => {
    const spatialIdx = spatialIndexRef.current;
    const runtimes = chunkRuntimesRef.current;
    const crowdJerseyMesh = crowdJerseyMeshRef.current;
    const crowdBodyMesh = crowdBodyMeshRef.current;
    if (!spatialIdx || runtimes.length === 0 || seats.length === 0) return;

    const storeNow = useStadiumStore.getState();
    const invMap = storeNow.inventoryBySeatId;
    const priceMap = storeNow.priceByCategoryId;
    const activeHoldToken = storeNow.activeHold?.holdToken ?? null;
    const uid = storeNow.currentUser.id ?? null;
    const selectedSet = new Set(storeNow.selectedSeatIds);
    const hoveredId = storeNow.hoveredSeat?.id ?? null;
    const focusedObj = storeNow.focusedSeat;
    const focusedId = focusedObj?.id ?? null;
    const ignoreStandFilter = cameraMode === 'SEAT_VIEW';

    const presetCfg = QUALITY_PRESET_CONFIGS[qualityPreset];
    const maxCrowd = presetCfg.maxCrowd;
    const crowdStride = presetCfg.crowdStride;

    const jerseyPalette = [
      '#0284C7',
      '#38BDF8',
      '#EAB308',
      '#F97316',
      '#10B981',
      '#F8FAFC',
      '#6366F1',
    ];

    let crowdIndex = 0;
    let foundHeld = false;
    hiddenCrowdSlotsRef.current = [];

    for (let c = 0; c < runtimes.length; c++) {
      const rt = runtimes[c];
      const chunkSeats = rt.chunk.seats;
      const statusArr = rt.statusAttr.array as Float32Array;
      let anyMatrixChanged = false;

      for (let idx = 0; idx < chunkSeats.length; idx++) {
        const subSeat = chunkSeats[idx];
        const anchorId = subSeat.seatId;
        const isHovered = hoveredId === anchorId;
        const isFocused = focusedId === anchorId;
        const isSelected = selectedSet.has(anchorId);
        const inv = invMap[anchorId];
        const status = inv?.status || 'AVAILABLE';
        if (status === 'HELD') foundHeld = true;
        const pricePaise = priceMap[subSeat.categoryId] ?? 180000;

        const descriptor = resolveSeatAvailabilityStatus({
          rawStatus: inv?.status,
          holdUserId: inv?.holdUserId,
          holdToken: inv?.holdToken,
          holdExpiresAt: inv?.holdExpiresAt,
          currentUserId: uid,
          activeHoldToken,
          isSelected,
        });
        statusArr[idx] = descriptor.shaderStateCode;

        const matchesFilter =
          (filterCategoryCode === 'ALL' || subSeat.categoryCode === filterCategoryCode) &&
          (filterMaxPricePaise === 0 || pricePaise <= filterMaxPricePaise) &&
          (!filterCoveredOnly || subSeat.isCovered) &&
          subSeat.viewQualityScore >= filterMinViewScore &&
          (ignoreStandFilter || !activeStandCode || subSeat.standCode === activeStandCode) &&
          (ignoreStandFilter || !activeBlockCode || subSeat.blockCode === activeBlockCode);

        const vis = computeSeatVisualHex({
          seat: subSeat,
          status,
          isHovered,
          isSelected,
          isFocused,
          matchesFilter,
        });

        _color.set(vis.hex).multiplyScalar(vis.brightnessMultiplier);
        rt.shellMesh.setColorAt(idx, _color);

        const hideInSeatView = cameraMode === 'SEAT_VIEW' && isFocused && subSeat.isCenterAnchor;
        if (hideInSeatView || vis.scale !== 1.0) {
          _dummy.position.set(subSeat.posX, subSeat.posY, subSeat.posZ);
          _dummy.rotation.set(0, subSeat.rotY, 0);
          _dummy.scale.setScalar(hideInSeatView ? 0.0001 : vis.scale);
          _dummy.updateMatrix();
          rt.shellMesh.setMatrixAt(idx, _dummy.matrix);
          rt.frameMesh.setMatrixAt(idx, _dummy.matrix);
          rt.hwMesh.setMatrixAt(idx, _dummy.matrix);
          anyMatrixChanged = true;
        }

        const shouldPlaceSpectator =
          !isSelected &&
          crowdIndex < maxCrowd &&
          ((status === 'BOOKED' && subSeat.subIdx % 2 === 0) ||
            (subSeat.globalInstanceIndex % crowdStride === 0 &&
              (subSeat.rowNumber + subSeat.subIdx) % 2 === (subSeat.anchorIdx % 2)));

        if (crowdJerseyMesh && crowdBodyMesh && shouldPlaceSpectator) {
          const nearFocusedEye =
            cameraMode === 'SEAT_VIEW' &&
            focusedObj &&
            Math.hypot(
              subSeat.posX - focusedObj.posX,
              subSeat.posY - focusedObj.posY,
              subSeat.posZ - focusedObj.posZ
            ) < 3.2;

          _dummy.position.set(subSeat.posX, subSeat.posY, subSeat.posZ);
          const yawJitter = (((subSeat.globalInstanceIndex * 37) % 15) - 7) * 0.015;
          _dummy.rotation.set(0, subSeat.rotY + yawJitter, 0);
          const scaleVar = 0.92 + ((subSeat.globalInstanceIndex * 17) % 18) * 0.008;
          _dummy.scale.setScalar(scaleVar);
          _dummy.updateMatrix();

          if (nearFocusedEye) {
            hiddenCrowdSlotsRef.current.push({ idx: crowdIndex, matrix: _dummy.matrix.clone() });
            _dummy.scale.setScalar(0.0001);
            _dummy.updateMatrix();
          }

          crowdJerseyMesh.setMatrixAt(crowdIndex, _dummy.matrix);
          crowdBodyMesh.setMatrixAt(crowdIndex, _dummy.matrix);
          _color.set(
            jerseyPalette[(subSeat.globalInstanceIndex * 7 + subSeat.rowNumber) % jerseyPalette.length]
          );
          crowdJerseyMesh.setColorAt(crowdIndex, _color);
          crowdIndex++;
        }
      }

      rt.statusAttr.needsUpdate = true;
      if (rt.shellMesh.instanceColor) rt.shellMesh.instanceColor.needsUpdate = true;
      if (anyMatrixChanged) {
        rt.shellMesh.instanceMatrix.needsUpdate = true;
        rt.frameMesh.instanceMatrix.needsUpdate = true;
        rt.hwMesh.instanceMatrix.needsUpdate = true;
      }
    }

    if (crowdJerseyMesh && crowdBodyMesh) {
      crowdJerseyMesh.count = crowdIndex;
      crowdBodyMesh.count = crowdIndex;
      crowdJerseyMesh.instanceMatrix.needsUpdate = true;
      crowdBodyMesh.instanceMatrix.needsUpdate = true;
      if (crowdJerseyMesh.instanceColor) crowdJerseyMesh.instanceColor.needsUpdate = true;
    }

    hasAnyHeldRef.current = foundHeld;
    prevSelectedSetRef.current = selectedSet;
    prevFocusedIdRef.current = focusedId;
    requestRenderRef.current();
  }, [
    seats,
    chunksBuiltNonce,
    inventoryVersion,
    cameraMode,
    activeStandCode,
    activeBlockCode,
    filterCategoryCode,
    filterMaxPricePaise,
    filterCoveredOnly,
    filterMinViewScore,
    qualityPreset,
  ]);

  // O(1) Imperative Subscription for Hovered Seat ONLY (0 React re-renders of StadiumCanvas3D!)
  useEffect(() => {
    const unsub = useStadiumStore.subscribe((state, prevState) => {
      if (state.hoveredSeat === prevState.hoveredSeat) return;
      stateRef.current.hoveredSeat = state.hoveredSeat;

      const spatialIdx = spatialIndexRef.current;
      const runtimes = chunkRuntimesRef.current;
      if (!spatialIdx || runtimes.length === 0 || state.seats.length === 0) return;

      const prevId = prevHoveredIdRef.current;
      const nextId = state.hoveredSeat?.id ?? null;
      if (prevId === nextId) return;

      const selSet = new Set(state.selectedSeatIds);
      const focId = state.focusedSeat?.id ?? null;

      if (prevId !== null) {
        const prevSeat = seatByIdMapRef.current.get(prevId);
        if (prevSeat) {
          applyAnchorVisualState(
            prevSeat,
            spatialIdx,
            runtimes,
            state.inventoryBySeatId,
            state.priceByCategoryId,
            selSet,
            nextId,
            focId,
            state.cameraMode,
            state.activeStandCode,
            state.activeBlockCode,
            state.filterCategoryCode,
            state.filterMaxPricePaise,
            state.filterCoveredOnly,
            state.filterMinViewScore,
            state.currentUser.id ?? null,
            state.activeHold?.holdToken ?? null
          );
        }
      }
      if (state.hoveredSeat) {
        applyAnchorVisualState(
          state.hoveredSeat,
          spatialIdx,
          runtimes,
          state.inventoryBySeatId,
          state.priceByCategoryId,
          selSet,
          nextId,
          focId,
          state.cameraMode,
          state.activeStandCode,
          state.activeBlockCode,
          state.filterCategoryCode,
          state.filterMaxPricePaise,
          state.filterCoveredOnly,
          state.filterMinViewScore,
          state.currentUser.id ?? null,
          state.activeHold?.holdToken ?? null
        );
      }

      prevHoveredIdRef.current = nextId;
      requestRenderRef.current();
    });
    return unsub;
  }, []);

  // O(k) Delta Update for Real-Time Socket.IO Inventory Events (<= 6 seats, NEVER 33,600!)
  useEffect(() => {
    if (!lastSocketDelta || lastSocketDelta.seatIds.length === 0) return;
    const spatialIdx = spatialIndexRef.current;
    const runtimes = chunkRuntimesRef.current;
    if (!spatialIdx || runtimes.length === 0) return;

    const storeNow = useStadiumStore.getState();
    const selSet = new Set(storeNow.selectedSeatIds);
    const hovId = storeNow.hoveredSeat?.id ?? null;
    const focId = storeNow.focusedSeat?.id ?? null;

    let anyHeldInInv = hasAnyHeldRef.current;
    for (const id of lastSocketDelta.seatIds) {
      if (storeNow.inventoryBySeatId[id]?.status === 'HELD') anyHeldInInv = true;
      const anchor = seatByIdMapRef.current.get(id);
      if (!anchor) continue;
      applyAnchorVisualState(
        anchor,
        spatialIdx,
        runtimes,
        storeNow.inventoryBySeatId,
        storeNow.priceByCategoryId,
        selSet,
        hovId,
        focId,
        storeNow.cameraMode,
        storeNow.activeStandCode,
        storeNow.activeBlockCode,
        storeNow.filterCategoryCode,
        storeNow.filterMaxPricePaise,
        storeNow.filterCoveredOnly,
        storeNow.filterMinViewScore,
        storeNow.currentUser.id ?? null,
        storeNow.activeHold?.holdToken ?? null
      );
    }
    hasAnyHeldRef.current = anyHeldInInv;
    requestRenderRef.current();
  }, [lastSocketDelta]);

  // O(k) Delta Update for Active Hold Ownership ("Reserved for You" purple <-> amber/available)
  useEffect(() => {
    const spatialIdx = spatialIndexRef.current;
    const runtimes = chunkRuntimesRef.current;
    if (!spatialIdx || runtimes.length === 0) return;

    const nextIds = activeHold ? activeHold.seats.map((s) => s.seatId) : [];
    const dirtyIds = new Set<number>([...prevHoldSeatIdsRef.current, ...nextIds]);
    prevHoldSeatIdsRef.current = nextIds;
    if (dirtyIds.size === 0) return;

    const storeNow = useStadiumStore.getState();
    const selSet = new Set(storeNow.selectedSeatIds);
    const hovId = storeNow.hoveredSeat?.id ?? null;
    const focId = storeNow.focusedSeat?.id ?? null;

    for (const id of dirtyIds) {
      const anchor = seatByIdMapRef.current.get(id);
      if (!anchor) continue;
      applyAnchorVisualState(
        anchor,
        spatialIdx,
        runtimes,
        storeNow.inventoryBySeatId,
        storeNow.priceByCategoryId,
        selSet,
        hovId,
        focId,
        storeNow.cameraMode,
        storeNow.activeStandCode,
        storeNow.activeBlockCode,
        storeNow.filterCategoryCode,
        storeNow.filterMaxPricePaise,
        storeNow.filterCoveredOnly,
        storeNow.filterMinViewScore,
        currentUserId ?? null,
        activeHold?.holdToken ?? null
      );
    }
    if (nextIds.length > 0) hasAnyHeldRef.current = true;
    requestRenderRef.current();
  }, [activeHold, currentUserId]);

  // O(k) Delta Update for Selected / Focused Seats ONLY (+ fast near-eye crowd hide in SEAT_VIEW)
  useEffect(() => {
    const spatialIdx = spatialIndexRef.current;
    const runtimes = chunkRuntimesRef.current;
    if (!spatialIdx || runtimes.length === 0 || seats.length === 0) return;

    const nextSet = new Set(selectedSeatIds);
    const prevSet = prevSelectedSetRef.current;
    const prevFoc = prevFocusedIdRef.current;
    const nextFoc = focusedSeat?.id ?? null;

    const dirtyIds = new Set<number>();
    prevSet.forEach((id) => {
      if (!nextSet.has(id)) dirtyIds.add(id);
    });
    nextSet.forEach((id) => {
      if (!prevSet.has(id)) dirtyIds.add(id);
    });
    if (prevFoc !== nextFoc) {
      if (prevFoc !== null) dirtyIds.add(prevFoc);
      if (nextFoc !== null) dirtyIds.add(nextFoc);
    }

    const st = stateRef.current;
    const hovId = st.hoveredSeat?.id ?? null;
    for (const id of dirtyIds) {
      const anchor = seatByIdMapRef.current.get(id);
      if (!anchor) continue;
      applyAnchorVisualState(
        anchor,
        spatialIdx,
        runtimes,
        st.inventoryBySeatId,
        st.priceByCategoryId,
        nextSet,
        hovId,
        nextFoc,
        st.cameraMode,
        st.activeStandCode,
        st.activeBlockCode,
        st.filterCategoryCode,
        st.filterMaxPricePaise,
        st.filterCoveredOnly,
        st.filterMinViewScore,
        st.currentUserId ?? null,
        st.activeHold?.holdToken ?? null
      );
    }

    // Update nearby spectator suppression in SEAT_VIEW if focusedSeat changed
    const crowdJerseyMesh = crowdJerseyMeshRef.current;
    const crowdBodyMesh = crowdBodyMeshRef.current;
    if (crowdJerseyMesh && crowdBodyMesh && hiddenCrowdSlotsRef.current.length > 0 && st.cameraMode === 'SEAT_VIEW') {
      for (const slot of hiddenCrowdSlotsRef.current) {
        crowdJerseyMesh.setMatrixAt(slot.idx, slot.matrix);
        crowdBodyMesh.setMatrixAt(slot.idx, slot.matrix);
      }
      hiddenCrowdSlotsRef.current = [];
      if (focusedSeat) {
        const count = crowdJerseyMesh.count;
        const pos = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
          crowdJerseyMesh.getMatrixAt(i, _dummy.matrix);
          pos.setFromMatrixPosition(_dummy.matrix);
          if (pos.distanceTo(new THREE.Vector3(focusedSeat.posX, focusedSeat.posY, focusedSeat.posZ)) < 3.2) {
            hiddenCrowdSlotsRef.current.push({ idx: i, matrix: _dummy.matrix.clone() });
            _dummy.scale.setScalar(0.0001);
            _dummy.position.copy(pos);
            _dummy.updateMatrix();
            crowdJerseyMesh.setMatrixAt(i, _dummy.matrix);
            crowdBodyMesh.setMatrixAt(i, _dummy.matrix);
          }
        }
      }
      crowdJerseyMesh.instanceMatrix.needsUpdate = true;
      crowdBodyMesh.instanceMatrix.needsUpdate = true;
    }

    prevSelectedSetRef.current = nextSet;
    prevFocusedIdRef.current = nextFoc;
    requestRenderRef.current();
  }, [selectedSeatIds, focusedSeat, seats]);

  // Update Time-of-Day Lighting (Broadcast Day, Golden Sunset Dusk, Bright Floodlit Night)
  useEffect(() => {
    const sun = sunLightRef.current;
    const fill = fillLightRef.current;
    const hemi = hemiLightRef.current;
    const scene = sceneRef.current;
    const skyMat = skyMaterialRef.current;
    if (!sun || !hemi || !scene) return;

    const hr = timeOfDayHours;
    const isNight = hr >= 18.5 || hr <= 6.5;
    const isDusk = hr >= 16.8 && hr < 18.5;

    if (isNight) {
      scene.background = new THREE.Color('#050D1C');
      scene.fog = new THREE.FogExp2('#071224', 0.00085);
      sun.color.set('#E2ECFF');
      sun.intensity = 1.28;
      sun.position.set(85, 118, 95);
      if (fill) {
        fill.color.set('#93C5FD');
        fill.intensity = 0.68;
        fill.position.set(-95, 105, -85);
      }
      hemi.color.set('#475569');
      hemi.groundColor.set('#143A22');
      hemi.intensity = 0.65;

      if (skyMat) {
        skyMat.uniforms.topColor.value.set('#030916');
        skyMat.uniforms.horizonColor.value.set('#0F213E');
        skyMat.uniforms.bottomColor.value.set('#050D1A');
        skyMat.uniforms.sunDirection.value.set(0.3, 0.8, 0.4);
        skyMat.uniforms.sunColor.value.set('#38BDF8');
        skyMat.uniforms.sunDiskIntensity.value = 0.0;
      }

      floodlightMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 7.5;
      });
      cityWindowMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 1.65;
      });
      vipWarmMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 1.85;
      });
      ledRibbonMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 1.25;
      });
      if (floodConesGroupRef.current && floodConeMatRef.current) {
        floodConesGroupRef.current.visible = true;
        floodConeMatRef.current.opacity = 0.065;
      }
      nightSpotLightsRef.current.forEach((sl) => {
        sl.intensity = 1.15;
      });
      roofMaterialsRef.current.forEach((m) => {
        m.emissive.set('#1E304A');
        m.emissiveIntensity = 0.55;
      });
    } else if (isDusk) {
      scene.background = new THREE.Color('#271D4E');
      scene.fog = new THREE.FogExp2('#4E2A42', 0.00095);
      sun.color.set('#FF9B4E');
      sun.intensity = 2.15;
      sun.position.set(-158, 30, 54);
      if (fill) {
        fill.color.set('#C4B5FD');
        fill.intensity = 0.72;
        fill.position.set(120, 90, -90);
      }
      hemi.color.set('#FDBA74');
      hemi.groundColor.set('#1B3B25');
      hemi.intensity = 0.88;

      if (skyMat) {
        skyMat.uniforms.topColor.value.set('#1E1B4B');
        skyMat.uniforms.horizonColor.value.set('#FB923C');
        skyMat.uniforms.bottomColor.value.set('#0F172A');
        skyMat.uniforms.sunDirection.value.copy(sun.position).normalize();
        skyMat.uniforms.sunColor.value.set('#FDE047');
        skyMat.uniforms.sunDiskIntensity.value = 2.4;
      }

      floodlightMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 4.6;
      });
      cityWindowMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 0.95;
      });
      vipWarmMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 1.25;
      });
      ledRibbonMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 1.05;
      });
      if (floodConesGroupRef.current && floodConeMatRef.current) {
        floodConesGroupRef.current.visible = true;
        floodConeMatRef.current.opacity = 0.035;
      }
      nightSpotLightsRef.current.forEach((sl) => {
        sl.intensity = 0.55;
      });
      roofMaterialsRef.current.forEach((m) => {
        m.emissive.set('#4D3224');
        m.emissiveIntensity = 0.48;
      });
    } else {
      const dayProgress = Math.max(0, Math.min(1, (hr - 8) / 10));
      const sunElevRad = Math.max(0.45, Math.sin(dayProgress * Math.PI) * 1.18);
      const sunAzimRad = THREE.MathUtils.degToRad(90 + dayProgress * 180);
      scene.background = new THREE.Color('#2B6CB0');
      scene.fog = new THREE.FogExp2('#8EC5EC', 0.00108);
      sun.color.set('#FFFBEB');
      sun.intensity = 2.55;
      sun.position.set(
        Math.sin(sunAzimRad) * Math.cos(sunElevRad) * 165,
        Math.max(48, Math.sin(sunElevRad) * 165),
        -Math.cos(sunAzimRad) * Math.cos(sunElevRad) * 165
      );
      if (fill) {
        fill.color.set('#BFDBFE');
        fill.intensity = 0.88;
        fill.position.set(120, 95, -100);
      }
      hemi.color.set('#E0F2FE');
      hemi.groundColor.set('#1E5A31');
      hemi.intensity = 1.02;

      if (skyMat) {
        skyMat.uniforms.topColor.value.set('#0284C7');
        skyMat.uniforms.horizonColor.value.set('#BAE6FD');
        skyMat.uniforms.bottomColor.value.set('#1E293B');
        skyMat.uniforms.sunDirection.value.copy(sun.position).normalize();
        skyMat.uniforms.sunColor.value.set('#FEF08A');
        skyMat.uniforms.sunDiskIntensity.value = 2.2;
      }

      floodlightMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 0.25;
      });
      cityWindowMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 0.05;
      });
      vipWarmMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 0.35;
      });
      ledRibbonMaterialsRef.current.forEach((m) => {
        m.emissiveIntensity = 0.72;
      });
      if (floodConesGroupRef.current) {
        floodConesGroupRef.current.visible = false;
      }
      nightSpotLightsRef.current.forEach((sl) => {
        sl.intensity = 0;
      });
      roofMaterialsRef.current.forEach((m) => {
        m.emissive.set('#263242');
        m.emissiveIntensity = 0.30;
      });
    }

    if (rendererRef.current) {
      rendererRef.current.shadowMap.needsUpdate = true;
    }
    requestRenderRef.current();
  }, [timeOfDayHours]);

  // Mount WebGLRenderer & Load Genuine Stadium GLB Assets ONCE
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    canvasMountCounter += 1;
    let disposed = false;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const initialPresetCfg = QUALITY_PRESET_CONFIGS[stateRef.current.qualityPreset];
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: isSoftwareGl,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    const initDpr = isSoftwareGl
      ? initialPresetCfg.maxDprSoftware
      : Math.min(window.devicePixelRatio || 1, initialPresetCfg.maxDpr);
    renderer.setPixelRatio(Math.max(0.5, initDpr * initialPresetCfg.resolutionScale));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl && initialPresetCfg.shadowsEnabled;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#2B6CB0');
    scene.fog = new THREE.FogExp2('#8EC5EC', 0.00108);
    sceneRef.current = scene;

    // Studio & outdoor sky PMREM environment reflections (baked once on mount for realistic steel & polymer highlights)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.25, 1100);
    const urlParams = new URLSearchParams(window.location.search);
    const shouldSkipIntro = urlParams.has('seat') || urlParams.get('autostart') === '1';
    if (shouldSkipIntro) {
      useStadiumStore.getState().setIntroPlaying(false);
      stateRef.current.introPlaying = false;
      camera.position.set(0, 56, 86);
    } else {
      camera.position.set(-28, 72, 118);
    }
    camera.lookAt(0, 4, -8);
    cameraRef.current = camera;

    let composerTarget: THREE.WebGLRenderTarget | null = null;
    if (!isSoftwareGl) {
      composerTarget = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        samples: 4,
      });
      const composer = new EffectComposer(renderer, composerTarget);
      composer.addPass(new RenderPass(scene, camera));
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.12,
        0.28,
        1.32
      );
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
      composerRef.current = composer;
      bloomPassRef.current = bloomPass;
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.075;
    controls.maxPolarAngle = Math.PI / 2 - 0.015;
    controls.minDistance = 3.0;
    controls.maxDistance = 285;
    controls.zoomToCursor = false;
    controls.target.set(0, 4, -8);
    controlsRef.current = controls;

    // 1. Atmospheric Sky Dome
    const skyGeo = new THREE.SphereGeometry(520, 28, 18);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color('#0284C7') },
        horizonColor: { value: new THREE.Color('#BAE6FD') },
        bottomColor: { value: new THREE.Color('#1E293B') },
        sunDirection: { value: new THREE.Vector3(-0.5, 0.7, 0.4).normalize() },
        sunColor: { value: new THREE.Color('#FEF08A') },
        sunDiskIntensity: { value: 2.2 },
      },
    });
    skyMaterialRef.current = skyMat;
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    skyDome.name = 'ATMOSPHERIC_SKY_DOME';
    scene.add(skyDome);

    // 2. Broadcast Stadium Lighting Rig
    const hemiLight = new THREE.HemisphereLight('#E0F2FE', '#1E5A31', isSoftwareGl ? 1.35 : 1.02);
    hemiLight.position.set(0, 140, 0);
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

    const sunLight = new THREE.DirectionalLight('#FFFBEB', isSoftwareGl ? 2.45 : 2.55);
    sunLight.position.set(-110, 135, 85);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 380;
    const d = 140;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    const stadiumFillLight = new THREE.DirectionalLight('#BFDBFE', 0.88);
    stadiumFillLight.position.set(120, 95, -100);
    scene.add(stadiumFillLight);
    fillLightRef.current = stadiumFillLight;

    const maxAniso = isSoftwareGl
      ? 1
      : Math.min(16, renderer.capabilities.getMaxAnisotropy());
    maxHardwareAnisoRef.current = maxAniso;
    const effectiveInitialAniso = isSoftwareGl
      ? 1
      : Math.min(maxAniso, initialPresetCfg.maxAnisotropyCap);
    const texLoader = new THREE.TextureLoader();

    const grassNeutralLuma = { value: 0.175 };
    const clayNeutralLuma = { value: 0.26 };
    const concreteNeutralLuma = { value: 0.24 };

    const loadTex = (
      url: string,
      isColor: boolean,
      neutralLumaTarget?: { value: number }
    ): THREE.Texture => {
      const t = texLoader.load(url, (loaded) => {
        if (neutralLumaTarget) {
          const mean = computeTextureMeanLinearLuma(loaded.image);
          if (mean !== null) neutralLumaTarget.value = mean;
        }
        if (!disposed) requestRender();
      });
      if (isColor) {
        t.colorSpace = THREE.SRGBColorSpace;
      }
      t.anisotropy = effectiveInitialAniso;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      return t;
    };

    const grassMacroTex = loadTex('/textures/macro/grass_turf_macro.jpg', true, grassNeutralLuma);
    const clayMacroTex = loadTex('/textures/macro/cricket_pitch_clay_macro.jpg', true, clayNeutralLuma);
    const concreteMacroTex = loadTex('/textures/macro/concrete_step_macro.jpg', true, concreteNeutralLuma);
    const seatAtlasNormal = !isSoftwareGl ? loadTex('/textures/seat_atlas_2k/seat_atlas_normal_2k.png', false) : null;
    const seatAtlasAo = !isSoftwareGl ? loadTex('/textures/seat_atlas_2k/seat_atlas_ao_2k.png', false) : null;
    const cityWindowTexs = createCityWindowTextures(effectiveInitialAniso);
    const floodBeamAlphaTex = createFloodBeamAlphaTexture();

    // Floodlight night illumination pools + soft tapered mid-air light rays
    const nightSpotGroup = new THREE.Group();
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 0, 0);
    nightSpotGroup.add(spotTarget);
    const spotLights: THREE.SpotLight[] = [];
    for (const [sx, sy, sz] of [
      [-115, 62, -95],
      [115, 62, 95],
    ]) {
      const sl = new THREE.SpotLight('#F8FAFC', 0, 320, Math.PI * 0.28, 0.85, 0.6);
      sl.position.set(sx, sy, sz);
      sl.target = spotTarget;
      sl.castShadow = false;
      nightSpotGroup.add(sl);
      spotLights.push(sl);
    }
    scene.add(nightSpotGroup);
    nightSpotLightsRef.current = spotLights;

    const conesGroup = new THREE.Group();
    conesGroup.visible = false;
    const coneMat = new THREE.MeshBasicMaterial({
      color: '#E0F2FE',
      alphaMap: floodBeamAlphaTex,
      transparent: true,
      opacity: 0.065,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    floodConeMatRef.current = coneMat;
    const coneGeo = new THREE.ConeGeometry(22, 88, 14, 1, true);
    coneGeo.translate(0, -44, 0);
    coneGeo.rotateX(-Math.PI * 0.5);
    for (const tDeg of [25, 85, 145, 205, 265, 325]) {
      const rad = THREE.MathUtils.degToRad(tDeg);
      const tx = (DEFAULT_STADIUM_SPEC.roofOuterRadiusX + 8.5) * Math.sin(rad);
      const tz = -(DEFAULT_STADIUM_SPEC.roofOuterRadiusZ + 8.5) * Math.cos(rad);
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(tx, 58.6, tz);
      cone.lookAt(0, 4, 0);
      conesGroup.add(cone);
    }
    scene.add(conesGroup);
    floodConesGroupRef.current = conesGroup;

    // 3. Shared Seat Materials (Physical for MEDIUM..ULTRA + Specular Polymer Phong for LOW/Software) with GPU Status Shader
    const seatShellLambertMat = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      specular: new THREE.Color('#D8E6F5'),
      shininess: 52,
    });
    attachSeatStatusShader(
      seatShellLambertMat,
      seatAvailModeUniformRef.current,
      seatStatusTimeUniformRef.current
    );
    const seatShellPhysicalMat = isSoftwareGl
      ? seatShellLambertMat
      : new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.34,
          metalness: 0.05,
          clearcoat: 0.28,
          clearcoatRoughness: 0.22,
          normalMap: seatAtlasNormal,
          normalScale: new THREE.Vector2(0.85, 0.85),
          aoMap: seatAtlasAo,
          aoMapIntensity: initialPresetCfg.aoEnabled ? initialPresetCfg.aoIntensity : 0,
        });
    if (seatShellPhysicalMat !== seatShellLambertMat) {
      attachSeatStatusShader(
        seatShellPhysicalMat,
        seatAvailModeUniformRef.current,
        seatStatusTimeUniformRef.current
      );
    }
    seatShellLambertMatRef.current = seatShellLambertMat;
    seatShellPhysicalMatRef.current = seatShellPhysicalMat;
    const initialShellMat =
      isSoftwareGl || initialPresetCfg.useSimpleSeatMaterial
        ? seatShellLambertMat
        : seatShellPhysicalMat;

    const seatFrameMat = isSoftwareGl
      ? new THREE.MeshLambertMaterial({ color: '#334155' })
      : new THREE.MeshStandardMaterial({
          color: '#334155',
          roughness: 0.42,
          metalness: 0.38,
        });
    seatFrameMatRef.current = seatFrameMat;

    const seatHardwareMat = isSoftwareGl
      ? new THREE.MeshLambertMaterial({ color: '#DCE4EE' })
      : new THREE.MeshPhysicalMaterial({
          color: '#DCE4EE',
          roughness: 0.26,
          metalness: 0.82,
          clearcoat: 0.3,
          clearcoatRoughness: 0.18,
        });
    seatHwMatRef.current = seatHardwareMat;

    const seatGroup = new THREE.Group();
    seatGroup.name = 'CHUNKED_SEAT_BOWL_24';
    seatGroup.visible = stateRef.current.seatInstanceVisibility;
    seatGroupRef.current = seatGroup;
    scene.add(seatGroup);
    setSceneMountNonce((n) => n + 1);

    // LOD0 Hero Pool (nearest <= 96 close-up seats on hardware GPU HIGH/ULTRA)
    if (!isSoftwareGl) {
      const heroStatusAttr = new THREE.InstancedBufferAttribute(new Float32Array(HERO_POOL_MAX), 1);
      heroStatusAttrRef.current = heroStatusAttr;
      const placeholderGeo = makeChunkWrappedGeo(buildUltraLeanPlaceholderSeatGeo(), heroStatusAttr);
      const heroShell = new THREE.InstancedMesh(placeholderGeo, initialShellMat, HERO_POOL_MAX);
      heroShell.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(HERO_POOL_MAX * 3), 3);
      heroShell.frustumCulled = false;
      heroShell.count = 0;
      heroShell.visible = false;
      heroShellMeshRef.current = heroShell;
      scene.add(heroShell);

      const heroFrame = new THREE.InstancedMesh(buildUltraLeanPlaceholderSeatGeo(), seatFrameMat, HERO_POOL_MAX);
      heroFrame.frustumCulled = false;
      heroFrame.count = 0;
      heroFrame.visible = false;
      heroFrameMeshRef.current = heroFrame;
      scene.add(heroFrame);

      const heroHw = new THREE.InstancedMesh(buildUltraLeanPlaceholderSeatGeo(), seatHardwareMat, HERO_POOL_MAX);
      heroHw.frustumCulled = false;
      heroHw.count = 0;
      heroHw.visible = false;
      heroHwMeshRef.current = heroHw;
      scene.add(heroHw);
    }

    // 4. GPU-Instanced Seated Crowd Spectators & Animated Cheering + Flags
    const crowdBowlSphere = new THREE.Sphere(new THREE.Vector3(0, 10, 0), 125);
    const attachCrowdCheerShader = (mat: THREE.Material) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uCrowdTime = crowdTimeUniformRef.current;
        shader.vertexShader =
          `uniform float uCrowdTime;\n` + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          #ifdef USE_INSTANCING
            float phase = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.41;
            float lift = max(0.0, transformed.y - 0.45);
            transformed.y += sin(uCrowdTime * 2.8 + phase) * 0.035 * lift;
            transformed.x += cos(uCrowdTime * 2.1 + phase * 1.3) * 0.018 * lift;
          #endif
          `
        );
      };
      mat.needsUpdate = true;
    };

    const initTorsoGeo = new THREE.BoxGeometry(0.32, 0.38, 0.17);
    initTorsoGeo.translate(0, 0.65, -0.02);
    const crowdJerseyMat = isSoftwareGl
      ? new THREE.MeshLambertMaterial({ color: 0xffffff })
      : new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.65,
          metalness: 0.04,
        });
    attachCrowdCheerShader(crowdJerseyMat);
    const crowdJerseyMesh = new THREE.InstancedMesh(initTorsoGeo, crowdJerseyMat, 3200);
    crowdJerseyMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3200 * 3), 3);
    crowdJerseyMesh.boundingSphere = crowdBowlSphere.clone();
    crowdJerseyMesh.frustumCulled = true;
    crowdJerseyMesh.count = 0;
    crowdJerseyMeshRef.current = crowdJerseyMesh;
    scene.add(crowdJerseyMesh);

    const initHeadGeo = new THREE.SphereGeometry(0.095, 8, 6);
    initHeadGeo.translate(0, 0.96, -0.01);
    const crowdBodyMat = isSoftwareGl
      ? new THREE.MeshLambertMaterial({ color: '#3B4559' })
      : new THREE.MeshStandardMaterial({
          color: '#3B4559',
          roughness: 0.72,
          metalness: 0.05,
        });
    attachCrowdCheerShader(crowdBodyMat);
    const crowdBodyMesh = new THREE.InstancedMesh(initHeadGeo, crowdBodyMat, 3200);
    crowdBodyMesh.boundingSphere = crowdBowlSphere.clone();
    crowdBodyMesh.frustumCulled = true;
    crowdBodyMesh.count = 0;
    crowdBodyMeshRef.current = crowdBodyMesh;
    scene.add(crowdBodyMesh);

    // 16 Stadium Pennant Flags around Tier 2/3 parapet ring (match-day atmosphere)
    const flagGeo = new THREE.BoxGeometry(0.05, 1.35, 0.95);
    flagGeo.translate(0, 0.68, 0.48);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    flagMat.onBeforeCompile = (shader) => {
      shader.uniforms.uCrowdTime = crowdTimeUniformRef.current;
      shader.vertexShader = `uniform float uCrowdTime;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        float flutter = sin(uCrowdTime * 4.5 + transformed.z * 3.8 + float(gl_InstanceID)) * 0.09 * max(0.0, transformed.z);
        transformed.x += flutter;
        `
      );
    };
    const flagMesh = new THREE.InstancedMesh(flagGeo, flagMat, 16);
    flagMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(16 * 3), 3);
    flagMesh.boundingSphere = crowdBowlSphere.clone();
    flagMesh.frustumCulled = true;
    const flagPalette = ['#0284C7', '#F59E0B', '#10B981', '#E2E8F0'];
    for (let f = 0; f < 16; f++) {
      const ang = (f / 16) * Math.PI * 2;
      const fx = Math.sin(ang) * (DEFAULT_STADIUM_SPEC.semiMajorAxisX + 31.1);
      const fz = -Math.cos(ang) * (DEFAULT_STADIUM_SPEC.semiMinorAxisZ + 31.1);
      _dummy.position.set(fx, 23.9, fz);
      _dummy.rotation.set(0, Math.atan2(-fx, -fz), 0);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      flagMesh.setMatrixAt(f, _dummy.matrix);
      _color.set(flagPalette[f % flagPalette.length]);
      flagMesh.setColorAt(f, _color);
    }
    flagMesh.instanceMatrix.needsUpdate = true;
    if (flagMesh.instanceColor) flagMesh.instanceColor.needsUpdate = true;
    flagMeshRef.current = flagMesh;
    scene.add(flagMesh);

    // 5. Load Stadium Venue & Multi-LOD Seat + Crowd Assets
    const gltfLoader = new GLTFLoader();
    const scoreboardCanvasTex = createHighResScoreboardTexture(maxAniso);

    // 5A. Stadium Architecture & Outfield GLB
    gltfLoader.load(
      '/models/stadium_venue.glb',
      (gltf) => {
        if (disposed) return;
        const venueRoot = gltf.scene;
        venueRoot.name = 'BLENDER_STADIUM_VENUE_GLB';

        let meshCount = 0;
        let vertexCount = 0;
        const floodMats: THREE.MeshStandardMaterial[] = [];
        const roofMats: THREE.MeshStandardMaterial[] = [];
        const allVenueMats: THREE.MeshStandardMaterial[] = [];
        const activeCfg = QUALITY_PRESET_CONFIGS[stateRef.current.qualityPreset];
        const activeAniso = isSoftwareGl
          ? 1
          : Math.min(maxAniso, activeCfg.maxAnisotropyCap);

        const turfMats = new Set<THREE.MeshStandardMaterial>();
        const roofMeshes: THREE.Mesh[] = [];
        const trussMeshes: THREE.Mesh[] = [];
        const cityWinMats: THREE.MeshStandardMaterial[] = [];
        const vipWarmMats: THREE.MeshStandardMaterial[] = [];
        const ledRibbonMats: THREE.MeshStandardMaterial[] = [];
        venueRoot.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            meshCount++;
            if (mesh.geometry?.attributes?.position) {
              vertexCount += mesh.geometry.attributes.position.count;
            }
            if (mesh.geometry?.attributes?.uv && !mesh.geometry.attributes.uv2) {
              mesh.geometry.setAttribute('uv2', mesh.geometry.attributes.uv);
            }
            const skipShadowCast =
              mesh.name.includes('Outfield') ||
              mesh.name.includes('Cricket_Pitch') ||
              mesh.name.includes('Cricket_Square') ||
              mesh.name.includes('Creases') ||
              mesh.name.includes('Boundary_Padded_Rope') ||
              mesh.name.includes('Boundary_Sponsor') ||
              mesh.name.includes('Exterior_Terrain') ||
              mesh.name.includes('Exterior_Roads') ||
              mesh.name.includes('Exterior_Granite_Plaza') ||
              mesh.name.includes('City_Skyline_Windows') ||
              mesh.name.includes('Floodlight_LED') ||
              mesh.name.includes('Scoreboard_Screens') ||
              mesh.name.includes('Glass') ||
              mesh.name.includes('Balustrade');
            mesh.castShadow = !isSoftwareGl && !skipShadowCast;
            mesh.receiveShadow = !isSoftwareGl && !mesh.name.includes('City_Skyline_Windows');

            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat) {
              allVenueMats.push(mat);
              const needsDoubleSided =
                mesh.name.includes('Glass') ||
                mesh.name.includes('Balustrade') ||
                mesh.name.includes('PTFE_Roof');
              mat.side = needsDoubleSided ? THREE.DoubleSide : THREE.FrontSide;
              mat.envMapIntensity = isSoftwareGl ? 0.65 : activeCfg.envMapIntensity;
              if (mat.map) mat.map.anisotropy = activeAniso;
              if (mat.normalMap) mat.normalMap.anisotropy = activeAniso;
              if (mat.roughnessMap) mat.roughnessMap.anisotropy = activeAniso;

              if (mesh.name.includes('Outfield_Turf_Field')) {
                mat.envMapIntensity = 0.12;
                mat.aoMapIntensity = 0.45;
                mat.normalScale.set(1.25, 1.25);
                mat.needsUpdate = true;
                turfMats.add(mat);
              } else if (
                mesh.name.includes('Cricket_Square') ||
                mesh.name.includes('Cricket_Pitch_22Yard') ||
                mesh.name.includes('Cricket_Pitch_Creases')
              ) {
                mat.envMapIntensity = 0.16;
                mat.aoMapIntensity = 0.45;
                turfMats.add(mat);
              } else if (mesh.name.includes('City_Skyline_Windows')) {
                mat.color.set('#CBD5E1');
                mat.roughness = 0.24;
                mat.metalness = 0.55;
                mat.map = cityWindowTexs.dayMap;
                mat.emissiveMap = cityWindowTexs.emissiveMap;
                mat.emissive = new THREE.Color('#FEF08A');
                mat.emissiveIntensity = 0.0;
                mat.needsUpdate = true;
                cityWinMats.push(mat);
              } else if (mesh.name.includes('VIP_Hospitality_Warm_Lounges')) {
                vipWarmMats.push(mat);
              } else if (mesh.name.includes('Perimeter_LED_Sponsor_Boards') && mat.map) {
                mat.emissiveMap = mat.map;
                mat.emissive = new THREE.Color('#FFFFFF');
                mat.emissiveIntensity = 0.72;
                mat.needsUpdate = true;
                ledRibbonMats.push(mat);
              }

              if (mesh.name.includes('Cricket_Pitch_Creases')) {
                mesh.renderOrder = 3;
                mat.polygonOffset = true;
                mat.polygonOffsetFactor = -3;
                mat.polygonOffsetUnits = -3;
              } else if (mesh.name.includes('Cricket_Pitch_22Yard')) {
                mesh.renderOrder = 2;
                mat.transparent = true;
                mat.depthWrite = false;
                mat.polygonOffset = true;
                mat.polygonOffsetFactor = -2;
                mat.polygonOffsetUnits = -2;
                mat.needsUpdate = true;
              } else if (mesh.name.includes('Cricket_Square')) {
                mesh.renderOrder = 1;
                mat.transparent = true;
                mat.depthWrite = false;
                mat.polygonOffset = true;
                mat.polygonOffsetFactor = -1;
                mat.polygonOffsetUnits = -1;
                mat.needsUpdate = true;
              }

              if (
                grassMacroTex &&
                (mesh.name.includes('Outfield_Turf_Field') ||
                  mesh.name.includes('Cricket_Square_Apron'))
              ) {
                const isOutfield = mesh.name.includes('Outfield');
                attachMultiScaleDetailShader(
                  mat,
                  grassMacroTex,
                  isOutfield ? 44.0 : 14.0,
                  isOutfield ? 0.68 : 0.42,
                  detailActiveUniformRef.current,
                  grassNeutralLuma,
                  { cacheKey: isOutfield ? 'turf-outfield' : 'turf-square', isTurf: true }
                );
              }

              if (
                clayMacroTex &&
                mesh.name.includes('Cricket_Pitch_22Yard')
              ) {
                attachMultiScaleDetailShader(
                  mat,
                  clayMacroTex,
                  12.0,
                  0.38,
                  detailActiveUniformRef.current,
                  clayNeutralLuma,
                  { cacheKey: 'pitch-clay', isTurf: false }
                );
              }

              if (
                concreteMacroTex &&
                mesh.name.includes('Seating_Bowl_Stepped_Tiers')
              ) {
                attachMultiScaleDetailShader(
                  mat,
                  concreteMacroTex,
                  8.0,
                  0.36,
                  detailActiveUniformRef.current,
                  concreteNeutralLuma,
                  { cacheKey: 'concrete-tiers', isTurf: false }
                );
              }

              if (mesh.name.includes('Scoreboard_Screens')) {
                mat.map = scoreboardCanvasTex;
                mat.emissiveMap = scoreboardCanvasTex;
                mat.emissive = new THREE.Color('#FFFFFF');
                mat.emissiveIntensity = 1.35;
                mat.needsUpdate = true;
              }

              if (mesh.name.includes('Floodlight_LED')) {
                floodMats.push(mat);
              }
              if (mesh.name.includes('PTFE_Roof')) {
                mesh.renderOrder = 2;
                mat.transparent = true;
                mat.opacity = 0.86;
                mat.depthWrite = true;
                mat.roughness = 0.34;
                mat.needsUpdate = true;
                roofMats.push(mat);
                roofMeshes.push(mesh);
              }
              if (mesh.name.includes('Roof_Steel_SpaceFrame_Trusses')) {
                mesh.renderOrder = 1;
                mat.metalness = 0.84;
                mat.roughness = 0.26;
                mat.needsUpdate = true;
                trussMeshes.push(mesh);
              }
            }
          }
        });

        venueMaterialsRef.current = allVenueMats;
        venueTurfMaterialsRef.current = turfMats;
        floodlightMaterialsRef.current = floodMats;
        cityWindowMaterialsRef.current = cityWinMats;
        vipWarmMaterialsRef.current = vipWarmMats;
        ledRibbonMaterialsRef.current = ledRibbonMats;
        roofMaterialsRef.current = roofMats;
        roofMeshesRef.current = roofMeshes;
        trussMeshesRef.current = trussMeshes;
        scene.add(venueRoot);
        renderer.shadowMap.needsUpdate = true;

        const statusObj = {
          loaded: true,
          generator: 'STADIUMX Asset Pipeline v2 (1:1 DEFAULT_STADIUM_SPEC)',
          meshCount,
          vertexCount,
        };
        (window as any).__STADIUMX_BLENDER_STATUS__ = statusObj;
        setBlenderAssetStatus({
          loaded: true,
          meshCount,
          vertexCount,
        });

        requestRender();
      },
      undefined,
      (err) => {
        console.error('Error loading /models/stadium_venue.glb:', err);
      }
    );

    // 5B. Load Multi-Tier Seat LODs (LOD3, LOD2, and on Hardware GPU: LOD1 + LOD0 Hero)
    const applyLoadedGeoToChunks = () => {
      const runtimes = chunkRuntimesRef.current;
      for (const rt of runtimes) {
        if (lodGeosRef.current.lod3Shell && !rt.wrappedGeos.LOD3) {
          rt.wrappedGeos.LOD3 = makeChunkWrappedGeo(lodGeosRef.current.lod3Shell, rt.statusAttr);
        }
        if (lodGeosRef.current.lod2Shell && !rt.wrappedGeos.LOD2) {
          rt.wrappedGeos.LOD2 = makeChunkWrappedGeo(lodGeosRef.current.lod2Shell, rt.statusAttr);
        }
        if (lodGeosRef.current.lod1Shell && !rt.wrappedGeos.LOD1) {
          rt.wrappedGeos.LOD1 = makeChunkWrappedGeo(lodGeosRef.current.lod1Shell, rt.statusAttr);
        }
        rt.currentLod = 'LOD3';
        const geo = rt.wrappedGeos.LOD3 || rt.wrappedGeos.LOD2;
        if (geo) {
          rt.shellMesh.geometry = geo;
        }
        if (lodGeosRef.current.lod1Frame) {
          rt.frameMesh.geometry = lodGeosRef.current.lod1Frame;
        }
        if (lodGeosRef.current.lod1Hw) {
          rt.hwMesh.geometry = lodGeosRef.current.lod1Hw;
        }
      }
      lodDirtyRef.current = true;
      requestRender();
    };

    gltfLoader.load('/models/seat_lod3.glb', (gltf) => {
      if (disposed) return;
      const geos: THREE.BufferGeometry[] = [];
      gltf.scene.traverse((ch) => {
        if ((ch as THREE.Mesh).isMesh) {
          const g = (ch as THREE.Mesh).geometry.clone();
          ch.updateWorldMatrix(true, false);
          g.applyMatrix4(ch.matrixWorld);
          geos.push(g);
        }
      });
      if (geos.length > 0) {
        const merged = BufferGeometryUtils.mergeGeometries(geos, false);
        merged.computeVertexNormals();
        lodGeosRef.current.lod3Shell = merged;
        applyLoadedGeoToChunks();
      }
    });

    gltfLoader.load('/models/seat_lod2.glb', (gltf) => {
      if (disposed) return;
      const geos: THREE.BufferGeometry[] = [];
      gltf.scene.traverse((ch) => {
        if ((ch as THREE.Mesh).isMesh) {
          const g = (ch as THREE.Mesh).geometry.clone();
          ch.updateWorldMatrix(true, false);
          g.applyMatrix4(ch.matrixWorld);
          geos.push(g);
        }
      });
      if (geos.length > 0) {
        const merged = BufferGeometryUtils.mergeGeometries(geos, false);
        merged.computeVertexNormals();
        lodGeosRef.current.lod2Shell = merged;
        applyLoadedGeoToChunks();
      }
    });

    gltfLoader.load('/models/seat_lod1.glb', (gltf) => {
      if (disposed) return;
      const sh: THREE.BufferGeometry[] = [];
      const fr: THREE.BufferGeometry[] = [];
      const hw: THREE.BufferGeometry[] = [];
      gltf.scene.traverse((ch) => {
        if ((ch as THREE.Mesh).isMesh) {
          const m = ch as THREE.Mesh;
          const g = m.geometry.clone();
          m.updateWorldMatrix(true, false);
          g.applyMatrix4(m.matrixWorld);
          if (g.attributes.uv && !g.attributes.uv2) {
            g.setAttribute('uv2', g.attributes.uv);
          }
          if (m.name.includes('Hardware')) hw.push(g);
          else if (m.name.includes('Frame')) fr.push(g);
          else sh.push(g);
        }
      });
      if (sh.length) {
        const m = BufferGeometryUtils.mergeGeometries(sh, false);
        m.computeVertexNormals();
        lodGeosRef.current.lod1Shell = m;
      }
      if (fr.length) {
        const m = BufferGeometryUtils.mergeGeometries(fr, false);
        m.computeVertexNormals();
        lodGeosRef.current.lod1Frame = m;
      }
      if (hw.length) {
        const m = BufferGeometryUtils.mergeGeometries(hw, false);
        m.computeVertexNormals();
        lodGeosRef.current.lod1Hw = m;
      }
      applyLoadedGeoToChunks();
    });

    if (!isSoftwareGl) {

      gltfLoader.load('/models/seat_high_detail.glb', (gltf) => {
        if (disposed) return;
        const sh: THREE.BufferGeometry[] = [];
        const fr: THREE.BufferGeometry[] = [];
        const hw: THREE.BufferGeometry[] = [];
        gltf.scene.traverse((ch) => {
          if ((ch as THREE.Mesh).isMesh) {
            const m = ch as THREE.Mesh;
            const g = m.geometry.clone();
            m.updateWorldMatrix(true, false);
            g.applyMatrix4(m.matrixWorld);
            if (g.attributes.uv && !g.attributes.uv2) {
              g.setAttribute('uv2', g.attributes.uv);
            }
            if (m.name.includes('Hardware')) hw.push(g);
            else if (m.name.includes('Frame')) fr.push(g);
            else sh.push(g);
          }
        });
        if (sh.length && heroShellMeshRef.current && heroStatusAttrRef.current) {
          const m = BufferGeometryUtils.mergeGeometries(sh, false);
          m.computeVertexNormals();
          lodGeosRef.current.lod0Shell = m;
          heroShellMeshRef.current.geometry = makeChunkWrappedGeo(m, heroStatusAttrRef.current);
        }
        if (fr.length && heroFrameMeshRef.current) {
          const m = BufferGeometryUtils.mergeGeometries(fr, false);
          m.computeVertexNormals();
          lodGeosRef.current.lod0Frame = m;
          heroFrameMeshRef.current.geometry.dispose();
          heroFrameMeshRef.current.geometry = m;
        }
        if (hw.length && heroHwMeshRef.current) {
          const m = BufferGeometryUtils.mergeGeometries(hw, false);
          m.computeVertexNormals();
          lodGeosRef.current.lod0Hw = m;
          heroHwMeshRef.current.geometry.dispose();
          heroHwMeshRef.current.geometry = m;
        }
        requestRender();
      });
    }

    // 5C. Proportioned Seated Spectator GLB
    gltfLoader.load(
      '/models/spectator_crowd.glb',
      (gltf) => {
        if (disposed) return;
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh;
            const clonedGeo = m.geometry.clone();
            m.updateWorldMatrix(true, false);
            clonedGeo.applyMatrix4(m.matrixWorld);
            clonedGeo.computeVertexNormals();

            if (m.name.includes('Jersey') && crowdJerseyMeshRef.current) {
              crowdJerseyMeshRef.current.geometry.dispose();
              crowdJerseyMeshRef.current.geometry = clonedGeo;
            } else if (m.name.includes('Body') && crowdBodyMeshRef.current) {
              crowdBodyMeshRef.current.geometry.dispose();
              crowdBodyMeshRef.current.geometry = clonedGeo;
            }
          }
        });
        requestRender();
      },
      undefined,
      (err) => {
        console.error('Error loading /models/spectator_crowd.glb:', err);
      }
    );

    // Cached Chunk LOD & LOD0 Hero Promotion Update (skips scan when camera moved < 0.25m)
    let lastLodPreset = '';
    let lastLodMode = '';
    const updateDynamicLods = () => {
      const runtimes = chunkRuntimesRef.current;
      if (runtimes.length === 0) return;

      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      const preset = stateRef.current.qualityPreset;
      const mode = stateRef.current.cameraMode;

      const camMovedSq =
        (cx - _lastLodCamPos.x) * (cx - _lastLodCamPos.x) +
        (cy - _lastLodCamPos.y) * (cy - _lastLodCamPos.y) +
        (cz - _lastLodCamPos.z) * (cz - _lastLodCamPos.z);

      if (
        !lodDirtyRef.current &&
        camMovedSq < 0.0625 &&
        lastLodPreset === preset &&
        lastLodMode === mode
      ) {
        return;
      }

      lodDirtyRef.current = false;
      _lastLodCamPos.set(cx, cy, cz);
      lastLodPreset = preset;
      lastLodMode = mode;

      const geos = lodGeosRef.current;
      const cfg = QUALITY_PRESET_CONFIGS[preset];

      // 1. Update each of the 24 spatial chunks' active LOD
      for (let i = 0; i < runtimes.length; i++) {
        const rt = runtimes[i];
        let targetLod = selectChunkLod(
          cx,
          cy,
          cz,
          rt.chunk.boundingSphere,
          preset,
          isSoftwareGl
        );

        if (targetLod === 'LOD1' && !geos.lod1Shell) targetLod = 'LOD2';
        if (targetLod === 'LOD2' && !geos.lod2Shell) targetLod = 'LOD3';
        if (targetLod === 'LOD3' && !geos.lod3Shell && geos.lod2Shell) {
          targetLod = 'LOD2';
        }

        if (rt.currentLod !== targetLod) {
          rt.currentLod = targetLod;
          if (targetLod === 'LOD1' && rt.wrappedGeos.LOD1) {
            rt.shellMesh.geometry = rt.wrappedGeos.LOD1;
            rt.frameMesh.instanceMatrix.array.set(rt.shellMesh.instanceMatrix.array);
            rt.frameMesh.instanceMatrix.needsUpdate = true;
            rt.hwMesh.instanceMatrix.array.set(rt.shellMesh.instanceMatrix.array);
            rt.hwMesh.instanceMatrix.needsUpdate = true;
            rt.frameMesh.visible = true;
            rt.hwMesh.visible = true;
          } else if (targetLod === 'LOD2' && rt.wrappedGeos.LOD2) {
            rt.shellMesh.geometry = rt.wrappedGeos.LOD2;
            rt.frameMesh.visible = false;
            rt.hwMesh.visible = false;
          } else if (rt.wrappedGeos.LOD3) {
            rt.shellMesh.geometry = rt.wrappedGeos.LOD3;
            rt.frameMesh.visible = false;
            rt.hwMesh.visible = false;
          }
        }

        rt.shellMesh.castShadow =
          !isSoftwareGl &&
          cfg.shadowsEnabled &&
          ((rt.currentLod === 'LOD1' && cfg.seatsCastShadowLod1) ||
            (rt.currentLod === 'LOD2' && cfg.seatsCastShadowLod2));
      }

      // 2. Hardware GPU Hero LOD0 Pool (nearest seats within 7.5m on HIGH/ULTRA)
      const heroShell = heroShellMeshRef.current;
      const heroFrame = heroFrameMeshRef.current;
      const heroHw = heroHwMeshRef.current;
      if (
        !isSoftwareGl &&
        heroShell &&
        heroFrame &&
        heroHw &&
        geos.lod0Shell &&
        cfg.useHeroLod0Pool &&
        cfg.heroPoolMax > 0
      ) {
        const prevPromoted = heroPromotedSlotsRef.current;
        for (let p = 0; p < prevPromoted.length; p++) {
          const slot = prevPromoted[p];
          const rt = runtimes[slot.chunkIdx];
          const sub = rt?.chunk.seats[slot.localIdx];
          if (rt && sub) {
            const hideSelf =
              mode === 'SEAT_VIEW' &&
              stateRef.current.focusedSeat?.id === sub.seatId &&
              sub.isCenterAnchor;
            _dummy.position.set(sub.posX, sub.posY, sub.posZ);
            _dummy.rotation.set(0, sub.rotY, 0);
            _dummy.scale.setScalar(hideSelf ? 0.0001 : 1);
            _dummy.updateMatrix();
            rt.shellMesh.setMatrixAt(slot.localIdx, _dummy.matrix);
            rt.shellMesh.instanceMatrix.needsUpdate = true;
          }
        }
        prevPromoted.length = 0;

        const candidates: Array<{ distSq: number; chunkIdx: number; localIdx: number }> = [];
        for (let c = 0; c < runtimes.length; c++) {
          const sp = runtimes[c].chunk.boundingSphere;
          const dCenter = Math.hypot(cx - sp.centerX, cy - sp.centerY, cz - sp.centerZ);
          if (dCenter - sp.radius > 9.0) continue;
          const chunkSeats = runtimes[c].chunk.seats;
          for (let s = 0; s < chunkSeats.length; s++) {
            const sub = chunkSeats[s];
            if (
              mode === 'SEAT_VIEW' &&
              stateRef.current.focusedSeat?.id === sub.seatId &&
              sub.isCenterAnchor
            ) {
              continue;
            }
            const dx = sub.posX - cx;
            const dy = sub.posY + 0.5 - cy;
            const dz = sub.posZ - cz;
            const dSq = dx * dx + dy * dy + dz * dz;
            if (dSq <= 56.25) {
              candidates.push({ distSq: dSq, chunkIdx: c, localIdx: s });
            }
          }
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => a.distSq - b.distSq);
          const count = Math.min(cfg.heroPoolMax, candidates.length);
          const invMap = stateRef.current.inventoryBySeatId;
          const selSet = new Set(stateRef.current.selectedSeatIds);
          const hovId = stateRef.current.hoveredSeat?.id ?? null;
          const focId = stateRef.current.focusedSeat?.id ?? null;

          for (let i = 0; i < count; i++) {
            const cand = candidates[i];
            const rt = runtimes[cand.chunkIdx];
            const sub = rt.chunk.seats[cand.localIdx];

            _dummy.position.set(sub.posX, sub.posY, sub.posZ);
            _dummy.rotation.set(0, sub.rotY, 0);
            _dummy.scale.setScalar(1);
            _dummy.updateMatrix();
            heroShell.setMatrixAt(i, _dummy.matrix);
            heroFrame.setMatrixAt(i, _dummy.matrix);
            heroHw.setMatrixAt(i, _dummy.matrix);

            const inv = invMap[sub.seatId];
            const status = inv?.status || 'AVAILABLE';
            const isSel = selSet.has(sub.seatId);
            const descriptor = resolveSeatAvailabilityStatus({
              rawStatus: inv?.status,
              holdUserId: inv?.holdUserId,
              holdToken: inv?.holdToken,
              holdExpiresAt: inv?.holdExpiresAt,
              currentUserId: stateRef.current.currentUserId ?? null,
              activeHoldToken: stateRef.current.activeHold?.holdToken ?? null,
              isSelected: isSel,
            });
            if (heroStatusAttrRef.current) {
              (heroStatusAttrRef.current.array as Float32Array)[i] = descriptor.shaderStateCode;
            }
            const vis = computeSeatVisualHex({
              seat: sub,
              status,
              isHovered: hovId === sub.seatId,
              isSelected: isSel,
              isFocused: focId === sub.seatId,
              matchesFilter: true,
            });
            _color.set(vis.hex).multiplyScalar(vis.brightnessMultiplier);
            heroShell.setColorAt(i, _color);

            _dummy.scale.setScalar(0.0001);
            _dummy.updateMatrix();
            rt.shellMesh.setMatrixAt(cand.localIdx, _dummy.matrix);
            rt.shellMesh.instanceMatrix.needsUpdate = true;
            prevPromoted.push({ chunkIdx: cand.chunkIdx, localIdx: cand.localIdx });
          }

          if (heroStatusAttrRef.current) heroStatusAttrRef.current.needsUpdate = true;

          heroShell.count = count;
          heroFrame.count = count;
          heroHw.count = count;
          heroShell.visible = true;
          heroFrame.visible = true;
          heroHw.visible = true;
          heroShell.instanceMatrix.needsUpdate = true;
          heroFrame.instanceMatrix.needsUpdate = true;
          heroHw.instanceMatrix.needsUpdate = true;
          if (heroShell.instanceColor) heroShell.instanceColor.needsUpdate = true;
        } else {
          heroShell.visible = false;
          heroFrame.visible = false;
          heroHw.visible = false;
        }
      } else if (heroShell && heroFrame && heroHw) {
        if (heroPromotedSlotsRef.current.length > 0) {
          for (const slot of heroPromotedSlotsRef.current) {
            const rt = runtimes[slot.chunkIdx];
            const sub = rt?.chunk.seats[slot.localIdx];
            if (rt && sub) {
              _dummy.position.set(sub.posX, sub.posY, sub.posZ);
              _dummy.rotation.set(0, sub.rotY, 0);
              _dummy.scale.setScalar(1);
              _dummy.updateMatrix();
              rt.shellMesh.setMatrixAt(slot.localIdx, _dummy.matrix);
              rt.shellMesh.instanceMatrix.needsUpdate = true;
            }
          }
          heroPromotedSlotsRef.current.length = 0;
        }
        heroShell.visible = false;
        heroFrame.visible = false;
        heroHw.visible = false;
      }
    };

    // Keyboard WASD / Arrow / Q-E navigation for FREE_FLY mode
    const keysPressed = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      keysPressed.add(e.code);
      if (
        useStadiumStore.getState().introPlaying &&
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'KeyQ',
          'KeyE',
          'Space',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Escape',
        ].includes(e.code)
      ) {
        useStadiumStore.getState().setIntroPlaying(false);
      }
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'KeyQ',
          'KeyE',
          'Space',
          'ShiftLeft',
          'ShiftRight',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(e.code)
      ) {
        requestRender();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysPressed.delete(e.code);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    controls.addEventListener('start', () => {
      if (stateRef.current.cameraMode !== 'SEAT_VIEW') {
        cameraTransitionActiveRef.current = false;
        zoomImpulseRef.current = 0;
      }
    });
    controls.addEventListener('change', () => {
      requestRender();
    });

    // Software-WebGL-Safe & Low-Latency Render Pacing Loop
    let frameId = 0;
    let timeoutId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();
    let tourAngle = 0;
    let introElapsed = 0;
    let lastRadarEmit = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      if (gl.flush) gl.flush();
      if (!sync) {
        timeoutId = window.setTimeout(cb, 16);
        return;
      }
      const poll = () => {
        if (disposed) {
          gl.deleteSync(sync);
          return;
        }
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          timeoutId = window.setTimeout(poll, 4);
        } else {
          gl.deleteSync(sync);
          timeoutId = window.setTimeout(cb, 16);
        }
      };
      timeoutId = window.setTimeout(poll, 4);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;

        const mode = stateRef.current.cameraMode;
        let needsNextFrame = false;

        // Smooth Roof Visibility Transition (SOLID=0.86 translucent PTFE, XRAY=0.24, HIDDEN=0.0)
        const targetRoofOp =
          stateRef.current.roofMode === 'SOLID'
            ? 0.86
            : stateRef.current.roofMode === 'XRAY'
            ? 0.24
            : 0.0;
        if (Math.abs(roofOpacityRef.current - targetRoofOp) > 0.015) {
          const stepAlpha = isSoftwareGl ? 1.0 : 1 - Math.exp(-9.0 * Math.max(0.016, dt));
          roofOpacityRef.current += (targetRoofOp - roofOpacityRef.current) * stepAlpha;
          if (Math.abs(roofOpacityRef.current - targetRoofOp) <= 0.015) {
            roofOpacityRef.current = targetRoofOp;
          } else {
            needsNextFrame = true;
          }
        } else {
          roofOpacityRef.current = targetRoofOp;
        }

        const rOp = roofOpacityRef.current;
        let roofShadowDirty = false;
        for (let i = 0; i < roofMeshesRef.current.length; i++) {
          const m = roofMeshesRef.current[i];
          const nextVis = rOp > 0.02;
          if (m.visible !== nextVis) {
            m.visible = nextVis;
            roofShadowDirty = true;
          }
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat) {
            const needTrans = rOp < 0.99;
            const wantDepthWrite = rOp > 0.6;
            if (mat.transparent !== needTrans || mat.depthWrite !== wantDepthWrite) {
              mat.transparent = needTrans;
              mat.depthWrite = wantDepthWrite;
              mat.needsUpdate = true;
              roofShadowDirty = true;
            }
            if (Math.abs(mat.opacity - rOp) > 0.005) {
              mat.opacity = rOp;
            }
          }
        }
        for (let i = 0; i < trussMeshesRef.current.length; i++) {
          const tm = trussMeshesRef.current[i];
          const tOp = rOp <= 0.02 ? 0.0 : Math.min(1.0, rOp + 0.16);
          const nextVis = tOp > 0.02;
          if (tm.visible !== nextVis) {
            tm.visible = nextVis;
            roofShadowDirty = true;
          }
          const mat = tm.material as THREE.MeshStandardMaterial;
          if (mat) {
            const needTrans = tOp < 0.99;
            if (mat.transparent !== needTrans) {
              mat.transparent = needTrans;
              mat.depthWrite = !needTrans;
              mat.needsUpdate = true;
              roofShadowDirty = true;
            }
            if (Math.abs(mat.opacity - tOp) > 0.005) {
              mat.opacity = tOp;
            }
          }
        }
        if (roofShadowDirty) {
          renderer.shadowMap.needsUpdate = true;
        }

        // Advance crowd cheer, flag flutter & held-seat pulse timer on hardware GPU (or active hold on software)
        crowdTimeUniformRef.current.value += dt;
        seatStatusTimeUniformRef.current.value += dt;
        if (!isSoftwareGl && (stateRef.current.qualityPreset !== 'LOW' || hasAnyHeldRef.current)) {
          needsNextFrame = true;
        }

        // Cinematic Aerial Entry Intro (3.4s swoop, immediately cancellable)
        if (stateRef.current.introPlaying && mode === 'ORBIT') {
          introElapsed += Math.max(0.016, dt);
          const dur = isSoftwareGl ? 1.8 : 3.4;
          const tNorm = Math.min(1.0, introElapsed / dur);
          const ease = 1 - Math.pow(1 - tNorm, 3);
          camera.position.set(
            THREE.MathUtils.lerp(-28, 0, ease),
            THREE.MathUtils.lerp(72, 56, ease),
            THREE.MathUtils.lerp(118, 86, ease)
          );
          controls.target.set(0, 4, THREE.MathUtils.lerp(4, -8, ease));
          controls.update();
          if (tNorm >= 1.0) {
            useStadiumStore.getState().setIntroPlaying(false);
          } else {
            needsNextFrame = true;
          }
        } else if (mode === 'TOUR') {
          tourAngle += dt * 0.28;
          camera.position.set(
            Math.sin(tourAngle) * 112,
            34 + Math.sin(tourAngle * 2) * 12,
            Math.cos(tourAngle) * 102
          );
          camera.lookAt(0, 6, 0);
          controls.target.set(0, 6, 0);
          needsNextFrame = true;
        } else if (mode === 'FREE_FLY') {
          const baseFlySpeed = useStadiumStore.getState().freeFlySpeedMps;
          const boost =
            keysPressed.has('ShiftLeft') || keysPressed.has('ShiftRight') ? 1.75 : 1.0;
          const moveDist = baseFlySpeed * boost * dt;

          _flyEuler.set(flyStateRef.current.pitch, flyStateRef.current.yaw, 0, 'YXZ');
          camera.quaternion.setFromEuler(_flyEuler);
          camera.getWorldDirection(_forwardVec).normalize();
          _rightVec.crossVectors(_forwardVec, _upVec).normalize();

          const prevY = camera.position.y;
          let moved = false;

          if (keysPressed.has('KeyW') || keysPressed.has('ArrowUp')) {
            camera.position.addScaledVector(_forwardVec, moveDist);
            moved = true;
          }
          if (keysPressed.has('KeyS') || keysPressed.has('ArrowDown')) {
            camera.position.addScaledVector(_forwardVec, -moveDist);
            moved = true;
          }
          if (keysPressed.has('KeyA') || keysPressed.has('ArrowLeft')) {
            camera.position.addScaledVector(_rightVec, -moveDist);
            moved = true;
          }
          if (keysPressed.has('KeyD') || keysPressed.has('ArrowRight')) {
            camera.position.addScaledVector(_rightVec, moveDist);
            moved = true;
          }
          if (keysPressed.has('KeyE') || keysPressed.has('Space')) {
            camera.position.y += moveDist * 0.75;
            moved = true;
          }
          if (keysPressed.has('KeyQ')) {
            camera.position.y -= moveDist * 0.75;
            moved = true;
          }

          if (moved) {
            const [cx, cy, cz] = clampStadiumCameraPosition(
              camera.position.x,
              camera.position.y,
              camera.position.z,
              prevY
            );
            camera.position.set(cx, cy, cz);
            needsNextFrame = true;
          }
          controls.target.copy(camera.position).addScaledVector(_forwardVec, 35);
        } else if (mode === 'SEAT_VIEW') {
          const fly = seatFlyAnimRef.current;
          if (fly.active) {
            const rawT = (now - fly.startMs) / Math.max(250, fly.durationMs);
            const t = Math.min(1.0, Math.max(0.0, rawT));
            const ease =
              t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

            camera.position.lerpVectors(fly.fromPos, fly.toPos, ease);
            if (fly.midArcLift > 0.01 && t < 1.0) {
              camera.position.y += Math.sin(t * Math.PI) * fly.midArcLift;
              const minSurfY =
                estimateStadiumSurfaceY(camera.position.x, camera.position.z) + 1.15;
              if (camera.position.y < minSurfY) {
                camera.position.y = minSurfY;
              }
            }
            _currentLookAt.lerpVectors(fly.fromLook, fly.toLook, ease);
            const nextFov = THREE.MathUtils.lerp(fly.fromFov, fly.toFov, ease);
            if (Math.abs(camera.fov - nextFov) > 0.05) {
              camera.fov = nextFov;
              camera.updateProjectionMatrix();
            }
            camera.lookAt(_currentLookAt);
            if (t >= 1.0) {
              camera.position.copy(fly.toPos);
              _currentLookAt.copy(fly.toLook);
              camera.fov = fly.toFov;
              camera.updateProjectionMatrix();
              camera.lookAt(_currentLookAt);
              fly.active = false;
            } else {
              needsNextFrame = true;
            }
          } else {
            camera.position.copy(_targetCamPos);
            _currentLookAt.copy(_targetLookAt);
            camera.lookAt(_currentLookAt);
          }
        } else if (exitFlyAnimRef.current.active) {
          const ex = exitFlyAnimRef.current;
          const rawT = (now - ex.startMs) / Math.max(250, ex.durationMs);
          const t = Math.min(1.0, Math.max(0.0, rawT));
          const ease =
            t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          camera.position.lerpVectors(ex.fromPos, ex.toPos, ease);
          const distEx = ex.fromPos.distanceTo(ex.toPos);
          if (distEx > 10 && t < 1.0) {
            camera.position.y += Math.sin(t * Math.PI) * Math.min(8, distEx * 0.07);
          }
          controls.target.lerpVectors(ex.fromLook, ex.toLook, ease);
          const nextFov = THREE.MathUtils.lerp(ex.fromFov, ex.toFov, ease);
          if (Math.abs(camera.fov - nextFov) > 0.05) {
            camera.fov = nextFov;
            camera.updateProjectionMatrix();
          }
          camera.lookAt(controls.target);
          if (t >= 1.0) {
            camera.position.copy(ex.toPos);
            controls.target.copy(ex.toLook);
            camera.fov = ex.toFov;
            camera.updateProjectionMatrix();
            controls.update();
            ex.active = false;
          } else {
            needsNextFrame = true;
          }
        } else if (cameraTransitionActiveRef.current) {
          const alpha = 1 - Math.exp(-6.8 * dt);
          camera.position.lerp(_targetCamPos, alpha);
          controls.target.lerp(_targetLookAt, alpha);
          controls.update();
          if (
            camera.position.distanceToSquared(_targetCamPos) < 0.25 &&
            controls.target.distanceToSquared(_targetLookAt) < 0.25
          ) {
            camera.position.copy(_targetCamPos);
            controls.target.copy(_targetLookAt);
            controls.update();
            cameraTransitionActiveRef.current = false;
          } else {
            needsNextFrame = true;
          }
        } else {
          // Process smooth damped cursor-ray zoom before OrbitControls.update()
          if (Math.abs(zoomImpulseRef.current) > 0.35) {
            const prevY = camera.position.y;
            const stepDt = Math.max(0.014, dt);
            const zoomScale = 0.00185;
            const maxSlice = 0.42 / zoomScale; // ~227 impulse units per frame so zero scroll delta is discarded
            const rawSlice = zoomImpulseRef.current * (1 - Math.exp(-16.0 * stepDt));
            const slice = THREE.MathUtils.clamp(rawSlice, -maxSlice, maxSlice);
            zoomImpulseRef.current -= slice;

            const dollyFactor = Math.exp(slice * zoomScale);

            if (dollyFactor < 0.9999) {
              _ndcPointer.set(zoomCursorNdcRef.current.x, zoomCursorNdcRef.current.y);
              _zoomRaycaster.setFromCamera(_ndcPointer, camera);
              const curTargetDist = camera.position.distanceTo(controls.target);
              const hit = intersectStadiumCursorRay(
                _zoomRaycaster.ray.origin.x,
                _zoomRaycaster.ray.origin.y,
                _zoomRaycaster.ray.origin.z,
                _zoomRaycaster.ray.direction.x,
                _zoomRaycaster.ray.direction.y,
                _zoomRaycaster.ray.direction.z,
                curTargetDist,
                DEFAULT_STADIUM_SPEC
              );
              _zoomHitVec.set(hit.x, hit.y, hit.z);
              const distToHit = camera.position.distanceTo(_zoomHitVec);

              if (distToHit > 3.25) {
                // If target was very close while zooming toward a distant stand, extend target straight along look dir (zero rotation!)
                if (curTargetDist < 12 && distToHit > 16) {
                  _zoomOffsetVec.subVectors(controls.target, camera.position);
                  if (_zoomOffsetVec.lengthSq() > 1e-6) {
                    _zoomOffsetVec.normalize();
                    controls.target
                      .copy(camera.position)
                      .addScaledVector(_zoomOffsetVec, Math.min(distToHit, 48));
                  }
                }

                const maxF = Math.max(0, 1 - 3.2 / distToHit);
                const f = Math.min(0.65, 1 - dollyFactor, maxF);
                if (f > 1e-5) {
                  // Equal lerp of both position and target guarantees P' - T' = (1 - f)(P - T) -> 0.000 deg unwanted rotation!
                  camera.position.lerp(_zoomHitVec, f);
                  controls.target.lerp(_zoomHitVec, f);
                  const [cx, cy, cz] = clampStadiumCameraPosition(
                    camera.position.x,
                    camera.position.y,
                    camera.position.z,
                    prevY,
                    hit.y
                  );
                  camera.position.set(cx, cy, cz);
                }
              }
            } else if (dollyFactor > 1.0001) {
              _zoomOffsetVec.subVectors(camera.position, controls.target);
              const curDist = _zoomOffsetVec.length();
              if (curDist > 1e-4) {
                const nextDist = Math.min(285, Math.max(3.2, curDist * dollyFactor));
                _zoomOffsetVec.normalize().multiplyScalar(nextDist);
                camera.position.copy(controls.target).add(_zoomOffsetVec);
                const [cx, cy, cz] = clampStadiumCameraPosition(
                  camera.position.x,
                  camera.position.y,
                  camera.position.z,
                  prevY
                );
                camera.position.set(cx, cy, cz);
              }
            }

            if (Math.abs(zoomImpulseRef.current) > 0.35) {
              needsNextFrame = true;
            } else {
              zoomImpulseRef.current = 0;
            }
          }

          controls.update();
          controls.target.y = Math.max(0.2, controls.target.y);
          let [cx, cy, cz] = clampStadiumCameraPosition(
            camera.position.x,
            camera.position.y,
            camera.position.z,
            camera.position.y,
            controls.target.y
          );
          // Prevent STAND_FOCUS orbit from slipping behind concrete bowl facade (d > 31m) at low altitude
          if (mode === 'STAND_FOCUS') {
            const dWall = computeBowlRadialOffsetM(cx, cz, DEFAULT_STADIUM_SPEC);
            if (dWall > 31.2 && cy < 26.0) {
              cy = 26.0;
            }
          }
          if (
            Math.abs(cx - camera.position.x) > 0.001 ||
            Math.abs(cy - camera.position.y) > 0.001 ||
            Math.abs(cz - camera.position.z) > 0.001
          ) {
            camera.position.set(cx, cy, cz);
            controls.update();
          }
        }

        updateDynamicLods();
        const renderStartMs = performance.now();
        const activePresetCfg = QUALITY_PRESET_CONFIGS[stateRef.current.qualityPreset];
        const useBloom =
          !isSoftwareGl &&
          activePresetCfg.bloomEnabled &&
          Boolean(composerRef.current);
        if (useBloom && composerRef.current) {
          composerRef.current.render();
        } else {
          renderer.render(scene, camera);
        }
        const renderElapsedMs = performance.now() - renderStartMs;

        if (now - lastRadarEmit > 90) {
          lastRadarEmit = now;
          camera.getWorldDirection(_forwardVec);
          const yawDeg = (Math.atan2(_forwardVec.x, -_forwardVec.z) * 180) / Math.PI;
          window.dispatchEvent(
            new CustomEvent('stadiumx:camera-radar', {
              detail: { x: camera.position.x, z: camera.position.z, yawDeg },
            })
          );
        }

        // Publish lightweight silent telemetry snapshot for external profiling & regression checks
        const runtimes = chunkRuntimesRef.current;
        const seatGroupVis = seatGroupRef.current?.visible ?? true;
        let lod1Count = 0;
        let lod2Count = 0;
        let lod3Count = 0;
        let visibleSeatInstances = 0;
        let visibleSeatBlockCount = 0;
        for (let i = 0; i < runtimes.length; i++) {
          const rt = runtimes[i];
          if (rt.currentLod === 'LOD1') lod1Count++;
          else if (rt.currentLod === 'LOD2') lod2Count++;
          else lod3Count++;
          if (seatGroupVis && rt.shellMesh.visible && rt.shellMesh.count > 0) {
            visibleSeatInstances += rt.shellMesh.count;
            visibleSeatBlockCount++;
          }
        }
        (window as any).__STADIUMX_PERF__ = {
          mountCount: canvasMountCounter,
          disposedCount: canvasDisposeCounter,
          instancedMeshCount: seatGroupRef.current?.children.length ?? 0,
          visibleSeatBlockCount,
          seatInstanceVisibility: seatGroupVis,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          qualityPreset: stateRef.current.qualityPreset,
          isSoftwareGl,
          dpr: renderer.getPixelRatio(),
          cameraMode: mode,
          seatFlyActive:
            seatFlyAnimRef.current.active || exitFlyAnimRef.current.active,
          fov: camera.fov,
          cameraPos: [
            Number(camera.position.x.toFixed(2)),
            Number(camera.position.y.toFixed(2)),
            Number(camera.position.z.toFixed(2)),
          ],
          targetPos: [
            Number(controls.target.x.toFixed(2)),
            Number(controls.target.y.toFixed(2)),
            Number(controls.target.z.toFixed(2)),
          ],
          cameraDist: Number(camera.position.distanceTo(controls.target).toFixed(2)),
          freeFlySpeedMps: useStadiumStore.getState().freeFlySpeedMps,
          visibleSeatInstances,
          crowdCount: crowdJerseyMeshRef.current?.count ?? 0,
          lodCounts: {
            LOD0: heroShellMeshRef.current?.visible ? heroShellMeshRef.current.count : 0,
            LOD1: lod1Count,
            LOD2: lod2Count,
            LOD3: lod3Count,
          },
          lastFrameRenderMs: Number(renderElapsedMs.toFixed(2)),
        };

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsNextFrame) {
            requestRender();
          }
        };

        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    }

    requestRenderRef.current = requestRender;
    requestRender();

    // Chunk-Scoped Raycasting, Free-Fly Mouse Look, & Direct Seat-View Look Controls
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastHoverCheck = 0;
    let isDraggingSeatLook = false;
    let isDraggingFlyLook = false;
    let pointerDownPos = { x: 0, y: 0 };
    let seatDragStartPos = { x: 0, y: 0, yaw: 0, pitch: 0 };
    let flyDragStartPos = { x: 0, y: 0, yaw: 0, pitch: 0 };

    const pickClosestSeatAnchor = (clientX: number, clientY: number): StaticSeatRecord | null => {
      const spatialIdx = spatialIndexRef.current;
      const runtimes = chunkRuntimesRef.current;
      if (!spatialIdx || runtimes.length === 0 || stateRef.current.seats.length === 0) {
        return null;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const candidateChunks: Array<{ rt: ChunkRuntime; sphereDist: number }> = [];
      for (let i = 0; i < runtimes.length; i++) {
        const rt = runtimes[i];
        if (raycaster.ray.intersectSphere(rt.boundingSphere, _rayHitVec)) {
          candidateChunks.push({
            rt,
            sphereDist: camera.position.distanceToSquared(_rayHitVec),
          });
        }
      }
      if (candidateChunks.length === 0) return null;

      candidateChunks.sort((a, b) => a.sphereDist - b.sphereDist);

      let bestDist = Infinity;
      let bestAnchor: StaticSeatRecord | null = null;
      const allSeats = stateRef.current.seats;

      for (let i = 0; i < candidateChunks.length; i++) {
        const { rt } = candidateChunks[i];
        const hits = raycaster.intersectObject(rt.shellMesh, false);
        if (hits.length > 0 && hits[0].instanceId !== undefined) {
          if (hits[0].distance < bestDist) {
            const subSeat = rt.chunk.seats[hits[0].instanceId];
            if (subSeat) {
              bestDist = hits[0].distance;
              bestAnchor = allSeats[subSeat.anchorIdx] || null;
              break;
            }
          }
        }
      }

      return bestAnchor;
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (tooltipRef.current) {
        const tx = Math.min(window.innerWidth - 280, Math.max(16, px + 18));
        const ty = Math.min(window.innerHeight - 160, Math.max(16, py - 18));
        tooltipRef.current.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      }

      if (stateRef.current.cameraMode === 'SEAT_VIEW') {
        if (isDraggingSeatLook) {
          const dx = e.clientX - seatDragStartPos.x;
          const dy = e.clientY - seatDragStartPos.y;
          useStadiumStore
            .getState()
            .setSeatViewLook(
              seatDragStartPos.yaw - dx * 0.18,
              seatDragStartPos.pitch + dy * 0.14
            );
        }
        return;
      }

      if (stateRef.current.cameraMode === 'FREE_FLY' && isDraggingFlyLook) {
        const dx = e.clientX - flyDragStartPos.x;
        const dy = e.clientY - flyDragStartPos.y;
        flyStateRef.current.yaw = flyDragStartPos.yaw - dx * 0.0042;
        flyStateRef.current.pitch = THREE.MathUtils.clamp(
          flyDragStartPos.pitch - dy * 0.0038,
          -1.42,
          1.42
        );
        _flyEuler.set(flyStateRef.current.pitch, flyStateRef.current.yaw, 0, 'YXZ');
        camera.quaternion.setFromEuler(_flyEuler);
        lodDirtyRef.current = true;
        requestRender();
        return;
      }

      const now = performance.now();
      if (now - lastHoverCheck < 50) return;
      lastHoverCheck = now;

      const seat = pickClosestSeatAnchor(e.clientX, e.clientY);
      if (seat) {
        if (stateRef.current.hoveredSeat?.id !== seat.id) {
          useStadiumStore.getState().setHoveredSeat(seat);
          renderer.domElement.style.cursor = 'pointer';
        }
      } else if (stateRef.current.hoveredSeat) {
        useStadiumStore.getState().setHoveredSeat(null);
        renderer.domElement.style.cursor = 'grab';
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (useStadiumStore.getState().introPlaying) {
        useStadiumStore.getState().setIntroPlaying(false);
      }
      pointerDownPos = { x: e.clientX, y: e.clientY };
      if (stateRef.current.cameraMode === 'SEAT_VIEW') {
        isDraggingSeatLook = true;
        seatDragStartPos = {
          x: e.clientX,
          y: e.clientY,
          yaw: stateRef.current.seatViewYawOffsetDeg,
          pitch: stateRef.current.seatViewPitchOffsetDeg,
        };
        renderer.domElement.style.cursor = 'grabbing';
      } else if (stateRef.current.cameraMode === 'FREE_FLY') {
        isDraggingFlyLook = true;
        flyDragStartPos = {
          x: e.clientX,
          y: e.clientY,
          yaw: flyStateRef.current.yaw,
          pitch: flyStateRef.current.pitch,
        };
        renderer.domElement.style.cursor = 'grabbing';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (stateRef.current.cameraMode === 'SEAT_VIEW') {
        isDraggingSeatLook = false;
        renderer.domElement.style.cursor = 'grab';
      } else if (isDraggingFlyLook) {
        isDraggingFlyLook = false;
        renderer.domElement.style.cursor = 'grab';
      }

      const moveDist = Math.hypot(
        e.clientX - pointerDownPos.x,
        e.clientY - pointerDownPos.y
      );
      if (moveDist > 6) return;

      const seat = pickClosestSeatAnchor(e.clientX, e.clientY);
      if (seat) {
        const st = useStadiumStore.getState();
        // If clicking our own currently viewed seat while already inside SEAT_VIEW, gently re-center view
        if (st.cameraMode === 'SEAT_VIEW' && st.focusedSeat?.id === seat.id) {
          st.setSeatViewLook(0, 0, 64);
          return;
        }
        const entered = st.selectAndInspectSeat(seat);
        if (entered) {
          soundEngine.playChime('select');
          // Non-blocking backend inventory revalidation
          fetch(`/api/matches/${st.activeMatchId}/inventory`)
            .then((r) => (r.ok ? r.json() : null))
            .then((invJson) => {
              if (!invJson?.inventory || !invJson?.pricing) return;
              const live = useStadiumStore.getState();
              live.setMatchInventory(invJson.inventory, invJson.pricing);
              const fresh = invJson.inventory.find((x: any) => x.seatId === seat.id);
              if (
                fresh &&
                fresh.status !== 'AVAILABLE' &&
                !(
                  fresh.status === 'HELD' &&
                  ((live.activeHold?.holdToken &&
                    fresh.holdToken === live.activeHold.holdToken) ||
                    (live.currentUser.id && fresh.holdUserId === live.currentUser.id))
                )
              ) {
                live.setSelectedSeatIds(
                  live.selectedSeatIds.filter((id) => id !== seat.id)
                );
                live.showToast(
                  `Seat ${seat.seatCode} was just claimed (${fresh.status.toLowerCase()}).`,
                  'warning'
                );
                if (live.focusedSeat?.id === seat.id && live.cameraMode === 'SEAT_VIEW') {
                  live.exitSeatView();
                }
              }
            })
            .catch(() => {});
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (useStadiumStore.getState().introPlaying) {
        useStadiumStore.getState().setIntroPlaying(false);
      }

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 32;
      else if (e.deltaMode === 2) dy *= 160;
      if (Math.abs(dy) < 0.01) return;

      const mode = stateRef.current.cameraMode;
      if (mode === 'SEAT_VIEW') {
        const fovStep = Math.sign(dy) * Math.min(4.5, Math.max(0.5, Math.abs(dy) * 0.025));
        useStadiumStore
          .getState()
          .setSeatViewLook(
            stateRef.current.seatViewYawOffsetDeg,
            stateRef.current.seatViewPitchOffsetDeg,
            stateRef.current.seatViewFov + fovStep
          );
        return;
      }

      if (mode === 'FREE_FLY') {
        const curSpeed = useStadiumStore.getState().freeFlySpeedMps;
        const step = -Math.sign(dy) * Math.max(2, Math.min(8, Math.round(Math.abs(dy) * 0.04)));
        useStadiumStore.getState().setFreeFlySpeedMps(curSpeed + step);
        requestRender();
        return;
      }

      if (mode === 'TOUR') return;

      // ORBIT / STAND_FOCUS: smooth damped cursor-ray zoom (supports mouse wheel + trackpad ctrlKey pinch)
      cameraTransitionActiveRef.current = false;
      const rect = renderer.domElement.getBoundingClientRect();
      zoomCursorNdcRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      zoomCursorNdcRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const sensitivity = e.ctrlKey ? 2.4 : 1.0;
      zoomImpulseRef.current = THREE.MathUtils.clamp(
        zoomImpulseRef.current + dy * sensitivity,
        -1800,
        1800
      );
      requestRender();
    };

    const onPointerLeave = () => {
      if (stateRef.current.hoveredSeat) {
        useStadiumStore.getState().setHoveredSeat(null);
      }
      renderer.domElement.style.cursor = 'grab';
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false, capture: true });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composerRef.current) {
        composerRef.current.setSize(w, h);
      }
      requestRender();
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      canvasDisposeCounter += 1;
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('wheel', onWheel, { capture: true });
      controls.dispose();
      composerTarget?.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      data-blender-loaded={blenderAssetStatus.loaded ? 'true' : 'loading'}
      className="relative w-full h-full overflow-hidden select-none bg-[#0B0F17]"
    >
      {/* Dedicated WebGL Mount Container */}
      <div
        ref={canvasMountRef}
        data-testid="stadium-webgl-canvas"
        className="w-full h-full"
      />

      {/* Cinematic Entry Skip Intro Button */}
      {introPlaying && cameraMode === 'ORBIT' && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-full bg-[#0F172A]/90 border border-white/20 px-4 py-1.5 text-xs text-slate-200 shadow-2xl">
          <span className="font-medium text-emerald-300">Sovereign Arena · 360° Fly-In</span>
          <button
            type="button"
            onClick={() => setIntroPlaying(false)}
            className="px-2.5 py-0.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors"
          >
            Skip Intro
          </button>
        </div>
      )}

      {/* Hover Seat Tooltip (Rendered in isolated child so hover never re-renders StadiumCanvas3D) */}
      <SeatHoverTooltip tooltipRef={tooltipRef} />

      {/* Active Stadium Facility Hotspot Banner */}
      {activeHotspot && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-20 max-w-md rounded-lg bg-[#0F172A] border border-white/15 px-4 py-3 shadow-xl text-slate-100">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-semibold text-emerald-400">
              {activeHotspot.category} · {activeHotspot.label}
            </span>
            <button
              type="button"
              onClick={() => useStadiumStore.getState().setActiveHotspot(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-300 leading-relaxed">
            {activeHotspot.description}
          </p>
        </div>
      )}
    </div>
  );
};
