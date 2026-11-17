# STADIUMX — STEP 6: THREE.JS / WEBGL REAL-TIME SEAT RENDERING & LOD INTEGRATION PLAN

## 1. Architecture Overview (51,769 Seats at 60 FPS)
To render **51,769 photorealistic reference-matched seats** in Three.js / React Three Fiber (`WebGL2`) without exceeding a **2.5 ms GPU frame budget** or **120 draw calls**, STADIUMX uses a **4-tier distance-driven `THREE.InstancedMesh` + Batched Row-Strip architecture** backed by our compact binary anchor buffer (`/blender_pipeline/output/seat_anchors.bin`, `1.45 MB`, 28 bytes/seat) and the baked 2K PBR seat atlas (`/blender_pipeline/textures/seat_atlas_2k/`).

---

## 2. Distance-Tiered Instancing & Strict 300-Seat `LOD0` Hero Cap

| Tier | Mesh Asset | Triangles / Seat | Distance Band | Max Active Instances | Draw Calls | Geometric & Shader Features |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`LOD0` (Hero Pool)** | `SEAT_STD_LOD0` / `SEAT_VIP_LOD0` | `7,796` tris (`8,108` VIP) | `0.0 – 5.5 m` | **Hard-capped at `300` nearest seats** around camera | `2` (`1` Std, `1` VIP) | Real 3D rear through-slots (`Slot 1..3`), ribbed slats, 3D `90 mm` brushed-aluminum rear disc, 3D stainless pan-head Phillips `+` screws, hollow dark inner armrest cavity, and per-instance SDF seat number on rear disc. |
| **`LOD1` (Near Bay)** | `SEAT_STD_LOD1` / `SEAT_VIP_LOD1` | `1,932` tris | `5.5 – 22.0 m` | Up to `4,500` seats (active stand + adjacent bays) | `4` (frustum-culled per stand) | Full shoulder-curve silhouette, real top handle slot (`Slot 1`), 3D armrests, 3D rear disc; lower slots (`Slot 2..3`) and Phillips screws rendered via 2K normal + AO + ID mask atlas. |
| **`LOD2` (Mid Bowl)** | `SEAT_STD_LOD2` | `388` tris | `22.0 – 65.0 m` | Up to `18,000` seats | `12` (1 per stand/tier group) | Curved shell + armrests + pedestal with baked 2K normal, AO, curvature, and mosaic color tinting. |
| **`LOD3` (Far Bowl)** | `SEAT_STD_LOD3` + Row-Strip Mesh | `96` tris | `> 65.0 m` | Remaining `~29,000` seats | `12` | Ultra-low-poly stepped row profile with mipmapped row-strip normal/albedo atlas and analytical horizon AO. |

### Enforcing the 300-Seat `LOD0` Hero Cap
1. The binary anchor file `seat_anchors.bin` is indexed at startup into a **block-level spatial bounding-sphere hierarchy** (`86` seating blocks).
2. Whenever the camera moves into ` WALK` / `SEAT_INSPECT` / `SEATED_FPV` mode (camera within `12 m` of a tier terrace), a lightweight spatial query selects the `<= 2` seating blocks intersecting the `6.0 m` sphere around `camera.position`.
3. Within those blocks, squared distances $d_i^2 = \|\mathbf{p}_i - \mathbf{c}\|^2$ are sorted in a pre-allocated `Float32Array`, and **at most the closest `300` seats** with $d_i \le 5.5\text{ m}$ are written into the `LOD0` `InstancedMesh` transform buffer (`instanceMatrix.needsUpdate = true`).
4. Worst-case `LOD0` triangle load is strictly bounded to $300 \times 7,796 = 2.33\text{M}$ triangles in a single instanced draw call (`< 0.35 ms` on desktop/mobile GPUs).

---

## 3. Dithered Screen-Space LOD Cross-Fade (Zero Popping)
To prevent visible popping when transitioning between `LOD0 <-> LOD1` (`4.8 – 5.5 m`), `LOD1 <-> LOD2` (`20.0 – 22.0 m`), and `LOD2 <-> LOD3` (`60.0 – 65.0 m`):
- Each transition band has a **`12%` overlap zone** where both LOD instances are submitted.
- In `onBeforeCompile`, a **4×4 Bayer ordered-dithering matrix** (`gl_FragCoord.xy`) discards fragments based on the normalized transition factor $\alpha \in [0, 1]$:
  ```glsl
  float bayer4x4(vec2 pos) {
    ivec2 p = ivec2(mod(pos, 4.0));
    int idx = p.y * 4 + p.x;
    const float m[16] = float[16](
      0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
     12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
      3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
     15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
    );
    return m[idx];
  }
  // Outgoing LOD discards when (1.0 - alpha) < bayer4x4(gl_FragCoord.xy)
  // Incoming LOD discards when alpha <= bayer4x4(gl_FragCoord.xy)
  ```
- Because no alpha blending is required, depth-buffer writes and early-Z culling remain **100% preserved**.

---

## 4. Texture Filtering, Anisotropy (`8x–16x`), and Toksvig Specular Anti-Aliasing
1. **Anisotropic Filtering (`8x–16x`)**:
   - All 2K seat atlas maps (`seat_atlas_normal_2k.png`, `seat_atlas_ao_2k.png`, `seat_atlas_curvature_2k.png`, `seat_atlas_id_mask_2k.png`) and concrete step maps (`concrete_albedo_2k.png`, `concrete_normal_2k.png`, `concrete_roughness_2k.png`) are initialized with:
     ```ts
     const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
     texture.anisotropy = Math.max(8, maxAniso);
     texture.minFilter = THREE.LinearMipmapLinearFilter;
     texture.magFilter = THREE.LinearFilter;
     texture.generateMipmaps = true;
     ```
2. **Toksvig / Kaplanyan Specular Anti-Aliasing (Preventing Distant Shimmer)**:
   - Molded satin HDPE (`roughness = 0.38`, `clearcoat = 0.15`) has strong rounded-edge specular highlights on the shoulder arch and horizontal slats that can shimmer at `15–60 m` without normal-variance roughness filtering.
   - In the custom `MeshPhysicalMaterial` fragment shader patch (`onBeforeCompile`), we compute screen-space normal derivatives (`dFdx(vNormal)`, `dFdy(vNormal)`) and increase perceptual roughness with distance/normal variance:
     ```glsl
     vec3 dndu = dFdx(geometryNormal);
     vec3 dndv = dFdy(geometryNormal);
     float variance = clamp(dot(dndu, dndu) + dot(dndv, dndv), 0.0, 0.25);
     roughnessFactor = clamp(sqrt(roughnessFactor * roughnessFactor + 1.8 * variance), 0.36, 0.88);
     clearcoatRoughness = clamp(sqrt(clearcoatRoughness * clearcoatRoughness + 2.4 * variance), 0.20, 0.90);
     ```

---

## 5. Per-Instance Attributes: Mosaic Palette, SDF Seat Numbers & Booking States
Each `InstancedMesh` attaches two compact `InstancedBufferAttribute` streams (`8 bytes/instance` total):
1. `aSeatMeta` (`vec4`: `mosaicColorId`, `seatNumberIndex (1..32)`, `bookingState`, `hoverPulse`):
   - **Mosaic Color Palette** (when `bookingState == AVAILABLE` in overview mode):
     - `0 (Navy Blue)`: `#1E4472` (sRGB `[30, 68, 114]` matching `seat_ref.png`)
     - `1 (Royal Blue)`: `#285A94`
     - `2 (Sky Accent)`: `#4882B8`
     - `3 (Saffron Orange)`: `#D85A1A`
     - `4 (Marigold Yellow)`: `#E2A822`
     - `5 (VIP Navy Leather)`: `#0E1D3A`
   - **SDF Seat Number on the Rear 90 mm Aluminum Disc**:
     - When `id_mask.g > 0.5` (on the rear 90 mm brushed-aluminum disc), the shader samples `seat_number_sdf_atlas_1k.png` using `seatNumberIndex` (`8x4` UV grid offset) with `smoothstep(0.48 - fwidth(d), 0.48 + fwidth(d), d)` to render laser-etched black seat numbers (`1..32`) with infinite crispness at `1 m`!
   - **Interactive Seat Booking States**:
     - `0 = Available`: True PBR HDPE plastic color + subtle emissive rim lift (`+0.08`) on raycast hover.
     - `1 = Hovered`: Warm cyan-white Fresnel rim highlight (`#38BDF8`, intensity `0.35`) + `8 mm` upward spring lift in vertex shader.
     - `2 = Selected (In Cart)`: Emerald-gold satin shell tint (`#10B981`) with a crisp top-shoulder beacon ring.
     - `3 = Held (Temporary Hold)`: Amber satin shell (`#F59E0B`) with reduced specular (`0.35`).
     - `4 = Booked / Sold`: Desaturated dark slate-charcoal shell (`#1E293B`, roughness `0.68`) so available seats immediately pop visually.
