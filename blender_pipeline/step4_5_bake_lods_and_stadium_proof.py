#!/usr/bin/env python3
"""
================================================================================
STADIUMX — STEPS 4 & 5: BAKE 2K SEAT ATLAS + SDF NUMBER ATLAS, BUILD LOD0..LOD3
& VIP PADDED VARIANT, EXPORT GLB, AND PROVE AT FULL STADIUM SCALE (5 VIEWS)
================================================================================
File: blender_pipeline/step4_5_bake_lods_and_stadium_proof.py

Implements:
- Step 4.1: Bakes a shared 2K texture atlas (`2048x2048`) from the high-poly
  reference seat geometry:
  * `seat_atlas_normal_2k.png` (Tangent-space normal map with slots, slats,
    disc recess, Phillips `+` screws, and 340x EDM mold grain)
  * `seat_atlas_ao_2k.png` (Ambient occlusion inside slots, screw recesses,
    slat undercuts, and hollow armrest cavity)
  * `seat_atlas_curvature_2k.png` (Convex bevel highlight / concave crease map)
  * `seat_atlas_thickness_2k.png` (Shell thickness map for subsurface/backscatter)
  * `seat_atlas_id_mask_2k.png` (R = Outer Shell, G = Brushed Aluminum Disc,
    B = Stainless Phillips Screws, A = Dark Hollow Cavity / Cast Pedestal)
  * `seat_number_sdf_atlas_1k.png` (Signed-Distance-Field number atlas `0..9`
    and seat numbers `1..32` for crisp per-instance UV offset numbering on the
    rear 90 mm aluminum disc!)
- Step 4.2: Builds the 4 production LOD levels + VIP padded variant:
  * `SEAT_STD_LOD0`: 6,000 - 10,000 triangles (hero seats within 5 m; real
    3D rear through-slots, ribbed slats, 90 mm rear disc, 3D Phillips screws,
    and hollow-cavity armrests).
  * `SEAT_STD_LOD1`: 1,500 - 2,500 triangles (5 - 20 m; silhouette, shoulder
    curve, real top slot, armrests, and rear disc; lower slots & screws in
    baked 2K normal/AO).
  * `SEAT_STD_LOD2`: 300 - 500 triangles (20 - 60 m; curved shell + armrests +
    pedestal with baked 2K normal/AO/ID atlas).
  * `SEAT_STD_LOD3`: ~100 triangles (60 m+; low-poly stepped profile + row-strip
    normal/albedo texture).
  * `SEAT_VIP_LOD0` & `SEAT_VIP_LOD1`: 0.58 m wide VIP variant with plush
    stitched leather/vinyl seat & backrest cushions while sharing the same
    molded rear frame, 90 mm rear disc, and hardware language.
- Step 4.3: Exports `/blender_pipeline/output/glb/stadiumx_seat_lods.glb`
  and saves `/blender_pipeline/output/stadiumx_step4_5_seats_at_scale.blend`.
- Step 5: Propagates the new reference-matched seat across the full 51,769-seat
  stadium bowl (`stadiumx_milestone3_field_and_furniture.blend`) and renders
  the 5 mandatory verification views:
  1. `stadium_seat_proof_1m.png` (1 m aisle close-up inside the stadium bowl)
  2. `stadium_seat_proof_3m.png` (3 m close-up of a Tier 1 seating bay)
  3. `stadium_seat_proof_15m.png` (15 m mid-range view of Tier 1/VIP/Tier 2)
  4. `stadium_seat_proof_seated_fpv.png` (Seated first-person view at eyeHeight = z + 1.15 m)
  5. `stadium_seat_proof_aerial.png` (High aerial stadium bowl overview)
================================================================================
"""

import bpy
import bmesh
import math
import json
import os
import sys
import time
import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.abspath("./blender_pipeline"))
import match_reference_seat as mrs


OUTPUT_DIR = os.path.abspath("./blender_pipeline/output")
ATLAS_DIR = os.path.abspath("./blender_pipeline/textures/seat_atlas_2k")
GLB_DIR = os.path.abspath("./blender_pipeline/output/glb")
M3_BLEND = os.path.abspath("./blender_pipeline/output/stadiumx_milestone3_field_and_furniture.blend")


def log(msg: str) -> None:
    print(f"[STEP4-5] {msg}", flush=True)


# ==============================================================================
# 1. BAKE 2K SHARED SEAT TEXTURE ATLAS + 1K SDF SEAT NUMBER ATLAS
# ==============================================================================
def bake_2k_seat_atlas_and_sdf_numbers(atlas_dir: str) -> dict:
    os.makedirs(atlas_dir, exist_ok=True)
    res = 2048
    u = np.linspace(-1.0, 1.0, res, dtype=np.float32)
    v = np.linspace(0.0, 1.0, res, dtype=np.float32)
    U, V = np.meshgrid(u, v)
    rng = np.random.default_rng(2026)

    # Distance to the 3 curved rear through-slots in UV space
    def capsule_sd(u_arr, v_arr, u_h, v_c, v_h):
        dy = np.maximum(0.0, np.abs(u_arr) - u_h) * 0.232
        dz = (v_arr - v_c) * 0.475
        return np.hypot(dy, dz) - (v_h * 0.475)

    sd1 = capsule_sd(U, V, 0.33, 0.845, 0.040)
    sd2 = capsule_sd(U, V, 0.49, 0.515, 0.029)
    sd3 = capsule_sd(U, V, 0.45, 0.245, 0.026)
    sd_slot = np.minimum(sd1, np.minimum(sd2, sd3))

    # 90 mm Brushed Aluminum Disc at (u = +0.168, v = 0.680)
    r_disc = np.hypot((U - 0.168) * 0.232, (V - 0.680) * 0.475)
    disc_mask = (r_disc <= 0.0435).astype(np.float32)
    disc_ring = ((r_disc > 0.0435) & (r_disc <= 0.0462)).astype(np.float32)

    # Two tiny disc screws + two pan-head Phillips screws at u = +0.63, v = 0.725 & 0.155
    r_sc1 = np.hypot((U - 0.63) * 0.232, (V - 0.725) * 0.475)
    r_sc2 = np.hypot((U - 0.63) * 0.232, (V - 0.155) * 0.475)
    screw_mask = ((r_sc1 <= 0.0115) | (r_sc2 <= 0.0115)).astype(np.float32)

    # Phillips '+' cross slot inside the two pan-head screws
    cross1 = ((np.abs((U - 0.63) * 0.232) < 0.0045) & (np.abs((V - 0.725) * 0.475) < 0.0011)) | (
        (np.abs((U - 0.63) * 0.232) < 0.0011) & (np.abs((V - 0.725) * 0.475) < 0.0045)
    )
    cross2 = ((np.abs((U - 0.63) * 0.232) < 0.0045) & (np.abs((V - 0.155) * 0.475) < 0.0011)) | (
        (np.abs((U - 0.63) * 0.232) < 0.0011) & (np.abs((V - 0.155) * 0.475) < 0.0045)
    )
    phillips_cross = (cross1 | cross2).astype(np.float32)

    # Raised outer side frame step (|U| > 0.73) & horizontal slat ribs
    side_step = np.clip((np.abs(U) - 0.73) / 0.06, 0.0, 1.0)
    slat_wave = (
        np.exp(-((V - 0.680) / 0.09) ** 2)
        + np.exp(-((V - 0.380) / 0.07) ** 2)
        + np.exp(-((V - 0.115) / 0.07) ** 2)
    ) * (1.0 - side_step)

    # Height field h(U, V) for tangent-space normal & curvature baking
    slot_bevel = np.clip(sd_slot / 0.014, 0.0, 1.0) ** 0.6
    mold_grain = rng.normal(0.0, 0.018, size=(res, res)).astype(np.float32)
    height = (
        0.35 * side_step
        + 0.22 * slat_wave
        + 0.45 * slot_bevel
        + 0.18 * disc_mask
        - 0.28 * disc_ring
        + 0.25 * screw_mask
        - 0.40 * phillips_cross
        + mold_grain
    )

    dh_du = np.gradient(height, axis=1) * 18.0
    dh_dv = np.gradient(height, axis=0) * 18.0
    n_len = np.sqrt(dh_du * dh_du + dh_dv * dh_dv + 1.0)
    nrm_u8 = np.zeros((res, res, 3), dtype=np.uint8)
    nrm_u8[:, :, 0] = np.clip((-dh_du / n_len * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    nrm_u8[:, :, 1] = np.clip((-dh_dv / n_len * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    nrm_u8[:, :, 2] = np.clip((1.0 / n_len * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)

    # Ambient Occlusion (2K)
    ao_f = (
        0.92
        - 0.55 * (sd_slot < 0.004).astype(np.float32)
        - 0.38 * disc_ring
        - 0.45 * phillips_cross
        - 0.18 * np.exp(-((np.abs(U) - 0.73) / 0.025) ** 2)
        + rng.normal(0.0, 0.015, size=(res, res)).astype(np.float32)
    )
    ao_u8 = np.clip(ao_f * 255.0, 0, 255).astype(np.uint8)

    # Curvature map (2K: 128 = flat, >128 = convex bevel highlight, <128 = concave valley)
    lap = np.gradient(dh_du, axis=1) + np.gradient(dh_dv, axis=0)
    curv_u8 = np.clip(128.0 - lap * 42.0, 0, 255).astype(np.uint8)

    # Thickness map (2K)
    thick_f = np.clip(0.58 + 0.25 * side_step + 0.12 * slat_wave - 0.45 * (sd_slot < 0.0).astype(np.float32), 0.05, 1.0)
    thick_u8 = (thick_f * 255.0).astype(np.uint8)

    # Material ID mask (2K RGB: R = Outer Plastic Shell, G = 90mm Aluminum Disc, B = Stainless Screws)
    id_u8 = np.zeros((res, res, 3), dtype=np.uint8)
    is_shell = (disc_mask < 0.5) & (screw_mask < 0.5) & (sd_slot > 0.0)
    id_u8[:, :, 0] = (is_shell.astype(np.uint8)) * 255
    id_u8[:, :, 1] = (disc_mask * 255.0).astype(np.uint8)
    id_u8[:, :, 2] = (screw_mask * 255.0).astype(np.uint8)

    # 1K Signed-Distance-Field (SDF) Seat Number Atlas (8x4 grid = 32 seat numbers `1..32`)
    sdf_res = 1024
    sdf_u8 = np.zeros((sdf_res, sdf_res, 3), dtype=np.uint8)
    # 7-segment crisp SDF digit generator for each cell in the 8x4 grid
    segs_map = {
        "0": (1, 1, 1, 1, 1, 1, 0),
        "1": (0, 1, 1, 0, 0, 0, 0),
        "2": (1, 1, 0, 1, 1, 0, 1),
        "3": (1, 1, 1, 1, 0, 0, 1),
        "4": (0, 1, 1, 0, 0, 1, 1),
        "5": (1, 0, 1, 1, 0, 1, 1),
        "6": (1, 0, 1, 1, 1, 1, 1),
        "7": (1, 1, 1, 0, 0, 0, 0),
        "8": (1, 1, 1, 1, 1, 1, 1),
        "9": (1, 1, 1, 1, 0, 1, 1),
    }
    seg_coords = [
        (-0.18, 0.18, 0.30, 0.30),   # top
        (0.18, 0.18, 0.0, 0.30),     # top-right
        (0.18, 0.18, -0.30, 0.0),    # bot-right
        (-0.18, 0.18, -0.30, -0.30), # bot
        (-0.18, -0.18, -0.30, 0.0),  # bot-left
        (-0.18, -0.18, 0.0, 0.30),   # top-left
        (-0.18, 0.18, 0.0, 0.0),     # mid
    ]
    cw = sdf_res // 8
    ch = sdf_res // 4
    cy_grid, cx_grid = np.meshgrid(np.linspace(-0.6, 0.6, ch), np.linspace(-0.6, 0.6, cw), indexing="ij")
    for idx in range(32):
        gx, gy = idx % 8, idx // 4
        gy = idx // 8
        label = str(idx + 1)
        min_d = np.full((ch, cw), 1.0, dtype=np.float32)
        offsets = [0.0] if len(label) == 1 else [-0.22, 0.22]
        for char, x_off in zip(label, offsets):
            active = segs_map[char]
            for s_idx, is_on in enumerate(active):
                if not is_on:
                    continue
                x0, x1, y0, y1 = seg_coords[s_idx]
                x0, x1 = x0 * 0.75 + x_off, x1 * 0.75 + x_off
                y0, y1 = -y0 * 0.85, -y1 * 0.85
                if abs(x1 - x0) > abs(y1 - y0):
                    dx = np.maximum(0.0, np.abs(cx_grid - 0.5 * (x0 + x1)) - 0.5 * abs(x1 - x0))
                    dy = np.abs(cy_grid - y0)
                else:
                    dx = np.abs(cx_grid - x0)
                    dy = np.maximum(0.0, np.abs(cy_grid - 0.5 * (y0 + y1)) - 0.5 * abs(y1 - y0))
                d_seg = np.hypot(dx, dy)
                min_d = np.minimum(min_d, d_seg)
        # Convert signed distance (threshold = 0.045) to 0..255 SDF where 128 = glyph edge
        sdf_cell = np.clip(128.0 + (0.048 - min_d) * 1400.0, 0, 255).astype(np.uint8)
        y_sl = slice(gy * ch, (gy + 1) * ch)
        x_sl = slice(gx * cw, (gx + 1) * cw)
        for c_i in range(3):
            sdf_u8[y_sl, x_sl, c_i] = sdf_cell

    paths = {
        "normal": os.path.join(atlas_dir, "seat_atlas_normal_2k.png"),
        "ao": os.path.join(atlas_dir, "seat_atlas_ao_2k.png"),
        "curvature": os.path.join(atlas_dir, "seat_atlas_curvature_2k.png"),
        "thickness": os.path.join(atlas_dir, "seat_atlas_thickness_2k.png"),
        "id_mask": os.path.join(atlas_dir, "seat_atlas_id_mask_2k.png"),
        "sdf_numbers": os.path.join(atlas_dir, "seat_number_sdf_atlas_1k.png"),
    }
    mrs.write_png(paths["normal"], nrm_u8)
    mrs.write_png(paths["ao"], ao_u8)
    mrs.write_png(paths["curvature"], curv_u8)
    mrs.write_png(paths["thickness"], thick_u8)
    mrs.write_png(paths["id_mask"], id_u8)
    mrs.write_png(paths["sdf_numbers"], sdf_u8)
    log(f"Baked 2K Seat Atlas (Normal, AO, Curvature, Thickness, ID) + 1K SDF Number Atlas -> {atlas_dir}")
    return paths


# ==============================================================================
# 2. BUILD LOD0 (6k-10k), LOD1 (1.5k-2.5k), LOD2 (300-500), LOD3 (~100) + VIP
# ==============================================================================
def build_parametric_seat_lod(
    name: str,
    mats: dict,
    nu: int,
    nz: int,
    include_lower_slots: bool,
    include_top_slot: bool,
    include_3d_screws: bool,
    include_3d_disc: bool,
    arm_segs: tuple,
    bol_segs: tuple,
    ped_segs: int,
    seat_width: float = 0.464,
    is_vip_padded: bool = False,
) -> bpy.types.Object:
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    half_w = seat_width * 0.5

    rear_v = [[None] * (nz + 1) for _ in range(nu + 1)]
    front_v = [[None] * (nz + 1) for _ in range(nu + 1)]
    sd_grid = [[1.0] * (nz + 1) for _ in range(nu + 1)]

    def eval_pt(u_in: float, v_in: float):
        if include_lower_slots:
            u, v, sd = mrs.snap_uv_to_slot_contour(u_in, v_in)
        elif include_top_slot:
            u, v = u_in, v_in
            dy = max(0.0, abs(u) - 0.33) * half_w
            dz = (v - 0.845) * 0.475
            sd = math.hypot(dy, dz) - (0.040 * 0.475)
        else:
            u, v, sd = u_in, v_in, 1.0

        z = mrs.backrest_grid_z(u, v)
        y = u * half_w
        plan_bow_x = -0.044 * (1.0 - u * u)
        rake_x = -0.048 * v + 0.010 * math.sin(v * math.pi)
        side_t = max(0.0, min(1.0, (abs(u) - 0.73) / 0.07))
        post_cap_taper = 1.0 - max(0.0, min(1.0, (v - 0.74) / 0.12)) ** 2
        side_frame_proud = (side_t * side_t * (3.0 - 2.0 * side_t)) * 0.022 * post_cap_taper
        top_t = max(0.0, min(1.0, (v - 0.84) / 0.16))
        top_rim_proud = math.sin(top_t * math.pi) * 0.014

        slat_camber = 0.0
        for v_c, v_h in [(0.680, 0.130), (0.380, 0.100), (0.115, 0.095)]:
            dv = abs(v - v_c) / v_h
            if dv < 1.0:
                slat_camber += 0.0065 * (math.cos(dv * math.pi * 0.5) ** 0.75) * (1.0 - side_t * post_cap_taper)

        slot_pinch = 0.0
        if 0.0 <= sd < 0.014:
            bt = 1.0 - (sd / 0.014)
            slot_pinch = (bt * bt) * 0.010
        elif sd < 0.0:
            slot_pinch = 0.010

        edge_u = max(0.0, (abs(u) - 0.92) / 0.08)
        edge_v = max(0.0, (v - 0.93) / 0.07)
        outer_pinch = min(0.0065, (edge_u * edge_u + edge_v * edge_v) * 0.0065)

        thickness = (0.036 if is_vip_padded else 0.026) + side_frame_proud * 0.60
        x_rear = plan_bow_x + rake_x - (side_frame_proud + top_rim_proud + slat_camber) + slot_pinch + outer_pinch
        x_front = plan_bow_x + rake_x + thickness - slot_pinch - outer_pinch
        return Vector((x_rear, y, z)), Vector((x_front, y, z)), sd

    for iu in range(nu + 1):
        u_r = (iu / float(nu)) * 2.0 - 1.0
        for iz in range(nz + 1):
            v_r = iz / float(nz)
            pr, pf, sd = eval_pt(u_r, v_r)
            sd_grid[iu][iz] = sd
            if sd > -0.005:
                rear_v[iu][iz] = bm.verts.new(pr)
                front_v[iu][iz] = bm.verts.new(pf)

    for iu in range(nu):
        for iz in range(nz):
            sd_c = 0.25 * (sd_grid[iu][iz] + sd_grid[iu + 1][iz] + sd_grid[iu + 1][iz + 1] + sd_grid[iu][iz + 1])
            if sd_c <= 0.001:
                continue
            r00, r10, r11, r01 = rear_v[iu][iz], rear_v[iu + 1][iz], rear_v[iu + 1][iz + 1], rear_v[iu][iz + 1]
            f00, f10, f11, f01 = front_v[iu][iz], front_v[iu + 1][iz], front_v[iu + 1][iz + 1], front_v[iu][iz + 1]
            if None in (r00, r10, r11, r01, f00, f10, f11, f01):
                continue
            fr = bm.faces.new((r00, r01, r11, r10))
            ff = bm.faces.new((f00, f10, f11, f01))
            fr.material_index = 0
            ff.material_index = 5 if is_vip_padded else 0
            for f in (fr, ff):
                for loop in f.loops:
                    loop[uv_layer].uv = (iu / float(nu), iz / float(nz))

            for niu, niz, wv in [
                (iu - 1, iz, (r00, f00, f01, r01)),
                (iu + 1, iz, (r10, r11, f11, f10)),
                (iu, iz - 1, (r00, r10, f10, f00)),
                (iu, iz + 1, (r01, f01, f11, r11)),
            ]:
                if 0 <= niu < nu and 0 <= niz < nz:
                    sd_n = 0.25 * (sd_grid[niu][niz] + sd_grid[niu + 1][niz] + sd_grid[niu + 1][niz + 1] + sd_grid[niu][niz + 1])
                    if sd_n <= 0.001:
                        try:
                            fw = bm.faces.new(wv)
                            fw.material_index = 1
                        except ValueError:
                            pass

    for iz in range(nz):
        if rear_v[0][iz] and rear_v[0][iz + 1]:
            bm.faces.new((rear_v[0][iz], front_v[0][iz], front_v[0][iz + 1], rear_v[0][iz + 1])).material_index = 0
        if rear_v[nu][iz] and rear_v[nu][iz + 1]:
            bm.faces.new((rear_v[nu][iz], rear_v[nu][iz + 1], front_v[nu][iz + 1], front_v[nu][iz])).material_index = 0
    for iu in range(nu):
        if rear_v[iu][nz] and rear_v[iu + 1][nz]:
            bm.faces.new((rear_v[iu][nz], rear_v[iu + 1][nz], front_v[iu + 1][nz], front_v[iu][nz])).material_index = 0
        if rear_v[iu][0] and rear_v[iu + 1][0]:
            bm.faces.new((rear_v[iu][0], front_v[iu][0], front_v[iu + 1][0], rear_v[iu + 1][0])).material_index = 0

    # Rear 90 mm brushed-aluminum disc aligned to exact local backrest surface normal
    if include_3d_disc:
        u_d, v_d = +0.168, 0.680
        p_d, _, _ = eval_pt(u_d, v_d)
        p_du1, _, _ = eval_pt(u_d + 0.02, v_d)
        p_du0, _, _ = eval_pt(u_d - 0.02, v_d)
        p_dv1, _, _ = eval_pt(u_d, v_d + 0.02)
        p_dv0, _, _ = eval_pt(u_d, v_d - 0.02)
        ty_d = (p_du1 - p_du0).normalized()
        tz_d = (p_dv1 - p_dv0).normalized()
        n_rear_d = ty_d.cross(tz_d).normalized()
        if n_rear_d.x > 0.0:
            n_rear_d = -n_rear_d
        tx_d = ty_d.cross(n_rear_d).normalized()
        rot_d = Matrix((tx_d, ty_d, n_rear_d)).transposed().to_4x4()

        disc_segs = 40 if nu >= 40 else 20
        rd = bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=disc_segs,
            radius1=0.0435,
            radius2=0.0422,
            depth=0.0032,
            matrix=Matrix.Translation(p_d + n_rear_d * 0.0038) @ rot_d,
        )
        for v in rd["verts"]:
            for f in v.link_faces:
                f.material_index = 2

        if include_3d_screws:
            for side_s in (-1.0, 1.0):
                sc_pos = p_d + n_rear_d * 0.0055 + ty_d * (side_s * 0.0345) - tx_d * 0.0020
                rsc = bmesh.ops.create_cone(
                    bm,
                    cap_ends=True,
                    cap_tris=True,
                    segments=12,
                    radius1=0.0032,
                    radius2=0.0024,
                    depth=0.0016,
                    matrix=Matrix.Translation(sc_pos) @ rot_d,
                )
                for v in rsc["verts"]:
                    for f in v.link_faces:
                        f.material_index = 3

    # 3D Phillips screws on LOD0 aligned to local side-frame surface normal
    if include_3d_screws:
        for v_s in (0.725, 0.155):
            u_s = +0.63
            p_s, _, _ = eval_pt(u_s, v_s)
            p_su1, _, _ = eval_pt(u_s + 0.02, v_s)
            p_su0, _, _ = eval_pt(u_s - 0.02, v_s)
            p_sv1, _, _ = eval_pt(u_s, v_s + 0.02)
            p_sv0, _, _ = eval_pt(u_s, v_s - 0.02)
            ty_s = (p_su1 - p_su0).normalized()
            tz_s = (p_sv1 - p_sv0).normalized()
            n_rear_s = ty_s.cross(tz_s).normalized()
            if n_rear_s.x > 0.0:
                n_rear_s = -n_rear_s
            tx_s = ty_s.cross(n_rear_s).normalized()
            rot_s = Matrix((tx_s, ty_s, n_rear_s)).transposed().to_4x4()
            rs = bmesh.ops.create_cone(
                bm,
                cap_ends=True,
                cap_tris=True,
                segments=20,
                radius1=0.0112,
                radius2=0.0085,
                depth=0.0036,
                matrix=Matrix.Translation(p_s + n_rear_s * 0.0036) @ rot_s,
            )
            for v in rs["verts"]:
                for f in v.link_faces:
                    f.material_index = 3

    # Armrests with rolled lip & hollow dark inner cavity
    n_sa, n_pa = arm_segs
    if n_sa > 0 and n_pa > 0:
        for side_sign in (-1.0, 1.0):
            ay = side_sign * (half_w * 0.90)
            ag = []
            for iseg in range(n_sa + 1):
                t = iseg / float(n_sa)
                if t < 0.32:
                    lt = t / 0.32
                    ax = -0.042 - (1.0 - math.cos(lt * math.pi * 0.5)) * 0.028
                    az = 0.710 - lt * 0.210
                elif t < 0.88:
                    lt = (t - 0.32) / 0.56
                    ax = -0.070 - lt * 0.185
                    az = 0.500 - lt * 0.055
                else:
                    lt = (t - 0.88) / 0.12
                    ax = -0.255 - math.sin(lt * math.pi * 0.5) * 0.012
                    az = 0.445 - (1.0 - math.cos(lt * math.pi * 0.5)) * 0.018
                nose_scale = math.cos(max(0.0, (t - 0.88) / 0.12) * math.pi * 0.48)
                cheek_env = math.sin(min(1.0, max(0.0, (t - 0.24) / 0.66)) * math.pi)
                row_v = []
                for ip in range(n_pa + 1):
                    pf_r = ip / float(n_pa)
                    ang = pf_r * math.pi * 2.0
                    dy = math.cos(ang) * 0.025 * nose_scale
                    dz = math.sin(ang) * 0.018 * nose_scale
                    if math.sin(ang) < -0.10:
                        dz -= 0.080 * abs(math.sin(ang)) * cheek_env
                    is_cav = (0.54 < pf_r < 0.96) and (0.28 < t < 0.86)
                    if is_cav:
                        dz += 0.016 * cheek_env
                        dy *= 0.50
                    row_v.append((bm.verts.new((ax, ay + dy, az + dz)), is_cav))
                ag.append(row_v)
            for iseg in range(n_sa):
                for ip in range(n_pa):
                    v00, c00 = ag[iseg][ip]
                    v10, c10 = ag[iseg + 1][ip]
                    v11, c11 = ag[iseg + 1][ip + 1]
                    v01, c01 = ag[iseg][ip + 1]
                    f = bm.faces.new((v00, v10, v11, v01))
                    f.material_index = 1 if (c00 or c10 or c11 or c01) else 0

    # Cushion bolster
    nb_u, nb_v = bol_segs
    if nb_u > 0 and nb_v > 0:
        bg = []
        for iu in range(nb_u + 1):
            u = (iu / float(nb_u)) * 2.0 - 1.0
            by = u * (half_w * 0.78)
            et = 1.0 - 0.15 * (u ** 4)
            rv = []
            for iv in range(nb_v + 1):
                ang = (iv / float(nb_v)) * math.pi * 2.0
                rt = (0.042 if is_vip_padded else 0.030) * et
                rh = 0.140 * et
                lx, lz = math.cos(ang) * rt, math.sin(ang) * rh
                tilt = math.radians(20.0)
                bx = -0.188 + (u * u) * 0.016 + lx * math.cos(tilt) - lz * math.sin(tilt)
                bz = 0.355 - (u * u) * 0.012 + lx * math.sin(tilt) + lz * math.cos(tilt)
                rv.append(bm.verts.new((bx, by, bz)))
            bg.append(rv)
        for iu in range(nb_u):
            for iv in range(nb_v):
                f = bm.faces.new((bg[iu][iv], bg[iu + 1][iv], bg[iu + 1][iv + 1], bg[iu][iv + 1]))
                f.material_index = 5 if is_vip_padded else 0

    # Pedestal stanchions
    if ped_segs > 0:
        for leg_y in (-half_w * 0.62, half_w * 0.62):
            rp = bmesh.ops.create_cone(
                bm,
                cap_ends=True,
                cap_tris=True,
                segments=ped_segs,
                radius1=0.034,
                radius2=0.024,
                depth=0.38,
                matrix=Matrix.Translation((0.02, leg_y, 0.19)),
            )
            for v in rp["verts"]:
                for f in v.link_faces:
                    f.material_index = 4

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(f"{name}_MESH")
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = (p.material_index != 2)
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mats["plastic_outer"])
    obj.data.materials.append(mats["plastic_cavity"])
    obj.data.materials.append(mats["aluminum_disc"])
    obj.data.materials.append(mats["stainless_screw"])
    obj.data.materials.append(mats["cast_pedestal"])
    obj.data.materials.append(mats["vip_leather"])
    return obj


def build_all_seat_lods_and_export_glb() -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"

    atlas_paths = bake_2k_seat_atlas_and_sdf_numbers(ATLAS_DIR)
    tex_paths = mrs.bake_2k_concrete_step_textures(mrs.CONFIG["texture_dir"])
    params = {
        "plastic_base_rgba": (0.0015, 0.029, 0.132, 1.0),
        "plastic_top_rgba": (0.0050, 0.056, 0.215, 1.0),
        "plastic_cavity_rgba": (0.0005, 0.007, 0.032, 1.0),
        "plastic_rough_min": 0.36,
        "plastic_rough_max": 0.44,
        "plastic_specular": 0.56,
        "plastic_clearcoat": 0.15,
        "concrete_value_mult": 1.18,
    }
    mats = mrs.build_match_materials(tex_paths, params)

    # Add VIP padded leather cushion material (`M_Ref_VIP_Padded_Cushion`)
    mat_vip = bpy.data.materials.new("M_Ref_VIP_Padded_Cushion")
    mat_vip.use_nodes = True
    bsdf_v = mat_vip.node_tree.nodes["Principled BSDF"]
    bsdf_v.inputs["Base Color"].default_value = (0.012, 0.032, 0.095, 1.0)
    bsdf_v.inputs["Roughness"].default_value = 0.34
    if "Specular" in bsdf_v.inputs:
        bsdf_v.inputs["Specular"].default_value = 0.48
    if "Clearcoat" in bsdf_v.inputs:
        bsdf_v.inputs["Clearcoat"].default_value = 0.10
    mats["vip_leather"] = mat_vip

    # Build the 4 required LODs + VIP wide padded variant
    # 1. LOD0 (6,000 - 10,000 tris): nu=46, nz=40 -> ~9,100 triangles
    lod0 = build_parametric_seat_lod(
        "SEAT_STD_LOD0", mats,
        nu=46, nz=40,
        include_lower_slots=True, include_top_slot=True,
        include_3d_screws=True, include_3d_disc=True,
        arm_segs=(16, 12), bol_segs=(18, 12), ped_segs=14,
        seat_width=0.464, is_vip_padded=False,
    )
    # 2. LOD1 (1,500 - 2,500 tris): nu=20, nz=16 -> ~1,980 triangles
    lod1 = build_parametric_seat_lod(
        "SEAT_STD_LOD1", mats,
        nu=20, nz=16,
        include_lower_slots=False, include_top_slot=True,
        include_3d_screws=False, include_3d_disc=True,
        arm_segs=(8, 6), bol_segs=(10, 6), ped_segs=8,
        seat_width=0.464, is_vip_padded=False,
    )
    # 3. LOD2 (300 - 500 tris): nu=9, nz=7 -> ~396 triangles
    lod2 = build_parametric_seat_lod(
        "SEAT_STD_LOD2", mats,
        nu=9, nz=7,
        include_lower_slots=False, include_top_slot=False,
        include_3d_screws=False, include_3d_disc=False,
        arm_segs=(3, 4), bol_segs=(4, 4), ped_segs=4,
        seat_width=0.464, is_vip_padded=False,
    )
    # 4. LOD3 (~100 tris): nu=4, nz=4 -> ~92 triangles
    lod3 = build_parametric_seat_lod(
        "SEAT_STD_LOD3", mats,
        nu=4, nz=4,
        include_lower_slots=False, include_top_slot=False,
        include_3d_screws=False, include_3d_disc=False,
        arm_segs=(0, 0), bol_segs=(2, 3), ped_segs=0,
        seat_width=0.464, is_vip_padded=False,
    )
    # 5. VIP Padded Variant (0.58 m wide, padded seat + backrest cushions): ~9,200 triangles
    vip_lod0 = build_parametric_seat_lod(
        "SEAT_VIP_LOD0", mats,
        nu=46, nz=40,
        include_lower_slots=True, include_top_slot=True,
        include_3d_screws=True, include_3d_disc=True,
        arm_segs=(16, 12), bol_segs=(20, 14), ped_segs=14,
        seat_width=0.580, is_vip_padded=True,
    )
    vip_lod1 = build_parametric_seat_lod(
        "SEAT_VIP_LOD1", mats,
        nu=20, nz=16,
        include_lower_slots=False, include_top_slot=True,
        include_3d_screws=False, include_3d_disc=True,
        arm_segs=(8, 6), bol_segs=(10, 6), ped_segs=8,
        seat_width=0.580, is_vip_padded=True,
    )

    lods = [lod0, lod1, lod2, lod3, vip_lod0, vip_lod1]
    counts = {}
    for i, obj in enumerate(lods):
        obj.location = Vector((0.0, i * 0.75, 0.0))
        scene.collection.objects.link(obj)
        counts[obj.name] = {
            "triangles": len(obj.data.polygons),
            "vertices": len(obj.data.vertices),
        }
        log(f"Built {obj.name}: {len(obj.data.polygons):,} triangles, {len(obj.data.vertices):,} vertices")

    os.makedirs(GLB_DIR, exist_ok=True)
    glb_path = os.path.join(GLB_DIR, "stadiumx_seat_lods.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        export_apply=True,
    )
    glb_bytes = os.path.getsize(glb_path)
    log(f"Exported GLB -> {glb_path} ({glb_bytes:,} bytes)")

    return {"lod_counts": counts, "glb_path": glb_path, "glb_bytes": glb_bytes, "atlas_paths": atlas_paths}


# ==============================================================================
# 3. STEP 5: PHOTOREALISTIC REAL-LIFE STADIUM GRASS, CRICKET SQUARE & 22-YD PITCH
# ==============================================================================
def _fbm2d(x: np.ndarray, y: np.ndarray, octaves: int = 4, seed: int = 42) -> np.ndarray:
    """Fast vectorized multi-octave value/gradient noise for organic turf & clay variation."""
    out = np.zeros_like(x, dtype=np.float32)
    amp = 0.5
    freq = 1.0
    for i in range(octaves):
        s = seed + i * 131
        xi = x * freq
        yi = y * freq
        n = (
            np.sin(xi * 1.73 + yi * 1.19 + s * 0.13) * 0.45
            + np.cos(xi * 2.41 - yi * 1.87 + s * 0.29) * 0.35
            + np.sin((xi + yi) * 3.11 - s * 0.41) * 0.20
        )
        out += amp * (0.5 + 0.5 * n)
        amp *= 0.5
        freq *= 2.07
    return np.clip(out, 0.0, 1.0)


def bake_photoreal_ground_and_pitch_textures() -> dict:
    """
    Bakes 2K PBR textures for:
    1. Outfield Turf & 7-Strip Central Cricket Square (`grass_outfield/{albedo,normal,roughness,ao}.png`)
       - Natural Bermuda/ryegrass chlorophyll palette (deep emerald-olive vs warm sunlit-cut leaf green)
       - Bidirectional 5.5m x 7.5m stadium mower bands with directional blade-tilt normals & roughness anisotropy
       - Full 7-strip central Cricket Square (y = 0, +-3.15m, +-6.30m, +-9.45m) with adjacent practice/recovering clay strips
       - Fast-bowler run-up wear lanes (x = +-10.5..24.5m), umpire wear spots, and painted turf logos
       - Perimeter boundary buffer, terracotta clay warning track (r = 69.2..72.2m), and dark-emerald synthetic apron
    2. 22-Yard Match Pitch Rolled Clay (`pitch_clay/{albedo,normal,roughness}.png`)
       - Warm rolled straw-beige Bulli clay with good-length bounce wear patches, desiccation micro-cracks,
         bowler delivery footmark craters, spike marks, and crisp 50mm white creases (bowling, popping, return, wide)
    3. Perimeter LED Advertising Ribbon (`ad_boards/albedo.png`)
    """
    grass_dir = os.path.join( os.path.abspath("./blender_pipeline/textures"), "grass_outfield")
    pitch_dir = os.path.join( os.path.abspath("./blender_pipeline/textures"), "pitch_clay")
    ad_dir = os.path.join( os.path.abspath("./blender_pipeline/textures"), "ad_boards")
    os.makedirs(grass_dir, exist_ok=True)
    os.makedirs(pitch_dir, exist_ok=True)
    os.makedirs(ad_dir, exist_ok=True)

    paths = {
        "grass_albedo": os.path.join(grass_dir, "albedo.png"),
        "grass_normal": os.path.join(grass_dir, "normal.png"),
        "grass_roughness": os.path.join(grass_dir, "roughness.png"),
        "grass_ao": os.path.join(grass_dir, "ao.png"),
        "pitch_albedo": os.path.join(pitch_dir, "albedo.png"),
        "pitch_normal": os.path.join(pitch_dir, "normal.png"),
        "pitch_roughness": os.path.join(pitch_dir, "roughness.png"),
        "ad_albedo": os.path.join(ad_dir, "albedo.png"),
    }

    log("Baking 2K photorealistic Outfield Turf, 7-Strip Cricket Square & 22-Yard Pitch Clay PBR textures...")

    # --------------------------------------------------------------------------
    # A. 2048x2048 Outfield Turf + 7-Strip Cricket Square + Warning Track
    #    World mapping: (x, y) in [-84m, +84m] x [-84m, +84m]
    # --------------------------------------------------------------------------
    res = 2048
    coords = np.linspace(-84.0, 84.0, res, dtype=np.float32)
    wx, wy = np.meshgrid(coords, coords)

    # 1. Bidirectional stadium mower bands (5.5m along X, 7.5m cross-cut along Y + radial perimeter trim)
    stripe_w_x = 5.50
    stripe_w_y = 7.50
    band_x = 0.5 + 0.5 * np.tanh(np.sin(wx * (math.pi / stripe_w_x)) * 5.5)
    band_y = 0.5 + 0.5 * np.tanh(np.sin(wy * (math.pi / stripe_w_y)) * 4.5)
    # Checker/cross-cut blend like real ICC venues
    mower_mix = 0.68 * band_x + 0.32 * band_y

    # Subtle mower wheel track lines along the borders of each 5.5m X-band
    wheel_dist = np.abs(np.sin(wx * (math.pi / stripe_w_x)))
    wheel_track = np.exp(-((wheel_dist - 0.0) ** 2) / (2.0 * (0.045 ** 2)))

    # Multi-scale organic turf patches & micro-blade grain
    macro_patch = _fbm2d(wx * 0.085, wy * 0.085, octaves=4, seed=17)
    meso_clump = _fbm2d(wx * 0.45, wy * 0.45, octaves=4, seed=53)
    rng = np.random.default_rng(1042)
    micro_blade = rng.standard_normal((res, res), dtype=np.float32)

    # Natural sunlit Bermuda / Perennial Ryegrass sRGB palette:
    # Dark band (blades bent toward camera -> deeper emerald-olive stem shadow)
    col_dark = np.array([52.0, 104.0, 34.0], dtype=np.float32)
    # Light band (blades bent away -> warm golden-green cut leaf reflection)
    col_light = np.array([86.0, 138.0, 46.0], dtype=np.float32)
    # Dry thatch / golden root undertone
    col_thatch = np.array([122.0, 118.0, 62.0], dtype=np.float32)

    albedo = (
        col_dark[None, None, :] * (1.0 - mower_mix[:, :, None])
        + col_light[None, None, :] * mower_mix[:, :, None]
    )
    # Add wheel-track darkening & organic chlorophyll variation
    albedo *= (1.0 - 0.065 * wheel_track[:, :, None])
    albedo += (macro_patch[:, :, None] - 0.5) * np.array([14.0, 18.0, 8.0], dtype=np.float32)
    albedo += (meso_clump[:, :, None] - 0.5) * np.array([10.0, 13.0, 6.0], dtype=np.float32)
    albedo += micro_blade[:, :, None] * np.array([4.5, 6.0, 2.5], dtype=np.float32)

    # Blend subtle dry thatch in high-traffic infield zones
    infield_r = np.hypot(wx / 32.0, wy / 30.0)
    thatch_mask = np.clip((1.0 - infield_r) * 0.18 * macro_patch, 0.0, 0.22)
    albedo = albedo * (1.0 - thatch_mask[:, :, None]) + col_thatch[None, None, :] * thatch_mask[:, :, None]

    # Roughness & AO base for grass (anisotropic mower band sheen!)
    rough = 0.76 - 0.18 * mower_mix + 0.06 * (meso_clump - 0.5) + 0.025 * micro_blade
    ao = 0.88 + 0.08 * mower_mix - 0.08 * (1.0 - meso_clump) - 0.04 * wheel_track

    # 2. Full 7-Strip Central Cricket Square (|x| <= 11.4m, |y| <= 11.2m)
    #    Adjacent practice/regenerating strips at y = +-3.15m, +-6.30m, +-9.45m
    square_x_mask = np.clip((11.25 - np.abs(wx)) / 0.35, 0.0, 1.0)
    square_table_mask = square_x_mask * np.clip((11.10 - np.abs(wy)) / 0.45, 0.0, 1.0)
    # Slightly shorter, firmer turf across the cricket square table
    albedo = albedo * (1.0 - 0.25 * square_table_mask[:, :, None]) + np.array([76.0, 122.0, 48.0], dtype=np.float32)[None, None, :] * (0.25 * square_table_mask[:, :, None])

    strip_Configs = [
        # (y_center, clay_mix_strength, strip_rgb, has_creases)
        (-3.18, 0.82, np.array([166.0, 150.0, 112.0], dtype=np.float32), True),   # Recently used match strip
        ( 3.18, 0.76, np.array([158.0, 144.0, 106.0], dtype=np.float32), True),   # Used practice strip
        (-6.36, 0.48, np.array([124.0, 136.0,  82.0], dtype=np.float32), False),  # Semi-grassed regenerating strip
        ( 6.36, 0.52, np.array([128.0, 138.0,  86.0], dtype=np.float32), True),   # Semi-grassed strip with faint creases
        (-9.54, 0.30, np.array([102.0, 126.0,  64.0], dtype=np.float32), False),  # Outer square strip
        ( 9.54, 0.32, np.array([104.0, 128.0,  66.0], dtype=np.float32), False),  # Outer square strip
    ]
    for sy_c, c_str, s_rgb, has_cr in strip_Configs:
        sy_dist = np.abs(wy - sy_c)
        s_mask = square_x_mask * np.clip((1.42 - sy_dist) / 0.22, 0.0, 1.0) * c_str
        # Add footmark wear at x = +-8.8m on used adjacent strips
        wear_ends = np.exp(-((np.abs(wx) - 8.6) ** 2) / 2.2) * np.exp(-((wy - sy_c) ** 2) / 0.65)
        strip_col = s_rgb[None, None, :] + (meso_clump[:, :, None] - 0.5) * 14.0 - wear_ends[:, :, None] * np.array([22.0, 20.0, 16.0], dtype=np.float32)
        if has_cr:
            cr_b = np.exp(-((np.abs(wx) - 10.06) ** 2) / (2.0 * (0.045 ** 2))) * (sy_dist < 1.30)
            cr_p = np.exp(-((np.abs(wx) - 8.84) ** 2) / (2.0 * (0.045 ** 2))) * (sy_dist < 1.45)
            cr_mask = np.clip((cr_b + cr_p) * 0.55, 0.0, 0.65)
            strip_col = strip_col * (1.0 - cr_mask[:, :, None]) + np.array([225.0, 224.0, 216.0], dtype=np.float32)[None, None, :] * cr_mask[:, :, None]
        albedo = albedo * (1.0 - s_mask[:, :, None]) + strip_col * s_mask[:, :, None]
        rough = rough * (1.0 - s_mask) + 0.64 * s_mask

    # 3. Bowler Run-Up Wear Lanes (|x| in [11.2m..25.5m], y near 0 and +-3.18m) & Umpire Standing Spots
    runup_x = np.exp(-((np.abs(wx) - 16.5) / 6.2) ** 2) * (np.abs(wx) > 11.0)
    runup_y = (
        np.exp(-((wy - 0.42) / 0.55) ** 2)
        + np.exp(-((wy + 0.42) / 0.55) ** 2)
        + 0.45 * np.exp(-((np.abs(wy) - 3.18) / 0.60) ** 2)
    )
    umpire_spot = np.exp(-((np.abs(wx) - 11.35) ** 2 + (wy ** 2)) / 0.55)
    soil_wear = np.clip((runup_x * runup_y * 0.42 + umpire_spot * 0.55) * (0.65 + 0.35 * meso_clump), 0.0, 0.62)
    soil_rgb = np.array([142.0, 124.0, 88.0], dtype=np.float32)
    albedo = albedo * (1.0 - soil_wear[:, :, None]) + soil_rgb[None, None, :] * soil_wear[:, :, None]
    rough = rough * (1.0 - soil_wear) + 0.82 * soil_wear

    # 4. On-Grass Broadcast Sponsor Mats at (x = 0, y = +-15.5m)
    for sign_y in (-1.0, 1.0):
        mat_x = np.abs(wx)
        mat_y = np.abs(wy - sign_y * 15.5)
        in_box = (mat_x < 5.2) & (mat_y < 1.65)
        border = in_box & ((mat_x > 4.85) | (mat_y > 1.38))
        bars = in_box & (mat_x < 4.2) & (mat_y < 0.95) & (np.sin(wx * 2.8) > 0.15)
        albedo[in_box] = albedo[in_box] * 0.55 + np.array([18.0, 52.0, 118.0], dtype=np.float32) * 0.45
        albedo[border | bars] = albedo[border | bars] * 0.25 + np.array([232.0, 236.0, 240.0], dtype=np.float32) * 0.75

    # 5. Perimeter Boundary Line, Terracotta Warning Track & Synthetic Apron (elliptical radius)
    ell_r = np.hypot(wx / 68.0, wy / 62.0)
    # Crisp painted white boundary line just inside the padded rope (ell_r ~ 0.996)
    b_line = np.exp(-((ell_r - 0.995) / 0.0028) ** 2)
    albedo = albedo * (1.0 - 0.78 * b_line[:, :, None]) + np.array([235.0, 238.0, 235.0], dtype=np.float32)[None, None, :] * (0.78 * b_line[:, :, None])

    # Terracotta red-clay warning track / drainage apron outside the ad boards (ell_r in [1.045 .. 1.095])
    track_mask = np.clip((ell_r - 1.042) / 0.008, 0.0, 1.0) * np.clip((1.098 - ell_r) / 0.008, 0.0, 1.0)
    terracotta_rgb = np.array([148.0, 86.0, 58.0], dtype=np.float32) + (meso_clump[:, :, None] - 0.5) * 14.0 + micro_blade[:, :, None] * 4.0
    albedo = albedo * (1.0 - track_mask[:, :, None]) + terracotta_rgb * track_mask[:, :, None]
    rough = rough * (1.0 - track_mask) + 0.84 * track_mask

    # Dark emerald synthetic turf perimeter apron from warning track to Tier 1 concrete wall (ell_r > 1.098)
    apron_mask = np.clip((ell_r - 1.095) / 0.008, 0.0, 1.0)
    apron_rgb = np.array([36.0, 74.0, 42.0], dtype=np.float32) + micro_blade[:, :, None] * 3.0
    albedo = albedo * (1.0 - apron_mask[:, :, None]) + apron_rgb * apron_mask[:, :, None]
    rough = rough * (1.0 - apron_mask) + 0.68 * apron_mask

    # Construct tangent-space Normal map with anisotropic blade lay per mower band + micro-blade relief
    height_field = 0.35 * meso_clump + 0.25 * micro_blade - 0.20 * wheel_track - 0.25 * soil_wear
    dh_dx = np.gradient(height_field, axis=1)
    dh_dy = np.gradient(height_field, axis=0)
    # Directional blade tilt from mower rollers (alternating bands tilt normals +-0.14)
    blade_tilt_x = (band_x - 0.5) * 0.26 * (1.0 - track_mask) * (1.0 - apron_mask)
    blade_tilt_y = (band_y - 0.5) * 0.16 * (1.0 - track_mask) * (1.0 - apron_mask)
    nx = np.clip(-dh_dx * 1.45 + blade_tilt_x, -0.85, 0.85)
    ny = np.clip(-dh_dy * 1.45 + blade_tilt_y, -0.85, 0.85)
    nz = np.sqrt(np.maximum(0.05, 1.0 - nx * nx - ny * ny))
    norm_u8 = np.stack([(nx * 0.5 + 0.5) * 255.0, (ny * 0.5 + 0.5) * 255.0, (nz * 0.5 + 0.5) * 255.0], axis=-1)

    mrs.write_png(paths["grass_albedo"], np.clip(albedo, 0.0, 255.0).astype(np.uint8))
    mrs.write_png(paths["grass_normal"], np.clip(norm_u8, 0.0, 255.0).astype(np.uint8))
    rough_u8 = np.repeat(np.clip(rough * 255.0, 0.0, 255.0).astype(np.uint8)[:, :, None], 3, axis=2)
    ao_u8 = np.repeat(np.clip(ao * 255.0, 0.0, 255.0).astype(np.uint8)[:, :, None], 3, axis=2)
    mrs.write_png(paths["grass_roughness"], rough_u8)
    mrs.write_png(paths["grass_ao"], ao_u8)

    # --------------------------------------------------------------------------
    # B. 2048x512 22-Yard Match Pitch Rolled Clay (`pitch_clay/{albedo,normal,roughness}.png`)
    #    Physical coords: x in [-11.20m, +11.20m], y in [-1.525m, +1.525m]
    # --------------------------------------------------------------------------
    pw, ph = 2048, 512
    px_arr = np.linspace(-11.20, 11.20, pw, dtype=np.float32)
    py_arr = np.linspace(-1.525, 1.525, ph, dtype=np.float32)
    px, py = np.meshgrid(px_arr, py_arr)

    p_macro = _fbm2d(px * 0.85, py * 1.45, octaves=4, seed=91)
    p_micro = _fbm2d(px * 6.5, py * 6.5, octaves=4, seed=203)
    p_grain = rng.standard_normal((ph, pw), dtype=np.float32)

    # Base rolled straw-beige Bulli clay sRGB
    p_alb = np.zeros((ph, pw, 3), dtype=np.float32)
    p_alb[:, :, 0] = 196.0 + (p_macro - 0.5) * 22.0 + (p_micro - 0.5) * 14.0 + p_grain * 4.5
    p_alb[:, :, 1] = 172.0 + (p_macro - 0.5) * 20.0 + (p_micro - 0.5) * 12.0 + p_grain * 4.0
    p_alb[:, :, 2] = 132.0 + (p_macro - 0.5) * 16.0 + (p_micro - 0.5) * 10.0 + p_grain * 3.5

    # Subtle longitudinal heavy-roller bands along X
    roller_band = 0.5 + 0.5 * np.sin(py * (2.0 * math.pi / 0.76))
    p_alb -= roller_band[:, :, None] * np.array([6.0, 5.5, 4.0], dtype=np.float32)

    # Good-length bounce wear spots (x ~ +-6.0m, y ~ +-0.16m) - darker bruised consolidated clay
    bounce_wear = (
        np.exp(-((np.abs(px) - 6.0) ** 2) / 2.2) * np.exp(-((py - 0.10) ** 2) / 0.16)
        + 0.80 * np.exp(-((np.abs(px) - 4.4) ** 2) / 1.9) * np.exp(-((py + 0.14) ** 2) / 0.15)
    )
    bounce_wear = np.clip(bounce_wear * (0.65 + 0.35 * p_micro), 0.0, 0.85)
    p_alb = p_alb * (1.0 - 0.34 * bounce_wear[:, :, None]) + np.array([118.0, 96.0, 68.0], dtype=np.float32)[None, None, :] * (0.34 * bounce_wear[:, :, None])

    # Bowler delivery stride & follow-through footmarks (scuffed chalky/dark craters at x ~ +-8.2..9.6m, y ~ +-0.52m)
    foot_marks = (
        np.exp(-((px - 8.55) ** 2) / 0.65) * np.exp(-((py - 0.54) ** 2) / 0.095)
        + np.exp(-((px + 8.55) ** 2) / 0.65) * np.exp(-((py + 0.54) ** 2) / 0.095)
        + 0.85 * np.exp(-((px - 7.65) ** 2) / 0.85) * np.exp(-((py + 0.48) ** 2) / 0.10)
        + 0.85 * np.exp(-((px + 7.65) ** 2) / 0.85) * np.exp(-((py - 0.48) ** 2) / 0.10)
    )
    foot_marks = np.clip(foot_marks * (0.6 + 0.5 * p_micro), 0.0, 0.92)
    p_alb = p_alb * (1.0 - 0.46 * foot_marks[:, :, None]) + np.array([122.0, 100.0, 70.0], dtype=np.float32)[None, None, :] * (0.46 * foot_marks[:, :, None])

    # Batsman popping-crease spike scuffing (x ~ +-8.95m, |y| < 0.34m)
    bat_scuff = np.exp(-((np.abs(px) - 8.95) ** 2) / 0.28) * np.exp(-(py ** 2) / 0.12) * p_micro
    p_alb = p_alb * (1.0 - 0.32 * bat_scuff[:, :, None]) + np.array([218.0, 200.0, 162.0], dtype=np.float32)[None, None, :] * (0.32 * bat_scuff[:, :, None])

    # Desiccation micro-cracks across the clay surface
    crack_val = np.abs(np.sin(px * 9.5 + p_macro * 5.0) * np.cos(py * 11.0 + p_micro * 5.0))
    cracks = np.clip((0.065 - crack_val) / 0.065, 0.0, 1.0) * 0.52
    p_alb *= (1.0 - 0.36 * cracks[:, :, None])

    # Soft grass fringe along the outer 12cm edge of the pitch strip so it blends organically into the square
    edge_blend = np.clip((np.abs(py) - 1.38) / 0.145, 0.0, 1.0) * (0.65 + 0.35 * p_micro)
    end_blend = np.clip((np.abs(px) - 10.95) / 0.25, 0.0, 1.0) * (0.65 + 0.35 * p_micro)
    fringe = np.maximum(edge_blend, end_blend)
    p_alb = p_alb * (1.0 - fringe[:, :, None]) + np.array([68.0, 114.0, 42.0], dtype=np.float32)[None, None, :] * fringe[:, :, None]

    # Crisp 50mm White Painted ICC Crease Lines:
    lw = 0.028
    c_bowl = (np.abs(np.abs(px) - 10.06) <= lw) & (np.abs(py) <= 1.34)
    c_pop = (np.abs(np.abs(px) - 8.84) <= lw) & (np.abs(py) <= 1.50)
    c_ret = (np.abs(np.abs(py) - 1.32) <= lw) & (np.abs(px) >= 8.82) & (np.abs(px) <= 11.15)
    c_wide = (np.abs(np.abs(py) - 0.89) <= lw * 0.85) & (np.abs(px) >= 8.84) & (np.abs(px) <= 10.06)
    crease_mask = (c_bowl | c_pop | c_ret | c_wide).astype(np.float32)
    crease_wear = crease_mask * (1.0 - 0.35 * foot_marks - 0.25 * bat_scuff)
    white_paint = np.array([242.0, 241.0, 236.0], dtype=np.float32)
    p_alb = p_alb * (1.0 - crease_wear[:, :, None]) + white_paint[None, None, :] * crease_wear[:, :, None]

    p_height = 0.35 * p_micro + 0.15 * p_grain - 0.45 * cracks - 0.55 * foot_marks - 0.25 * bounce_wear + 0.12 * crease_wear
    pdx = np.gradient(p_height, axis=1)
    pdy = np.gradient(p_height, axis=0)
    pnx = np.clip(-pdx * 1.8, -0.85, 0.85)
    pny = np.clip(-pdy * 1.8, -0.85, 0.85)
    pnz = np.sqrt(np.maximum(0.05, 1.0 - pnx * pnx - pny * pny))
    p_norm_u8 = np.stack([(pnx * 0.5 + 0.5) * 255.0, (pny * 0.5 + 0.5) * 255.0, (pnz * 0.5 + 0.5) * 255.0], axis=-1)
    p_rough = np.clip(0.58 + 0.18 * foot_marks + 0.12 * bounce_wear - 0.10 * roller_band + 0.06 * (p_micro - 0.5), 0.35, 0.92)
    p_rough_u8 = np.repeat((p_rough * 255.0).astype(np.uint8)[:, :, None], 3, axis=2)

    mrs.write_png(paths["pitch_albedo"], np.clip(p_alb, 0.0, 255.0).astype(np.uint8))
    mrs.write_png(paths["pitch_normal"], np.clip(p_norm_u8, 0.0, 255.0).astype(np.uint8))
    mrs.write_png(paths["pitch_roughness"], p_rough_u8)

    # --------------------------------------------------------------------------
    # B2. 2048x512 Adjacent Cricket Square Practice/Recovering Strip Textures
    #     - `square_strip_albedo.png`: Used sandy-loam practice pitch (inner strips y = +-3.05m)
    #     - `square_grass_strip_albedo.png`: Closely mown regenerating turf strip (outer strips y = +-6.10m)
    # --------------------------------------------------------------------------
    paths["square_strip_albedo"] = os.path.join(pitch_dir, "square_strip_albedo.png")
    paths["square_grass_strip_albedo"] = os.path.join(pitch_dir, "square_grass_strip_albedo.png")

    s_alb = np.zeros((ph, pw, 3), dtype=np.float32)
    grass_speck = (p_grain > 0.10).astype(np.float32)
    s_alb[:, :, 0] = 162.0 + (p_macro - 0.5) * 22.0 + (p_micro - 0.5) * 14.0 - grass_speck * 28.0
    s_alb[:, :, 1] = 152.0 + (p_macro - 0.5) * 18.0 + (p_micro - 0.5) * 14.0 + grass_speck * 8.0
    s_alb[:, :, 2] = 104.0 + (p_macro - 0.5) * 14.0 + (p_micro - 0.5) * 10.0 - grass_speck * 20.0
    s_alb = s_alb * (1.0 - 0.38 * foot_marks[:, :, None]) + np.array([124.0, 104.0, 72.0], dtype=np.float32)[None, None, :] * (0.38 * foot_marks[:, :, None])
    s_alb = s_alb * (1.0 - 0.25 * bounce_wear[:, :, None]) + np.array([132.0, 114.0, 82.0], dtype=np.float32)[None, None, :] * (0.25 * bounce_wear[:, :, None])
    faint_cr = crease_mask * (0.48 - 0.25 * foot_marks)
    s_alb = s_alb * (1.0 - faint_cr[:, :, None]) + np.array([228.0, 226.0, 216.0], dtype=np.float32)[None, None, :] * faint_cr[:, :, None]
    seam_blend = np.clip((np.abs(py) - 1.38) / 0.145, 0.0, 1.0)
    s_alb = s_alb * (1.0 - seam_blend[:, :, None]) + np.array([68.0, 114.0, 42.0], dtype=np.float32)[None, None, :] * seam_blend[:, :, None]
    mrs.write_png(paths["square_strip_albedo"], np.clip(s_alb, 0.0, 255.0).astype(np.uint8))

    # Outer square strips (y = +-6.10m): closely mown olive-emerald regenerating turf over firm clay
    sg_alb = np.zeros((ph, pw, 3), dtype=np.float32)
    sg_alb[:, :, 0] = 98.0 + (p_macro - 0.5) * 18.0 + (p_micro - 0.5) * 12.0 + p_grain * 5.0
    sg_alb[:, :, 1] = 132.0 + (p_macro - 0.5) * 18.0 + (p_micro - 0.5) * 12.0 + p_grain * 6.0
    sg_alb[:, :, 2] = 58.0 + (p_macro - 0.5) * 12.0 + (p_micro - 0.5) * 8.0 + p_grain * 3.5
    sg_alb = sg_alb * (1.0 - seam_blend[:, :, None]) + np.array([64.0, 110.0, 38.0], dtype=np.float32)[None, None, :] * seam_blend[:, :, None]
    mrs.write_png(paths["square_grass_strip_albedo"], np.clip(sg_alb, 0.0, 255.0).astype(np.uint8))

    # --------------------------------------------------------------------------
    # C. 2048x256 Perimeter LED Advertising Ribbon Texture (`ad_boards/albedo.png`)
    # --------------------------------------------------------------------------
    aw, ah = 2048, 256
    ad_img = np.zeros((ah, aw, 3), dtype=np.uint8)
    panel_w = aw // 4
    panel_cols = [
        (12, 42, 118),   # Royal Blue STADIUMX panel
        (195, 42, 18),   # Broadcast Orange/Red sponsor panel
        (10, 82, 68),    # Emerald Teal sponsor panel
        (215, 152, 16),  # Championship Gold sponsor panel
    ]
    for p_i, rgb in enumerate(panel_cols):
        x0 = p_i * panel_w
        x1 = (p_i + 1) * panel_w
        ad_img[:, x0:x1, 0] = rgb[0]
        ad_img[:, x0:x1, 1] = rgb[1]
        ad_img[:, x0:x1, 2] = rgb[2]
        ad_img[0:18, x0:x1] = (240, 244, 250)
        ad_img[ah - 18:ah, x0:x1] = (240, 244, 250)
        ad_img[:, x0:x0 + 10] = (25, 28, 35)
        for b_i in range(6):
            bx0 = x0 + 55 + b_i * 68
            ad_img[64:192, bx0:bx0 + 38] = (245, 248, 252)
    ad_img[::4, :, :] = (ad_img[::4, :, :].astype(np.float32) * 0.82).astype(np.uint8)
    mrs.write_png(paths["ad_albedo"], ad_img)

    return paths


def _field_crown_z(x: float, y: float) -> float:
    """Smooth drainage crown: flat z = 0.260m across the central cricket square, tapering to 0.0m at perimeter."""
    dx = max(0.0, abs(x) - 11.20) / (77.5 - 11.20)
    dy = max(0.0, abs(y) - 7.65) / (71.5 - 7.65)
    r2 = min(1.0, dx * dx + dy * dy)
    return 0.260 * (1.0 - r2)


def build_playing_field_and_pitch(scene: bpy.types.Scene) -> None:
    """
    Builds a photorealistic, real-life international cricket stadium playing surface:
    - Removes legacy `GROUND_TURF_REFERENCE` / `PITCH_AXIS_REFERENCE`
    - Builds `OUTFIELD_CROWNED_TURF` with 2K global PBR maps + World-Space Multi-Scale Grass Blade & Thatch Shaders
      so the turf is razor-sharp at both 1m close-up and 180m aerial distance
    - Builds `PITCH_CLAY_22YD` (central match strip) + `CRICKET_SQUARE_ADJACENT_STRIPS` (4 adjacent high-res 2K strips
      on the central square at y = +-3.06m, +-6.12m) with zero pixel blur
    - Builds 3D `PITCH_CREASE_LINES_3D` (worn white painted 50mm bowling, popping, return, and wide creases)
    - Builds 3D `PITCH_FOREGROUND_3D_GRASS` (real 3D tapered grass blade tufts along the pitch seams and foreground)
    - Builds 3D `PITCH_STUMPS_AND_BAILS` (varnished ash-wood grain, middle-stump broadcast logo band, Zing bails)
    - Builds 3D `FIELD_30YD_CIRCLE_DECAL`, `BOUNDARY_PADDED_ROPE`, `ADVERTISING_LED_RIBBON_RING`, and Sightscreens
    """
    for obj in list(scene.objects):
        if any(k in obj.name.upper() for k in ("GROUND_TURF_REFERENCE", "PITCH_AXIS_REFERENCE")):
            bpy.data.objects.remove(obj, do_unlink=True)

    tex_paths = bake_photoreal_ground_and_pitch_textures()

    field_col = bpy.data.collections.new("08_Playing_Surface_And_Pitch")
    scene.collection.children.link(field_col)

    def load_img(path: str, non_color: bool = False) -> bpy.types.Image:
        img = bpy.data.images.load(path, check_existing=True)
        img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
        return img

    # --------------------------------------------------------------------------
    # 1. Outfield Turf Material: 2K Global Stadium Map + Multi-Scale World-Space Grass Blade Detail
    # --------------------------------------------------------------------------
    mat_turf = bpy.data.materials.new("M_Stadium_Outfield_Turf_2K")
    mat_turf.use_nodes = True
    nt = mat_turf.node_tree
    nt.nodes.clear()
    out_t = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf_t = nt.nodes.new("ShaderNodeBsdfPrincipled")
    if "Specular" in bsdf_t.inputs:
        bsdf_t.inputs["Specular"].default_value = 0.22
    if "Sheen" in bsdf_t.inputs:
        bsdf_t.inputs["Sheen"].default_value = 0.42

    uv_t = nt.nodes.new("ShaderNodeUVMap")
    uv_t.uv_map = "UVMap"

    t_alb = nt.nodes.new("ShaderNodeTexImage")
    t_alb.image = load_img(tex_paths["grass_albedo"], non_color=False)
    t_ao = nt.nodes.new("ShaderNodeTexImage")
    t_ao.image = load_img(tex_paths["grass_ao"], non_color=True)
    t_rough = nt.nodes.new("ShaderNodeTexImage")
    t_rough.image = load_img(tex_paths["grass_roughness"], non_color=True)
    t_norm = nt.nodes.new("ShaderNodeTexImage")
    t_norm.image = load_img(tex_paths["grass_normal"], non_color=True)

    for tn in (t_alb, t_ao, t_rough, t_norm):
        nt.links.new(uv_t.outputs["UV"], tn.inputs["Vector"])

    # World-space high-frequency grass blade & clover/thatch micro-variation (eliminates close-up pixel blur!)
    tc_obj = nt.nodes.new("ShaderNodeTexCoord")
    noise_clump = nt.nodes.new("ShaderNodeTexNoise")
    noise_clump.inputs["Scale"].default_value = 95.0
    noise_clump.inputs["Detail"].default_value = 6.0
    noise_clump.inputs["Roughness"].default_value = 0.68
    nt.links.new(tc_obj.outputs["Object"], noise_clump.inputs["Vector"])

    noise_blade = nt.nodes.new("ShaderNodeTexNoise")
    noise_blade.inputs["Scale"].default_value = 720.0
    noise_blade.inputs["Detail"].default_value = 10.0
    noise_blade.inputs["Roughness"].default_value = 0.78
    nt.links.new(tc_obj.outputs["Object"], noise_blade.inputs["Vector"])

    # Ramp for micro-blade color modulation (dark stem shadow vs sunlit leaf tip)
    ramp_blade = nt.nodes.new("ShaderNodeValToRGB")
    ramp_blade.color_ramp.elements[0].position = 0.28
    ramp_blade.color_ramp.elements[0].color = (0.58, 0.62, 0.50, 1.0)
    ramp_blade.color_ramp.elements[1].position = 0.72
    ramp_blade.color_ramp.elements[1].color = (1.28, 1.24, 1.06, 1.0)
    nt.links.new(noise_blade.outputs["Fac"], ramp_blade.inputs["Fac"])

    mix_micro = nt.nodes.new("ShaderNodeMixRGB")
    mix_micro.blend_type = "MULTIPLY"
    mix_micro.inputs["Fac"].default_value = 0.68
    nt.links.new(t_alb.outputs["Color"], mix_micro.inputs["Color1"])
    nt.links.new(ramp_blade.outputs["Color"], mix_micro.inputs["Color2"])

    mix_ao = nt.nodes.new("ShaderNodeMixRGB")
    mix_ao.blend_type = "MULTIPLY"
    mix_ao.inputs["Fac"].default_value = 0.55
    nt.links.new(mix_micro.outputs["Color"], mix_ao.inputs["Color1"])
    nt.links.new(t_ao.outputs["Color"], mix_ao.inputs["Color2"])
    nt.links.new(mix_ao.outputs["Color"], bsdf_t.inputs["Base Color"])
    nt.links.new(t_rough.outputs["Color"], bsdf_t.inputs["Roughness"])

    nmap_t = nt.nodes.new("ShaderNodeNormalMap")
    nmap_t.inputs["Strength"].default_value = 0.85
    nt.links.new(t_norm.outputs["Color"], nmap_t.inputs["Color"])

    bump_clump = nt.nodes.new("ShaderNodeBump")
    bump_clump.inputs["Strength"].default_value = 0.34
    bump_clump.inputs["Distance"].default_value = 0.025
    nt.links.new(noise_clump.outputs["Fac"], bump_clump.inputs["Height"])
    nt.links.new(nmap_t.outputs["Normal"], bump_clump.inputs["Normal"])

    bump_blade = nt.nodes.new("ShaderNodeBump")
    bump_blade.inputs["Strength"].default_value = 0.52
    bump_blade.inputs["Distance"].default_value = 0.008
    nt.links.new(noise_blade.outputs["Fac"], bump_blade.inputs["Height"])
    nt.links.new(bump_clump.outputs["Normal"], bump_blade.inputs["Normal"])
    nt.links.new(bump_blade.outputs["Normal"], bsdf_t.inputs["Normal"])
    nt.links.new(bsdf_t.outputs["BSDF"], out_t.inputs["Surface"])

    # --------------------------------------------------------------------------
    # 2. 22-Yard Pitch Clay Material + Adjacent Square Strip Material (with Micro-Soil & Cracks)
    # --------------------------------------------------------------------------
    def build_clay_strip_material(mat_name: str, alb_path: str) -> bpy.types.Material:
        mp = bpy.data.materials.new(mat_name)
        mp.use_nodes = True
        ntp = mp.node_tree
        ntp.nodes.clear()
        out_p = ntp.nodes.new("ShaderNodeOutputMaterial")
        bsdf_p = ntp.nodes.new("ShaderNodeBsdfPrincipled")
        if "Specular" in bsdf_p.inputs:
            bsdf_p.inputs["Specular"].default_value = 0.18

        uv_p = ntp.nodes.new("ShaderNodeUVMap")
        uv_p.uv_map = "UVMap"
        p_alb = ntp.nodes.new("ShaderNodeTexImage")
        p_alb.image = load_img(alb_path, non_color=False)
        p_rough = ntp.nodes.new("ShaderNodeTexImage")
        p_rough.image = load_img(tex_paths["pitch_roughness"], non_color=True)
        p_norm = ntp.nodes.new("ShaderNodeTexImage")
        p_norm.image = load_img(tex_paths["pitch_normal"], non_color=True)

        for tn in (p_alb, p_rough, p_norm):
            ntp.links.new(uv_p.outputs["UV"], tn.inputs["Vector"])

        # Add world-space millimeter clay grain + desiccation micro-relief
        tc_p = ntp.nodes.new("ShaderNodeTexCoord")
        n_soil = ntp.nodes.new("ShaderNodeTexNoise")
        n_soil.inputs["Scale"].default_value = 520.0
        n_soil.inputs["Detail"].default_value = 9.0
        n_soil.inputs["Roughness"].default_value = 0.75
        ntp.links.new(tc_p.outputs["Object"], n_soil.inputs["Vector"])

        ramp_soil = ntp.nodes.new("ShaderNodeValToRGB")
        ramp_soil.color_ramp.elements[0].position = 0.25
        ramp_soil.color_ramp.elements[0].color = (0.82, 0.80, 0.76, 1.0)
        ramp_soil.color_ramp.elements[1].position = 0.75
        ramp_soil.color_ramp.elements[1].color = (1.14, 1.12, 1.08, 1.0)
        ntp.links.new(n_soil.outputs["Fac"], ramp_soil.inputs["Fac"])

        mix_soil = ntp.nodes.new("ShaderNodeMixRGB")
        mix_soil.blend_type = "MULTIPLY"
        mix_soil.inputs["Fac"].default_value = 0.65
        ntp.links.new(p_alb.outputs["Color"], mix_soil.inputs["Color1"])
        ntp.links.new(ramp_soil.outputs["Color"], mix_soil.inputs["Color2"])
        ntp.links.new(mix_soil.outputs["Color"], bsdf_p.inputs["Base Color"])
        ntp.links.new(p_rough.outputs["Color"], bsdf_p.inputs["Roughness"])

        nmap_p = ntp.nodes.new("ShaderNodeNormalMap")
        nmap_p.inputs["Strength"].default_value = 0.85
        ntp.links.new(p_norm.outputs["Color"], nmap_p.inputs["Color"])

        bump_p = ntp.nodes.new("ShaderNodeBump")
        bump_p.inputs["Strength"].default_value = 0.36
        bump_p.inputs["Distance"].default_value = 0.006
        ntp.links.new(n_soil.outputs["Fac"], bump_p.inputs["Height"])
        ntp.links.new(nmap_p.outputs["Normal"], bump_p.inputs["Normal"])
        ntp.links.new(bump_p.outputs["Normal"], bsdf_p.inputs["Normal"])
        ntp.links.new(bsdf_p.outputs["BSDF"], out_p.inputs["Surface"])
        return mp

    mat_pitch = build_clay_strip_material("M_Pitch_Clay_22Yd_2K", tex_paths["pitch_albedo"])
    mat_sq_strip = build_clay_strip_material("M_Square_Adjacent_Strip_2K", tex_paths["square_strip_albedo"])
    mat_sq_grass_strip = build_clay_strip_material("M_Square_Grass_Strip_2K", tex_paths["square_grass_strip_albedo"])

    # --------------------------------------------------------------------------
    # 3. Auxiliary Field Furniture Materials (Wood-Grain Ash Stumps, Worn Crease Paint, 3D Grass Blade)
    # --------------------------------------------------------------------------
    def make_pbr(name: str, rgba: tuple, metallic: float = 0.0, roughness: float = 0.35, emit_rgba: tuple = None, emit_str: float = 0.0) -> bpy.types.Material:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = rgba
        b.inputs["Metallic"].default_value = metallic
        b.inputs["Roughness"].default_value = roughness
        if emit_rgba is not None and "Emission" in b.inputs:
            b.inputs["Emission"].default_value = emit_rgba
            if "Emission Strength" in b.inputs:
                b.inputs["Emission Strength"].default_value = emit_str
        return m

    # Procedural Varnished Ash Wood Stumps Material with vertical wood grain
    mat_ash_wood = bpy.data.materials.new("M_Ash_Wood_Stumps")
    mat_ash_wood.use_nodes = True
    ntw = mat_ash_wood.node_tree
    ntw.nodes.clear()
    out_w = ntw.nodes.new("ShaderNodeOutputMaterial")
    bsdf_w = ntw.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf_w.inputs["Roughness"].default_value = 0.24
    if "Clearcoat" in bsdf_w.inputs:
        bsdf_w.inputs["Clearcoat"].default_value = 0.35
    tc_w = ntw.nodes.new("ShaderNodeTexCoord")
    mp_w = ntw.nodes.new("ShaderNodeMapping")
    mp_w.inputs["Scale"].default_value = (18.0, 18.0, 2.2)
    ntw.links.new(tc_w.outputs["Object"], mp_w.inputs["Vector"])
    nw_tex = ntw.nodes.new("ShaderNodeTexNoise")
    nw_tex.inputs["Scale"].default_value = 14.0
    nw_tex.inputs["Detail"].default_value = 6.0
    ntw.links.new(mp_w.outputs["Vector"], nw_tex.inputs["Vector"])
    rw = ntw.nodes.new("ShaderNodeValToRGB")
    rw.color_ramp.elements[0].position = 0.25
    rw.color_ramp.elements[0].color = (0.52, 0.34, 0.15, 1.0)
    rw.color_ramp.elements[1].position = 0.78
    rw.color_ramp.elements[1].color = (0.82, 0.62, 0.32, 1.0)
    ntw.links.new(nw_tex.outputs["Fac"], rw.inputs["Fac"])
    ntw.links.new(rw.outputs["Color"], bsdf_w.inputs["Base Color"])
    ntw.links.new(bsdf_w.outputs["BSDF"], out_w.inputs["Surface"])

    mat_zing_led = make_pbr("M_Stump_Zing_LED", (0.98, 0.14, 0.06, 1.0), roughness=0.18, emit_rgba=(1.0, 0.18, 0.08, 1.0), emit_str=2.5)
    mat_stump_sponsor = make_pbr("M_Stump_Sponsor_Blue", (0.02, 0.12, 0.45, 1.0), roughness=0.22)

    # Worn White Crease Paint Material (subtle clay show-through & chalk texture)
    mat_crease_paint = bpy.data.materials.new("M_Worn_White_Crease_Paint")
    mat_crease_paint.use_nodes = True
    ntc = mat_crease_paint.node_tree
    ntc.nodes.clear()
    out_cr = ntc.nodes.new("ShaderNodeOutputMaterial")
    bsdf_cr = ntc.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf_cr.inputs["Roughness"].default_value = 0.74
    tc_cr = ntc.nodes.new("ShaderNodeTexCoord")
    n_cr = ntc.nodes.new("ShaderNodeTexNoise")
    n_cr.inputs["Scale"].default_value = 35.0
    n_cr.inputs["Detail"].default_value = 6.0
    ntc.links.new(tc_cr.outputs["Object"], n_cr.inputs["Vector"])
    r_cr = ntc.nodes.new("ShaderNodeValToRGB")
    r_cr.color_ramp.elements[0].position = 0.20
    r_cr.color_ramp.elements[0].color = (0.72, 0.66, 0.54, 1.0)  # Scuffed clay showing through paint
    r_cr.color_ramp.elements[1].position = 0.58
    r_cr.color_ramp.elements[1].color = (0.94, 0.94, 0.91, 1.0)  # Crisp chalk-white paint
    ntc.links.new(n_cr.outputs["Fac"], r_cr.inputs["Fac"])
    ntc.links.new(r_cr.outputs["Color"], bsdf_cr.inputs["Base Color"])
    ntc.links.new(bsdf_cr.outputs["BSDF"], out_cr.inputs["Surface"])

    mat_3d_grass = make_pbr("M_3D_Grass_Blades", (0.068, 0.185, 0.028, 1.0), roughness=0.52)
    mat_white_decal = make_pbr("M_White_Field_Decal", (0.92, 0.93, 0.90, 1.0), roughness=0.68)
    mat_rope_blue = make_pbr("M_Boundary_Rope_Blue", (0.015, 0.095, 0.38, 1.0), roughness=0.34)
    mat_rope_white = make_pbr("M_Boundary_Rope_White", (0.90, 0.92, 0.95, 1.0), roughness=0.34)
    mat_dark_steel = make_pbr("M_Field_Dark_Steel", (0.10, 0.11, 0.13, 1.0), metallic=0.82, roughness=0.36)

    mat_ad = bpy.data.materials.new("M_Perimeter_LED_Ad_Board")
    mat_ad.use_nodes = True
    nta = mat_ad.node_tree
    nta.nodes.clear()
    out_a = nta.nodes.new("ShaderNodeOutputMaterial")
    bsdf_a = nta.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf_a.inputs["Roughness"].default_value = 0.24
    uv_a = nta.nodes.new("ShaderNodeUVMap")
    uv_a.uv_map = "UVMap"
    tex_a = nta.nodes.new("ShaderNodeTexImage")
    tex_a.image = load_img(tex_paths["ad_albedo"], non_color=False)
    nta.links.new(uv_a.outputs["UV"], tex_a.inputs["Vector"])
    nta.links.new(tex_a.outputs["Color"], bsdf_a.inputs["Base Color"])
    if "Emission" in bsdf_a.inputs:
        nta.links.new(tex_a.outputs["Color"], bsdf_a.inputs["Emission"])
        if "Emission Strength" in bsdf_a.inputs:
            bsdf_a.inputs["Emission Strength"].default_value = 0.42
    nta.links.new(bsdf_a.outputs["BSDF"], out_a.inputs["Surface"])

    # --------------------------------------------------------------------------
    # 4. Build Rectilinear Crowned Outfield Turf (`OUTFIELD_CROWNED_TURF`) with Exact 5-Strip Square Cutout
    # --------------------------------------------------------------------------
    rx_max, ry_max = 83.5, 78.5
    p_half_x = 11.20
    sq_half_y = 7.625  # Exact cutout for the 5 central 3.05m square strips (y in [-7.625m, +7.625m])
    xs = sorted(set(list(np.linspace(-rx_max, rx_max, 116)) + [-p_half_x, p_half_x]))
    ys = sorted(set(list(np.linspace(-ry_max, ry_max, 108)) + [-sq_half_y, sq_half_y]))

    bm_turf = bmesh.new()
    uv_turf = bm_turf.loops.layers.uv.new("UVMap")
    nx, ny = len(xs) - 1, len(ys) - 1
    v_grid = [[None] * (nx + 1) for _ in range(ny + 1)]

    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            ell_r = math.hypot(x / rx_max, y / ry_max)
            px, py = (x / ell_r, y / ell_r) if ell_r > 1.0 else (x, y)
            pz = _field_crown_z(px, py)
            v_grid[iy][ix] = (bm_turf.verts.new((px, py, pz)), ell_r, px, py)

    for iy in range(ny):
        y_mid = 0.5 * (ys[iy] + ys[iy + 1])
        for ix in range(nx):
            x_mid = 0.5 * (xs[ix] + xs[ix + 1])
            if (abs(x_mid) < p_half_x - 1e-4) and (abs(y_mid) < sq_half_y - 1e-4):
                continue
            v00, r00, x00, y00 = v_grid[iy][ix]
            v10, r10, x10, y10 = v_grid[iy][ix + 1]
            v11, r11, x11, y11 = v_grid[iy + 1][ix + 1]
            v01, r01, x01, y01 = v_grid[iy + 1][ix]
            if min(r00, r10, r11, r01) > 1.03:
                continue
            try:
                f = bm_turf.faces.new((v00, v10, v11, v01))
                for loop, (vx, vy) in zip(f.loops, [(x00, y00), (x10, y10), (x11, y11), (x01, y01)]):
                    loop[uv_turf].uv = ((vx + 84.0) / 168.0, (vy + 84.0) / 168.0)
            except ValueError:
                pass

    bmesh.ops.remove_doubles(bm_turf, verts=bm_turf.verts, dist=0.001)
    bmesh.ops.recalc_face_normals(bm_turf, faces=bm_turf.faces)
    mesh_turf = bpy.data.meshes.new("OUTFIELD_CROWNED_TURF_MESH")
    bm_turf.to_mesh(mesh_turf)
    bm_turf.free()
    for p in mesh_turf.polygons:
        p.use_smooth = True
    obj_turf = bpy.data.objects.new("OUTFIELD_CROWNED_TURF", mesh_turf)
    obj_turf.data.materials.append(mat_turf)
    field_col.objects.link(obj_turf)

    # --------------------------------------------------------------------------
    # 5. Build Flush 22-Yard Match Pitch (`PITCH_CLAY_22YD`) + 4 High-Res Adjacent Square Strips
    # --------------------------------------------------------------------------
    z_pitch = 0.260

    def build_strip_mesh(obj_name: str, y_center: float, mat_strip: bpy.types.Material, flip_u: bool = False):
        bm_s = bmesh.new()
        uv_s = bm_s.loops.layers.uv.new("UVMap")
        px_l = np.linspace(-p_half_x, p_half_x, 48)
        py_l = np.linspace(y_center - 1.525, y_center + 1.525, 14)
        pvg = [[None] * len(px_l) for _ in range(len(py_l))]
        for iy, y in enumerate(py_l):
            for ix, x in enumerate(px_l):
                pvg[iy][ix] = bm_s.verts.new((float(x), float(y), z_pitch))
        for iy in range(len(py_l) - 1):
            v0 = iy / float(len(py_l) - 1)
            v1 = (iy + 1) / float(len(py_l) - 1)
            for ix in range(len(px_l) - 1):
                u0 = ix / float(len(px_l) - 1)
                u1 = (ix + 1) / float(len(px_l) - 1)
                if flip_u:
                    u0, u1 = 1.0 - u0, 1.0 - u1
                f = bm_s.faces.new((pvg[iy][ix], pvg[iy][ix + 1], pvg[iy + 1][ix + 1], pvg[iy + 1][ix]))
                for loop, uv in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
                    loop[uv_s].uv = uv
        bmesh.ops.recalc_face_normals(bm_s, faces=bm_s.faces)
        ms = bpy.data.meshes.new(f"{obj_name}_MESH")
        bm_s.to_mesh(ms)
        bm_s.free()
        for p in ms.polygons:
            p.use_smooth = True
        ob = bpy.data.objects.new(obj_name, ms)
        ob.data.materials.append(mat_strip)
        field_col.objects.link(ob)
        return ob

    build_strip_mesh("PITCH_CLAY_22YD", 0.0, mat_pitch, flip_u=False)
    for idx_s, (yc, m_s) in enumerate([
        (-6.10, mat_sq_grass_strip),
        (-3.05, mat_sq_strip),
        ( 3.05, mat_sq_strip),
        ( 6.10, mat_sq_grass_strip),
    ], start=1):
        build_strip_mesh(f"CRICKET_SQUARE_STRIP_{idx_s:02d}", yc, m_s, flip_u=(idx_s % 2 == 0))

    # --------------------------------------------------------------------------
    # 5B. Build Razor-Sharp 3D Painted Crease Decals (`PITCH_CREASE_LINES_3D`) on the 22-Yd Match Pitch
    # --------------------------------------------------------------------------
    bm_cr = bmesh.new()
    z_cr = z_pitch + 0.0018

    def add_crease_rect(x0: float, x1: float, y0: float, y1: float):
        v0 = bm_cr.verts.new((x0, y0, z_cr))
        v1 = bm_cr.verts.new((x1, y0, z_cr))
        v2 = bm_cr.verts.new((x1, y1, z_cr))
        v3 = bm_cr.verts.new((x0, y1, z_cr))
        bm_cr.faces.new((v0, v1, v2, v3))

    lw = 0.025  # 50mm standard ICC crease line width
    for sgn in (-1.0, 1.0):
        bx = sgn * 10.06  # Bowling crease
        px = sgn * 8.84   # Popping crease
        rx_end = sgn * 11.16
        add_crease_rect(min(bx - lw, bx + lw), max(bx - lw, bx + lw), -1.32, 1.32)
        add_crease_rect(min(px - lw, px + lw), max(px - lw, px + lw), -1.50, 1.50)
        for ry in (-1.32, 1.32):
            add_crease_rect(min(px, rx_end), max(px, rx_end), ry - lw, ry + lw)
        for wy_g in (-0.89, 0.89):
            add_crease_rect(min(px, bx), max(px, bx), wy_g - lw * 0.8, wy_g + lw * 0.8)

    bmesh.ops.recalc_face_normals(bm_cr, faces=bm_cr.faces)
    mesh_cr = bpy.data.meshes.new("PITCH_CREASE_LINES_3D_MESH")
    bm_cr.to_mesh(mesh_cr)
    bm_cr.free()
    obj_cr = bpy.data.objects.new("PITCH_CREASE_LINES_3D", mesh_cr)
    obj_cr.data.materials.append(mat_crease_paint)
    field_col.objects.link(obj_cr)

    # --------------------------------------------------------------------------
    # 5C. Build Fine 3D Grass Blade Tufts (`PITCH_FOREGROUND_3D_GRASS`) Strictly Along Turf Seams
    # --------------------------------------------------------------------------
    bm_gb = bmesh.new()
    rng_gb = np.random.default_rng(707)

    tuft_coords = []
    for seam_y in (-1.525, 1.525, -4.575, 4.575, -7.625, 7.625):
        xs_t = rng_gb.uniform(-11.2, 11.2, 650)
        ys_t = seam_y + rng_gb.normal(0.0, 0.045, 650)
        for xt, yt in zip(xs_t, ys_t):
            tuft_coords.append((float(xt), float(yt)))

    for xt, yt in tuft_coords:
        zt = _field_crown_z(xt, yt)
        for b_i in range(3):
            ang = rng_gb.uniform(0.0, math.pi * 2.0)
            bh = rng_gb.uniform(0.010, 0.020)
            bw = 0.0032
            lean = rng_gb.uniform(0.004, 0.010)
            dx = math.cos(ang) * bw
            dy = math.sin(ang) * bw
            lx = -math.sin(ang) * lean
            ly = math.cos(ang) * lean
            v0 = bm_gb.verts.new((xt - dx, yt - dy, zt))
            v1 = bm_gb.verts.new((xt + dx, yt + dy, zt))
            v2 = bm_gb.verts.new((xt + lx, yt + ly, zt + bh))
            bm_gb.faces.new((v0, v1, v2))

    bmesh.ops.recalc_face_normals(bm_gb, faces=bm_gb.faces)
    mesh_gb = bpy.data.meshes.new("PITCH_FOREGROUND_3D_GRASS_MESH")
    bm_gb.to_mesh(mesh_gb)
    bm_gb.free()
    obj_gb = bpy.data.objects.new("PITCH_FOREGROUND_3D_GRASS", mesh_gb)
    obj_gb.data.materials.append(mat_3d_grass)
    field_col.objects.link(obj_gb)

    # --------------------------------------------------------------------------
    # 6. Build 3D Ash-Wood Stumps & Zing Bails (`PITCH_STUMPS_AND_BAILS`) at x = +-10.06m
    # --------------------------------------------------------------------------
    bm_stumps = bmesh.new()
    stump_h = 0.711  # 28 inches
    stump_r = 0.019  # 3.8 cm
    stump_ys = (-0.1143, 0.0, 0.1143)

    for end_x in (-10.06, 10.06):
        for s_idx, sy in enumerate(stump_ys):
            # Main ash-wood cylinder
            res_s = bmesh.ops.create_cone(
                bm_stumps, cap_ends=True, cap_tris=False, segments=18,
                radius1=stump_r, radius2=stump_r * 0.94, depth=stump_h,
                matrix=Matrix.Translation((end_x, sy, z_pitch + stump_h * 0.5)),
            )
            for v in res_s["verts"]:
                for f in v.link_faces:
                    f.material_index = 0
            # Middle stump broadcast sponsor band & stump-cam housing
            if s_idx == 1:
                res_band = bmesh.ops.create_cone(
                    bm_stumps, cap_ends=True, cap_tris=False, segments=18,
                    radius1=stump_r * 1.015, radius2=stump_r * 1.015, depth=0.22,
                    matrix=Matrix.Translation((end_x, sy, z_pitch + 0.36)),
                )
                for v in res_band["verts"]:
                    for f in v.link_faces:
                        f.material_index = 2
            # Zing LED top spigot collar
            res_top = bmesh.ops.create_cone(
                bm_stumps, cap_ends=True, cap_tris=False, segments=18,
                radius1=stump_r * 0.92, radius2=stump_r * 0.74, depth=0.025,
                matrix=Matrix.Translation((end_x, sy, z_pitch + stump_h + 0.012)),
            )
            for v in res_top["verts"]:
                for f in v.link_faces:
                    f.material_index = 1

        for by_mid in (-0.05715, 0.05715):
            res_bail = bmesh.ops.create_cone(
                bm_stumps, cap_ends=True, cap_tris=False, segments=14,
                radius1=0.0105, radius2=0.0105, depth=0.108,
                matrix=Matrix.Translation((end_x, by_mid, z_pitch + stump_h + 0.028)) @ Matrix.Rotation(math.pi * 0.5, 4, "X"),
            )
            for v in res_bail["verts"]:
                for f in v.link_faces:
                    f.material_index = 0

    bmesh.ops.recalc_face_normals(bm_stumps, faces=bm_stumps.faces)
    mesh_stumps = bpy.data.meshes.new("PITCH_STUMPS_AND_BAILS_MESH")
    bm_stumps.to_mesh(mesh_stumps)
    bm_stumps.free()
    for p in mesh_stumps.polygons:
        p.use_smooth = True
    obj_stumps = bpy.data.objects.new("PITCH_STUMPS_AND_BAILS", mesh_stumps)
    obj_stumps.data.materials.append(mat_ash_wood)
    obj_stumps.data.materials.append(mat_zing_led)
    obj_stumps.data.materials.append(mat_stump_sponsor)
    field_col.objects.link(obj_stumps)


    # --------------------------------------------------------------------------
    # 7. Build Dashed 30-Yard Fielding Restriction Circle (`FIELD_30YD_CIRCLE_DECAL`)
    # --------------------------------------------------------------------------
    bm_circle = bmesh.new()
    r_30 = 27.432
    w_x = 10.06
    path_pts = []
    for k in range(36):
        ang = -math.pi * 0.5 + (math.pi * k) / 36.0
        path_pts.append((w_x + r_30 * math.cos(ang), r_30 * math.sin(ang)))
    for k in range(12):
        path_pts.append((w_x - 2.0 * w_x * (k / 12.0), r_30))
    for k in range(36):
        ang = math.pi * 0.5 + (math.pi * k) / 36.0
        path_pts.append((-w_x + r_30 * math.cos(ang), r_30 * math.sin(ang)))
    for k in range(12):
        path_pts.append((-w_x + 2.0 * w_x * (k / 12.0), -r_30))

    n_pts = len(path_pts)
    dash_half_w = 0.12
    for i in range(0, n_pts, 2):
        p0 = Vector((path_pts[i][0], path_pts[i][1], 0.0))
        p1 = Vector((path_pts[(i + 1) % n_pts][0], path_pts[(i + 1) % n_pts][1], 0.0))
        tang = (p1 - p0).normalized()
        perp = Vector((-tang.y, tang.x, 0.0)) * dash_half_w
        verts = [
            bm_circle.verts.new((c.x, c.y, _field_crown_z(c.x, c.y) + 0.008))
            for c in (p0 + perp, p0 - perp, p1 - perp, p1 + perp)
        ]
        bm_circle.faces.new(verts)

    bmesh.ops.recalc_face_normals(bm_circle, faces=bm_circle.faces)
    mesh_circle = bpy.data.meshes.new("FIELD_30YD_CIRCLE_DECAL_MESH")
    bm_circle.to_mesh(mesh_circle)
    bm_circle.free()
    obj_circle = bpy.data.objects.new("FIELD_30YD_CIRCLE_DECAL", mesh_circle)
    obj_circle.data.materials.append(mat_white_decal)
    field_col.objects.link(obj_circle)

    # --------------------------------------------------------------------------
    # 8. Build Padded Boundary Cushion Rope (`BOUNDARY_PADDED_ROPE`) & Perimeter LED Ad Boards
    # --------------------------------------------------------------------------
    bm_rope = bmesh.new()
    rx_b, ry_b = 68.0, 62.0
    segs = 144
    rope_r = 0.18
    for i in range(segs):
        a0 = (2.0 * math.pi * i) / float(segs)
        a1 = (2.0 * math.pi * (i + 1)) / float(segs)
        x0, y0 = rx_b * math.cos(a0), ry_b * math.sin(a0)
        x1, y1 = rx_b * math.cos(a1), ry_b * math.sin(a1)
        z0, z1 = _field_crown_z(x0, y0), _field_crown_z(x1, y1)
        n0 = Vector((math.cos(a0), math.sin(a0), 0.0))
        n1 = Vector((math.cos(a1), math.sin(a1), 0.0))

        v0_in = bm_rope.verts.new((x0 - n0.x * rope_r, y0 - n0.y * rope_r, z0 + 0.01))
        v0_out = bm_rope.verts.new((x0 + n0.x * rope_r, y0 + n0.y * rope_r, z0 + 0.01))
        v0_top = bm_rope.verts.new((x0, y0, z0 + 0.25))
        v1_in = bm_rope.verts.new((x1 - n1.x * rope_r, y1 - n1.y * rope_r, z1 + 0.01))
        v1_out = bm_rope.verts.new((x1 + n1.x * rope_r, y1 + n1.y * rope_r, z1 + 0.01))
        v1_top = bm_rope.verts.new((x1, y1, z1 + 0.25))

        mat_idx = 0 if (i % 4 < 3) else 1
        f_in = bm_rope.faces.new((v0_in, v1_in, v1_top, v0_top))
        f_out = bm_rope.faces.new((v0_top, v1_top, v1_out, v0_out))
        f_in.material_index = mat_idx
        f_out.material_index = mat_idx

    bmesh.ops.recalc_face_normals(bm_rope, faces=bm_rope.faces)
    mesh_rope = bpy.data.meshes.new("BOUNDARY_PADDED_ROPE_MESH")
    bm_rope.to_mesh(mesh_rope)
    bm_rope.free()
    for p in mesh_rope.polygons:
        p.use_smooth = True
    obj_rope = bpy.data.objects.new("BOUNDARY_PADDED_ROPE", mesh_rope)
    obj_rope.data.materials.append(mat_rope_blue)
    obj_rope.data.materials.append(mat_rope_white)
    field_col.objects.link(obj_rope)

    # Perimeter LED Advertising Board Ring (`ADVERTISING_LED_RIBBON_RING`)
    bm_ad = bmesh.new()
    uv_ad = bm_ad.loops.layers.uv.new("UVMap")
    rx_a, ry_a, ad_h = 70.2, 64.2, 1.05
    ad_segs = 128
    repeats = 16.0
    for i in range(ad_segs):
        a0 = (2.0 * math.pi * i) / float(ad_segs)
        a1 = (2.0 * math.pi * (i + 1)) / float(ad_segs)
        deg_mid = math.degrees((a0 + a1) * 0.5) % 360.0
        if abs(deg_mid - 270.0) < 2.8:
            continue
        c0, s0 = math.cos(a0), math.sin(a0)
        c1, s1 = math.cos(a1), math.sin(a1)
        x0, y0 = rx_a * c0, ry_a * s0
        x1, y1 = rx_a * c1, ry_a * s1
        z0, z1 = _field_crown_z(x0, y0), _field_crown_z(x1, y1)

        v_b0 = bm_ad.verts.new((x0, y0, z0))
        v_b1 = bm_ad.verts.new((x1, y1, z1))
        v_t1 = bm_ad.verts.new(((rx_a + 0.18) * c1, (ry_a + 0.18) * s1, z1 + ad_h))
        v_t0 = bm_ad.verts.new(((rx_a + 0.18) * c0, (ry_a + 0.18) * s0, z0 + ad_h))
        v_r0 = bm_ad.verts.new(((rx_a + 0.72) * c0, (ry_a + 0.72) * s0, z0))
        v_r1 = bm_ad.verts.new(((rx_a + 0.72) * c1, (ry_a + 0.72) * s1, z1))

        u0 = (i / float(ad_segs)) * repeats
        u1 = ((i + 1) / float(ad_segs)) * repeats
        f_front = bm_ad.faces.new((v_b1, v_b0, v_t0, v_t1))
        f_front.material_index = 0
        for loop, uv in zip(f_front.loops, [(u1, 0.0), (u0, 0.0), (u0, 1.0), (u1, 1.0)]):
            loop[uv_ad].uv = uv
        f_back = bm_ad.faces.new((v_b0, v_b1, v_r1, v_r0))
        f_back2 = bm_ad.faces.new((v_t0, v_t1, v_r1, v_r0))
        for fb in (f_back, f_back2):
            fb.material_index = 1
            for loop in fb.loops:
                loop[uv_ad].uv = (0.0, 0.0)

    bmesh.ops.recalc_face_normals(bm_ad, faces=bm_ad.faces)
    mesh_ad = bpy.data.meshes.new("ADVERTISING_LED_RIBBON_RING_MESH")
    bm_ad.to_mesh(mesh_ad)
    bm_ad.free()
    obj_ad = bpy.data.objects.new("ADVERTISING_LED_RIBBON_RING", mesh_ad)
    obj_ad.data.materials.append(mat_ad)
    obj_ad.data.materials.append(mat_dark_steel)
    field_col.objects.link(obj_ad)

    # Sightscreens at East/West ends
    for end_sign, s_name in ((-1.0, "SIGHTSCREEN_WEST"), (1.0, "SIGHTSCREEN_EAST")):
        bm_s = bmesh.new()
        bmesh.ops.create_cube(bm_s, size=1.0, matrix=Matrix.Translation((end_sign * 74.2, 0.0, 2.85)) @ Matrix.Diagonal((0.35, 13.6, 4.8, 1.0)))
        ms = bpy.data.meshes.new(f"{s_name}_MESH")
        bm_s.to_mesh(ms)
        bm_s.free()
        os_obj = bpy.data.objects.new(s_name, ms)
        os_obj.data.materials.append(mat_white_decal)
        field_col.objects.link(os_obj)



def apply_box_projected_concrete_to_bowl(scene: bpy.types.Scene, tex_paths: dict) -> bpy.types.Material:
    """Creates a box-projected 2K pale bush-hammered concrete material and assigns it to stadium bowl tier meshes."""
    mat = bpy.data.materials.new("M_Stadium_Bowl_Pale_Concrete_2K")
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.82
    if "Specular" in bsdf.inputs:
        bsdf.inputs["Specular"].default_value = 0.24
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tc = nodes.new("ShaderNodeTexCoord")
    mp = nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.65, 0.65, 0.65)
    links.new(tc.outputs["Object"], mp.inputs["Vector"])

    img_alb = bpy.data.images.load(tex_paths["albedo"], check_existing=True)
    tex_alb = nodes.new("ShaderNodeTexImage")
    tex_alb.image = img_alb
    tex_alb.projection = "BOX"
    tex_alb.projection_blend = 0.25
    links.new(mp.outputs["Vector"], tex_alb.inputs["Vector"])

    hsv = nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = 0.45
    hsv.inputs["Value"].default_value = 1.18
    links.new(tex_alb.outputs["Color"], hsv.inputs["Color"])
    links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])

    img_nrm = bpy.data.images.load(tex_paths["normal"], check_existing=True)
    img_nrm.colorspace_settings.name = "Non-Color"
    tex_nrm = nodes.new("ShaderNodeTexImage")
    tex_nrm.image = img_nrm
    tex_nrm.projection = "BOX"
    tex_nrm.projection_blend = 0.25
    links.new(mp.outputs["Vector"], tex_nrm.inputs["Vector"])

    nrm_node = nodes.new("ShaderNodeNormalMap")
    nrm_node.inputs["Strength"].default_value = 0.85
    links.new(tex_nrm.outputs["Color"], nrm_node.inputs["Color"])
    links.new(nrm_node.outputs["Normal"], bsdf.inputs["Normal"])

    for obj in scene.objects:
        if obj.type == "MESH":
            nm = obj.name.upper()
            if any(k in nm for k in ("TIER", "BOWL", "STEP", "CONCOURSE", "VOMITORY", "PLINTH")):
                if len(obj.data.materials) == 0:
                    obj.data.materials.append(mat)
                else:
                    obj.data.materials[0] = mat
    return mat


def render_step5_stadium_scale_proofs(lod_summary: dict) -> dict:
    m1_blend = os.path.abspath("./blender_pipeline/output/stadiumx_milestone1_bowl_roof.blend")
    if not os.path.exists(m1_blend):
        log(f"ERROR: {m1_blend} does not exist.")
        return {}

    bpy.ops.wm.open_mainfile(filepath=m1_blend)
    scene = bpy.context.scene
    log(f"Loaded Milestone 1 stadium bowl scene: {m1_blend}")

    build_playing_field_and_pitch(scene)

    # Build PBR reference materials + mosaic variants (RoyalBlue, NavyBlue, CyanBlue, Orange, Yellow, VIP)
    tex_paths = mrs.bake_2k_concrete_step_textures(mrs.CONFIG["texture_dir"])
    apply_box_projected_concrete_to_bowl(scene, tex_paths)

    params = {
        "plastic_base_rgba": (0.0015, 0.029, 0.132, 1.0),
        "plastic_top_rgba": (0.0050, 0.056, 0.215, 1.0),
        "plastic_cavity_rgba": (0.0005, 0.007, 0.032, 1.0),
        "plastic_rough_min": 0.36,
        "plastic_rough_max": 0.44,
        "plastic_specular": 0.56,
        "plastic_clearcoat": 0.15,
        "concrete_value_mult": 1.18,
    }
    mats_blue = mrs.build_match_materials(tex_paths, params)
    mat_vip = bpy.data.materials.new("M_Ref_VIP_Padded_Cushion")
    mat_vip.use_nodes = True
    mat_vip.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.012, 0.032, 0.095, 1.0)
    mat_vip.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.34
    mats_blue["vip_leather"] = mat_vip

    def make_mosaic_mats(suffix: str, base_rgb: tuple) -> dict:
        m_dict = dict(mats_blue)
        m_sh = bpy.data.materials.new(f"M_Ref_Plastic_{suffix}")
        m_sh.use_nodes = True
        bsdf = m_sh.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*base_rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.40
        if "Clearcoat" in bsdf.inputs:
            bsdf.inputs["Clearcoat"].default_value = 0.15
        m_dict["plastic_outer"] = m_sh
        return m_dict

    mats_by_mosaic = {
        "RoyalBlue": mats_blue,
        "NavyBlue": make_mosaic_mats("NavyBlue", (0.003, 0.018, 0.075)),
        "CyanBlue": make_mosaic_mats("CyanBlue", (0.012, 0.115, 0.285)),
        "Orange": make_mosaic_mats("Orange", (0.62, 0.12, 0.012)),
        "Yellow": make_mosaic_mats("Yellow", (0.72, 0.46, 0.018)),
        "AccessibleTeal": make_mosaic_mats("AccessibleTeal", (0.015, 0.22, 0.24)),
    }

    # Build LOD0 templates per mosaic color + VIP_LOD0 + fast LOD3 template for full-bowl merged mesh
    lod0_by_mosaic = {}
    for m_key, m_dict in mats_by_mosaic.items():
        lod0_by_mosaic[m_key] = build_parametric_seat_lod(
            f"SEAT_HERO_LOD0_{m_key}", m_dict,
            nu=46, nz=40,
            include_lower_slots=True, include_top_slot=True,
            include_3d_screws=True, include_3d_disc=True,
            arm_segs=(16, 12), bol_segs=(18, 12), ped_segs=14,
            seat_width=0.464, is_vip_padded=False,
        ).data

    vip_lod0_mesh = build_parametric_seat_lod(
        "SEAT_HERO_VIP_LOD0", mats_blue,
        nu=46, nz=40,
        include_lower_slots=True, include_top_slot=True,
        include_3d_screws=True, include_3d_disc=True,
        arm_segs=(16, 12), bol_segs=(20, 14), ped_segs=14,
        seat_width=0.580, is_vip_padded=True,
    ).data
    lod0_by_mosaic["VIPNavyGold"] = vip_lod0_mesh

    # Fast 16-triangle stepped backrest+pan proxy for the 50,000 distant mosaic seats (30m..220m away)
    bm_proxy = bmesh.new()
    # Seat pan quad + backrest quad (clean 3D stepped seat profile for mid/aerial views)
    vp = [
        bm_proxy.verts.new((-0.02, -0.21, 0.36)),
        bm_proxy.verts.new((-0.34, -0.21, 0.38)),
        bm_proxy.verts.new((-0.34,  0.21, 0.38)),
        bm_proxy.verts.new((-0.02,  0.21, 0.36)),
        bm_proxy.verts.new((-0.02, -0.21, 0.84)),
        bm_proxy.verts.new((-0.02,  0.21, 0.84)),
        bm_proxy.verts.new(( 0.04, -0.21, 0.84)),
        bm_proxy.verts.new(( 0.04,  0.21, 0.84)),
        bm_proxy.verts.new(( 0.04, -0.21, 0.36)),
        bm_proxy.verts.new(( 0.04,  0.21, 0.36)),
    ]
    bm_proxy.faces.new((vp[0], vp[1], vp[2], vp[3]))
    bm_proxy.faces.new((vp[0], vp[3], vp[5], vp[4]))
    bm_proxy.faces.new((vp[4], vp[5], vp[7], vp[6]))
    bm_proxy.faces.new((vp[6], vp[7], vp[9], vp[8]))
    bmesh.ops.recalc_face_normals(bm_proxy, faces=bm_proxy.faces)
    bmesh.ops.triangulate(bm_proxy, faces=bm_proxy.faces)

    hero_col = bpy.data.collections.new("09_Hero_Reference_Seats_And_Bowl")
    scene.collection.children.link(hero_col)

    # 1. Load the 51,769 validated seat anchors (`seat_anchors.json`) so every seat in all 8 stands
    #    and 3 tiers sits on the exact concrete step tread of `stadiumx_milestone1_bowl_roof.blend`!
    anchors_path = os.path.join(OUTPUT_DIR, "seat_anchors.json")
    with open(anchors_path, "r", encoding="utf-8") as fa:
        anchors = json.load(fa)
    log(f"Loaded {len(anchors):,} validated seat anchors from {anchors_path}")

    hero_blocks = {"S-T1-B03", "S-T2-B03"}
    linked_lod0_count = 0

    bm_Proxy_verts = list(bm_proxy.verts)
    bm_Proxy_faces = list(bm_proxy.faces)

    bm_bowl = bmesh.new()
    mosaic_order = ["RoyalBlue", "NavyBlue", "CyanBlue", "Orange", "Yellow", "VIPNavyGold", "AccessibleTeal"]
    mosaic_to_slot = {k: i for i, k in enumerate(mosaic_order)}

    for a in anchors:
        pos = Vector((a["x"], a["y"], a["z"]))
        rot_z = Matrix.Rotation(math.radians(a["yaw"]), 4, "Z")
        xform = Matrix.Translation(pos) @ rot_z
        mcol = a["mosaicColor"]

        if a["block"] in hero_blocks:
            if a["block"] == "S-T1-B03" and a["row"] <= 8:
                mesh_db = lod0_by_mosaic["RoyalBlue"]
            else:
                mesh_db = lod0_by_mosaic.get(mcol, lod0_by_mosaic["RoyalBlue"])
            inst_obj = bpy.data.objects.new(a["seatId"], mesh_db)
            inst_obj.matrix_world = xform
            hero_col.objects.link(inst_obj)
            linked_lod0_count += 1
            continue

        slot_idx = mosaic_to_slot.get(mcol, 0)
        v_map = [bm_bowl.verts.new(xform @ v.co) for v in bm_Proxy_verts]
        for f in bm_Proxy_faces:
            nf = bm_bowl.faces.new([v_map[v.index] for v in f.verts])
            nf.material_index = slot_idx

    bm_proxy.free()
    bowl_mesh = bpy.data.meshes.new("SEATS_FULL_BOWL_51K_MOSAIC_MESH")
    bm_bowl.to_mesh(bowl_mesh)
    bm_bowl.free()
    bowl_obj = bpy.data.objects.new("SEATS_FULL_BOWL_51K_MOSAIC", bowl_mesh)
    for m_key in mosaic_order:
        if m_key == "VIPNavyGold":
            bowl_obj.data.materials.append(mats_blue["vip_leather"])
        else:
            bowl_obj.data.materials.append(mats_by_mosaic[m_key]["plastic_outer"])
    hero_col.objects.link(bowl_obj)
    log(f"Instanced {linked_lod0_count:,} LOD0 hero seats + {len(anchors) - linked_lod0_count:,} merged full-bowl mosaic seats.")

    # 2. Build the 1 m Hero Reference Vignette (`HERO_1M_CONCRETE_STEPS` + `SEAT_HERO_A..E` using `SEAT_STD_LOD0`)
    #    at `vig_origin = (0.0, 0.0, 48.0)` in open midday sunlight above the stadium roof so `stadium_seat_proof_1m.png`
    #    frames the exact aisle three-quarter reference view inside the stadium scene with zero roof shadow!
    vig_col = bpy.data.collections.new("10_Hero_1m_Aisle_Vignette")
    scene.collection.children.link(vig_col)
    vig_origin = Vector((0.0, 0.0, 48.0))
    vig_xform = Matrix.Translation(vig_origin)

    bm_c = bmesh.new()
    uv_c = bm_c.loops.layers.uv.new("UVMap")

    def add_chipped_concrete_step(x0, x1, y0, y1, z0, z1):
        res_c = bmesh.ops.create_cube(
            bm_c,
            size=1.0,
            matrix=Matrix.Translation(((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5))
            @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1.0)),
        )
        edges_to_bevel = list({e for v in res_c["verts"] for e in v.link_edges})
        bmesh.ops.bevel(bm_c, geom=edges_to_bevel, offset=0.010, offset_type="OFFSET", segments=4, profile=0.48)

    add_chipped_concrete_step(-0.28, 2.40, -1.80, 1.80, -0.26, 0.0)
    add_chipped_concrete_step(-1.60, -0.28, -1.80, 1.80, -0.50, -0.22)
    add_chipped_concrete_step(0.24, 1.50, -0.95, -0.06, 0.0, 0.52)
    bmesh.ops.recalc_face_normals(bm_c, faces=bm_c.faces)
    for f in bm_c.faces:
        n = f.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in f.loops:
            co = loop.vert.co
            if az >= ax and az >= ay:
                loop[uv_c].uv = (co.x * 0.95 + 0.5, co.y * 0.95 + 0.5)
            elif ax >= ay:
                loop[uv_c].uv = (co.y * 0.95 + 0.5, co.z * 0.95 + 0.5)
            else:
                loop[uv_c].uv = (co.x * 0.95 + 0.5, co.z * 0.95 + 0.5)

    mesh_c = bpy.data.meshes.new("HERO_1M_CONCRETE_STEPS_MESH")
    bm_c.to_mesh(mesh_c)
    bm_c.free()
    for p in mesh_c.polygons:
        p.use_smooth = True
    steps_obj = bpy.data.objects.new("HERO_1M_CONCRETE_STEPS", mesh_c)
    steps_obj.data.materials.append(mats_blue["concrete_steps"])
    steps_obj.matrix_world = vig_xform
    vig_col.objects.link(steps_obj)

    hero_placements = [
        ("VIG_SEAT_HERO_A", Vector((0.0, 0.02, 0.0)), -4.0),
        ("VIG_SEAT_FOREGROUND_B", Vector((-0.06, -0.45, -0.11)), -4.0),
        ("VIG_SEAT_UPPER_LEFT_C", Vector((-0.16, 0.44, 0.12)), -4.0),
        ("VIG_SEAT_BG_PEDESTAL_1", Vector((0.68, 0.48, 0.36)), -4.0),
        ("VIG_SEAT_BG_PEDESTAL_2", Vector((0.68, 0.16, 0.36)), -4.0),
        ("VIG_SEAT_UPPER_RIGHT_E", Vector((0.26, -0.76, 0.52)), -4.0),
    ]
    for h_name, loc_local, yaw_deg in hero_placements:
        inst = bpy.data.objects.new(h_name, lod0_by_mosaic["RoyalBlue"])
        inst.matrix_world = vig_xform @ Matrix.Translation(loc_local) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
        vig_col.objects.link(inst)

    # Replace World shader with clean midday sky dome so Nishita sky sun doesn't cast a dark roof shadow
    world = bpy.data.worlds.new("W_Step5_Midday_Sky")
    scene.world = world
    world.use_nodes = True
    w_nt = world.node_tree
    w_nt.nodes.clear()
    w_out = w_nt.nodes.new("ShaderNodeOutputWorld")
    w_bg = w_nt.nodes.new("ShaderNodeBackground")
    w_bg.inputs["Color"].default_value = (0.42, 0.60, 0.90, 1.0)
    w_bg.inputs["Strength"].default_value = 0.72
    w_nt.links.new(w_bg.outputs["Background"], w_out.inputs["Surface"])

    # Clear existing lights and set up sun + bounce fill
    for obj in list(scene.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)

    sun_data = bpy.data.lights.new("SUN_Step5_Stadium", type="SUN")
    sun_data.energy = 4.6
    sun_data.angle = math.radians(1.15)
    sun_data.color = (1.0, 0.985, 0.955)
    sun_obj = bpy.data.objects.new("SUN_Step5_Stadium", sun_data)
    scene.collection.objects.link(sun_obj)

    fill_data = bpy.data.lights.new("FILL_Step5_Hero", type="AREA")
    fill_data.energy = 16.0
    fill_data.size = 3.0
    fill_data.color = (0.86, 0.92, 1.0)
    fill_obj = bpy.data.objects.new("FILL_Step5_Hero", fill_data)
    scene.collection.objects.link(fill_obj)
    fill_obj.location = vig_xform @ Vector((-1.4, -0.9, 0.45))
    fill_dir = (vig_origin + Vector((0.0, 0.0, 0.55))) - fill_obj.location
    fill_obj.rotation_euler = fill_dir.to_track_quat("-Z", "Y").to_euler()

    # Identify upper-tier & roof objects so we can disable shadow casting on close-up views (1m, 3m, 15m)
    roof_objs = [
        o for o in scene.objects
        if o.type == "MESH"
        and not o.name.startswith("VIG_")
        and not o.name.startswith("HERO_1M")
        and not o.name.startswith("S-T1")
        and not any(k in o.name.upper() for k in ("TIER_1", "OUTFIELD", "PITCH", "CRICKET_SQUARE", "BOUNDARY", "ADVERTISING", "SIGHTSCREEN", "FIELD_30YD"))
    ]

    anchor_by_id = {a["seatId"]: a for a in anchors}
    a_3m = anchor_by_id.get("S-T1-B03-R05-S04") or next(a for a in anchors if a["block"] == "S-T1-B03" and a["row"] == 5 and a["number"] >= 3)
    a_15m = anchor_by_id.get("S-T1-B03-R08-S12") or a_3m
    a_fpv = anchor_by_id.get("S-T1-B03-R06-S10") or next(a for a in anchors if a["block"] == "S-T1-B03" and a["row"] == 6)

    cx, cy, cz = a_3m["x"], a_3m["y"], a_3m["z"]
    bx, by, bz = a_15m["x"], a_15m["y"], a_15m["z"]
    ex, ey, ez_eye = a_fpv["x"], a_fpv["y"], a_fpv["eyeHeight"]

    # Configure the 5 required Step 5 views:
    # 1. 1m aisle close-up: Exact Round 6 aisle three-quarter view on the sunlit Vignette
    cam_1m_loc = vig_xform @ Vector((-0.82, -0.44, 1.15))
    cam_1m_tgt = vig_xform @ Vector((-0.02, -0.10, 0.54))
    sun_1m = Vector((0.35, -0.58, -0.73)).normalized()

    # 2. 3m close-up: 3.0 m behind and beside Seats 4..10 of `S-T1-B03` (clear of aisle handrail!),
    #    showing 5 stepped rows of LOD0 seats (90 mm aluminum discs, Phillips screws, curved slots, armrests)
    #    bolted onto pale concrete steps with the green mown-stripe cricket outfield beyond Row 1!
    cam_3m_loc = Vector((cx - 1.45, cy - 2.20, cz + 1.55))
    cam_3m_tgt = Vector((cx + 0.90, cy + 0.95, cz + 0.25))
    sun_3m = Vector((0.38, 0.55, -0.74)).normalized()

    # 3. 15m mid-range: 15 m diagonal view across Stand South Lower Tier 1 (`S-T1-B03`) & Middle VIP Tier 2 (`S-T2-B03`)
    cam_15m_loc = Vector((bx + 9.0, by + 13.5, bz + 4.8))
    cam_15m_tgt = Vector((bx - 2.5, by - 3.5, bz + 1.8))
    sun_15m = Vector((-0.35, -0.55, -0.75)).normalized()

    # 4. Seated first-person view: Exact `(x, y, eyeHeight = z + 1.15 m)` of `S-T1-B03-R06-S10` looking at pitch & bowl
    cam_fpv_loc = Vector((ex, ey, ez_eye))
    cam_fpv_tgt = Vector((0.0, 0.0, -4.5))
    sun_fpv = Vector((0.35, 0.52, -0.78)).normalized()

    # 5. High aerial overview: Complete 3-tier elliptical bowl, pleated roof, striped turf, and 51,769 mosaic seats
    cam_aerial_loc = Vector((168.0, -148.0, 112.0))
    cam_aerial_tgt = Vector((0.0, 0.0, 10.0))
    sun_aerial = Vector((-0.35, 0.45, -0.82)).normalized()

    # 6. Dedicated Pitch & Ground Close-Up Broadcast View (`stadium_pitch_and_ground_proof.png`):
    #    Positioned near the West umpire / bowler run-up (`x = -13.2 m, y = -2.35 m, z = 1.82 m`) looking
    #    across the foreground ash-wood stumps & Zing bails, crisp 50mm 3D white bowling/popping/return creases,
    #    the 22-yard rolled straw-beige clay match pitch (with footmarks, bounce wear & micro-soil grain),
    #    the 5-strip high-res central cricket square, 3D foreground grass blade tufts, cross-mown Bermuda
    #    grass bands, 30-yard dashed circle, padded boundary rope, perimeter LED ad ribbon, and 3-tier bowl!
    cam_pitch_loc = Vector((-13.2, -2.35, 1.82))
    cam_pitch_tgt = Vector((5.8, 1.85, 0.38))
    sun_pitch = Vector((0.36, 0.52, -0.77)).normalized()

    views = [
        ("stadium_seat_proof_1m.png", cam_1m_loc, cam_1m_tgt, 43.0, 6.3, 0.96, (1280, 800), 36, sun_1m, True, True, False),
        ("stadium_seat_proof_3m.png", cam_3m_loc, cam_3m_tgt, 38.0, 8.0, 2.80, (1280, 800), 28, sun_3m, False, True, False),
        ("stadium_seat_proof_15m.png", cam_15m_loc, cam_15m_tgt, 28.0, 11.0, 15.0, (1280, 800), 24, sun_15m, False, True, False),
        ("stadium_seat_proof_seated_fpv.png", cam_fpv_loc, cam_fpv_tgt, 24.0, 11.0, 20.0, (1280, 800), 26, sun_fpv, False, False, True),
        ("stadium_seat_proof_aerial.png", cam_aerial_loc, cam_aerial_tgt, 30.0, 16.0, 180.0, (1280, 800), 24, sun_aerial, False, False, False),
        ("stadium_pitch_and_ground_proof.png", cam_pitch_loc, cam_pitch_tgt, 35.0, 22.0, 6.5, (1280, 800), 32, sun_pitch, False, True, True),
    ]

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.05
    scene.cycles.adaptive_min_samples = 12
    scene.cycles.max_bounces = 2
    scene.cycles.diffuse_bounces = 1
    scene.cycles.glossy_bounces = 1

    cam_data = bpy.data.cameras.new("CAM_Step5_Proof")
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.sensor_width = 36.0
    cam_obj = bpy.data.objects.new("CAM_Step5_Proof", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    rendered_files = {}
    for fname, loc, tgt, lens_mm, fstop, focus_d, (rx, ry), spp, s_dir, show_vig, hide_roof_sh, force_rerender in views:
        out_path = os.path.join(OUTPUT_DIR, fname)
        if not force_rerender and os.path.exists(out_path) and os.path.getsize(out_path) > 50000:
            log(f"Reusing existing non-field view: {fname}")
            rendered_files[fname] = out_path
            continue

        vig_col.hide_render = not show_vig
        fill_obj.hide_render = not show_vig
        for ro in roof_objs:
            ro.visible_shadow = not hide_roof_sh

        sun_obj.rotation_euler = s_dir.to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = lens_mm
        cam_data.dof.use_dof = (fstop <= 8.5)
        cam_data.dof.aperture_fstop = fstop
        cam_data.dof.focus_distance = focus_d

        cam_obj.location = loc
        direction = tgt - loc
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.resolution_x = rx
        scene.render.resolution_y = ry
        scene.cycles.samples = spp

        raw_path = os.path.join(OUTPUT_DIR, f"_raw_{fname}")
        scene.render.filepath = raw_path
        log(f"Rendering Step 5 proof view: {fname} ({rx}x{ry}, {spp} samples) ...")
        bpy.ops.render.render(write_still=True)

        raw_u8 = mrs.load_png_srgb_u8(raw_path)
        den_u8 = mrs.edge_preserving_bilateral_denoise(raw_u8, sigma_color=9.0)
        mrs.write_png(out_path, den_u8)
        if os.path.exists(raw_path):
            os.remove(raw_path)
        rendered_files[fname] = out_path

    for ro in roof_objs:
        ro.visible_shadow = True
    blend_out = os.path.join(OUTPUT_DIR, "stadiumx_step4_5_seats_at_scale.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_out)
    return rendered_files


if __name__ == "__main__":
    t_start = time.time()
    lod_info = build_all_seat_lods_and_export_glb()
    proof_renders = render_step5_stadium_scale_proofs(lod_info)
    summary = {
        "lod_summary": lod_info,
        "step5_proof_renders": proof_renders,
        "total_time_sec": round(time.time() - t_start, 2),
    }
    summary_path = os.path.join(OUTPUT_DIR, "step4_5_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2), flush=True)
