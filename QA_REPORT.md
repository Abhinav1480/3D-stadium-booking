# STADIUMX — Complete Performance, Real-Time Availability & UX QA Report

**Audit Date:** 2026-11-16  
**Venue Scope Preserved:** 8 stands, 3 tiers, 24 spatial chunks, 4,800 PostgreSQL seat anchors mapped 1:7 to 33,600 individual 3D seat instances.  
**Verification Environment:** Node.js + Express + Socket.IO + Vite React SPA on `http://localhost:3000`; headless Chromium (`1440×900` & `390×844`) running on CPU-rasterized SwiftShader WebGL (`isSoftwareGl: true`, hardware GPU noted separately where applicable).

---

## 1. Root-Cause Audit Summary

| Domain | Observed Root Cause | Targeted Fix Implemented |
| :--- | :--- | :--- |
| **GPU / Draw Calls & Aerial Poly Count** | Distant aerial views rendered full-detail 96-triangle `seat_lod3.glb` shells (`3.23M+` tris), plus per-frame shadow-map re-renders and per-frame `mat.needsUpdate` during roof opacity transitions. | Rebuilt `public/models/seat_lod3.glb` as a lean 36-triangle shell (`62%` reduction, `5,288` bytes); set `renderer.shadowMap.autoUpdate = false` (dirtying only on preset/sun/roof change); flipped `mat.needsUpdate` only when `transparent` state changes; wrapped 24 spatial chunks with shared VBO shallow geometry (`makeChunkWrappedGeo`). |
| **CPU / React Re-Renders** | `StadiumCanvas3D` subscribed to `hoveredSeat`, forcing full canvas parent re-renders and `33,600`-instance buffer re-syncs on pointer movement, `focusedSeat` changes, and single-seat socket events. | Replaced `hoveredSeat` React hook with imperative `useStadiumStore.subscribe` (`O(1)` 14-instance hover update); isolated `<SeatHoverTooltip />`; split `O(k)` `lastSocketDelta` partial buffer updates away from full-bowl sync; moved `SEAT_VIEW` spectator hiding to fast `O(1)` visibility toggling. |
| **Memory & Network Caching** | Static `/models/*` and `/textures/*` lacked browser cache headers; quality settings reset to `HIGH` regardless of client hardware or user preference. | Added `Cache-Control: public, max-age=3600` for `/models` & `/textures` and `maxAge: '1d'` on static `dist/` in `server.ts`; added 9-dimension `QUALITY_PRESET_CONFIGS`, `detectRecommendedQualityPreset`, and `localStorage` persistence. |
| **3D Seat Availability Visualization** | Individual 3D seats lacked a unified GPU-driven 6-state visual language preserving realistic seat finishes while preventing double-selection confusion. | Added `aStatusState` `InstancedBufferAttribute` + GLSL fragment shader (`attachSeatStatusShader`) rendering outlines, amber/purple hold pulses, `BOOKED` crimson diagonal hatching, and `BLOCKED` slate X cross-hatching directly on 3D geometry at `0` extra draw calls; added `Realistic` / `Availability` mode toggle and collapsible `<SeatAvailabilityLegend />`. |
| **Seat Sightline Inspector Hide/Show & Mobile Layout** | Right-side Inspector needed crisp `translateX(0)` / `translateX(110%)` CSS `transform` sliding, pointer/focus locking when hidden, an external `Show Seat Inspector` toggle, non-overlapping Legend spacing, and wrapped mobile Cart actions. | Updated `ViewFromSeatHud.tsx` with `[transform:translateX(0)]` / `[transform:translateX(110%)]` (`300ms ease-in-out`), `inert` + `pointer-events-none`, external `Show Seat Inspector (I)` toggle, deduplicated `I` key listener, hardened `H` dock listener, adjusted `SeatAvailabilityLegend.tsx` offsets, and wrapped mobile Cart buttons in `BottomControlDock.tsx`. |

---

## 2. Measured Performance Telemetry (Headless Chromium SwiftShader, `1440×900`)

> **Hardware Context Note:** All numbers below were directly measured in headless Chromium (`isSoftwareGl: true`, CPU SwiftShader). On native client hardware GPUs (Apple Silicon / NVIDIA / AMD), frame times are substantially faster and `QUALITY_PRESET_CONFIGS` unlocks hardware `Bloom`, `AO`, `4K` shadows, and full `LOD1` bucket-seat shells at close range.

### 2.1 Asset & API Load Timing

| Resource | Latency | Payload |
| :--- | :---: | :---: |
| `DOMContentLoaded` / `loadEventEnd` | `2,113 ms` / `2,115 ms` | Initial document + bundle |
| `/models/stadium_venue.glb` | `216 ms` | `4,566,248` bytes |
| `/models/seat_lod3.glb` (36-tri shell) | `15 ms` | `5,288` bytes |
| `/models/seat_lod2.glb` | `13 ms` | `4,900` bytes |
| `/models/seat_lod1.glb` | `28 ms` | `66,684` bytes |
| `/models/spectator_crowd.glb` | `16 ms` | `21,372` bytes |
| `/api/matches/1/inventory` (4,800 anchors) | `198 ms` | `444,850` bytes |
| `/api/health` (`curl`) | `2.0 ms` | JSON health check |
| `/api/stadium/seats` (`curl`) | `6.6 ms` | Cached static anchors |

### 2.2 Quality Preset Scaling (`FULL BOWL` Aerial View, `33,600` Visible Seat Instances)

| Preset | Draw Calls | Triangles | Crowd | DPR | Avg FPS | Min FPS | Median Frame | Long Tasks | JS Heap | `localStorage` Saved |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **LOW** | `55` | `1,137,986` | `0` | `0.5625` | `28.8` | `2.5` *(initial switch)* | `16.7 ms` | `1` | `48 MB` | `LOW` |
| **MEDIUM** | `57` | `1,346,786` | `900` | `0.81` | `59.7` | `30.0` | `16.7 ms` | `0` | `48 MB` | `MEDIUM` |
| **HIGH** | `59` | `2,781,986` | `1,800` | `1.00` | `33.5` | `2.3` | `16.7 ms` | `0` | `48 MB` | `HIGH` |
| **ULTRA** | `59` | `3,028,386` | `3,200` | `1.00` | `40.5` | `2.6` | `16.7 ms` | `0` | `48 MB` | `ULTRA` |

* Steady-state single frame render time after shader warmup (`MEDIUM` zoomed/moving): **`10.5 ms`** (`44` draw calls, `641,186` tris with frustum culling); Free-Fly motion **`1.9 ms`**.

---

## 3. Functional & Interactive Browser Verification

### 3.1 Camera Navigation, Zoom, Free-Fly & First-Person Sightlines
- **Orbit 3D & Cursor-Ray Wheel Zoom:** Dragging orbited smoothly (`[0, 56, 86]` → `[-16.55, 53.52, 85.88]`). Scroll wheel `(-480)` zoomed smoothly toward the cursor ray (`cameraDist: 107.42 m → 70.58 m`, `cameraPos: [0, 36.81, 48.87]`, `0` console errors).
- **Stand Focus & Outer Wall Clamp:** North (`[-95.41, 42.41, 23]` / `N-T2`) and South End (`[0, 24, 20]`) framed stands inside the concrete bowl without clipping through walls or roof.
- **Free-Fly (`WASD` + Wheel Speed):** `KeyW` advanced camera (`[0, 36.81, 48.87]` → `[0, 34.97, 45.55]`); scroll wheel incremented fly speed (`38 → 43 m/s`).
- **T1 / T2 / T3 First-Person `View From Here` & `Exit Seat View`:**
  - `N-T1-R05-S10` (Tier 1): eye at `[-1.35, 4.55, -79.19]` → target `[0.01, 0.77, 0.71]`
  - `N-T2-R05-S10` (Tier 2): eye at `[-1.50, 10.79, -88.79]` → target `[-0.16, 1.85, -9.30]`
  - `N-T3-R05-S10` (Tier 3): eye at `[-1.64, 18.03, -98.39]` → target `[-0.33, 4.23, -19.60]`
  - Clicking `Exit Seat View` returned cleanly to full aerial `ORBIT` mode (`[0, 56, 86]`).
- **Roof Modes & Solar Lighting:** Verified Roof `Solid`, `X-Ray`, and `Off` with `Day`, `Dusk`, and `Night` floodlight scenes cleanly.

### 3.2 Seat Sightline Inspector Hide/Show & Keyboard Shortcuts
- **Expanded State:** Right-side panel visible (`x: 1100..1420`, `transform: matrix(1, 0, 0, 1, 0, 0)`, `opacity: 1`, `pointerEvents: auto`, `inert: false`) displaying `N-T2-R03-S10`, sightline score `86/100`, distances/angles, canopy shade, scoreboard line, `View From Here`, `Compare Seat`, `Share Link`, and `Hide Inspector [I]` button.
- **Hide Click & `I` Shortcut:** Panel slid off-screen (`x: 1452..1772`, `transform: matrix(1, 0, 0, 1, 352, 0)`, `opacity: 0`, `pointerEvents: none`, `inert: true`, `aria-hidden: true`). Floating external `"◂ Show Seat Inspector [I]"` button remained visible at top-right (`x: 1241..1420`).
- **Explore While Hidden & Restore:** Stadium rotated and zoomed cleanly while hidden; clicking `"Show Seat Inspector"` or pressing `I` restored the panel with `N-T2-R03-S10` preserved.
- **`H` Shortcut Independence & Editable Guard:** Pressing `H` toggled only the bottom Stadium Controls dock while keeping the Inspector intact; pressing `I` or `H` inside `<select>`/`<input>`/`<textarea>`/`contentEditable` did not trigger shortcuts.

### 3.3 Real-Time 3D Seat Availability & Dual-Session Socket.IO Concurrency
Verified simultaneously across two isolated incognito browser contexts (`User A`: `demo-fan-uid`, `User B`: `?visitor=fan_b`):
1. **Live Hold Propagation (`User A` → `User B`):** User A selected and held `N-T2-R10-S09` (`HOLD-...`), switching User A's 3D seat + Legend + Inspector to `★ Reserved for You` (`07:59` live countdown). User B immediately received Socket.IO `seat:updated` showing `Temporarily Held: 1` (`07:57`), amber 3D highlight, and toast `"Temporarily reserved — try again shortly"` on click.
2. **Live Booking Transition:** User A completed Razorpay Test Payment (`BK-STX-...`). User B immediately transitioned via Socket.IO to `BOOKED` (`Temporarily Held: 0`, `Booked: 441`), crimson diagonal-hatched 3D seat shader, and toast `"This seat is already booked"` on click.
3. **Hold Release & Admin Block/Unblock:** Verified `DELETE /api/matches/1/holds/:holdToken` restores `AVAILABLE` and `POST /api/admin/matches/1/block-seats` toggles `BLOCKED` / `AVAILABLE` cleanly, leaving inventory in clean state after verification.

### 3.4 Responsive & Overlay Layout Checks
- **Desktop (`1440×900`):** Verified zero bounding-box overlaps among `Bowl Radar` (`[20, 80, 196, 292]`), `SeatAvailabilityLegend` (`[16, 397, 234, 632]`), and expanded `BottomControlDock` with Cart Strip + Stand Block row (`[250, 559, 1190, 884]`).
- **Mobile (`390×844`):** `scrollWidth === innerWidth` (`390 === 390`, zero horizontal overflow), Legend auto-collapsed to top-left pill, Cart Strip action buttons wrap cleanly (`flex-wrap`), and mobile dock caps scroll height.

---

## 4. Automated Test, Build & Lint Results

| Check | Command | Result |
| :--- | :--- | :--- |
| **TypeScript Lint** | `npm run lint` (`tsc --noEmit`) | **PASS** (`0` errors) |
| **Production Build** | `npm run build` (`vite build`) | **PASS** |
| **Spatial & Domain Unit Tests** | `npx --yes tsx --test src/shared/stadiumSpec.test.ts src/shared/seatingSpatial.test.ts` | **PASS (`15/15`)** |
| **S1 4,800-Anchor Geometry Parity** | `npx --yes tsx scripts/validate-s1-seating.ts` | **PASS (`4,800/4,800`, max delta `0.000005 m`)** |
| **Browser Console & Assets** | Playwright `console error` + `requests` (after final fixes) | **PASS (`0` console errors, all assets/APIs HTTP `200`/`201`)** |
