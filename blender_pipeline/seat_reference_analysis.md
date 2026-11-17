# STEP 1: PHOTOGRAPHIC & GEOMETRIC ANALYSIS OF `/blender_pipeline/reference/seat_ref.png`

## 1. Reference Image Telemetry & Pixel Statistics
- **Source File**: `/blender_pipeline/reference/seat_ref.png` (`2048 × 1307` px, aspect ratio `1.567:1`).
- **Measured Region sRGB Means (8-bit `[0..255]`)**:
  - **Overall Frame Mean sRGB**: `[79.41, 104.38, 136.43]`
  - **Molded Blue Seat Shell Mean sRGB**: `[31.05, 68.45, 114.66]` (`64.4%` of frame area)
    - Sunlit top-facing bevels / specular crown: `sRGB [58, 112, 178]` to `[115, 162, 218]`
    - Mid-tone satin backrest slats: `sRGB [30, 72, 128]`
    - Shaded hollow inner cavity & under-armrest recess: `sRGB [10, 24, 52]`
  - **Sunlit Concrete Step Mean sRGB**: `[226.35, 226.87, 227.90]` (`20.7%` of frame area)
    - Shaded vertical concrete riser (upper right): `sRGB [172, 178, 184]`
    - Deep cast shadow on concrete tread: `sRGB [24, 34, 48]`
  - **Brushed Aluminum Disc Mean sRGB**: `[196.0, 206.5, 214.0]`
  - **Measured Edge-Sharpness Gradient**: `6.764` (`mean(|dx|) + mean(|dy|)` in 8-bit luminance).

---

## 2. Camera & Optical Breakdown
- **Camera Distance**: `~0.95 m` (`95 cm`) from the primary hero seat (`Seat A`, center-left), with `Seat B` (`0.48 m` lateral seat pitch to the right) filling the lower-right foreground and `Seat C` (adjacent row/seat) partially visible in the upper-left corner.
- **Viewing Angle**: **Aisle-side three-quarter rear-left view** (`azimuth ~38°` off the rear backrest normal, `elevation ~25°` looking downward across the backrest crown, armrests, and concrete steps).
- **Focal Length**: `45 mm` full-frame equivalent (`36 mm` sensor width), producing natural perspective compression between `Seat A` (upper-left/center) and `Seat B` (lower-right).
- **Depth of Field**: Aperture `f/5.6` focused on `Seat A`'s circular aluminum number disc (`focus distance = 0.92 m`), giving razor-sharp screw threads, mold grain, and disc bevels on `Seat A`/`Seat B` with gentle optical softness on the background concrete riser and cast pedestal feet (`1.6–2.2 m` away).

---

## 3. Lighting & Shadow Breakdown
- **Primary Key Light**: Hard midday / early-afternoon direct sunlight (`Sun Elevation ~56°`, `Azimuth ~135°` from upper-left/front-left), casting crisp, high-contrast dark shadows (`sun angular diameter ~0.53°`) downward and to the right across the backrest recesses and onto the pale concrete treads.
- **Specular Response**: Broad, smooth anisotropic-like satin specular band running along the top arched shoulder curve of the backrest, the upper lip of each horizontal slat, the chamfered inner rim of the curved through-slots, and the rolled top edge of the armrest.
- **Bounce / Fill Lighting**: High-albedo pale concrete treads (`albedo ~0.78`) bounce warm-neutral daylight upward into the backrest slots and side-frame bevels, while the deep hollow inner cavity of the armrest remains dark navy due to ambient occlusion.

---

## 4. Seat Form & Dimensional Estimates (`1 unit = 1.0 m`)
- **Overall Proportions**:
  - **Center-to-Center Seat Pitch**: `0.480 m` (`480 mm`)
  - **Clear Backrest Shell Width**: `0.436 m` (`436 mm`) between outer side standards
  - **Overall Backrest Top Crown Height**: `0.850 m` (`850 mm`) above the concrete step tread
  - **Shoulder Height at Side Standards**: `0.735 m` (`735 mm`), rising via a smooth S-curved **shoulder curve** (`115 mm` rise) to the central arched crown (`width ~260 mm`).
- **Rear Backrest Architecture**:
  1. **Raised Outer Frame**: Continuous `28 mm` wide × `24 mm` proud perimeter side-rail frame along the left and right edges of the backrest that transitions smoothly into the upper shoulder curve and forward into the molded armrests.
  2. **Top Curved Through-Slot (`Slot 1`)**: Located in the arched upper crown (`z = 0.745 m` to `0.783 m`), `168 mm` wide × `36 mm` tall, arched to follow the crown curvature, with `26 mm` deep walls and `4 mm` rounded bevels on front and rear edges. Looks completely through to the sunlit concrete behind.
  3. **Upper Slat (`Slat 1` — Disc & Screw Carrier)**: `102 mm` tall curved horizontal panel (`z = 0.635 m` to `0.737 m`), convexly bowed toward the rear (`28 mm` camber) with `3.5 mm` rounded top/bottom edges.
  4. **Second Long Curved Through-Slot (`Slot 2`)**: Located below `Slat 1` (`z = 0.605 m` to `0.635 m`), `236 mm` wide × `28 mm` tall, with stadium-rounded ends and beveled through-walls exposing the bright concrete step behind.
  5. **Middle Ribbed Horizontal Slat (`Slat 2`)**: Located at `z = 0.505 m` to `0.600 m` (`95 mm` tall), matching the horizontal curvature and rounded perimeter bevels of `Slat 1`, with a recessed perimeter shadow groove where it meets the raised side frame.
  6. **Third Curved Through-Slot (`Slot 3`) & Lower Ribbed Slat (`Slat 3`)**: Located at `z = 0.478 m` to `0.504 m` (`216 mm` wide × `25 mm` tall through-slot) followed by the lower horizontal slat (`z = 0.395 m` to `0.475 m`) carrying the lower frame screw.
- **Molded Armrest & Hollow Inner Cavity**:
  - Sweeps forward from the raised backrest side frame at `z = 0.610 m` down to `z = 0.545 m` (`length = 0.295 m`, `width = 0.052 m`), terminating in a rounded waterfall nose with a `6 mm` rolled outer lip.
  - The inner/lower side of the armrest shell forms a **deep recessed hollow cavity** (`18 mm` deep pocket) shaded a noticeably darker navy (`Base Color × 0.42` + cavity AO) than the sunlit outer shell.
- **Sitter-Facing Front Face & Contoured Seat Pan**:
  - The sitter-facing front of the backrest is a smooth, ergonomically contoured shell (without the rear ribs or number disc), with the 3 curved through-slots passing cleanly through.
  - The molded seat pan (`depth = 0.42 m`, `pan height = 0.43 m`) has a thick, smoothly rounded front waterfall cushion edge (`64 mm` front roll) and rests on a **dark navy cast pedestal stanchion** (`sRGB ~[14, 24, 42]`) with a flared triangular floor flange bolted to the concrete tread.

---

## 5. Hardware Details
1. **Brushed-Aluminum Round Number Disc**:
   - **Location**: Rear face of `Slat 1` (upper third of backrest, `z = 0.682 m`), offset slightly left of the vertical centerline (`y_local = -0.042 m`), recessed `1.8 mm` into a circular molded pocket (`diameter = 0.088 m` / `88 mm`, disc diameter `0.084 m` / `84 mm`) with a crisp dark shadow gap around its circumference.
   - **Fasteners**: Two tiny countersunk stainless rivets/screws (`diameter = 4.5 mm`) positioned inside the left (`~8 o'clock`) and right (`~4 o'clock`) rims of the disc (`35 mm` radial offset from disc center).
   - **Material**: Anisotropic brushed aluminum (`Base Color = (0.78, 0.82, 0.86)`, `Metallic = 0.88`, `Roughness = 0.26`).
2. **Stainless Pan-Head Phillips Frame Screws**:
   - **Locations**: Mounted on the left side of `Slat 1` (`z = 0.704 m, y_local = -0.148 m`) and `Slat 3` (`z = 0.435 m, y_local = -0.148 m`) inside circular counterbore bosses.
   - **Geometry**: Domed pan-head washer screw (`22 mm` outer washer/head diameter, `5 mm` crown height) with a real 3D recessed **Phillips `+` cross slot** (`9 mm` span × `2.2 mm` slot width × `2.5 mm` depth) that catches a dark crisp shadow cross in sunlight.

---

## 6. Plastic & Concrete PBR Material Specifications
- **Molded HDPE / Polypropylene Shell (`M_Seat_Ref_HDPE_Blue`)**:
  - **Base Color**: Cobalt / Royal-Navy Blue (`Linear RGB ~(0.015, 0.062, 0.215)` -> `sRGB ~(32, 70, 122)`), modulated by a top-facing sun-bleach/dust gradient (`+14%` brighter on upward-facing normals) and a deep cavity darkening (`× 0.38` inside the hollow armrest cavity and slot interiors).
  - **Roughness**: `0.38` base (`0.34–0.44` via micro-EDM mold grain noise), `Specular = 0.58`, `Clearcoat = 0.15`, `Clearcoat Roughness = 0.22`.
  - **Micro-Bump / Mold Lines**: Fine procedural 3D noise (`Scale = 420`, `Strength = 0.045`) + faint parting-line seam along the outer frame center.
- **Concrete Steps (`M_Concrete_Ref_BroomFinish`)**:
  - **Base Color**: Pale warm-neutral architectural concrete (`Linear RGB ~(0.74, 0.75, 0.76)` -> `sRGB ~(226, 227, 228)` in full sun), with subtle dark mineral speckle pores, broom-finish directional striation, and soft weathering stains along the step riser base.
  - **Step Nosing Geometry**: Beveled `6 mm` step nosing with procedural micro-chipping displacement/bump and expansion joint grooves.
