#!/usr/bin/env python3
"""
================================================================================
STADIUMX — REFERENCE PHOTO MATCH PIPELINE (STEPS 2 & 3)
HIGH-POLY MASTER SEAT (20,000 - 50,000 TRIANGLES) + CONCRETE STEPS +
1920x1200 128-SAMPLE CYCLES MATCH RENDER + AUTOMATED NUMERIC COMPARISON
================================================================================
File: blender_pipeline/match_reference_seat.py

Implements:
- Step 2.1: High-Poly Master Seat (32,000-42,000 triangles) with:
  * Rear backrest face (-X): raised outer perimeter frame with S-curved shoulder
    arch, two long curved through-slots near the top + lower horizontal slat slot
    (with contour-snapped smooth beveled slot rims — zero grid staircase),
    ribbed horizontal slats with 3-4 mm bevels, 90 mm brushed-aluminum round
    number disc recessed at the upper third with two tiny countersunk screws,
    and stainless pan-head Phillips screws with 3D '+' drive slots on the left
    outer frame rail.
  * Sitter-facing front face (+X): clean molded plastic contour.
  * Molded armrests flowing continuously from the shell with a rolled outer lip
    and a recessed hollow inner cavity shaded darker navy than the outer shell.
  * Sculpted upturned/folded tip-up cushion bolster between the armrests and
    dark navy cast pedestal with webbed floor flange.
- Step 2.2: Off-white bush-hammered / broom-finished concrete step block with
  2K tiling PBR texture, detail normal, 7 mm chipped nosing, and expansion joint.
- Step 2.3: Node-based PBR materials for satin-to-semi-gloss cobalt/navy HDPE
  plastic (albedo gradient, top-face sun/dust lift, cavity darkening, roughness
  variation 0.35-0.45, clearcoat 0.16, EDM mold grain), anisotropic brushed
  aluminum disc, stainless steel screws, dark navy cast pedestal, and pale concrete.
- Step 3: Renders `match_round_N.png` at 1920x1200 with 128 Cycles samples +
  edge-preserving bilateral denoiser, generates `match_round_N_side_by_side.png`,
  and computes quantitative metrics against `/blender_pipeline/reference/seat_ref.png`.
================================================================================
"""

import bpy
import bmesh
import math
import json
import os
import sys
import time
import zlib
import struct
import numpy as np
from mathutils import Vector, Matrix


CONFIG = {
    "ref_image_path": os.path.abspath("./blender_pipeline/reference/seat_ref.png"),
    "output_dir": os.path.abspath("./blender_pipeline/output"),
    "texture_dir": os.path.abspath("./blender_pipeline/textures/seat_match"),
    "resolution": (1920, 1200),
    "samples": 128,
    "seat_pitch": 0.480,
    "seat_height": 0.855,
}


def log(msg: str) -> None:
    print(f"[SEAT-MATCH] {msg}", flush=True)


def write_png(filepath: str, arr: np.ndarray) -> int:
    """Writes an (H, W, 3) or (H, W) uint8 numpy array to PNG (row 0 = top)."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    if arr.ndim == 2:
        h, w = arr.shape
        ctype = 0
    else:
        h, w, c = arr.shape
        ctype = 2 if c == 3 else 6
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 4)) + chunk(b"IEND", b"")
    with open(filepath, "wb") as f:
        f.write(png)
    return len(png)


# ==============================================================================
# 1. BAKE 2K CONCRETE STEP PBR TEXTURES (BROOM FINISH + FINE PORES + AGGREGATE)
# ==============================================================================
def bake_2k_concrete_step_textures(tex_dir: str) -> dict:
    os.makedirs(tex_dir, exist_ok=True)
    res = 2048
    u = np.linspace(0.0, 1.0, res, dtype=np.float32)
    U, V = np.meshgrid(u, u)
    rng = np.random.default_rng(108)

    # Multi-scale mineral aggregate + bush-hammered concrete pits + subtle broom finish
    broom = 0.5 + 0.5 * np.sin(V * 220.0 * math.pi + 0.45 * np.sin(U * 32.0 * math.pi))
    macro = (
        0.5
        + 0.22 * np.sin(U * 8.0 * math.pi) * np.cos(V * 8.0 * math.pi)
        + 0.16 * np.sin((U * 1.3 + V * 0.9) * 18.0 * math.pi)
        + 0.10 * np.cos((U * 2.1 - V * 1.7) * 34.0 * math.pi)
    )
    grain = rng.normal(0.0, 1.0, size=(res, res)).astype(np.float32)
    # Pitted concrete air pockets (1-5 mm dark pores visible on the step riser in seat_ref.png)
    pores = (grain < -1.65).astype(np.float32)
    med_pits = ((np.sin(U * 95.0 * math.pi) * np.cos(V * 110.0 * math.pi) + grain * 0.45) < -1.15).astype(np.float32)

    # Base pale off-white concrete color matching seat_ref.png (~226 sRGB in sun, ~172 on shaded riser)
    base_val = 228.0 + 9.0 * (macro - 0.5) + 3.5 * (broom - 0.5) + grain * 5.8 - pores * 46.0 - med_pits * 28.0
    albedo = np.zeros((res, res, 3), dtype=np.uint8)
    albedo[:, :, 0] = np.clip(base_val - 1.0, 0, 255).astype(np.uint8)
    albedo[:, :, 1] = np.clip(base_val, 0, 255).astype(np.uint8)
    albedo[:, :, 2] = np.clip(base_val + 1.8, 0, 255).astype(np.uint8)

    # Tangent-space normal map with crisp aggregate pits & directional broom texture
    dx = rng.normal(0.0, 0.16, size=(res, res)).astype(np.float32) - pores * 0.48 - med_pits * 0.32
    dy = rng.normal(0.0, 0.16, size=(res, res)).astype(np.float32) + 0.16 * np.cos(V * 220.0 * math.pi) - pores * 0.35
    normal = np.zeros((res, res, 3), dtype=np.uint8)
    normal[:, :, 0] = np.clip(128.0 + dx * 105.0, 0, 255).astype(np.uint8)
    normal[:, :, 1] = np.clip(128.0 + dy * 105.0, 0, 255).astype(np.uint8)
    normal[:, :, 2] = 242

    rough = np.clip((0.76 + 0.12 * pores + 0.08 * med_pits - 0.05 * macro) * 255.0, 0, 255).astype(np.uint8)

    paths = {
        "albedo": os.path.join(tex_dir, "concrete_albedo_2k.png"),
        "normal": os.path.join(tex_dir, "concrete_normal_2k.png"),
        "roughness": os.path.join(tex_dir, "concrete_roughness_2k.png"),
    }
    write_png(paths["albedo"], albedo)
    write_png(paths["normal"], normal)
    write_png(paths["roughness"], rough)
    return paths


# ==============================================================================
# 2. BUILD PBR MATERIALS MATCHING `seat_ref.png`
# ==============================================================================
def build_match_materials(tex_paths: dict, params: dict) -> dict:
    mats = {}

    # 1. Outer Satin Molded HDPE Shell (`M_Ref_Seat_Outer_HDPE`)
    #    Matches reference royal/navy blue (sRGB ~ [31, 68, 115]), satin roughness ~0.38,
    #    subtle clearcoat 0.16, upward-facing sun/dust lift, and fine EDM mold grain.
    mat_plastic = bpy.data.materials.new("M_Ref_Seat_Outer_HDPE")
    mat_plastic.use_nodes = True
    nt = mat_plastic.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")

    geom = nt.nodes.new("ShaderNodeNewGeometry")
    sep_n = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp_top = nt.nodes.new("ShaderNodeValToRGB")
    ramp_top.color_ramp.elements[0].position = 0.0
    ramp_top.color_ramp.elements[0].color = params["plastic_base_rgba"]
    ramp_top.color_ramp.elements[1].position = 0.82
    ramp_top.color_ramp.elements[1].color = params["plastic_top_rgba"]

    tex_coord = nt.nodes.new("ShaderNodeTexCoord")
    noise_fine = nt.nodes.new("ShaderNodeTexNoise")
    noise_fine.inputs["Scale"].default_value = 340.0
    noise_fine.inputs["Detail"].default_value = 3.0
    noise_fine.inputs["Roughness"].default_value = 0.60

    noise_rough = nt.nodes.new("ShaderNodeTexNoise")
    noise_rough.inputs["Scale"].default_value = 38.0
    noise_rough.inputs["Detail"].default_value = 2.5

    map_rough = nt.nodes.new("ShaderNodeMapRange")
    map_rough.inputs["From Min"].default_value = 0.0
    map_rough.inputs["From Max"].default_value = 1.0
    map_rough.inputs["To Min"].default_value = params["plastic_rough_min"]
    map_rough.inputs["To Max"].default_value = params["plastic_rough_max"]

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.036
    bump.inputs["Distance"].default_value = 0.0012

    if "Specular" in bsdf.inputs:
        bsdf.inputs["Specular"].default_value = params["plastic_specular"]
    if "Clearcoat" in bsdf.inputs:
        bsdf.inputs["Clearcoat"].default_value = params["plastic_clearcoat"]
    if "Clearcoat Roughness" in bsdf.inputs:
        bsdf.inputs["Clearcoat Roughness"].default_value = 0.22

    nt.links.new(geom.outputs["Normal"], sep_n.inputs["Vector"])
    nt.links.new(sep_n.outputs["Z"], ramp_top.inputs["Fac"])
    nt.links.new(ramp_top.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex_coord.outputs["Object"], noise_fine.inputs["Vector"])
    nt.links.new(tex_coord.outputs["Object"], noise_rough.inputs["Vector"])
    nt.links.new(noise_rough.outputs["Fac"], map_rough.inputs["Value"])
    nt.links.new(map_rough.outputs["Result"], bsdf.inputs["Roughness"])
    nt.links.new(noise_fine.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mats["plastic_outer"] = mat_plastic

    # 2. Hollow Inner Cavity & Recessed Slot/Groove Material (`M_Ref_Seat_Hollow_Cavity`)
    #    Explicitly darker navy than the outer shell (Correction 3)
    mat_cavity = bpy.data.materials.new("M_Ref_Seat_Hollow_Cavity")
    mat_cavity.use_nodes = True
    ntc = mat_cavity.node_tree
    bsdf_c = ntc.nodes["Principled BSDF"]
    bsdf_c.inputs["Base Color"].default_value = params["plastic_cavity_rgba"]
    bsdf_c.inputs["Roughness"].default_value = 0.45
    if "Specular" in bsdf_c.inputs:
        bsdf_c.inputs["Specular"].default_value = 0.32
    if "Clearcoat" in bsdf_c.inputs:
        bsdf_c.inputs["Clearcoat"].default_value = 0.05
    mats["plastic_cavity"] = mat_cavity

    # 3. 90 mm Satin Anodized Brushed-Aluminum Number Disc (`M_Ref_Brushed_Aluminum_Disc`)
    #    Bright silver-grey anodized finish matching seat_ref.png (~[196, 206, 215] sRGB)
    mat_disc = bpy.data.materials.new("M_Ref_Brushed_Aluminum_Disc")
    mat_disc.use_nodes = True
    ntd = mat_disc.node_tree
    ntd.nodes.clear()
    out_d = ntd.nodes.new("ShaderNodeOutputMaterial")
    bsdf_d = ntd.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf_d.inputs["Base Color"].default_value = (0.58, 0.64, 0.71, 1.0)
    bsdf_d.inputs["Metallic"].default_value = 0.36
    bsdf_d.inputs["Roughness"].default_value = 0.42
    if "Specular" in bsdf_d.inputs:
        bsdf_d.inputs["Specular"].default_value = 0.75
    if "Clearcoat" in bsdf_d.inputs:
        bsdf_d.inputs["Clearcoat"].default_value = 0.25
    tc_d = ntd.nodes.new("ShaderNodeTexCoord")
    map_d = ntd.nodes.new("ShaderNodeMapping")
    map_d.inputs["Scale"].default_value = (14.0, 280.0, 14.0)
    noise_d = ntd.nodes.new("ShaderNodeTexNoise")
    noise_d.inputs["Scale"].default_value = 16.0
    noise_d.inputs["Detail"].default_value = 2.0
    bump_d = ntd.nodes.new("ShaderNodeBump")
    bump_d.inputs["Strength"].default_value = 0.025
    ntd.links.new(tc_d.outputs["Object"], map_d.inputs["Vector"])
    ntd.links.new(map_d.outputs["Vector"], noise_d.inputs["Vector"])
    ntd.links.new(noise_d.outputs["Fac"], bump_d.inputs["Height"])
    ntd.links.new(bump_d.outputs["Normal"], bsdf_d.inputs["Normal"])
    ntd.links.new(bsdf_d.outputs["BSDF"], out_d.inputs["Surface"])
    mats["aluminum_disc"] = mat_disc

    # 4. Stainless Steel Pan-Head Phillips Screws & Tiny Disc Rivets (`M_Ref_Stainless_Screws`)
    mat_screw = bpy.data.materials.new("M_Ref_Stainless_Screws")
    mat_screw.use_nodes = True
    bsdf_s = mat_screw.node_tree.nodes["Principled BSDF"]
    bsdf_s.inputs["Base Color"].default_value = (0.66, 0.71, 0.77, 1.0)
    bsdf_s.inputs["Metallic"].default_value = 0.42
    bsdf_s.inputs["Roughness"].default_value = 0.32
    if "Specular" in bsdf_s.inputs:
        bsdf_s.inputs["Specular"].default_value = 0.85
    mats["stainless_screw"] = mat_screw

    # 5. Dark Navy Cast Pedestal & Recessed Shadow Gaps (`M_Ref_Cast_Navy_Pedestal`)
    mat_ped = bpy.data.materials.new("M_Ref_Cast_Navy_Pedestal")
    mat_ped.use_nodes = True
    bsdf_p = mat_ped.node_tree.nodes["Principled BSDF"]
    bsdf_p.inputs["Base Color"].default_value = (0.005, 0.012, 0.032, 1.0)
    bsdf_p.inputs["Metallic"].default_value = 0.30
    bsdf_p.inputs["Roughness"].default_value = 0.40
    mats["cast_pedestal"] = mat_ped

    # 6. Pale Broom-Finished / Bush-Hammered Concrete Steps (`M_Ref_Concrete_Steps`)
    mat_conc = bpy.data.materials.new("M_Ref_Concrete_Steps")
    mat_conc.use_nodes = True
    ntk = mat_conc.node_tree
    ntk.nodes.clear()
    out_k = ntk.nodes.new("ShaderNodeOutputMaterial")
    bsdf_k = ntk.nodes.new("ShaderNodeBsdfPrincipled")
    if "Specular" in bsdf_k.inputs:
        bsdf_k.inputs["Specular"].default_value = 0.16

    uv_k = ntk.nodes.new("ShaderNodeUVMap")
    uv_k.uv_map = "UVMap"

    img_alb = bpy.data.images.load(tex_paths["albedo"], check_existing=True)
    img_nrm = bpy.data.images.load(tex_paths["normal"], check_existing=True)
    img_nrm.colorspace_settings.name = "Non-Color"
    img_rgh = bpy.data.images.load(tex_paths["roughness"], check_existing=True)
    img_rgh.colorspace_settings.name = "Non-Color"

    t_alb = ntk.nodes.new("ShaderNodeTexImage")
    t_alb.image = img_alb
    t_nrm = ntk.nodes.new("ShaderNodeTexImage")
    t_nrm.image = img_nrm
    t_rgh = ntk.nodes.new("ShaderNodeTexImage")
    t_rgh.image = img_rgh

    bc_mult = ntk.nodes.new("ShaderNodeHueSaturation")
    bc_mult.inputs["Value"].default_value = params["concrete_value_mult"]

    nmap = ntk.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 0.85

    for tn in (t_alb, t_nrm, t_rgh):
        ntk.links.new(uv_k.outputs["UV"], tn.inputs["Vector"])
    ntk.links.new(t_alb.outputs["Color"], bc_mult.inputs["Color"])
    ntk.links.new(bc_mult.outputs["Color"], bsdf_k.inputs["Base Color"])
    ntk.links.new(t_rgh.outputs["Color"], bsdf_k.inputs["Roughness"])
    ntk.links.new(t_nrm.outputs["Color"], nmap.inputs["Color"])
    ntk.links.new(nmap.outputs["Normal"], bsdf_k.inputs["Normal"])
    ntk.links.new(bsdf_k.outputs["BSDF"], out_k.inputs["Surface"])
    mats["concrete_steps"] = mat_conc

    return mats


# ==============================================================================
# 3. HIGH-POLY MASTER SEAT GENERATOR (20,000 - 50,000 TRIANGLES)
#    WITH CONTOUR-ALIGNED SMOOTH THROUGH-SLOTS & EXACT REFERENCE HARDWARE
# ==============================================================================
def backrest_top_crown_z(u: float) -> float:
    """
    Computes the top profile height z(u) of the backrest with the distinctive
    S-curved shoulder arch seen in `seat_ref.png`:
    - Outer side frame uprights at |u| >= 0.82 sit at z = 0.728 m
    - Sweeps smoothly upward via a cubic Hermite shoulder curve to z = 0.855 m at u = 0
    """
    au = abs(u)
    s = max(0.0, min(1.0, (0.83 - au) / 0.60))
    smooth_s = s * s * (3.0 - 2.0 * s)
    arch_top = math.cos(min(1.0, au / 0.56) * math.pi * 0.5) ** 0.68
    return 0.726 + 0.129 * (0.74 * smooth_s + 0.26 * arch_top)


def backrest_grid_z(u: float, v: float) -> float:
    """
    Maps normalized vertical parameter v in [0, 1] to physical height z(u, v)
    so that for v <= 0.80, the horizontal grid lines follow the exact gentle
    arch of the three through-slots and slats (`arch_z`), and smoothly blend
    into `backrest_top_crown_z(u)` near the top shoulder arch.
    This guarantees that the horizontal slot edges align with the grid lines
    and have ZERO staircase/sawtooth artifacts!
    """
    z_bot = 0.340
    # Gentle upward arch of the slats & slots in the center of the backrest
    slat_arch = 0.022 * max(0.0, 1.0 - (u / 0.78) ** 2)
    z_slat_band = z_bot + v * (0.815 - z_bot) + slat_arch * min(1.0, v / 0.35)
    z_crown = backrest_top_crown_z(u)
    # Smoothly transition to the S-curved shoulder crown only at the very top (v > 0.78)
    if v <= 0.76:
        return z_slat_band
    t = (v - 0.76) / 0.24
    blend = t * t * (3.0 - 2.0 * t)
    z_linear_top = z_bot + v * (z_crown - z_bot)
    return (1.0 - blend) * z_slat_band + blend * z_linear_top


def slot_uv_signed_distance(u: float, v: float) -> float:
    """
    Computes smooth signed distance in (u, v) space to the 3 through-slots.
    Because `backrest_grid_z(u, v)` already arches with `u`, each slot in (u, v)
    space is a clean horizontal stadium capsule with semicircular rounded ends!
    """
    def capsule_dist(u_pt: float, v_pt: float, u_half: float, v_center: float, v_half: float) -> float:
        # Scale u and v into physical metres so rounding radius is circular in 3D
        dy = max(0.0, abs(u_pt) - u_half) * 0.222
        dz = (v_pt - v_center) * 0.475
        r_m = v_half * 0.475
        return math.hypot(dy, dz) - r_m

    # Slot 1: Top curved handle/ventilation slot inside the arched shoulder crown
    d1 = capsule_dist(u, v, u_half=0.33, v_center=0.845, v_half=0.040)
    # Slot 2: Second long curved through-slot below the 90 mm aluminum disc slat
    d2 = capsule_dist(u, v, u_half=0.49, v_center=0.515, v_half=0.029)
    # Slot 3: Third long curved through-slot between the middle and lower slats
    d3 = capsule_dist(u, v, u_half=0.45, v_center=0.245, v_half=0.026)

    return min(d1, d2, d3)


def snap_uv_to_slot_contour(u: float, v: float) -> tuple:
    """
    Projects any grid vertex near a slot boundary (`|sd| < 0.010 m`) onto smooth
    concentric isolines around `sd = 0` so the semicircular ends of every slot
    are 100% smooth curves with zero polygon jagging.
    """
    sd = slot_uv_signed_distance(u, v)
    if abs(sd) > 0.0085:
        return u, v, sd
    eps = 1e-4
    gx = (slot_uv_signed_distance(u + eps, v) - sd) / eps
    gy = (slot_uv_signed_distance(u, v + eps) - sd) / eps
    g2 = gx * gx + gy * gy
    if g2 < 1e-8:
        return u, v, sd
    # If vertex is inside or within 3.5 mm of the slot edge, snap it onto the exact sd = 0 contour
    if sd < 0.0038:
        u_new = u - (sd * gx) / g2
        v_new = v - (sd * gy) / g2
        return u_new, v_new, 0.0
    return u, v, sd


def build_highpoly_master_seat(mats: dict) -> bpy.types.Object:
    """
    Builds `SEAT_HIGHPOLY_MASTER` (target: 30,000 - 42,000 triangles).
    Local coordinate convention matching camera view from (-X, -Y):
    - Origin (0, 0, 0) on the concrete step tread at seat center.
    - -X is the REAR face of the backrest (facing the camera in the 1 m match view).
    - +Y (u > 0) is SCREEN LEFT in the 1 m match view; -Y (u < 0) is SCREEN RIGHT.
    - Therefore, on each seat's rear backrest face:
      * The stainless pan-head Phillips screws sit on the screen-left outer frame
        rail at u = +0.80 (y = +0.178 m), z = 0.692 m and z = 0.425 m.
      * The 90 mm brushed-aluminum round disc sits slightly screen-left of center
        at u = +0.17 (y = +0.038 m), z = 0.665 m, with two tiny countersunk screws.
    """
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    half_w = 0.232
    nu = 96
    nz = 84

    rear_v = [[None] * (nz + 1) for _ in range(nu + 1)]
    front_v = [[None] * (nz + 1) for _ in range(nu + 1)]
    sd_raw_grid = [[0.0] * (nz + 1) for _ in range(nu + 1)]

    def eval_backrest_point(u_in: float, v_in: float, snap_contour: bool = True):
        if snap_contour:
            u, v, sd = snap_uv_to_slot_contour(u_in, v_in)
        else:
            u, v = u_in, v_in
            sd = slot_uv_signed_distance(u, v)

        z = backrest_grid_z(u, v)
        y = u * half_w

        # Base cylindrical plan curvature (convex bow toward -X camera on the rear face)
        plan_bow_x = -0.044 * (1.0 - u * u)
        # Vertical lumbar rake
        rake_x = -0.048 * v + 0.010 * math.sin(v * math.pi)

        # Raised outer perimeter frame along left/right side rails (|u| > 0.74)
        # Tapers smoothly at the shoulder post cap (v ~ 0.78) so there are no wing ears at the top corners!
        side_t = max(0.0, min(1.0, (abs(u) - 0.73) / 0.07))
        post_cap_taper = 1.0 - max(0.0, min(1.0, (v - 0.74) / 0.12)) ** 2
        side_frame_proud = (side_t * side_t * (3.0 - 2.0 * side_t)) * 0.022 * post_cap_taper

        # Smooth rounded perimeter rim around the S-curved shoulder arch (v > 0.84)
        top_t = max(0.0, min(1.0, (v - 0.84) / 0.16))
        top_rim_proud = math.sin(top_t * math.pi) * 0.014

        # Horizontal slat rib camber on the REAR face (-X) with crisp horizontal step ledges
        slat_camber = 0.0
        for v_c, v_h in [(0.680, 0.130), (0.380, 0.100), (0.115, 0.095)]:
            dv = abs(v - v_c) / v_h
            if dv < 1.0:
                slat_camber += 0.0068 * (math.cos(dv * math.pi * 0.5) ** 0.75) * (1.0 - side_t * post_cap_taper)

        # Circular recessed pocket on the rear face of Slat 1 for the 90 mm aluminum disc
        y_disc = +0.039
        z_disc = 0.666
        r_disc = math.hypot(y - y_disc, z - z_disc)
        disc_recess = 0.0
        if r_disc < 0.0465:
            edge_s = max(0.0, min(1.0, (0.0465 - r_disc) / 0.0035))
            disc_recess = 0.0032 * edge_s

        # Smooth 4.5 mm rounded bevel where the rear and front faces approach a through-slot
        bevel_zone = 0.014
        if 0.0 <= sd < bevel_zone:
            bt = 1.0 - (sd / bevel_zone)
            slot_pinch = (bt * bt) * 0.011
        elif sd < 0.0:
            slot_pinch = 0.011
        else:
            slot_pinch = 0.0

        # Smooth rounded bevel at the outer side edges (|u| -> 1.0) and top shoulder arch (v -> 1.0)
        # Clamped to 0.0065 m so x_front - x_rear stays >= 13 mm everywhere (zero corner self-intersection!)
        edge_u = max(0.0, (abs(u) - 0.92) / 0.08)
        edge_v = max(0.0, (v - 0.93) / 0.07)
        outer_pinch = min(0.0065, (edge_u * edge_u + edge_v * edge_v) * 0.0065)

        thickness = 0.026 + side_frame_proud * 0.60
        x_rear = plan_bow_x + rake_x - (side_frame_proud + top_rim_proud + slat_camber) + disc_recess + slot_pinch + outer_pinch
        x_front = plan_bow_x + rake_x + thickness - slot_pinch - outer_pinch

        return Vector((x_rear, y, z)), Vector((x_front, y, z)), sd, (0.0445 < r_disc < 0.0468)

    for iu in range(nu + 1):
        u_raw = (iu / float(nu)) * 2.0 - 1.0
        for iz in range(nz + 1):
            v_raw = iz / float(nz)
            sd_raw = slot_uv_signed_distance(u_raw, v_raw)
            sd_raw_grid[iu][iz] = sd_raw
            p_rear, p_front, _, _ = eval_backrest_point(u_raw, v_raw, snap_contour=True)
            if sd_raw > -0.006:
                rear_v[iu][iz] = bm.verts.new(p_rear)
                front_v[iu][iz] = bm.verts.new(p_front)

    # Create rear faces, front faces, and stitch smooth contour-snapped slot inner walls
    for iu in range(nu):
        for iz in range(nz):
            sd_c = 0.25 * (
                sd_raw_grid[iu][iz]
                + sd_raw_grid[iu + 1][iz]
                + sd_raw_grid[iu + 1][iz + 1]
                + sd_raw_grid[iu][iz + 1]
            )
            if sd_c <= 0.0012:
                continue
            r00, r10, r11, r01 = rear_v[iu][iz], rear_v[iu + 1][iz], rear_v[iu + 1][iz + 1], rear_v[iu][iz + 1]
            f00, f10, f11, f01 = front_v[iu][iz], front_v[iu + 1][iz], front_v[iu + 1][iz + 1], front_v[iu][iz + 1]
            if None in (r00, r10, r11, r01, f00, f10, f11, f01):
                continue

            fr = bm.faces.new((r00, r01, r11, r10))
            ff = bm.faces.new((f00, f10, f11, f01))
            fr.material_index = 0
            ff.material_index = 0
            for f in (fr, ff):
                for loop in f.loops:
                    loop[uv_layer].uv = (iu / float(nu), iz / float(nz))

            neighbors = [
                (iu - 1, iz, (r00, f00, f01, r01)),
                (iu + 1, iz, (r10, r11, f11, f10)),
                (iu, iz - 1, (r00, r10, f10, f00)),
                (iu, iz + 1, (r01, f01, f11, r11)),
            ]
            for niu, niz, wall_verts in neighbors:
                if 0 <= niu < nu and 0 <= niz < nz:
                    sd_n = 0.25 * (
                        sd_raw_grid[niu][niz]
                        + sd_raw_grid[niu + 1][niz]
                        + sd_raw_grid[niu + 1][niz + 1]
                        + sd_raw_grid[niu][niz + 1]
                    )
                    if sd_n <= 0.0012:
                        try:
                            fw = bm.faces.new(wall_verts)
                            fw.material_index = 1  # Darker recessed slot inner wall
                        except ValueError:
                            pass

    # Stitch outer perimeter border (left, right, top shoulder arch, bottom)
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

    # Tangential Laplacian smoothing along all slot boundary vertices so slot curves are 100% razor-smooth
    slot_border_verts = set()
    for f in bm.faces:
        if f.material_index == 1 and len(f.verts) == 4:
            for v in f.verts:
                if 0.36 < v.co.z < 0.83 and abs(v.co.y) < 0.17:
                    slot_border_verts.add(v)
    for _ in range(3):
        new_pos = {}
        for v in slot_border_verts:
            nbrs = [e.other_vert(v) for e in v.link_edges if e.other_vert(v) in slot_border_verts]
            if len(nbrs) >= 2:
                avg = sum((nb.co for nb in nbrs), Vector((0.0, 0.0, 0.0))) / len(nbrs)
                new_pos[v] = v.co.lerp(avg, 0.45)
        for v, p in new_pos.items():
            v.co = p

    # --------------------------------------------------------------------------
    # B. 90 mm BRUSHED-ALUMINUM ROUND NUMBER DISC + TWO TINY COUNTERSUNK SCREWS
    #    Built with concentric radial rings + center vertex (`cap_tris=True`) and
    #    flat front cap normals so there are ZERO triangulation shading facets!
    # --------------------------------------------------------------------------
    u_disc = +0.168
    v_disc = 0.680
    p_disc_rear, _, _, _ = eval_backrest_point(u_disc, v_disc, snap_contour=False)
    p_du, _, _, _ = eval_backrest_point(u_disc + 0.02, v_disc, snap_contour=False)
    p_dv, _, _, _ = eval_backrest_point(u_disc, v_disc + 0.02, snap_contour=False)
    t_u = (p_du - p_disc_rear).normalized()
    t_v = (p_dv - p_disc_rear).normalized()
    n_rear = t_u.cross(t_v).normalized()
    if n_rear.x > 0:
        n_rear = -n_rear

    rot_disc = Vector((0, 0, 1)).rotation_difference(n_rear).to_matrix().to_4x4()
    res_ring = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=True,
        segments=64,
        radius1=0.0455,
        radius2=0.0450,
        depth=0.0018,
        matrix=Matrix.Translation(p_disc_rear + n_rear * 0.0005) @ rot_disc,
    )
    for v in res_ring["verts"]:
        for f in v.link_faces:
            f.material_index = 4

    disc_center = p_disc_rear + n_rear * 0.0018
    res_disc_rim = bmesh.ops.create_cone(
        bm,
        cap_ends=False,
        cap_tris=False,
        segments=64,
        radius1=0.0436,
        radius2=0.0418,
        depth=0.0026,
        matrix=Matrix.Translation(disc_center) @ rot_disc,
    )
    res_disc_face = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=True,
        segments=64,
        radius1=0.0418,
        radius2=0.0416,
        depth=0.0004,
        matrix=Matrix.Translation(disc_center + n_rear * 0.0014) @ rot_disc,
    )
    for rd in (res_disc_rim, res_disc_face):
        for v in rd["verts"]:
            for f in v.link_faces:
                f.material_index = 2  # Satin brushed aluminum disc

    # Two tiny countersunk rivets/screws on the left and right rim of the disc
    for ang_deg in (165.0, -15.0):
        ang_r = math.radians(ang_deg)
        rivet_offset = (t_u * math.cos(ang_r) + t_v * math.sin(ang_r)) * 0.0355
        rivet_pos = disc_center + rivet_offset + n_rear * 0.0015
        res_riv = bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=20,
            radius1=0.0032,
            radius2=0.0026,
            depth=0.0014,
            matrix=Matrix.Translation(rivet_pos) @ rot_disc,
        )
        for v in res_riv["verts"]:
            for f in v.link_faces:
                f.material_index = 3
        res_dimp = bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=12,
            radius1=0.0013,
            radius2=0.0010,
            depth=0.0012,
            matrix=Matrix.Translation(rivet_pos + n_rear * 0.0007) @ rot_disc,
        )
        for v in res_dimp["verts"]:
            for f in v.link_faces:
                f.material_index = 4

    # --------------------------------------------------------------------------
    # C. TWO STAINLESS PAN-HEAD PHILLIPS SCREWS (WITH 3D '+' DRIVE CROSS)
    #    Mounted on the screen-left raised frame rail (u_s = +0.63, v = 0.725 & 0.155)
    # --------------------------------------------------------------------------
    def add_phillips_panhead_screw(u_s: float, v_s: float):
        p_s, _, _, _ = eval_backrest_point(u_s, v_s, snap_contour=False)
        p_su, _, _, _ = eval_backrest_point(u_s + 0.02, v_s, snap_contour=False)
        p_sv, _, _, _ = eval_backrest_point(u_s, v_s + 0.02, snap_contour=False)
        tu = (p_su - p_s).normalized()
        tv = (p_sv - p_s).normalized()
        nr = tu.cross(tv).normalized()
        if nr.x > 0:
            nr = -nr

        rot_s = Vector((0, 0, 1)).rotation_difference(nr).to_matrix().to_4x4()
        s_center = p_s + nr * 0.0022

        r_shadow = bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=32,
            radius1=0.0126,
            radius2=0.0122,
            depth=0.0015,
            matrix=Matrix.Translation(p_s + nr * 0.0006) @ rot_s,
        )
        for v in r_shadow["verts"]:
            for f in v.link_faces:
                f.material_index = 4

        r_flange = bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=36,
            radius1=0.0112,
            radius2=0.0100,
            depth=0.0026,
            matrix=Matrix.Translation(s_center) @ rot_s,
        )
        r_dome = bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=36,
            radius1=0.0100,
            radius2=0.0068,
            depth=0.0020,
            matrix=Matrix.Translation(s_center + nr * 0.0020) @ rot_s,
        )
        for rd in (r_flange, r_dome):
            for v in rd["verts"]:
                for f in v.link_faces:
                    f.material_index = 3

        cross_center = s_center + nr * 0.0031
        for arm_rot in (0.18, 0.18 + math.pi * 0.5):
            rot_c = rot_s @ Matrix.Rotation(arm_rot, 4, "Z")
            r_slot = bmesh.ops.create_cube(
                bm,
                size=1.0,
                matrix=Matrix.Translation(cross_center) @ rot_c @ Matrix.Diagonal((0.0085, 0.0020, 0.0015, 1.0)),
            )
            for v in r_slot["verts"]:
                for f in v.link_faces:
                    f.material_index = 4

    add_phillips_panhead_screw(u_s=+0.63, v_s=0.725)
    add_phillips_panhead_screw(u_s=+0.63, v_s=0.155)

    # --------------------------------------------------------------------------
    # D. INTEGRAL MOLDED ARMRESTS FLOWING CONTINUOUSLY FROM THE SHELL SIDE FRAME
    #    WITH ROLLED UPPER LIP & DARKER HOLLOW INNER CAVITY + THICK ROLLED TIP-UP
    #    CUSHION BOLSTER + DARK NAVY CAST PEDESTAL
    # --------------------------------------------------------------------------
    for side_sign in (-1.0, 1.0):
        ay = side_sign * (half_w * 0.90)
        n_seg_arm = 28
        n_prof = 18
        arm_grid = []
        for iseg in range(n_seg_arm + 1):
            t = iseg / float(n_seg_arm)
            if t < 0.32:
                # Smooth integral vertical side rail along the backrest frame (z=0.71 -> 0.50)
                lt = t / 0.32
                ax = -0.042 - (1.0 - math.cos(lt * math.pi * 0.5)) * 0.028
                az = 0.710 - lt * 0.210
            elif t < 0.88:
                # Horizontal-sloped armrest bar projecting forward (-X) with a rolled lip (x=-0.070 -> -0.255, z=0.50 -> 0.445)
                lt = (t - 0.32) / 0.56
                ax = -0.070 - lt * 0.185
                az = 0.500 - lt * 0.055
            else:
                # Clean rounded front nose cap of the armrest bar (t in [0.88, 1.0])
                lt = (t - 0.88) / 0.12
                ax = -0.255 - math.sin(lt * math.pi * 0.5) * 0.012
                az = 0.445 - (1.0 - math.cos(lt * math.pi * 0.5)) * 0.018

            # Taper radius to a closed rounded nose at t = 1.0 (zero hanging ribbon tail!)
            nose_scale = math.cos(max(0.0, (t - 0.88) / 0.12) * math.pi * 0.48)
            cheek_env = math.sin(min(1.0, max(0.0, (t - 0.24) / 0.66)) * math.pi)
            row_v = []
            for ip in range(n_prof + 1):
                p_frac = ip / float(n_prof)
                ang = p_frac * math.pi * 2.0
                dy = math.cos(ang) * 0.025 * nose_scale
                dz = math.sin(ang) * 0.018 * nose_scale
                if math.sin(ang) > 0.3:
                    dz *= 0.65
                # Deep structural cheek web below the armrest bar with hollow dark inner cavity
                if math.sin(ang) < -0.10:
                    dz -= 0.085 * abs(math.sin(ang)) * cheek_env
                is_cavity = (0.54 < p_frac < 0.96) and (0.28 < t < 0.86)
                if is_cavity:
                    dz += 0.018 * cheek_env
                    dy *= 0.48
                v_pt = bm.verts.new((ax, ay + dy, az + dz))
                row_v.append((v_pt, is_cavity))
            arm_grid.append(row_v)

        for iseg in range(n_seg_arm):
            for ip in range(n_prof):
                v00, c00 = arm_grid[iseg][ip]
                v10, c10 = arm_grid[iseg + 1][ip]
                v11, c11 = arm_grid[iseg + 1][ip + 1]
                v01, c01 = arm_grid[iseg][ip + 1]
                f = bm.faces.new((v00, v10, v11, v01))
                f.material_index = 1 if (c00 or c10 or c11 or c01) else 0
                for loop in f.loops:
                    loop[uv_layer].uv = (iseg / float(n_seg_arm), ip / float(n_prof))

    # Full 360-degree closed rounded tip-up cushion bolster tucked between the armrests
    nb_u, nb_v = 36, 28
    bol_grid = []
    for iu in range(nb_u + 1):
        u = (iu / float(nb_u)) * 2.0 - 1.0
        by = u * (half_w * 0.78)
        end_taper = 1.0 - 0.15 * (u ** 4)
        row_v = []
        for iv in range(nb_v + 1):
            ang = (iv / float(nb_v)) * math.pi * 2.0
            r_thick = 0.030 * end_taper
            r_height = 0.140 * end_taper
            local_x = math.cos(ang) * r_thick
            local_z = math.sin(ang) * r_height
            tilt = math.radians(20.0)
            bx = -0.188 + (u * u) * 0.016 + local_x * math.cos(tilt) - local_z * math.sin(tilt)
            bz = 0.355 - (u * u) * 0.012 + local_x * math.sin(tilt) + local_z * math.cos(tilt)
            row_v.append(bm.verts.new((bx, by, bz)))
        bol_grid.append(row_v)

    for iu in range(nb_u):
        for iv in range(nb_v):
            f = bm.faces.new((bol_grid[iu][iv], bol_grid[iu + 1][iv], bol_grid[iu + 1][iv + 1], bol_grid[iu][iv + 1]))
            f.material_index = 0
            for loop in f.loops:
                loop[uv_layer].uv = (iu / float(nb_u), iv / float(nb_v))

    # Dark Navy Cast Pedestal Stanchion & Triangular Webbed Floor Flange (slot 4)
    for leg_y in (-half_w * 0.62, half_w * 0.62):
        res_ped = bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=20,
            radius1=0.035,
            radius2=0.024,
            depth=0.38,
            matrix=Matrix.Translation((0.02, leg_y, 0.19)) @ Matrix.Rotation(math.radians(12.0), 4, "Y"),
        )
        res_flange = bmesh.ops.create_cube(
            bm,
            size=1.0,
            matrix=Matrix.Translation((0.04, leg_y, 0.014)) @ Matrix.Diagonal((0.21, 0.11, 0.028, 1.0)),
        )
        for rd in (res_ped, res_flange):
            for v in rd["verts"]:
                for f in v.link_faces:
                    f.material_index = 4

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new("SEAT_HIGHPOLY_MASTER_MESH")
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = (poly.material_index != 2)
    mesh.update()

    obj = bpy.data.objects.new("SEAT_HIGHPOLY_MASTER", mesh)
    obj.data.materials.append(mats["plastic_outer"])    # slot 0: Satin cobalt/navy outer shell
    obj.data.materials.append(mats["plastic_cavity"])   # slot 1: Darker navy hollow inner cavity & slot walls
    obj.data.materials.append(mats["aluminum_disc"])    # slot 2: 90 mm brushed aluminum number disc
    obj.data.materials.append(mats["stainless_screw"])  # slot 3: Stainless pan-head Phillips screws & disc rivets
    obj.data.materials.append(mats["cast_pedestal"])    # slot 4: Dark navy cast pedestal & Phillips slot recess

    log(f"Built SEAT_HIGHPOLY_MASTER: {len(mesh.polygons):,} triangles, {len(mesh.vertices):,} vertices")
    return obj


# ==============================================================================
# 4. BUILD STEPPED CONCRETE BLOCK WITH CHIPPED NOSING & SEAT INSTANCES
#    MATCHING THE EXACT SPATIAL LAYOUT OF `/blender_pipeline/reference/seat_ref.png`
# ==============================================================================
def build_reference_vignette_scene(mats: dict, master_seat: bpy.types.Object, params: dict) -> dict:
    scene = bpy.context.scene

    bm_c = bmesh.new()
    uv_c = bm_c.loops.layers.uv.new("UVMap")

    def add_chipped_concrete_step(x0, x1, y0, y1, z0, z1):
        res = bmesh.ops.create_cube(
            bm_c,
            size=1.0,
            matrix=Matrix.Translation(((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5))
            @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1.0)),
        )
        edges_to_bevel = list({e for v in res["verts"] for e in v.link_edges})
        bmesh.ops.bevel(
            bm_c,
            geom=edges_to_bevel,
            offset=0.010,
            offset_type="OFFSET",
            segments=4,
            profile=0.48,
        )
        faces_step = list({f for v in bm_c.verts for f in v.link_faces})
        bmesh.ops.subdivide_edges(
            bm_c,
            edges=list({e for f in faces_step for e in f.edges}),
            cuts=3,
            use_grid_fill=True,
        )

    # 1. Main sunlit concrete terrace behind and under the seats (z = 0.0 m)
    add_chipped_concrete_step(-0.28, 2.40, -1.80, 1.80, -0.26, 0.0)

    # 2. Lower step tread on the far lower-left (z = -0.24 m) creating the diagonal concrete
    #    nosing shadow line from upper-left toward lower-center under the armrests!
    add_chipped_concrete_step(-1.60, -0.28, -1.80, 1.80, -0.50, -0.22)

    # 3. Raised aisle concrete step block in the upper-right quadrant of `seat_ref.png`
    #    Corner at (x = +0.24 m, y = -0.06 m, z = 0.0..0.52 m) so its sunlit white top tread
    #    and shaded bush-hammered vertical riser sit prominently in the upper-right quadrant!
    add_chipped_concrete_step(0.24, 1.50, -0.95, -0.06, 0.0, 0.52)

    for v in bm_c.verts:
        co = v.co
        n_val = math.sin(co.x * 55.0 + co.y * 43.0) * math.cos(co.y * 67.0 - co.z * 51.0)
        if abs(co.z - 0.52) < 0.025 or abs(co.z - 0.0) < 0.025:
            v.co.x += n_val * 0.0022
            v.co.y += n_val * 0.0022
            v.co.z += n_val * 0.0016

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

    mesh_c = bpy.data.meshes.new("REF_CONCRETE_STEP_BLOCK_MESH")
    bm_c.to_mesh(mesh_c)
    bm_c.free()
    for p in mesh_c.polygons:
        p.use_smooth = True
    obj_c = bpy.data.objects.new("REF_CONCRETE_STEP_BLOCK", mesh_c)
    obj_c.data.materials.append(mats["concrete_steps"])
    scene.collection.objects.link(obj_c)

    # Seat placements matching `seat_ref.png`:
    placements = [
        ("SEAT_HERO_A", Vector((0.0, 0.02, 0.0)), -4.0),
        ("SEAT_FOREGROUND_B", Vector((-0.06, -0.45, -0.11)), -4.0),
        ("SEAT_UPPER_LEFT_C", Vector((-0.16, 0.44, 0.12)), -4.0),
        ("SEAT_BG_PEDESTAL_1", Vector((0.68, 0.48, 0.36)), -4.0),
        ("SEAT_BG_PEDESTAL_2", Vector((0.68, 0.16, 0.36)), -4.0),
        ("SEAT_UPPER_RIGHT_E", Vector((0.26, -0.76, 0.52)), -4.0),
    ]
    seat_objs = []
    for sname, pos, yaw_deg in placements:
        inst = bpy.data.objects.new(sname, master_seat.data)
        inst.matrix_world = Matrix.Translation(pos) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
        scene.collection.objects.link(inst)
        seat_objs.append(inst)

    return {"concrete": obj_c, "seats": seat_objs}


# ==============================================================================
# 5. CAMERA, SUNLIGHT, CYCLES 1920x1200 128-SAMPLE RENDER + EDGE-PRESERVING DENOISE
# ==============================================================================
def setup_camera_and_lighting(params: dict) -> bpy.types.Object:
    scene = bpy.context.scene

    world = bpy.data.worlds.new("Ref_Match_World")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = params["sky_ambient_rgba"]
    bg.inputs["Strength"].default_value = params["sky_strength"]
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    sun_data = bpy.data.lights.new("Sun_Midday_Ref", type="SUN")
    sun_data.energy = params["sun_energy"]
    sun_data.angle = math.radians(params["sun_angle_deg"])
    sun_data.color = params["sun_color"]
    sun_obj = bpy.data.objects.new("Sun_Midday_Ref", sun_data)
    sun_obj.rotation_euler = params["sun_euler"]
    scene.collection.objects.link(sun_obj)

    cam_data = bpy.data.cameras.new("CAM_Ref_Match_1m")
    cam_data.lens = params["cam_lens_mm"]
    cam_data.sensor_width = 36.0
    cam_data.clip_start = 0.05
    cam_data.clip_end = 50.0
    cam_data.dof.use_dof = True
    cam_data.dof.focus_distance = params["cam_focus_dist"]
    cam_data.dof.aperture_fstop = params["cam_fstop"]

    cam_obj = bpy.data.objects.new("CAM_Ref_Match_1m", cam_data)
    cam_obj.location = Vector(params["cam_loc"])
    direction = Vector(params["cam_target"]) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = params["exposure"]

    return cam_obj


def edge_preserving_bilateral_denoise(img_u8: np.ndarray, sigma_color: float = 9.0) -> np.ndarray:
    """
    Gentle 3x3 edge-preserving bilateral filter in NumPy to remove Monte Carlo
    path-tracing grain while preserving high-frequency concrete pores, screw
    slots, and edge sharpness.
    """
    img = img_u8.astype(np.float32)
    h, w, _ = img.shape
    padded = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="reflect")
    acc = np.zeros_like(img)
    w_sum = np.zeros((h, w, 1), dtype=np.float32)

    inv_2sc2 = 1.0 / (2.0 * sigma_color * sigma_color)
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            spatial_w = math.exp(-(dx * dx + dy * dy) / 2.0)
            shifted = padded[1 + dy : 1 + dy + h, 1 + dx : 1 + dx + w, :]
            diff2 = np.sum((shifted - img) ** 2, axis=2, keepdims=True) / 3.0
            weight = spatial_w * np.exp(-diff2 * inv_2sc2)
            acc += shifted * weight
            w_sum += weight

    return np.clip(acc / np.maximum(w_sum, 1e-5), 0, 255).astype(np.uint8)


def load_png_srgb_u8(path: str) -> np.ndarray:
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape((h, w, 4))
    px = np.flipud(px)[:, :, :3] * 255.0
    bpy.data.images.remove(img)
    return np.clip(px, 0, 255).astype(np.uint8)


def resize_nearest_u8(arr: np.ndarray, target_h: int, target_w: int) -> np.ndarray:
    h, w, _ = arr.shape
    yi = np.clip((np.arange(target_h) * (h / float(target_h))).astype(np.int32), 0, h - 1)
    xi = np.clip((np.arange(target_w) * (w / float(target_w))).astype(np.int32), 0, w - 1)
    return arr[yi[:, None], xi[None, :], :]


def compute_quantitative_match_metrics(ref_u8: np.ndarray, ren_u8: np.ndarray) -> dict:
    """
    Computes quantitative comparison metrics required by Step 3c:
    1. Mean sRGB color of blue seat region vs. reference
    2. Mean sRGB color of sunlit concrete region vs. reference
    3. RGB 32-bin histogram intersection similarity (0.0 - 1.0)
    4. Edge-sharpness estimate (mean(|dx|) + mean(|dy|)) vs. reference
    """
    def region_stats(arr: np.ndarray):
        f = arr.astype(np.float32)
        blue_mask = (f[:, :, 2] > f[:, :, 0] * 1.30) & (f[:, :, 2] > 35.0)
        conc_mask = (f[:, :, 0] > 160.0) & (np.abs(f[:, :, 0] - f[:, :, 1]) < 24.0) & (np.abs(f[:, :, 1] - f[:, :, 2]) < 28.0)
        seat_mean = f[blue_mask].mean(axis=0).round(2).tolist() if np.any(blue_mask) else [0.0, 0.0, 0.0]
        conc_mean = f[conc_mask].mean(axis=0).round(2).tolist() if np.any(conc_mask) else [0.0, 0.0, 0.0]
        lum = f.mean(axis=2)
        sharpness = float(np.abs(np.diff(lum, axis=1)).mean() + np.abs(np.diff(lum, axis=0)).mean())
        return {
            "overall_mean_srgb": f.mean(axis=(0, 1)).round(2).tolist(),
            "seat_mean_srgb": seat_mean,
            "seat_area_fraction": round(float(blue_mask.mean()), 3),
            "concrete_mean_srgb": conc_mean,
            "concrete_area_fraction": round(float(conc_mask.mean()), 3),
            "edge_sharpness": round(sharpness, 3),
        }

    ref_s = region_stats(ref_u8)
    ren_s = region_stats(ren_u8)

    hist_sims = []
    for ch in range(3):
        hr, _ = np.histogram(ref_u8[:, :, ch], bins=32, range=(0, 256), density=True)
        hm, _ = np.histogram(ren_u8[:, :, ch], bins=32, range=(0, 256), density=True)
        sim = float(np.minimum(hr, hm).sum() * (256.0 / 32.0))
        hist_sims.append(sim)

    seat_delta = float(np.linalg.norm(np.array(ref_s["seat_mean_srgb"]) - np.array(ren_s["seat_mean_srgb"])))
    conc_delta = float(np.linalg.norm(np.array(ref_s["concrete_mean_srgb"]) - np.array(ren_s["concrete_mean_srgb"])))

    return {
        "reference": ref_s,
        "rendered": ren_s,
        "seat_rgb_l2_distance": round(seat_delta, 2),
        "concrete_rgb_l2_distance": round(conc_delta, 2),
        "histogram_intersection_rgb": [round(x, 3) for x in hist_sims],
        "histogram_intersection_mean": round(float(np.mean(hist_sims)), 3),
        "edge_sharpness_ratio": round(ren_s["edge_sharpness"] / max(1e-4, ref_s["edge_sharpness"]), 3),
    }


def render_match_round(round_num: int, params: dict) -> dict:
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    tex_paths = bake_2k_concrete_step_textures(CONFIG["texture_dir"])
    mats = build_match_materials(tex_paths, params)
    master_seat = build_highpoly_master_seat(mats)
    master_seat.hide_render = True
    master_seat.hide_viewport = True

    build_reference_vignette_scene(mats, master_seat, params)
    setup_camera_and_lighting(params)

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = CONFIG["samples"]
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.032
    scene.cycles.adaptive_min_samples = 24
    scene.cycles.max_bounces = 2
    scene.cycles.diffuse_bounces = 1
    scene.cycles.glossy_bounces = 1
    scene.cycles.sample_clamp_direct = 10.0
    scene.cycles.sample_clamp_indirect = 3.5

    w_res, h_res = CONFIG["resolution"]
    scene.render.resolution_x = w_res
    scene.render.resolution_y = h_res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"

    os.makedirs(CONFIG["output_dir"], exist_ok=True)
    raw_png = os.path.join(CONFIG["output_dir"], f"match_round_{round_num}_raw.png")
    final_png = os.path.join(CONFIG["output_dir"], f"match_round_{round_num}.png")
    sbs_png = os.path.join(CONFIG["output_dir"], f"match_round_{round_num}_side_by_side.png")

    scene.render.filepath = raw_png
    log(f"Rendering Round {round_num} at {w_res}x{h_res} ({CONFIG['samples']} samples) -> {final_png} ...")
    bpy.ops.render.render(write_still=True)

    raw_u8 = load_png_srgb_u8(raw_png)
    denoised_u8 = edge_preserving_bilateral_denoise(raw_u8, sigma_color=8.5)
    write_png(final_png, denoised_u8)

    ref_orig_u8 = load_png_srgb_u8(CONFIG["ref_image_path"])
    ref_resized_u8 = resize_nearest_u8(ref_orig_u8, h_res, w_res)

    half_h, half_w = 600, 960
    left_half = resize_nearest_u8(ref_resized_u8, half_h, half_w)
    right_half = resize_nearest_u8(denoised_u8, half_h, half_w)
    divider = np.full((half_h, 8, 3), 240, dtype=np.uint8)
    sbs_u8 = np.concatenate([left_half, divider, right_half], axis=1)
    write_png(sbs_png, sbs_u8)

    metrics = compute_quantitative_match_metrics(ref_resized_u8, denoised_u8)
    metrics["round"] = round_num
    metrics["render_time_sec"] = round(time.time() - t0, 2)
    metrics["highpoly_seat_triangles"] = len(master_seat.data.polygons)
    metrics["highpoly_seat_vertices"] = len(master_seat.data.vertices)
    metrics["match_render_path"] = final_png
    metrics["side_by_side_path"] = sbs_png

    blend_path = os.path.join(CONFIG["output_dir"], "stadiumx_highpoly_reference_seat.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    metrics_path = os.path.join(CONFIG["output_dir"], f"match_round_{round_num}_metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print(json.dumps(metrics, indent=2), flush=True)
    return metrics


if __name__ == "__main__":
    round_idx = int(sys.argv[-1]) if sys.argv[-1].isdigit() else 4

    # Round 4 calibrated physical parameters:
    round4_params = {
        "plastic_base_rgba": (0.0015, 0.029, 0.132, 1.0),
        "plastic_top_rgba": (0.0050, 0.056, 0.215, 1.0),
        "plastic_cavity_rgba": (0.0005, 0.007, 0.032, 1.0),
        "plastic_rough_min": 0.36,
        "plastic_rough_max": 0.44,
        "plastic_specular": 0.56,
        "plastic_clearcoat": 0.15,
        "concrete_value_mult": 1.18,
        "sky_ambient_rgba": (0.28, 0.52, 0.84, 1.0),
        "sky_strength": 0.54,
        "sun_energy": 6.0,
        "sun_angle_deg": 0.55,
        "sun_color": (1.0, 0.99, 0.96),
        "sun_euler": (math.radians(30.0), math.radians(-24.0), math.radians(-142.0)),
        "cam_lens_mm": 43.0,
        "cam_focus_dist": 0.96,
        "cam_fstop": 6.3,
        "cam_loc": (-0.82, -0.44, 1.15),
        "cam_target": (-0.02, -0.10, 0.54),
        "exposure": 0.05,
    }
    render_match_round(round_idx, round4_params)
