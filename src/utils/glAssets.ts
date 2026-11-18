import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  computeSeatVisualHex,
  type SeatSpatialChunk,
} from '../shared/seatingSpatial';

/**
 * Configures GLTFLoader with global in-memory asset cache + Draco & Meshopt decoders.
 */
export function createOptimizedGltfLoader(): {
  loader: GLTFLoader;
  dispose: () => void;
} {
  THREE.Cache.enabled = true;
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('/draco/');
  dracoLoader.preload();
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return {
    loader,
    dispose: () => {
      dracoLoader.dispose();
    },
  };
}

/**
 * Builds a single ultra-lean (~240-tri) curved row-strip BufferGeometry for a 1,400-seat chunk,
 * used beyond 150 m instead of 1,400 individual 3D seat instances while preserving exact
 * architectural stand/row color banding via vertex colors.
 */
export function buildChunkRowStripGeometry(chunk: SeatSpatialChunk): THREE.BufferGeometry {
  const rows = new Map<number, typeof chunk.seats>();
  for (let i = 0; i < chunk.seats.length; i++) {
    const s = chunk.seats[i];
    let arr = rows.get(s.rowNumber);
    if (!arr) {
      arr = [];
      rows.set(s.rowNumber, arr);
    }
    arr.push(s);
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const c = new THREE.Color();

  const pushQuad = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    nx: number,
    ny: number,
    nz: number,
    col: THREE.Color
  ) => {
    const base = positions.length / 3;
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    for (let k = 0; k < 4; k++) {
      normals.push(nx, ny, nz);
      colors.push(col.r, col.g, col.b);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (const [, rowSeats] of rows) {
    if (rowSeats.length < 2) continue;
    // Sort seats deterministically along row arc by seatNumber then subIdx
    rowSeats.sort((a, b) => a.seatNumber - b.seatNumber || a.subIdx - b.subIdx);

    // Sample up to 14 evenly-spaced control points per row -> smooth arc, ~260 tris/chunk total
    const step = Math.max(1, Math.floor(rowSeats.length / 12));
    const samples: typeof chunk.seats = [];
    for (let i = 0; i < rowSeats.length; i += step) {
      samples.push(rowSeats[i]);
    }
    if (samples[samples.length - 1] !== rowSeats[rowSeats.length - 1]) {
      samples.push(rowSeats[rowSeats.length - 1]);
    }

    for (let i = 0; i < samples.length - 1; i++) {
      const s0 = samples[i];
      const s1 = samples[i + 1];

      const midIdx = Math.min(rowSeats.length - 1, Math.floor((i * step + (i + 1) * step) * 0.5));
      const vis = computeSeatVisualHex({
        seat: rowSeats[midIdx] || s0,
        status: 'AVAILABLE',
        isHovered: false,
        isSelected: false,
        isFocused: false,
        matchesFilter: true,
      });
      c.set(vis.hex).multiplyScalar(vis.brightnessMultiplier);

      const fwdX0 = Math.sin(s0.rotY);
      const fwdZ0 = Math.cos(s0.rotY);
      const fwdX1 = Math.sin(s1.rotY);
      const fwdZ1 = Math.cos(s1.rotY);

      // Slanted backrest slab (0.42m..0.82m) + seat pan top (0.42m)
      const backBottomY0 = s0.posY + 0.40;
      const backTopY0 = s0.posY + 0.82;
      const backBottomY1 = s1.posY + 0.40;
      const backTopY1 = s1.posY + 0.82;

      pushQuad(
        s0.posX,
        backBottomY0,
        s0.posZ,
        s1.posX,
        backBottomY1,
        s1.posZ,
        s1.posX - fwdX1 * 0.05,
        backTopY1,
        s1.posZ - fwdZ1 * 0.05,
        s0.posX - fwdX0 * 0.05,
        backTopY0,
        s0.posZ - fwdZ0 * 0.05,
        (fwdX0 + fwdX1) * 0.5,
        0.2,
        (fwdZ0 + fwdZ1) * 0.5,
        c
      );

      // Seat pan upper horizontal strip
      pushQuad(
        s0.posX,
        backBottomY0,
        s0.posZ,
        s1.posX,
        backBottomY1,
        s1.posZ,
        s1.posX + fwdX1 * 0.34,
        backBottomY1,
        s1.posZ + fwdZ1 * 0.34,
        s0.posX + fwdX0 * 0.34,
        backBottomY0,
        s0.posZ + fwdZ0 * 0.34,
        0,
        1,
        0,
        c
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

const NON_MERGEABLE_MESH_KEYWORDS = [
  'Outfield_Turf_Field',
  'Cricket_Square',
  'Cricket_Pitch',
  'PTFE_Roof',
  'Roof_Steel_SpaceFrame_Trusses',
  'Scoreboard_Screens',
  'City_Skyline_Windows',
  'Floodlight_LED',
  'VIP_Hospitality_Warm_Lounges',
  'Perimeter_LED_Sponsor_Boards',
  'Glass',
  'Balustrade',
  'Seating_Bowl_Stepped_Tiers',
  'Boundary_',
];

/**
 * Merges static opaque meshes in stadium_venue.glb sharing material & shadow flags,
 * and culls far exterior skyline buildings beyond maxCityDistanceM (600 m).
 */
export function optimizeStaticVenueRoot(
  venueRoot: THREE.Object3D,
  maxCityDistanceM = 600
): { mergedGroups: number; culledCityMeshes: number } {
  venueRoot.updateMatrixWorld(true);
  const buckets = new Map<
    string,
    { material: THREE.Material; castShadow: boolean; receiveShadow: boolean; meshes: THREE.Mesh[] }
  >();
  let culledCityMeshes = 0;

  venueRoot.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const name = mesh.name || '';

    // Distance-cull far city props beyond 600 m from stadium center
    if (name.includes('City') || name.includes('Exterior_City') || name.includes('Skyline')) {
      mesh.geometry.computeBoundingSphere();
      const sphere = mesh.geometry.boundingSphere;
      if (sphere) {
        const worldCenter = sphere.center.clone().applyMatrix4(mesh.matrixWorld);
        if (Math.hypot(worldCenter.x, worldCenter.z) - sphere.radius > maxCityDistanceM) {
          mesh.visible = false;
          culledCityMeshes++;
          return;
        }
      }
    }

    if (NON_MERGEABLE_MESH_KEYWORDS.some((kw) => name.includes(kw))) {
      return;
    }

    const mat = mesh.material;
    if (!mat || Array.isArray(mat)) return;
    if ((mat as THREE.Material).transparent) return;
    if (!mesh.geometry || !mesh.geometry.attributes.position) return;

    const hasUv = Boolean(mesh.geometry.attributes.uv);
    const hasNormal = Boolean(mesh.geometry.attributes.normal);
    const key = `${mat.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}|${hasUv ? 1 : 0}|${hasNormal ? 1 : 0}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material: mat,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        meshes: [],
      };
      buckets.set(key, bucket);
    }
    bucket.meshes.push(mesh);
  });

  let mergedGroups = 0;
  for (const [, bucket] of buckets) {
    if (bucket.meshes.length < 2) continue;

    const prepared: THREE.BufferGeometry[] = [];
    for (const m of bucket.meshes) {
      let g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      if (g.index) {
        const nonIndexed = g.toNonIndexed();
        g.dispose();
        g = nonIndexed;
      }
      // Keep only consistent standard attributes so mergeGeometries succeeds cleanly
      for (const attr of Object.keys(g.attributes)) {
        if (attr !== 'position' && attr !== 'normal' && attr !== 'uv' && attr !== 'uv2') {
          g.deleteAttribute(attr);
        }
      }
      if (g.attributes.uv && !g.attributes.uv2) {
        g.setAttribute('uv2', g.attributes.uv);
      }
      if (!g.attributes.normal) {
        g.computeVertexNormals();
      }
      prepared.push(g);
    }

    const merged = BufferGeometryUtils.mergeGeometries(prepared, false);
    for (const pg of prepared) pg.dispose();
    if (!merged) continue;

    const mergedMesh = new THREE.Mesh(merged, bucket.material);
    mergedMesh.name = `MERGED_STATIC_VENUE_${mergedGroups}`;
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    venueRoot.add(mergedMesh);

    for (const oldMesh of bucket.meshes) {
      oldMesh.removeFromParent();
      oldMesh.geometry.dispose();
    }
    mergedGroups++;
  }

  return { mergedGroups, culledCityMeshes };
}

/**
 * Enforces runtime texture dimension budget (<= 2048 stadium shell, <= 1024 props/detail)
 * by downsampling oversized HTMLImageElements on upload cleanly.
 */
export function clampTextureMaxDimension(tex: THREE.Texture, maxDim: number): void {
  const img = tex.image as
    | { width?: number; height?: number }
    | undefined;
  if (!img || !img.width || !img.height) return;
  const maxSide = Math.max(img.width, img.height);
  if (maxSide <= maxDim || typeof document === 'undefined') return;

  const scale = maxDim / maxSide;
  const nextW = Math.max(1, Math.round(img.width * scale));
  const nextH = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = nextW;
  canvas.height = nextH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  try {
    ctx.drawImage(img as CanvasImageSource, 0, 0, nextW, nextH);
    tex.image = canvas;
    tex.needsUpdate = true;
  } catch {
    // Ignore tainted canvas sources safely
  }
}

/**
 * Full recursive WebGL disposal helper to prevent GPU memory leaks on unmount.
 */
export function disposeSceneResources(
  scene: THREE.Scene,
  extraTextures: Array<THREE.Texture | null | undefined> = []
): void {
  const seenGeo = new Set<THREE.BufferGeometry>();
  const seenMat = new Set<THREE.Material>();
  const seenTex = new Set<THREE.Texture>();

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !seenGeo.has(mesh.geometry)) {
      seenGeo.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
      ? [mesh.material]
      : [];
    for (const mat of mats) {
      if (!mat || seenMat.has(mat)) continue;
      seenMat.add(mat);
      const anyMat = mat as unknown as Record<string, unknown>;
      for (const k of Object.keys(anyMat)) {
        const val = anyMat[k];
        if (val && (val as THREE.Texture).isTexture && !seenTex.has(val as THREE.Texture)) {
          seenTex.add(val as THREE.Texture);
          (val as THREE.Texture).dispose();
        }
      }
      mat.dispose();
    }
  });

  if (scene.environment && !seenTex.has(scene.environment)) {
    scene.environment.dispose();
  }
  for (const t of extraTextures) {
    if (t && !seenTex.has(t)) {
      seenTex.add(t);
      t.dispose();
    }
  }
}
