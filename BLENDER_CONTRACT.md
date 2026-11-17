# STADIUMX — Blender GLB Integration Contract & Modeling Checklist

This document defines the exact spatial, naming, material, and optimization contract so a custom Blender `.glb` stadium model can drop into STADIUMX and replace or augment the procedural stadium without code changes.

---

## 1. World Coordinate System & Units

- **Units**: `1 Blender Unit = 1.0 Metre`
- **Up Axis**: `+Y Up` (glTF 2.0 standard; Blender's exporter converts `+Z Up` to `+Y Up` automatically when *"Y Up"* is checked)
- **Origin `(0, 0, 0)`**: Exact geometric center of the 22-yard cricket pitch strip at turf level (`Y = 0.00m`)
- **Pitch Axis**: Runs along the **Z-axis** from `Z = -10.06m` (North Pavilion End stumps) to `Z = +10.06m` (South Media End stumps)
- **Outfield Boundary Oval**:
  - Semi-major axis (`X`): `84.0m` (Boundary rope at `75.6m`)
  - Semi-minor axis (`Z`): `72.0m` (Boundary rope at `64.8m`)

---

## 2. GLB File Split & Naming Convention

Export separate Draco/Meshopt-compressed `.glb` files into `/public/models/` (or load via the in-app **Blender GLB Inspector**):

| File Name | Root Collection / Mesh Node Names | Triangle Budget | Texture Budget |
| :--- | :--- | :--- | :--- |
| `stadium_shell.glb` | `STAND_NORTH`, `STAND_NORTH_EAST`, `STAND_EAST`, `STAND_SOUTH_EAST`, `STAND_SOUTH`, `STAND_SOUTH_WEST`, `STAND_WEST`, `STAND_NORTH_WEST`, `CONCOURSE_OUTER` | `≤ 65,000 tris` | `2048x2048` KTX2 (Albedo + Baked AO/Roughness) |
| `pitch_ground.glb` | `PITCH_STRIP`, `CREASE_MARKINGS`, `STUMPS_NORTH`, `STUMPS_SOUTH`, `OUTFIELD_TURF`, `BOUNDARY_ROPE`, `AD_BOARDS_RING` | `≤ 12,000 tris` | `2048x2048` tileable grass normal + mowing mask |
| `roof_canopy.glb` | `ROOF_CANOPY`, `ROOF_TRUSS_RING`, `ROOF_PILLAR_01..08`, `VIP_GLASS_CURTAIN` | `≤ 28,000 tris` | `1024x1024` metallic/roughness |
| `floodlights.glb` | `FLOODLIGHT_01` .. `FLOODLIGHT_06` (with child `EMITTER_HEAD` at `Y = 52m`) | `≤ 9,000 tris` total | `512x512` emissive LED array |
| `scoreboards.glb` | `SCOREBOARD_01` (`NE 45°`), `SCOREBOARD_02` (`SW 225°`), `PAVILION_MAIN` (`North 0°`) | `≤ 8,000 tris` | Dynamic canvas UV mapped `[0..1]` |
| `seat_high_lod.glb` | `SEAT_SHELL`, `SEAT_CUSHION`, `SEAT_ARMREST` | `≤ 220 tris` per instance | Vertex color / `instanceColor` driven |

---

## 3. Seat Anchor Verification Contract

STADIUMX guarantees 1:1 parity between PostgreSQL seat records and 3D transforms:
1. By default, `InstancedMesh` transforms are generated from `DEFAULT_STADIUM_SPEC` (`generateSeatsFromSpec()`).
2. If your Blender file includes empty anchors named `SEAT_ANCHOR_<BlockCode>_R<Row>_S<Seat>` (e.g. `SEAT_ANCHOR_N-T2-R03-S10`), you can verify zero spatial drift (< `0.05m` tolerance) using the `/api/blender/validate-manifest` endpoint or the **Blender Contract** modal inside the app.

---

## 4. Step-by-Step Blender Modeling Checklist

1. **Blockout & Reference Oval (Order 1)**:
   - Create an ellipse curve with `X = 84m`, `Z = 72m` for the turf perimeter.
   - Model the 22-yard pitch (`20.12m × 3.05m`) centered at `(0, 0.02, 0)`.
2. **Three-Tier Seating Bowl (Order 2)**:
   - Extrude the 8 radial stand sectors (`36°` arc span each, leaving sight-screen & tunnel gaps).
   - Apply exact tier rake angles:
     - **Tier 1 (Lower Bowl)**: Base elevation `+2.2m`, rake `18°`
     - **Tier 2 (VIP / Hospitality Club)**: Base elevation `+11.5m`, rake `24°`
     - **Tier 3 (Upper Terrace)**: Base elevation `+20.0m`, rake `31°`
3. **Pavilion, VIP Glass Boxes & Roof Trusses (Order 3)**:
   - Model the North Pavilion walkout tunnel at `(0, 0, -76m)`.
   - Model the cantilevered canopy ring (`innerRadius = 88m×76m`, `outerRadius = 128m×116m`, `height = 34m`).
4. **UV Unwrapping & Ambient Occlusion Baking (Order 4)**:
   - Unwrap architectural concrete onto `UVMap` (tileable detail) and `UVMap_AO` (non-overlapping lightmap).
   - Bake Ambient Occlusion (128 samples) into the Red channel and Roughness into the Green channel of a combined ORM map.
5. **glTF 2.0 Export Settings (Order 5)**:
   - Format: `glTF Binary (.glb)`
   - Include: `Custom Properties`, `Punctual Lights`
   - Transform: `+Y Up`
   - Compression: Enable `Meshopt` or `Draco` (quantization: Position `14-bit`, Normal `10-bit`, TexCoord `12-bit`).
