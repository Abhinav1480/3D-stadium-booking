#!/usr/bin/env python3
"""
STADIUMX — Headless Blender 3.4 Photorealistic Cricket Stadium & Reference Seat Generator
Run via:
  blender --background --python scripts/build_stadium_blender.py

Generates and exports:
  1. public/models/stadium_venue.glb      — Complete multi-tier international cricket stadium with 2K PBR textures,
                                            crowned multi-ring outfield turf, 5-strip cricket square, 22-yard rolled
                                            Bulli clay match pitch, 3D creases, 30-yard dashed circle, ash stumps,
                                            and 1:1 stepped bush-hammered concrete bowl matching DEFAULT_STADIUM_SPEC.
  2. public/models/seat_high_detail.glb   — Reference-matched sculpted stadium seat (Seat_Shell, Seat_Frame,
                                            Seat_Hardware with 90mm brushed-aluminum rear disc & Phillips screws).
  3. public/models/spectator_crowd.glb    — Seated 3D spectator character for GPU instanced crowd.
  4. public/models/blender_manifest.json  — Asset verification manifest & 1:1 coordinate parity report.
"""

import bpy
import bmesh
import math
import json
import os
import sys
import random
import struct
import zlib
from mathutils import Vector, Matrix

random.seed(42)

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_DIR = os.path.join(ROOT_DIR, "public", "models")
PUBLIC_TEX_DIR = os.path.join(ROOT_DIR, "public", "textures")
os.makedirs(OUTPUT_DIR, exist_ok=True)
TEX_DIR = os.path.join("/tmp", "stadiumx_blender_textures")
os.makedirs(TEX_DIR, exist_ok=True)

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)
from blender_pipeline import match_reference_seat as mrs


# ---------------------------------------------------------------------------
# Coordinate Converter: Three.js (Y-up: X, Y, Z) -> Blender (Z-up: X, -Z, Y)
# When exported with export_yup=True, Blender (X, -Z, Y) maps 1:1 to Three.js (X, Y, Z).
# ---------------------------------------------------------------------------
def b_pos(x_three: float, y_three: float, z_three: float) -> Vector:
    return Vector((float(x_three), float(-z_three), float(y_three)))


def write_png_rgba(filepath: str, width: int, height: int, pixel_bytes: bytearray):
    """Writes a standard 8-bit RGBA PNG file from raw RGBA bytes."""
    def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
        chunk = struct.pack(">I", len(data)) + chunk_type + data
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return chunk + struct.pack(">I", crc)

    raw_rows = bytearray()
    stride = width * 4
    for y in range(height):
        raw_rows.append(0)
        row_start = y * stride
        raw_rows.extend(pixel_bytes[row_start : row_start + stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    compressed = zlib.compress(bytes(raw_rows), level=6)

    with open(filepath, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(make_chunk(b"IHDR", ihdr))
        f.write(make_chunk(b"IDAT", compressed))
        f.write(make_chunk(b"IEND", b""))


def resolve_pbr_textures():
    """Resolves the 2K baked PBR textures from public/textures and generates scoreboard telemetry."""
    textures = {
        "turf_albedo": os.path.join(PUBLIC_TEX_DIR, "grass_outfield", "albedo.png"),
        "turf_normal": os.path.join(PUBLIC_TEX_DIR, "grass_outfield", "normal.png"),
        "turf_rough": os.path.join(PUBLIC_TEX_DIR, "grass_outfield", "roughness.png"),
        "pitch_albedo": os.path.join(PUBLIC_TEX_DIR, "pitch_clay", "albedo.png"),
        "pitch_normal": os.path.join(PUBLIC_TEX_DIR, "pitch_clay", "normal.png"),
        "pitch_rough": os.path.join(PUBLIC_TEX_DIR, "pitch_clay", "roughness.png"),
        "square_used_albedo": os.path.join(PUBLIC_TEX_DIR, "pitch_clay", "square_strip_albedo.png"),
        "square_grass_albedo": os.path.join(PUBLIC_TEX_DIR, "pitch_clay", "square_grass_strip_albedo.png"),
        "concrete_albedo": os.path.join(PUBLIC_TEX_DIR, "concrete_steps", "concrete_albedo_2k.png"),
        "concrete_normal": os.path.join(PUBLIC_TEX_DIR, "concrete_steps", "concrete_normal_2k.png"),
        "concrete_rough": os.path.join(PUBLIC_TEX_DIR, "concrete_steps", "concrete_roughness_2k.png"),
        "seat_normal": os.path.join(PUBLIC_TEX_DIR, "seat_atlas_2k", "seat_atlas_normal_2k.png"),
        "seat_ao": os.path.join(PUBLIC_TEX_DIR, "seat_atlas_2k", "seat_atlas_ao_2k.png"),
        "led_ribbon": os.path.join(PUBLIC_TEX_DIR, "ad_boards", "albedo.png"),
    }

    # Giant 8K LED Scoreboard Broadcast Telemetry Texture (512x256 fallback embedded in GLB)
    sw, sh = 512, 256
    sb_tex = bytearray(sw * sh * 4)
    for y in range(sh):
        for x in range(sw):
            r, g, b = 10, 18, 34
            if y < 38:
                r, g, b = 6, 95, 70
            elif 40 <= y < 44:
                r, g, b = 16, 185, 129
            elif 95 <= y < 155 and 28 <= x < 484:
                r, g, b = 17, 28, 52
                if y in (95, 96, 153, 154) or x in (28, 29, 482, 483):
                    r, g, b = 56, 189, 248
            if 108 <= y <= 142 and 48 <= x <= 290:
                if (x // 8) % 2 == 0 and (y // 6) % 2 == 0:
                    r, g, b = 248, 250, 252
            cx, cy = 400, 148
            d_wheel = math.hypot(x - cx, y - cy)
            if d_wheel < 64:
                r, g, b = 14, 72, 46
                if abs(d_wheel - 62) < 2.0 or abs(d_wheel - 30) < 1.5:
                    r, g, b = 226, 232, 240
                angle = math.atan2(y - cy, x - cx)
                if abs(math.sin(angle * 7.0)) < 0.05:
                    r, g, b = 251, 191, 36
            if y > 220:
                r, g, b = 15, 23, 42
                if 228 <= y <= 242 and (x // 12) % 3 != 0:
                    r, g, b = 245, 158, 11

            idx = (y * sw + x) * 4
            sb_tex[idx : idx + 4] = bytes((r, g, b, 255))

    sb_path = os.path.join(TEX_DIR, "scoreboard_8k.png")
    write_png_rgba(sb_path, sw, sh, sb_tex)
    textures["scoreboard_8k"] = sb_path

    return textures


def create_pbr_material(
    name: str,
    base_color=(0.8, 0.8, 0.8, 1.0),
    metallic=0.0,
    roughness=0.5,
    emission_color=None,
    emission_strength=0.0,
    alpha=1.0,
    transmission=0.0,
    albedo_path=None,
    normal_path=None,
    roughness_path=None,
    emissive_path=None,
):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out_node = nodes.new(type="ShaderNodeOutputMaterial")
    out_node.location = (400, 0)

    bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 0.999:
        mat.blend_method = "BLEND"
    if transmission > 0.0 and "Transmission" in bsdf.inputs:
        bsdf.inputs["Transmission"].default_value = transmission

    if emission_color is not None and "Emission" in bsdf.inputs:
        bsdf.inputs["Emission"].default_value = emission_color
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength

    links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    if albedo_path and os.path.exists(albedo_path):
        tex_img = nodes.new(type="ShaderNodeTexImage")
        tex_img.location = (-350, 200)
        img = bpy.data.images.load(albedo_path, check_existing=True)
        img.pack()
        tex_img.image = img
        links.new(tex_img.outputs["Color"], bsdf.inputs["Base Color"])

    if emissive_path and os.path.exists(emissive_path) and "Emission" in bsdf.inputs:
        tex_em = nodes.new(type="ShaderNodeTexImage")
        tex_em.location = (-350, -50)
        img_em = bpy.data.images.load(emissive_path, check_existing=True)
        img_em.pack()
        tex_em.image = img_em
        links.new(tex_em.outputs["Color"], bsdf.inputs["Emission"])
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = max(1.8, emission_strength)

    if roughness_path and os.path.exists(roughness_path):
        tex_rough = nodes.new(type="ShaderNodeTexImage")
        tex_rough.location = (-350, -250)
        img_r = bpy.data.images.load(roughness_path, check_existing=True)
        img_r.colorspace_settings.name = "Non-Color"
        img_r.pack()
        tex_rough.image = img_r
        links.new(tex_rough.outputs["Color"], bsdf.inputs["Roughness"])

    if normal_path and os.path.exists(normal_path):
        tex_norm = nodes.new(type="ShaderNodeTexImage")
        tex_norm.location = (-600, -450)
        img_n = bpy.data.images.load(normal_path, check_existing=True)
        img_n.colorspace_settings.name = "Non-Color"
        img_n.pack()
        tex_norm.image = img_n

        norm_map = nodes.new(type="ShaderNodeNormalMap")
        norm_map.location = (-300, -450)
        norm_map.inputs["Strength"].default_value = 0.90
        links.new(tex_norm.outputs["Color"], norm_map.inputs["Color"])
        links.new(norm_map.outputs["Normal"], bsdf.inputs["Normal"])

    mat.use_backface_culling = False
    return mat


def finalize_mesh(
    bm: bmesh.types.BMesh,
    name: str,
    mat: bpy.types.Material,
    collection: bpy.types.Collection,
    smooth=True,
    solidify_thickness=0.0,
):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv_layer = bm.loops.layers.uv.verify()

    for face in bm.faces:
        n = face.normal
        for loop in face.loops:
            uv = loop[uv_layer].uv
            if uv.length_squared == 0.0:
                co = loop.vert.co
                if abs(n.z) > 0.7:
                    loop[uv_layer].uv = ((co.x + 90.0) / 180.0, (co.y + 90.0) / 180.0)
                else:
                    angle = math.atan2(co.y, co.x) / (2.0 * math.pi) + 0.5
                    loop[uv_layer].uv = (angle * 16.0, co.z / 8.0)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = math.radians(42.0)

    if mat:
        mesh.materials.append(mat)

    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)

    if solidify_thickness > 0.0:
        mod = obj.modifiers.new(name="ArchitecturalThickness", type="SOLIDIFY")
        mod.thickness = solidify_thickness
        mod.offset = 0.0

    return obj


# ---------------------------------------------------------------------------
# 1. Build & Export Reference-Matched Sculpted Stadium Seat (seat_high_detail.glb)
# ---------------------------------------------------------------------------
def build_and_export_high_detail_seat(textures):
    """
    Builds the reference-matched stadium seat (`seat_ref.png`) split into 3 clean layers:
      1. Seat_Shell    — Molded HDPE backrest with S-curved shoulder arch, 3 curved through-slots,
                         ribbed horizontal slats, sculpted armrests, and tip-up cushion bolster.
      2. Seat_Frame    — Twin dark cast-aluminum/navy pedestal stanchions and hollow inner armrest/slot cavity.
      3. Seat_Hardware — 90 mm brushed-aluminum round rear number disc + stainless steel pan-head Phillips screws.

    Orientation:
      In `match_reference_seat.py`, the seat's front (armrests/cushion) is along `-X`, rear backrest is `+X`,
      lateral width is `Y`, and vertical height is `Z`.
      To map to Three.js local seat space (`X` = lateral width, `Y` = height `0..0.855m`, `+Z` = front facing pitch,
      `-Z` = rear backrest with 90mm disc & Phillips screws) when exported with `export_yup=True`,
      we transform each local point `(px, py, pz)` via `b_pos(py, pz, -px) = Vector((py, px, pz))`!
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.context.scene.collection

    mat_shell = create_pbr_material(
        "Seat_Polymer_Shell",
        base_color=(0.96, 0.98, 1.0, 1.0),
        metallic=0.04,
        roughness=0.38,
        normal_path=textures["seat_normal"],
    )
    mat_frame = create_pbr_material(
        "Seat_Cast_Aluminum_Frame",
        base_color=(0.05, 0.10, 0.19, 1.0),
        metallic=0.35,
        roughness=0.44,
    )
    mat_hardware = create_pbr_material(
        "Seat_Brushed_Aluminum_Hardware",
        base_color=(0.82, 0.86, 0.91, 1.0),
        metallic=0.78,
        roughness=0.28,
    )

    bm_shell = bmesh.new()
    uv_shell = bm_shell.loops.layers.uv.verify()
    bm_frame = bmesh.new()
    uv_frame = bm_frame.loops.layers.uv.verify()
    bm_hw = bmesh.new()
    uv_hw = bm_hw.loops.layers.uv.verify()

    seat_width = 0.464
    half_w = seat_width * 0.5
    nu, nz = 32, 36

    def to_seat_bpos(pt: Vector) -> Vector:
        # Maps (px_front_neg, py_lateral, pz_up) -> Three.js (x=py_lateral, y=pz_up, z=-px_front_neg)
        return b_pos(pt.y, pt.z, -pt.x)

    def eval_pt(u_in: float, v_in: float):
        u, v, sd = mrs.snap_uv_to_slot_contour(u_in, v_in)
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

        thickness = 0.026 + side_frame_proud * 0.60
        x_rear = plan_bow_x + rake_x - (side_frame_proud + top_rim_proud + slat_camber) + slot_pinch + outer_pinch
        x_front = plan_bow_x + rake_x + thickness - slot_pinch - outer_pinch
        return to_seat_bpos(Vector((x_rear, y, z))), to_seat_bpos(Vector((x_front, y, z))), sd

    rear_v = [[None] * (nz + 1) for _ in range(nu + 1)]
    front_v = [[None] * (nz + 1) for _ in range(nu + 1)]
    sd_grid = [[1.0] * (nz + 1) for _ in range(nu + 1)]

    for iu in range(nu + 1):
        u_r = (iu / float(nu)) * 2.0 - 1.0
        for iz in range(nz + 1):
            v_r = iz / float(nz)
            pr, pf, sd = eval_pt(u_r, v_r)
            sd_grid[iu][iz] = sd
            if sd > -0.005:
                rear_v[iu][iz] = bm_shell.verts.new(pr)
                front_v[iu][iz] = bm_shell.verts.new(pf)

    for iu in range(nu):
        for iz in range(nz):
            sd_c = 0.25 * (sd_grid[iu][iz] + sd_grid[iu + 1][iz] + sd_grid[iu + 1][iz + 1] + sd_grid[iu][iz + 1])
            if sd_c <= 0.001:
                continue
            r00, r10, r11, r01 = rear_v[iu][iz], rear_v[iu + 1][iz], rear_v[iu + 1][iz + 1], rear_v[iu][iz + 1]
            f00, f10, f11, f01 = front_v[iu][iz], front_v[iu + 1][iz], front_v[iu + 1][iz + 1], front_v[iu][iz + 1]
            if None in (r00, r10, r11, r01, f00, f10, f11, f01):
                continue
            fr = bm_shell.faces.new((r00, r01, r11, r10))
            ff = bm_shell.faces.new((f00, f10, f11, f01))
            for f in (fr, ff):
                for loop in f.loops:
                    loop[uv_shell].uv = (iu / float(nu), iz / float(nz))

            # Slot inner walls go into bm_frame (darker recessed cavity)
            for niu, niz, pts in [
                (iu - 1, iz, (r00.co, f00.co, f01.co, r01.co)),
                (iu + 1, iz, (r10.co, r11.co, f11.co, f10.co)),
                (iu, iz - 1, (r00.co, r10.co, f10.co, f00.co)),
                (iu, iz + 1, (r01.co, f01.co, f11.co, r11.co)),
            ]:
                if 0 <= niu < nu and 0 <= niz < nz:
                    sd_n = 0.25 * (sd_grid[niu][niz] + sd_grid[niu + 1][niz] + sd_grid[niu + 1][niz + 1] + sd_grid[niu][niz + 1])
                    if sd_n <= 0.001:
                        wv = [bm_frame.verts.new(p) for p in pts]
                        bm_frame.faces.new(wv)

    # Outer perimeter rim of backrest
    for iz in range(nz):
        if rear_v[0][iz] and rear_v[0][iz + 1]:
            bm_shell.faces.new((rear_v[0][iz], front_v[0][iz], front_v[0][iz + 1], rear_v[0][iz + 1]))
        if rear_v[nu][iz] and rear_v[nu][iz + 1]:
            bm_shell.faces.new((rear_v[nu][iz], rear_v[nu][iz + 1], front_v[nu][iz + 1], front_v[nu][iz]))
    for iu in range(nu):
        if rear_v[iu][nz] and rear_v[iu + 1][nz]:
            bm_shell.faces.new((rear_v[iu][nz], rear_v[iu + 1][nz], front_v[iu + 1][nz], front_v[iu][nz]))
        if rear_v[iu][0] and rear_v[iu + 1][0]:
            bm_shell.faces.new((rear_v[iu][0], front_v[iu][0], front_v[iu + 1][0], rear_v[iu + 1][0]))

    # Sculpted armrests (outer lip in bm_shell, inner dark cavity in bm_frame)
    n_sa, n_pa = 14, 12
    for side_sign in (-1.0, 1.0):
        ay = side_sign * (half_w * 0.90)
        ag_pts = []
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
            row_pts = []
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
                row_pts.append((to_seat_bpos(Vector((ax, ay + dy, az + dz))), is_cav))
            ag_pts.append(row_pts)
        for iseg in range(n_sa):
            for ip in range(n_pa):
                p00, c00 = ag_pts[iseg][ip]
                p10, c10 = ag_pts[iseg + 1][ip]
                p11, c11 = ag_pts[iseg + 1][ip + 1]
                p01, c01 = ag_pts[iseg][ip + 1]
                target_bm = bm_frame if (c00 or c10 or c11 or c01) else bm_shell
                tv = [target_bm.verts.new(p) for p in (p00, p10, p11, p01)]
                target_bm.faces.new(tv)

    # Tip-up Cushion Bolster in bm_shell
    nb_u, nb_v = 14, 12
    bg = []
    for iu in range(nb_u + 1):
        u = (iu / float(nb_u)) * 2.0 - 1.0
        by = u * (half_w * 0.78)
        et = 1.0 - 0.15 * (u ** 4)
        rv = []
        for iv in range(nb_v + 1):
            ang = (iv / float(nb_v)) * math.pi * 2.0
            rt = 0.032 * et
            rh = 0.145 * et
            lx, lz = math.cos(ang) * rt, math.sin(ang) * rh
            tilt = math.radians(20.0)
            bx = -0.188 + (u * u) * 0.016 + lx * math.cos(tilt) - lz * math.sin(tilt)
            bz = 0.355 - (u * u) * 0.012 + lx * math.sin(tilt) + lz * math.cos(tilt)
            rv.append(bm_shell.verts.new(to_seat_bpos(Vector((bx, by, bz)))))
        bg.append(rv)
    for iu in range(nb_u):
        for iv in range(nb_v):
            bm_shell.faces.new((bg[iu][iv], bg[iu + 1][iv], bg[iu + 1][iv + 1], bg[iu][iv + 1]))

    # Twin Cast-Aluminum / Dark Navy Pedestal Stanchions + Floor Flanges in bm_frame
    for leg_y in (-half_w * 0.62, half_w * 0.62):
        bmesh.ops.create_cone(
            bm_frame,
            cap_ends=True,
            cap_tris=True,
            segments=12,
            radius1=0.034,
            radius2=0.024,
            depth=0.38,
            matrix=Matrix.Translation(to_seat_bpos(Vector((0.02, leg_y, 0.19)))),
        )
        bmesh.ops.create_cone(
            bm_frame,
            cap_ends=True,
            cap_tris=True,
            segments=12,
            radius1=0.056,
            radius2=0.048,
            depth=0.018,
            matrix=Matrix.Translation(to_seat_bpos(Vector((0.02, leg_y, 0.009)))),
        )

    # Rear 90 mm Brushed-Aluminum Number Disc & Stainless Pan-Head Phillips Screws in bm_hw
    p_d, _, _ = eval_pt(+0.168, 0.680)
    p_du1, _, _ = eval_pt(+0.188, 0.680)
    p_du0, _, _ = eval_pt(+0.148, 0.680)
    p_dv1, _, _ = eval_pt(+0.168, 0.700)
    p_dv0, _, _ = eval_pt(+0.168, 0.660)
    ty_d = (p_du1 - p_du0).normalized()
    tz_d = (p_dv1 - p_dv0).normalized()
    n_rear_d = ty_d.cross(tz_d).normalized()
    if n_rear_d.y > 0.0:
        # In Blender Z-up where b_pos maps +Z_three to -Y_bl, rear of backrest (-Z_three) is +Y_bl
        pass
    if n_rear_d.y < 0.0:
        n_rear_d = -n_rear_d
    tx_d = ty_d.cross(n_rear_d).normalized()
    rot_d = Matrix((tx_d, ty_d, n_rear_d)).transposed().to_4x4()

    bmesh.ops.create_cone(
        bm_hw,
        cap_ends=True,
        cap_tris=True,
        segments=28,
        radius1=0.044,
        radius2=0.043,
        depth=0.004,
        matrix=Matrix.Translation(p_d + n_rear_d * 0.004) @ rot_d,
    )
    # Two tiny disc rivets
    for side_s in (-1.0, 1.0):
        sc_pos = p_d + n_rear_d * 0.006 + ty_d * (side_s * 0.034)
        bmesh.ops.create_cone(
            bm_hw,
            cap_ends=True,
            cap_tris=True,
            segments=10,
            radius1=0.0035,
            radius2=0.0026,
            depth=0.002,
            matrix=Matrix.Translation(sc_pos) @ rot_d,
        )

    # Stainless pan-head Phillips screws on outer backrest frame rail
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
        if n_rear_s.y < 0.0:
            n_rear_s = -n_rear_s
        tx_s = ty_s.cross(n_rear_s).normalized()
        rot_s = Matrix((tx_s, ty_s, n_rear_s)).transposed().to_4x4()
        bmesh.ops.create_cone(
            bm_hw,
            cap_ends=True,
            cap_tris=True,
            segments=16,
            radius1=0.0115,
            radius2=0.0088,
            depth=0.004,
            matrix=Matrix.Translation(p_s + n_rear_s * 0.004) @ rot_s,
        )

    for bm_item in (bm_shell, bm_frame, bm_hw):
        bmesh.ops.remove_doubles(bm_item, verts=bm_item.verts, dist=0.0001)
        bmesh.ops.recalc_face_normals(bm_item, faces=bm_item.faces)
        bmesh.ops.triangulate(bm_item, faces=bm_item.faces)

    finalize_mesh(bm_shell, "Seat_Shell", mat_shell, col, smooth=True)
    finalize_mesh(bm_frame, "Seat_Frame", mat_frame, col, smooth=True)
    finalize_mesh(bm_hw, "Seat_Hardware", mat_hardware, col, smooth=True)

    seat_glb_path = os.path.join(OUTPUT_DIR, "seat_high_detail.glb")
    bpy.ops.export_scene.gltf(
        filepath=seat_glb_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )
    return seat_glb_path


# ---------------------------------------------------------------------------
# 2. Build & Export Seated 3D Spectator Model (spectator_crowd.glb)
# ---------------------------------------------------------------------------
def build_and_export_spectator_crowd():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.context.scene.collection

    mat_jersey = create_pbr_material(
        "Spectator_Jersey_Mat",
        base_color=(0.95, 0.96, 0.98, 1.0),
        metallic=0.04,
        roughness=0.65,
    )
    mat_body = create_pbr_material(
        "Spectator_Body_Mat",
        base_color=(0.25, 0.28, 0.35, 1.0),
        metallic=0.05,
        roughness=0.72,
    )

    bm_jersey = bmesh.new()
    bmesh.ops.create_cube(bm_jersey, size=1.0)
    for v in bm_jersey.verts:
        z_t = v.co.z + 0.5
        shoulder_w = 0.34 if z_t > 0.4 else 0.28
        v.co.x *= shoulder_w
        v.co.y = v.co.y * 0.19 - 0.04
        v.co.z = v.co.z * 0.42 + 0.67
    for side in (-1.0, 1.0):
        ret_arm = bmesh.ops.create_cube(bm_jersey, size=1.0)
        for v in ret_arm["verts"]:
            v.co.x = v.co.x * 0.085 + side * 0.21
            v.co.y = v.co.y * 0.22 + 0.06
            v.co.z = v.co.z * 0.26 + 0.72
    finalize_mesh(bm_jersey, "Spectator_Jersey", mat_jersey, col, smooth=True)

    bm_body = bmesh.new()
    bmesh.ops.create_icosphere(bm_body, subdivisions=2, radius=0.105, matrix=Matrix.Translation((0.0, -0.02, 1.01)))
    for side in (-1.0, 1.0):
        ret_thigh = bmesh.ops.create_cube(bm_body, size=1.0)
        for v in ret_thigh["verts"]:
            v.co.x = v.co.x * 0.11 + side * 0.09
            v.co.y = v.co.y * 0.30 + 0.10
            v.co.z = v.co.z * 0.11 + 0.48
    finalize_mesh(bm_body, "Spectator_Body", mat_body, col, smooth=True)

    crowd_glb_path = os.path.join(OUTPUT_DIR, "spectator_crowd.glb")
    bpy.ops.export_scene.gltf(
        filepath=crowd_glb_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )
    return crowd_glb_path


# ---------------------------------------------------------------------------
# 3. Build & Export Complete International Cricket Stadium (stadium_venue.glb)
# ---------------------------------------------------------------------------
def build_and_export_complete_stadium(textures):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.context.scene.collection

    rx_base = 84.0
    rz_base = 72.0
    roof_in_x, roof_in_z = 92.0, 80.0
    roof_out_x, roof_out_z = 128.0, 116.0
    roof_h = 31.5

    # Exact 1:1 parity with DEFAULT_STADIUM_SPEC in src/shared/stadiumSpec.ts (42° span per stand across 360°)
    stands = [
        {"code": "NORTH", "angle": 0.0, "span": 42.0},
        {"code": "NORTH_EAST", "angle": 45.0, "span": 42.0},
        {"code": "EAST", "angle": 90.0, "span": 42.0},
        {"code": "SOUTH_EAST", "angle": 135.0, "span": 42.0},
        {"code": "SOUTH", "angle": 180.0, "span": 42.0},
        {"code": "SOUTH_WEST", "angle": 225.0, "span": 42.0},
        {"code": "WEST", "angle": 270.0, "span": 42.0},
        {"code": "NORTH_WEST", "angle": 315.0, "span": 42.0},
    ]

    tiers = [
        {"tier": 1, "elev": 2.2, "riser": 0.30, "row_depth": 0.80, "offset": 4.0, "rows": 10},
        {"tier": 2, "elev": 8.2, "riser": 0.36, "row_depth": 0.80, "offset": 13.6, "rows": 10},
        {"tier": 3, "elev": 15.2, "riser": 0.42, "row_depth": 0.80, "offset": 23.2, "rows": 10},
    ]

    # Create 2K PBR Materials
    mat_turf = create_pbr_material(
        "Outfield_Bermuda_Turf",
        base_color=(1.0, 1.0, 1.0, 1.0),
        metallic=0.0,
        roughness=0.78,
        albedo_path=textures["turf_albedo"],
        normal_path=textures["turf_normal"],
        roughness_path=textures["turf_rough"],
    )
    mat_pitch = create_pbr_material(
        "Pitch_22Yard_Clay",
        base_color=(1.0, 1.0, 1.0, 1.0),
        metallic=0.0,
        roughness=0.74,
        albedo_path=textures["pitch_albedo"],
        normal_path=textures["pitch_normal"],
        roughness_path=textures["pitch_rough"],
    )
    mat_square_used = create_pbr_material(
        "Cricket_Square_Used_Loam",
        base_color=(1.0, 1.0, 1.0, 1.0),
        metallic=0.0,
        roughness=0.78,
        albedo_path=textures["square_used_albedo"],
        normal_path=textures["pitch_normal"],
        roughness_path=textures["pitch_rough"],
    )
    mat_square_grass = create_pbr_material(
        "Cricket_Square_Regen_Turf",
        base_color=(1.0, 1.0, 1.0, 1.0),
        metallic=0.0,
        roughness=0.80,
        albedo_path=textures["square_grass_albedo"],
        normal_path=textures["turf_normal"],
        roughness_path=textures["turf_rough"],
    )
    mat_crease_white = create_pbr_material(
        "Pitch_Crease_White_Paint",
        base_color=(0.96, 0.97, 0.98, 1.0),
        metallic=0.02,
        roughness=0.58,
    )
    # Pale off-white bush-hammered concrete steps matching seat_ref.png!
    mat_concrete = create_pbr_material(
        "Stadium_Precast_Concrete",
        base_color=(0.88, 0.89, 0.91, 1.0),
        metallic=0.04,
        roughness=0.78,
        albedo_path=textures["concrete_albedo"],
        normal_path=textures["concrete_normal"],
        roughness_path=textures["concrete_rough"],
    )
    mat_dark_concrete = create_pbr_material(
        "Stadium_Substructure_Dark",
        base_color=(0.14, 0.17, 0.23, 1.0),
        metallic=0.14,
        roughness=0.78,
    )
    mat_aisle_step = create_pbr_material(
        "Aisle_Safety_Stair",
        base_color=(0.92, 0.74, 0.15, 1.0),
        metallic=0.12,
        roughness=0.48,
    )
    mat_steel = create_pbr_material(
        "Structural_Truss_Steel",
        base_color=(0.64, 0.70, 0.78, 1.0),
        metallic=0.88,
        roughness=0.26,
    )
    mat_roof_ptfe = create_pbr_material(
        "Cantilever_PTFE_Membrane",
        base_color=(0.90, 0.93, 0.97, 0.88),
        metallic=0.12,
        roughness=0.34,
        alpha=0.88,
    )
    mat_sightscreen = create_pbr_material(
        "SightScreen_Louvered_Matte",
        base_color=(0.94, 0.96, 0.98, 1.0),
        metallic=0.06,
        roughness=0.52,
    )
    mat_vip_glass = create_pbr_material(
        "VIP_Suite_Reflective_Glass",
        base_color=(0.22, 0.58, 0.86, 0.58),
        metallic=0.25,
        roughness=0.06,
        alpha=0.58,
        transmission=0.65,
        emission_color=(0.18, 0.42, 0.65, 1.0),
        emission_strength=0.35,
    )
    mat_vip_lounge_glow = create_pbr_material(
        "VIP_Interior_Warm_Soffit",
        base_color=(0.98, 0.82, 0.52, 1.0),
        metallic=0.1,
        roughness=0.4,
        emission_color=(0.98, 0.78, 0.42, 1.0),
        emission_strength=1.4,
    )
    mat_scoreboard = create_pbr_material(
        "Giant_8K_Scoreboard_LED",
        base_color=(1.0, 1.0, 1.0, 1.0),
        metallic=0.1,
        roughness=0.22,
        albedo_path=textures["scoreboard_8k"],
        emissive_path=textures["scoreboard_8k"],
        emission_color=(1.0, 1.0, 1.0, 1.0),
        emission_strength=2.2,
    )
    mat_led_ribbon = create_pbr_material(
        "Perimeter_Sponsor_LED",
        base_color=(1.0, 1.0, 1.0, 1.0),
        metallic=0.15,
        roughness=0.25,
        albedo_path=textures["led_ribbon"],
        emissive_path=textures["led_ribbon"],
        emission_color=(1.0, 1.0, 1.0, 1.0),
        emission_strength=1.4,
    )
    mat_floodlight_led = create_pbr_material(
        "Floodlight_Luminaire_Array",
        base_color=(0.98, 0.99, 1.0, 1.0),
        metallic=0.2,
        roughness=0.15,
        emission_color=(0.96, 0.98, 1.0, 1.0),
        emission_strength=4.5,
    )
    mat_stump_wood = create_pbr_material(
        "Polished_Ash_Stumps",
        base_color=(0.92, 0.76, 0.42, 1.0),
        metallic=0.05,
        roughness=0.30,
    )
    mat_zing_bail = create_pbr_material(
        "Zing_LED_Bail_Glow",
        base_color=(1.0, 0.25, 0.15, 1.0),
        metallic=0.05,
        roughness=0.22,
        emission_color=(1.0, 0.22, 0.10, 1.0),
        emission_strength=2.8,
    )
    mat_boundary_rope = create_pbr_material(
        "Boundary_Cushion_Rope",
        base_color=(0.96, 0.97, 0.99, 1.0),
        metallic=0.05,
        roughness=0.42,
    )
    mat_foliage = create_pbr_material(
        "Plaza_Canopy_Foliage",
        base_color=(0.14, 0.42, 0.22, 1.0),
        metallic=0.0,
        roughness=0.82,
    )

    def turf_crown_y(x_m: float, z_m: float) -> float:
        r_norm = min(1.0, math.hypot(x_m / (rx_base + 3.5), z_m / (rz_base + 3.5)))
        return 0.36 * math.cos(r_norm * math.pi * 0.5) ** 1.5

    # -----------------------------------------------------------------------
    # A. Crowned Multi-Ring Outfield Turf Oval + UV Mapping (12 rings x 128 segs)
    # -----------------------------------------------------------------------
    bm_turf = bmesh.new()
    uv_turf = bm_turf.loops.layers.uv.verify()
    segs = 128
    rings = 14
    max_rx = rx_base + 3.5
    max_rz = rz_base + 3.5

    center_v = bm_turf.verts.new(b_pos(0.0, turf_crown_y(0.0, 0.0), 0.0))
    ring_grid = []
    for ir in range(1, rings + 1):
        frac = ir / float(rings)
        row_v = []
        for iseg in range(segs):
            theta = (iseg / float(segs)) * 2.0 * math.pi
            vx = max_rx * frac * math.sin(theta)
            vz = -max_rz * frac * math.cos(theta)
            vy = turf_crown_y(vx, vz)
            row_v.append(bm_turf.verts.new(b_pos(vx, vy, vz)))
        ring_grid.append(row_v)

    for iseg in range(segs):
        nxt = (iseg + 1) % segs
        f0 = bm_turf.faces.new((center_v, ring_grid[0][iseg], ring_grid[0][nxt]))
        for lp in f0.loops:
            tx, tz = lp.vert.co.x, -lp.vert.co.y
            lp[uv_turf].uv = (0.5 + tx / (2.0 * max_rx), 0.5 + tz / (2.0 * max_rz))

    for ir in range(rings - 1):
        for iseg in range(segs):
            nxt = (iseg + 1) % segs
            f = bm_turf.faces.new((ring_grid[ir][iseg], ring_grid[ir + 1][iseg], ring_grid[ir + 1][nxt], ring_grid[ir][nxt]))
            for lp in f.loops:
                tx, tz = lp.vert.co.x, -lp.vert.co.y
                lp[uv_turf].uv = (0.5 + tx / (2.0 * max_rx), 0.5 + tz / (2.0 * max_rz))

    finalize_mesh(bm_turf, "Outfield_Turf_Field", mat_turf, col, smooth=True)

    # -----------------------------------------------------------------------
    # B. 5-Strip Central Cricket Square, 22-Yard Match Pitch, 3D Creases,
    #    30-Yard Dashed Circle & Ash Stumps with Zing Bails
    # -----------------------------------------------------------------------
    def add_subdivided_pitch_strip(bm_target, uv_layer_target, x_center: float, width: float, z_half: float, y_lift: float, swap_uv: bool):
        nx, nz_s = 12, 48
        grid = []
        for ix in range(nx + 1):
            u = ix / float(nx)
            px = x_center + (u - 0.5) * width
            row = []
            for iz in range(nz_s + 1):
                v = iz / float(nz_s)
                pz = (v * 2.0 - 1.0) * z_half
                py = turf_crown_y(px, pz) + y_lift
                row.append((bm_target.verts.new(b_pos(px, py, pz)), u, v))
            grid.append(row)
        for ix in range(nx):
            for iz in range(nz_s):
                v00, u00, w00 = grid[ix][iz]
                v10, u10, w10 = grid[ix + 1][iz]
                v11, u11, w11 = grid[ix + 1][iz + 1]
                v01, u01, w01 = grid[ix][iz + 1]
                f = bm_target.faces.new((v00, v10, v11, v01))
                uvs = [(w00, u00), (w10, u10), (w11, u11), (w01, u01)] if swap_uv else [(u00, w00), (u10, w10), (u11, w11), (u01, w01)]
                for lp, uv_val in zip(f.loops, uvs):
                    lp[uv_layer_target].uv = uv_val

    # 1. Central 22-Yard Match Pitch (x=0, width=3.05m, length=22.40m including run-up ends)
    bm_pitch = bmesh.new()
    uv_p = bm_pitch.loops.layers.uv.verify()
    add_subdivided_pitch_strip(bm_pitch, uv_p, 0.0, 3.05, 11.20, 0.012, swap_uv=True)
    finalize_mesh(bm_pitch, "Cricket_Pitch_22Yard", mat_pitch, col, smooth=True)

    # 2. Inner Used Practice Clay Strips (x = ±3.15m, width=2.75m)
    bm_sq_used = bmesh.new()
    uv_su = bm_sq_used.loops.layers.uv.verify()
    for sx in (-3.15, 3.15):
        add_subdivided_pitch_strip(bm_sq_used, uv_su, sx, 2.75, 10.80, 0.009, swap_uv=True)
    finalize_mesh(bm_sq_used, "Cricket_Square_Used_Strips", mat_square_used, col, smooth=True)

    # 3. Outer Regenerating Turf Strips (x = ±6.15m, width=2.75m)
    bm_sq_grass = bmesh.new()
    uv_sg = bm_sq_grass.loops.layers.uv.verify()
    for sx in (-6.15, 6.15):
        add_subdivided_pitch_strip(bm_sq_grass, uv_sg, sx, 2.75, 10.60, 0.007, swap_uv=True)
    finalize_mesh(bm_sq_grass, "Cricket_Square_Turf_Strips", mat_square_grass, col, smooth=True)

    # 4. Crisp 3D Raised White Painted Crease Markings & 30-Yard Dashed Fielding Circle
    bm_creases = bmesh.new()

    def add_crease_quad(x0: float, z0: float, x1: float, z1: float, y_off: float = 0.016):
        v0 = bm_creases.verts.new(b_pos(x0, turf_crown_y(x0, z0) + y_off, z0))
        v1 = bm_creases.verts.new(b_pos(x1, turf_crown_y(x1, z0) + y_off, z0))
        v2 = bm_creases.verts.new(b_pos(x1, turf_crown_y(x1, z1) + y_off, z1))
        v3 = bm_creases.verts.new(b_pos(x0, turf_crown_y(x0, z1) + y_off, z1))
        bm_creases.faces.new((v0, v1, v2, v3))

    lw = 0.026  # 52mm total crease line width
    for end_sign in (-1.0, 1.0):
        z_stump = end_sign * 10.06
        z_pop = end_sign * (10.06 - 1.22)
        z_back = end_sign * (10.06 + 1.22)
        # Bowling crease (2.64m wide)
        add_crease_quad(-1.32, z_stump - lw, 1.32, z_stump + lw)
        # Popping crease (3.05m wide)
        add_crease_quad(-1.52, z_pop - lw, 1.52, z_pop + lw)
        # Return creases (at x = ±1.32m) and Wide guidelines (at x = ±0.89m)
        z_min, z_max = min(z_pop, z_back), max(z_pop, z_back)
        for rx_c in (-1.32, 1.32):
            add_crease_quad(rx_c - lw, z_min, rx_c + lw, z_max)
        z_wmin, z_wmax = min(z_pop, z_stump), max(z_pop, z_stump)
        for wx_c in (-0.89, 0.89):
            add_crease_quad(wx_c - lw * 0.8, z_wmin, wx_c + lw * 0.8, z_wmax)

    # 30-Yard Fielding Circle (dashed white oval decal, 27.43m radius)
    circle_r = 27.43
    dash_count = 72
    for i in range(dash_count):
        t0 = ((i + 0.15) / dash_count) * 2.0 * math.pi
        t1 = ((i + 0.72) / dash_count) * 2.0 * math.pi
        r_in, r_out = circle_r - 0.14, circle_r + 0.14
        x0_i, z0_i = r_in * math.sin(t0), -r_in * math.cos(t0)
        x0_o, z0_o = r_out * math.sin(t0), -r_out * math.cos(t0)
        x1_o, z1_o = r_out * math.sin(t1), -r_out * math.cos(t1)
        x1_i, z1_i = r_in * math.sin(t1), -r_in * math.cos(t1)
        cv0 = bm_creases.verts.new(b_pos(x0_i, turf_crown_y(x0_i, z0_i) + 0.014, z0_i))
        cv1 = bm_creases.verts.new(b_pos(x0_o, turf_crown_y(x0_o, z0_o) + 0.014, z0_o))
        cv2 = bm_creases.verts.new(b_pos(x1_o, turf_crown_y(x1_o, z1_o) + 0.014, z1_o))
        cv3 = bm_creases.verts.new(b_pos(x1_i, turf_crown_y(x1_i, z1_i) + 0.014, z1_i))
        bm_creases.faces.new((cv0, cv1, cv2, cv3))

    finalize_mesh(bm_creases, "Cricket_Pitch_Creases_And_30Yard_Circle", mat_crease_white, col, smooth=False)

    # 5. Polished Ash Stumps & Glowing Zing LED Bails
    bm_stumps = bmesh.new()
    bm_bails = bmesh.new()
    for end_z in (-10.06, 10.06):
        base_y = turf_crown_y(0.0, end_z) + 0.012
        for sx in (-0.1143, 0.0, 0.1143):
            bmesh.ops.create_cone(
                bm_stumps,
                cap_ends=True,
                cap_tris=False,
                segments=16,
                radius1=0.019,
                radius2=0.018,
                depth=0.711,
                matrix=Matrix.Translation(b_pos(sx, base_y + 0.3555, end_z)),
            )
        for bx in (-0.057, 0.057):
            ret_b = bmesh.ops.create_cube(bm_bails, size=1.0)
            for v in ret_b["verts"]:
                v.co.x = v.co.x * 0.108 + bx
                v.co.y = v.co.y * 0.016 - end_z
                v.co.z = v.co.z * 0.016 + (base_y + 0.722)
    finalize_mesh(bm_stumps, "Cricket_Stumps_And_Bails", mat_stump_wood, col, smooth=True)
    finalize_mesh(bm_bails, "Cricket_Zing_LED_Bails", mat_zing_bail, col, smooth=True)

    # -----------------------------------------------------------------------
    # C. Padded Boundary Rope + 360° Digital LED Advertising Perimeter Boards + Team Dugouts
    # -----------------------------------------------------------------------
    bm_rope = bmesh.new()
    bm_led = bmesh.new()
    uv_led = bm_led.loops.layers.uv.verify()
    b_segs = 128
    bound_rx = rx_base * 0.90
    bound_rz = rz_base * 0.90
    led_rx = rx_base + 1.8
    led_rz = rz_base + 1.8

    for i in range(b_segs):
        t0 = (i / b_segs) * 2.0 * math.pi
        t1 = ((i + 1) / b_segs) * 2.0 * math.pi

        x0, z0 = bound_rx * math.sin(t0), -bound_rz * math.cos(t0)
        x1, z1 = bound_rx * math.sin(t1), -bound_rz * math.cos(t1)
        nx0, nz0 = math.sin(t0), -math.cos(t0)
        nx1, nz1 = math.sin(t1), -math.cos(t1)
        rw_half = 0.22
        y_r0 = turf_crown_y(x0, z0) + 0.14
        y_r1 = turf_crown_y(x1, z1) + 0.14
        rv0 = bm_rope.verts.new(b_pos(x0 - nx0 * rw_half, y_r0, z0 - nz0 * rw_half))
        rv1 = bm_rope.verts.new(b_pos(x0 + nx0 * rw_half, y_r0, z0 + nz0 * rw_half))
        rv2 = bm_rope.verts.new(b_pos(x1 + nx1 * rw_half, y_r1, z1 + nz1 * rw_half))
        rv3 = bm_rope.verts.new(b_pos(x1 - nx1 * rw_half, y_r1, z1 - nz1 * rw_half))
        bm_rope.faces.new((rv0, rv1, rv2, rv3))

        deg = (i / b_segs) * 360.0
        if not (deg < 5.0 or deg > 355.0):
            lx0, lz0 = led_rx * math.sin(t0), -led_rz * math.cos(t0)
            lx1, lz1 = led_rx * math.sin(t1), -led_rz * math.cos(t1)
            lv0 = bm_led.verts.new(b_pos(lx0, 0.0, lz0))
            lv1 = bm_led.verts.new(b_pos(lx1, 0.0, lz1))
            lv2 = bm_led.verts.new(b_pos(lx1 * 1.004, 1.05, lz1 * 1.004))
            lv3 = bm_led.verts.new(b_pos(lx0 * 1.004, 1.05, lz0 * 1.004))
            lf = bm_led.faces.new((lv0, lv1, lv2, lv3))
            u0 = (i % 16) / 16.0
            u1 = ((i % 16) + 1) / 16.0
            lf.loops[0][uv_led].uv = (u0, 0.0)
            lf.loops[1][uv_led].uv = (u1, 0.0)
            lf.loops[2][uv_led].uv = (u1, 1.0)
            lf.loops[3][uv_led].uv = (u0, 1.0)

    finalize_mesh(bm_rope, "Boundary_Padded_Rope", mat_boundary_rope, col, smooth=True, solidify_thickness=0.14)
    finalize_mesh(bm_led, "Perimeter_LED_Sponsor_Boards", mat_led_ribbon, col, smooth=False, solidify_thickness=0.22)

    bm_dugouts = bmesh.new()
    for d_deg in (-22.0, 22.0):
        drad = math.radians(d_deg)
        dx = (rx_base - 1.2) * math.sin(drad)
        dz = -(rz_base - 1.2) * math.cos(drad)
        ret_d = bmesh.ops.create_cube(bm_dugouts, size=1.0)
        for v in ret_d["verts"]:
            v.co.x = v.co.x * 8.5 + dx
            v.co.y = v.co.y * 2.2 - dz
            v.co.z = v.co.z * 2.0 + 1.0
    finalize_mesh(bm_dugouts, "Team_Boundary_Dugouts", mat_vip_glass, col, smooth=True)

    # -----------------------------------------------------------------------
    # D. Stepped Bush-Hammered Concrete Seating Bowl (8 Stands × 3 Tiers × 10 Rows)
    #    1:1 Match with DEFAULT_STADIUM_SPEC (posY = elev + (r-1)*riser, offset + (r-1)*0.80)
    # -----------------------------------------------------------------------
    bm_bowl = bmesh.new()
    uv_bowl = bm_bowl.loops.layers.uv.verify()
    bm_stairs = bmesh.new()
    bm_railings = bmesh.new()
    bm_vip = bmesh.new()
    bm_vip_glow = bmesh.new()

    arc_subdivs = 20

    for stand in stands:
        c_deg = stand["angle"]
        half_span = stand["span"] * 0.5 + 1.2

        for tier_cfg in tiers:
            step_h = tier_cfg["row_depth"]  # 0.80 m going
            step_v = tier_cfg["riser"]      # 0.30 / 0.36 / 0.42 m riser

            for r in range(1, tier_cfg["rows"] + 1):
                rad_center = tier_cfg["offset"] + (r - 1) * step_h
                rad_in = rad_center - 0.42
                rad_out = rad_center + 0.42
                y_top = tier_cfg["elev"] + (r - 1) * step_v
                y_bot = y_top - step_v - 0.04

                rx_in, rz_in = rx_base + rad_in, rz_base + rad_in
                rx_out, rz_out = rx_base + rad_out, rz_base + rad_out

                for k in range(arc_subdivs):
                    a0 = math.radians(c_deg - half_span + (k / arc_subdivs) * (2.0 * half_span))
                    a1 = math.radians(c_deg - half_span + ((k + 1) / arc_subdivs) * (2.0 * half_span))

                    x0_i, z0_i = rx_in * math.sin(a0), -rz_in * math.cos(a0)
                    x1_i, z1_i = rx_in * math.sin(a1), -rz_in * math.cos(a1)
                    x0_o, z0_o = rx_out * math.sin(a0), -rz_out * math.cos(a0)
                    x1_o, z1_o = rx_out * math.sin(a1), -rz_out * math.cos(a1)

                    # Vertical step riser
                    v_bl = bm_bowl.verts.new(b_pos(x0_i, y_bot, z0_i))
                    v_br = bm_bowl.verts.new(b_pos(x1_i, y_bot, z1_i))
                    v_tr = bm_bowl.verts.new(b_pos(x1_i, y_top, z1_i))
                    v_tl = bm_bowl.verts.new(b_pos(x0_i, y_top, z0_i))
                    f_riser = bm_bowl.faces.new((v_bl, v_br, v_tr, v_tl))
                    f_riser.loops[0][uv_bowl].uv = (0.0, 0.0)
                    f_riser.loops[1][uv_bowl].uv = (2.0, 0.0)
                    f_riser.loops[2][uv_bowl].uv = (2.0, 0.35)
                    f_riser.loops[3][uv_bowl].uv = (0.0, 0.35)

                    # Horizontal step tread (where seat pedestals bolt at y_top)
                    v_bo = bm_bowl.verts.new(b_pos(x0_o, y_top, z0_o))
                    v_bro = bm_bowl.verts.new(b_pos(x1_o, y_top, z1_o))
                    f_tread = bm_bowl.faces.new((v_tl, v_tr, v_bro, v_bo))
                    f_tread.loops[0][uv_bowl].uv = (0.0, 0.35)
                    f_tread.loops[1][uv_bowl].uv = (2.0, 0.35)
                    f_tread.loops[2][uv_bowl].uv = (2.0, 1.0)
                    f_tread.loops[3][uv_bowl].uv = (0.0, 1.0)

                for aisle_frac in (-0.21, 0.21):
                    a_st0 = math.radians(c_deg + aisle_frac * stand["span"] - 0.65)
                    a_st1 = math.radians(c_deg + aisle_frac * stand["span"] + 0.65)
                    sx0_i, sz0_i = rx_in * math.sin(a_st0), -rz_in * math.cos(a_st0)
                    sx1_i, sz1_i = rx_in * math.sin(a_st1), -rz_in * math.cos(a_st1)
                    sx0_o, sz0_o = rx_out * math.sin(a_st0), -rz_out * math.cos(a_st0)
                    sx1_o, sz1_o = rx_out * math.sin(a_st1), -rz_out * math.cos(a_st1)
                    sv0 = bm_stairs.verts.new(b_pos(sx0_i, y_top + 0.015, sz0_i))
                    sv1 = bm_stairs.verts.new(b_pos(sx1_i, y_top + 0.015, sz1_i))
                    sv2 = bm_stairs.verts.new(b_pos(sx1_o, y_top + 0.015, sz1_o))
                    sv3 = bm_stairs.verts.new(b_pos(sx0_o, y_top + 0.015, sz0_o))
                    bm_stairs.faces.new((sv0, sv1, sv2, sv3))

            rail_rad = tier_cfg["offset"] - 0.55
            rail_rx, rail_rz = rx_base + rail_rad, rz_base + rail_rad
            rail_y0 = tier_cfg["elev"] - 0.15
            rail_y1 = tier_cfg["elev"] + 0.72
            for k in range(arc_subdivs):
                a0 = math.radians(c_deg - half_span + (k / arc_subdivs) * (2.0 * half_span))
                a1 = math.radians(c_deg - half_span + ((k + 1) / arc_subdivs) * (2.0 * half_span))
                gx0, gz0 = rail_rx * math.sin(a0), -rail_rz * math.cos(a0)
                gx1, gz1 = rail_rx * math.sin(a1), -rail_rz * math.cos(a1)
                gv0 = bm_railings.verts.new(b_pos(gx0, rail_y0, gz0))
                gv1 = bm_railings.verts.new(b_pos(gx1, rail_y0, gz1))
                gv2 = bm_railings.verts.new(b_pos(gx1, rail_y1, gz1))
                gv3 = bm_railings.verts.new(b_pos(gx0, rail_y1, gz0))
                bm_railings.faces.new((gv0, gv1, gv2, gv3))

            if tier_cfg["tier"] == 2:
                suite_rad_in = tier_cfg["offset"] + tier_cfg["rows"] * step_h + 0.2
                suite_rad_out = suite_rad_in + 1.2
                srx_i, srz_i = rx_base + suite_rad_in, rz_base + suite_rad_in
                srx_o, srz_o = rx_base + suite_rad_out, rz_base + suite_rad_out
                sy_bot = 11.50
                sy_top = 14.85
                for k in range(arc_subdivs):
                    a0 = math.radians(c_deg - half_span + (k / arc_subdivs) * (2.0 * half_span))
                    a1 = math.radians(c_deg - half_span + ((k + 1) / arc_subdivs) * (2.0 * half_span))
                    vx0, vz0 = srx_i * math.sin(a0), -srz_i * math.cos(a0)
                    vx1, vz1 = srx_i * math.sin(a1), -srz_i * math.cos(a1)
                    ox0, oz0 = srx_o * math.sin(a0), -srz_o * math.cos(a0)
                    ox1, oz1 = srx_o * math.sin(a1), -srz_o * math.cos(a1)

                    vv0 = bm_vip.verts.new(b_pos(vx0, sy_bot, vz0))
                    vv1 = bm_vip.verts.new(b_pos(vx1, sy_bot, vz1))
                    vv2 = bm_vip.verts.new(b_pos(vx1 * 0.992, sy_top, vz1 * 0.992))
                    vv3 = bm_vip.verts.new(b_pos(vx0 * 0.992, sy_top, vz0 * 0.992))
                    bm_vip.faces.new((vv0, vv1, vv2, vv3))

                    cv0 = bm_vip_glow.verts.new(b_pos(vx0, sy_top - 0.15, vz0))
                    cv1 = bm_vip_glow.verts.new(b_pos(vx1, sy_top - 0.15, vz1))
                    cv2 = bm_vip_glow.verts.new(b_pos(ox1, sy_top - 0.15, oz1))
                    cv3 = bm_vip_glow.verts.new(b_pos(ox0, sy_top - 0.15, oz0))
                    bm_vip_glow.faces.new((cv0, cv1, cv2, cv3))

    finalize_mesh(bm_bowl, "Seating_Bowl_Stepped_Tiers", mat_concrete, col, smooth=False, solidify_thickness=0.18)
    finalize_mesh(bm_stairs, "Radial_Aisle_Safety_Stairs", mat_aisle_step, col, smooth=False)
    finalize_mesh(bm_railings, "Tier_Glass_Balustrades", mat_vip_glass, col, smooth=False, solidify_thickness=0.06)
    finalize_mesh(bm_vip, "VIP_Hospitality_Glass_Curtain", mat_vip_glass, col, smooth=True, solidify_thickness=0.12)
    finalize_mesh(bm_vip_glow, "VIP_Hospitality_Warm_Lounges", mat_vip_lounge_glow, col, smooth=False)

    # -----------------------------------------------------------------------
    # E. Outer Architectural Bowl Shell, Diagrid Steel Exoskeleton & Concourse Podium
    # -----------------------------------------------------------------------
    bm_shell = bmesh.new()
    shell_segs = 96
    for i in range(shell_segs):
        t0 = (i / shell_segs) * 2.0 * math.pi
        t1 = ((i + 1) / shell_segs) * 2.0 * math.pi

        ax0, az0 = (rx_base + 3.5) * math.sin(t0), -(rz_base + 3.5) * math.cos(t0)
        ax1, az1 = (rx_base + 3.5) * math.sin(t1), -(rz_base + 3.5) * math.cos(t1)
        av0 = bm_shell.verts.new(b_pos(ax0, 0.0, az0))
        av1 = bm_shell.verts.new(b_pos(ax1, 0.0, az1))
        av2 = bm_shell.verts.new(b_pos(ax1, 2.0, az1))
        av3 = bm_shell.verts.new(b_pos(ax0, 2.0, az0))
        bm_shell.faces.new((av0, av1, av2, av3))

        bx0_b, bz0_b = (rx_base + 36.0) * math.sin(t0), -(rz_base + 36.0) * math.cos(t0)
        bx1_b, bz1_b = (rx_base + 36.0) * math.sin(t1), -(rz_base + 36.0) * math.cos(t1)
        bx0_t, bz0_t = (rx_base + 31.5) * math.sin(t0), -(rz_base + 31.5) * math.cos(t0)
        bx1_t, bz1_t = (rx_base + 31.5) * math.sin(t1), -(rz_base + 31.5) * math.cos(t1)
        bv0 = bm_shell.verts.new(b_pos(bx0_b, 0.0, bz0_b))
        bv1 = bm_shell.verts.new(b_pos(bx1_b, 0.0, bz1_b))
        bv2 = bm_shell.verts.new(b_pos(bx1_t, 24.5, bz1_t))
        bv3 = bm_shell.verts.new(b_pos(bx0_t, 24.5, bz0_t))
        bm_shell.faces.new((bv0, bv1, bv2, bv3))

        px0, pz0 = (rx_base + 58.0) * math.sin(t0), -(rz_base + 58.0) * math.cos(t0)
        px1, pz1 = (rx_base + 58.0) * math.sin(t1), -(rz_base + 58.0) * math.cos(t1)
        pv0 = bm_shell.verts.new(b_pos(bx0_b, -0.05, bz0_b))
        pv1 = bm_shell.verts.new(b_pos(bx1_b, -0.05, bz1_b))
        pv2 = bm_shell.verts.new(b_pos(px1, -0.05, pz1))
        pv3 = bm_shell.verts.new(b_pos(px0, -0.05, pz0))
        bm_shell.faces.new((pv0, pv1, pv2, pv3))

    finalize_mesh(bm_shell, "Stadium_Substructure_And_Concourse", mat_dark_concrete, col, smooth=True, solidify_thickness=0.35)

    # -----------------------------------------------------------------------
    # F. Monumental Cantilevered Pleated PTFE Roof Canopy & 32 Boomerang Steel Trusses
    # -----------------------------------------------------------------------
    bm_roof = bmesh.new()
    bm_truss = bmesh.new()
    roof_segs = 64

    for i in range(roof_segs):
        t0 = (i / roof_segs) * 2.0 * math.pi
        t1 = ((i + 1) / roof_segs) * 2.0 * math.pi
        pleat0 = 1.35 if (i % 2 == 0) else 0.0
        pleat1 = 1.35 if ((i + 1) % 2 == 0) else 0.0

        ix0, iz0 = roof_in_x * math.sin(t0), -roof_in_z * math.cos(t0)
        ix1, iz1 = roof_in_x * math.sin(t1), -roof_in_z * math.cos(t1)
        ox0, oz0 = roof_out_x * math.sin(t0), -roof_out_z * math.cos(t0)
        ox1, oz1 = roof_out_x * math.sin(t1), -roof_out_z * math.cos(t1)

        rv0 = bm_roof.verts.new(b_pos(ix0, roof_h + 1.8 + pleat0 * 0.6, iz0))
        rv1 = bm_roof.verts.new(b_pos(ix1, roof_h + 1.8 + pleat1 * 0.6, iz1))
        rv2 = bm_roof.verts.new(b_pos(ox1, roof_h - 1.5 + pleat1, oz1))
        rv3 = bm_roof.verts.new(b_pos(ox0, roof_h - 1.5 + pleat0, oz0))
        bm_roof.faces.new((rv0, rv1, rv2, rv3))

        if i % 2 == 0:
            dx, dz = math.cos(t0) * 0.55, math.sin(t0) * 0.55
            tv0 = bm_truss.verts.new(b_pos(ix0 - dx, roof_h + 1.1, iz0 - dz))
            tv1 = bm_truss.verts.new(b_pos(ix0 + dx, roof_h + 1.1, iz0 + dz))
            tv2 = bm_truss.verts.new(b_pos(ox0 + dx, roof_h - 1.8, oz0 + dz))
            tv3 = bm_truss.verts.new(b_pos(ox0 - dx, roof_h - 1.8, oz0 - dz))
            bm_truss.faces.new((tv0, tv1, tv2, tv3))

            cx_bot, cz_bot = (roof_out_x + 4.0) * math.sin(t0), -(roof_out_z + 4.0) * math.cos(t0)
            cv0 = bm_truss.verts.new(b_pos(cx_bot - dx * 1.4, 0.0, cz_bot - dz * 1.4))
            cv1 = bm_truss.verts.new(b_pos(cx_bot + dx * 1.4, 0.0, cz_bot + dz * 1.4))
            cv2 = bm_truss.verts.new(b_pos(ox0 + dx, roof_h - 1.5, oz0 + dz))
            cv3 = bm_truss.verts.new(b_pos(ox0 - dx, roof_h - 1.5, oz0 - dz))
            bm_truss.faces.new((cv0, cv1, cv2, cv3))

    finalize_mesh(bm_roof, "Cantilevered_PTFE_Roof_Canopy", mat_roof_ptfe, col, smooth=False, solidify_thickness=0.26)
    finalize_mesh(bm_truss, "Roof_Steel_SpaceFrame_Trusses", mat_steel, col, smooth=False, solidify_thickness=0.45)

    # -----------------------------------------------------------------------
    # G. Sight-Screens (12m x 4.2m) & South Broadcast Media Pod
    # -----------------------------------------------------------------------
    bm_pavilion = bmesh.new()
    for sz_sign in (-1.0, 1.0):
        ret_ss = bmesh.ops.create_cube(bm_pavilion, size=1.0)
        for v in ret_ss["verts"]:
            v.co.x *= 11.0
            v.co.y = v.co.y * 0.55 - sz_sign * (rz_base + 1.2)
            v.co.z = v.co.z * 2.76 + 1.38

    ret_pod = bmesh.ops.create_cube(bm_pavilion, size=1.0)
    for v in ret_pod["verts"]:
        v.co.x *= 22.0
        v.co.y = v.co.y * 4.8 - (rz_base + 32.5)
        v.co.z = v.co.z * 4.2 + 22.0
    finalize_mesh(bm_pavilion, "SightScreens_And_South_Media_Pod", mat_sightscreen, col, smooth=False)

    # -----------------------------------------------------------------------
    # H. Twin Giant 8K LED Scoreboards (NE 45° and SW 225°)
    # -----------------------------------------------------------------------
    bm_screens = bmesh.new()
    uv_scr = bm_screens.loops.layers.uv.verify()
    bm_screen_frames = bmesh.new()

    for sb_deg in (45.0, 225.0):
        rad = math.radians(sb_deg)
        dist_rx, dist_rz = rx_base + 29.0, rz_base + 29.0
        cx, cz = dist_rx * math.sin(rad), -dist_rz * math.cos(rad)
        cy = 27.5
        yaw = math.atan2(-cx, -cz)
        ux, uz = math.cos(yaw), -math.sin(yaw)
        fx, fz = math.sin(yaw), math.cos(yaw)
        hw, hh = 15.0, 6.8

        sv0 = bm_screens.verts.new(b_pos(cx - ux * hw + fx * 0.4, cy - hh, cz - uz * hw + fz * 0.4))
        sv1 = bm_screens.verts.new(b_pos(cx + ux * hw + fx * 0.4, cy - hh, cz + uz * hw + fz * 0.4))
        sv2 = bm_screens.verts.new(b_pos(cx + ux * hw + fx * 0.4, cy + hh, cz + uz * hw + fz * 0.4))
        sv3 = bm_screens.verts.new(b_pos(cx - ux * hw + fx * 0.4, cy + hh, cz - uz * hw + fz * 0.4))
        sf = bm_screens.faces.new((sv0, sv1, sv2, sv3))
        sf.loops[0][uv_scr].uv = (0.0, 0.0)
        sf.loops[1][uv_scr].uv = (1.0, 0.0)
        sf.loops[2][uv_scr].uv = (1.0, 1.0)
        sf.loops[3][uv_scr].uv = (0.0, 1.0)

        fw, fh = hw + 1.1, hh + 0.9
        fv0 = bm_screen_frames.verts.new(b_pos(cx - ux * fw, cy - fh, cz - uz * fw))
        fv1 = bm_screen_frames.verts.new(b_pos(cx + ux * fw, cy - fh, cz + uz * fw))
        fv2 = bm_screen_frames.verts.new(b_pos(cx + ux * fw, cy + fh, cz + uz * fw))
        fv3 = bm_screen_frames.verts.new(b_pos(cx - ux * fw, cy + fh, cz - uz * fw))
        bm_screen_frames.faces.new((fv0, fv1, fv2, fv3))

    finalize_mesh(bm_screens, "Giant_8K_LED_Scoreboard_Screens", mat_scoreboard, col, smooth=False)
    finalize_mesh(bm_screen_frames, "Giant_Scoreboard_Steel_Frames", mat_steel, col, smooth=False, solidify_thickness=1.1)

    # -----------------------------------------------------------------------
    # I. 6 Monumental 62m Steel Floodlight Towers & Emissive LED Luminaire Banks
    # -----------------------------------------------------------------------
    bm_towers = bmesh.new()
    bm_lights = bmesh.new()

    for tower_deg in (25.0, 85.0, 145.0, 205.0, 265.0, 325.0):
        rad = math.radians(tower_deg)
        tx = (roof_out_x + 7.5) * math.sin(rad)
        tz = -(roof_out_z + 7.5) * math.cos(rad)
        yaw = math.atan2(-tx, -tz)
        ux, uz = math.cos(yaw), -math.sin(yaw)
        fx, fz = math.sin(yaw), math.cos(yaw)

        bmesh.ops.create_cone(
            bm_towers,
            cap_ends=True,
            cap_tris=False,
            segments=12,
            radius1=2.2,
            radius2=1.05,
            depth=56.0,
            matrix=Matrix.Translation(b_pos(tx, 28.0, tz)),
        )

        hw, hh = 7.5, 4.2
        hy = 58.0
        lv0 = bm_lights.verts.new(b_pos(tx - ux * hw + fx * 0.9, hy - hh, tz - uz * hw + fz * 0.9))
        lv1 = bm_lights.verts.new(b_pos(tx + ux * hw + fx * 0.9, hy - hh, tz + uz * hw + fz * 0.9))
        lv2 = bm_lights.verts.new(b_pos(tx + ux * hw + fx * 0.2, hy + hh, tz + uz * hw + fz * 0.2))
        lv3 = bm_lights.verts.new(b_pos(tx - ux * hw + fx * 0.2, hy + hh, tz - uz * hw + fz * 0.2))
        bm_lights.faces.new((lv0, lv1, lv2, lv3))

        bv0 = bm_towers.verts.new(b_pos(tx - ux * (hw + 0.6), hy - (hh + 0.5), tz - uz * (hw + 0.6)))
        bv1 = bm_towers.verts.new(b_pos(tx + ux * (hw + 0.6), hy - (hh + 0.5), tz + uz * (hw + 0.6)))
        bv2 = bm_towers.verts.new(b_pos(tx + ux * (hw + 0.6), hy + (hh + 0.5), tz + uz * (hw + 0.6)))
        bv3 = bm_towers.verts.new(b_pos(tx - ux * (hw + 0.6), hy + (hh + 0.5), tz - uz * (hw + 0.6)))
        bm_towers.faces.new((bv0, bv1, bv2, bv3))

    finalize_mesh(bm_towers, "Floodlight_Steel_Towers", mat_steel, col, smooth=True, solidify_thickness=0.8)
    finalize_mesh(bm_lights, "Floodlight_LED_Luminaire_Arrays", mat_floodlight_led, col, smooth=False)

    # -----------------------------------------------------------------------
    # J. Landscaped Perimeter Plaza Trees
    # -----------------------------------------------------------------------
    bm_trees = bmesh.new()
    for i in range(40):
        t = (i / 40.0) * 2.0 * math.pi
        if abs(math.sin(t * 2.0)) < 0.14:
            continue
        tx = (roof_out_x + 25.0 + (i % 3) * 5.5) * math.sin(t)
        tz = -(roof_out_z + 25.0 + (i % 3) * 5.5) * math.cos(t)
        bmesh.ops.create_icosphere(
            bm_trees,
            subdivisions=2,
            radius=3.6 + (i % 3) * 0.8,
            matrix=Matrix.Translation(b_pos(tx, 6.2, tz)),
        )
    finalize_mesh(bm_trees, "Perimeter_Plaza_Trees", mat_foliage, col, smooth=True)

    # Export Complete Stadium GLB
    stadium_glb_path = os.path.join(OUTPUT_DIR, "stadium_venue.glb")
    bpy.ops.export_scene.gltf(
        filepath=stadium_glb_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )

    mesh_summary = []
    total_verts = 0
    total_faces = 0
    for obj in col.objects:
        if obj.type == "MESH":
            depsgraph = bpy.context.evaluated_depsgraph_get()
            eval_obj = obj.evaluated_get(depsgraph)
            eval_mesh = eval_obj.to_mesh()
            v_cnt = len(eval_mesh.vertices)
            f_cnt = len(eval_mesh.polygons)
            total_verts += v_cnt
            total_faces += f_cnt
            mesh_summary.append({
                "name": obj.name,
                "vertices": v_cnt,
                "faces": f_cnt,
                "material": obj.data.materials[0].name if obj.data.materials else "NONE",
            })
            eval_obj.to_mesh_clear()

    return stadium_glb_path, mesh_summary, total_verts, total_faces


def main():
    print("=== STADIUMX BLENDER 3.4 PHOTOREALISTIC ASSET PIPELINE STARTING ===")
    textures = resolve_pbr_textures()
    seat_glb = build_and_export_high_detail_seat(textures)
    crowd_glb = build_and_export_spectator_crowd()
    stadium_glb, meshes, total_verts, total_faces = build_and_export_complete_stadium(textures)

    manifest = {
        "generator": f"Blender {bpy.app.version_string} Python (bpy + bmesh + io_scene_gltf2)",
        "coordinateSystem": "glTF 2.0 Y-Up (1 unit = 1 metre, exact 1:1 parity with DEFAULT_STADIUM_SPEC)",
        "assets": {
            "stadiumVenueGlb": "/models/stadium_venue.glb",
            "stadiumVenueSizeBytes": os.path.getsize(stadium_glb),
            "seatHighDetailGlb": "/models/seat_high_detail.glb",
            "seatHighDetailSizeBytes": os.path.getsize(seat_glb),
            "stadiumxSeatLodsGlb": "/models/stadiumx_seat_lods.glb",
            "spectatorCrowdGlb": "/models/spectator_crowd.glb",
            "spectatorCrowdSizeBytes": os.path.getsize(crowd_glb),
        },
        "geometryStats": {
            "stadiumMeshObjects": len(meshes),
            "stadiumVertices": total_verts,
            "stadiumFaces": total_faces,
            "instancedSeatsCount": 4800,
            "meshes": meshes,
        },
    }

    manifest_path = os.path.join(OUTPUT_DIR, "blender_manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print("=== STADIUMX BLENDER EXPORT COMPLETE ===")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
