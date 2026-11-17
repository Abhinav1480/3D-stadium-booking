#!/usr/bin/env python3
"""
================================================================================
STADIUMX — PARAMETRIC CRICKET STADIUM GENERATOR FOR BLENDER (bpy 3.x / 4.x)
================================================================================
File: generate_stadium.py
Current Stage: STEP B1 (Config, Collections, Ground, Pitch, 30-Yard Circle,
                        Boundary Rope, Stumps, and Elliptical Bowl Footprint)

COORDINATE & AXIS CONVENTIONS:
- Units: Metric (1.0 Blender unit = 1.0 metre).
- Origin (0, 0, 0): Exact centre of the 22-yard cricket pitch strip.
- Pitch Axis: Aligned along the +X / -X axis (Bowler runs along X; North/South
  ends or East/West ends can be mapped cleanly; in this generator, +Y is North
  and -Y is South, while the pitch strip runs along the X-axis as requested in
  Section 1: "Pitch centre at the origin. Pitch axis along the X axis").
- Up Axis in Blender: +Z. When exported to glTF 2.0 (.glb) in Step B8, the
  exporter converts +Z up to glTF's +Y up automatically (`export_yup=True`).

HOW TO RUN:
1. Headless CLI:
   blender -b -P generate_stadium.py
2. Blender GUI (Scripting Tab):
   Open Blender -> Scripting workspace -> Open `generate_stadium.py` -> Click
   "Run Script" (or press Alt + P).
================================================================================
"""

import bpy
import bmesh
import math
import random
from mathutils import Vector, Matrix


# ==============================================================================
# 1. MASTER CONFIGURATION DICTIONARY (ALL PARAMETERS IN ONE PLACE)
# ==============================================================================
CONFIG = {
    # --- Determinism & Metadata ---
    "random_seed": 42,                  # Fixed seed for deterministic generation
    "stadium_name": "STADIUMX_INTERNATIONAL_ARENA",
    "active_step": "B1",                # Current build step indicator

    # --- File Paths (Used in B2, B6, B7, B8) ---
    "export_dir": "./export",           # Output directory for GLBs, JSON, CSV
    "texture_dir": "./textures",        # Expected: TEXTURE_DIR/<mat>/{albedo,normal,roughness,ao}.jpg
    "hdri_path": "./textures/hdri/stadium_sky.hdr",

    # --- Ground & Pitch Parameters (Step B1) ---
    "ground": {
        "is_elliptical": True,          # True = elliptical boundary, False = circular
        "boundary_radius_x": 72.0,      # Boundary rope semi-axis along X (metres)
        "boundary_radius_y": 66.0,      # Boundary rope semi-axis along Y (metres)
        "outfield_margin": 6.5,         # Extra turf apron outside the boundary rope (m)
        "outfield_segments": 128,       # Radial smoothness of elliptical turf & rope
        "outfield_rings": 24,           # Concentric rings on outfield for clean UV/quads

        # 22-yard pitch strip (20.12 m length between bowling creases, 22.56 m total clay bed)
        "pitch_length": 22.56,          # Total clay strip length along X axis (m)
        "pitch_wicket_to_wicket": 20.12,# 22 yards = 20.1168 m between bowling creases
        "pitch_width": 3.05,            # 10 feet = 3.048 m width along Y axis
        "pitch_elevation": 0.012,       # Slight crown above outfield to prevent Z-fighting (m)

        # Crease markings (white painted decal meshes slightly above clay strip)
        "popping_crease_offset": 1.22,  # 4 ft in front of bowling crease (m)
        "return_crease_half_width": 1.32, # 4 ft 4 in from centre line (m)
        "crease_line_width": 0.05,      # 5 cm painted white line width (m)

        # Wooden stumps & bails (3 stumps + 2 bails at each end along X axis)
        "stump_height": 0.711,          # 28 inches regulation height (m)
        "stump_diameter": 0.038,        # 1.5 inches diameter (m)
        "wicket_width": 0.2286,         # 9 inches total width across 3 stumps (m)

        # 30-yard fielding restriction circle (27.432 m radius from each wicket, joined by parallel lines)
        "thirty_yard_radius": 27.432,   # 30 yards = 27.432 m
        "thirty_yard_dash_count": 72,   # Number of painted white dashes around the oval
        "thirty_yard_line_width": 0.14, # Width of painted 30-yard dash decal (m)

        # Boundary cushion rope
        "rope_tube_radius": 0.14,       # Padded cushion radius (m)
        "rope_bevel_segments": 12,      # Cross-section segments for smooth cylinder
    },

    # --- Seating Bowl Parameters (Used in B1 footprint & B2 tier generation) ---
    "bowl": {
        "num_tiers": 3,                 # 1 = Lower, 2 = Middle/Premium, 3 = Upper
        "seat_pitch": 0.48,             # Centre-to-centre seat width along row arc (m)
        "row_depth": 0.80,              # Horizontal tread depth per row (m)
        "aisle_width": 1.20,            # Clear width of radial stepped aisles (m)
        "vomitory_spacing_blocks": 2,   # Vomitory portal every N blocks on Lower/Upper tiers
        "vomitory_width": 3.60,         # Width of entry tunnel portal (m)
        "vomitory_rows_spanned": 5,     # Number of rows cut by a vomitory opening

        # Per-tier structural specs (Lower, Middle/VIP, Upper)
        "tiers": [
            {
                "tier_index": 1,
                "name": "TIER_1",
                "label": "Lower Bowl",
                "rows": 22,
                "riser_height": 0.30,   # Shallow rake near field (m)
                "setback_from_boundary": 5.5, # Distance from boundary rope to Row 1 (m)
                "base_elevation": 0.60, # Elevation of Row 1 tread above field (m)
                "aisles_per_stand": 4,
                "category": "STANDARD_LOWER",
            },
            {
                "tier_index": 2,
                "name": "TIER_2",
                "label": "Middle Club & VIP",
                "rows": 14,
                "riser_height": 0.36,   # Medium rake for club/executive level (m)
                "setback_from_prev_tier": -2.4, # Cantilever overhang over back of Tier 1 (m)
                "vertical_gap_concourse": 4.2,  # Vertical clearance above Tier 1 back row (m)
                "aisles_per_stand": 4,
                "category": "CLUB_EXECUTIVE",
            },
            {
                "tier_index": 3,
                "name": "TIER_3",
                "label": "Upper Panoramic",
                "rows": 26,
                "riser_height": 0.42,   # Steeper rake for upper deck sightlines (m)
                "setback_from_prev_tier": -1.8, # Slight overhang over VIP ring (m)
                "vertical_gap_concourse": 4.8,  # Vertical gap above Tier 2 back row (m)
                "aisles_per_stand": 6,
                "category": "UPPER_TERRACE",
            },
        ],
    },

    # --- Stands & Angular Blocks (Used in B2) ---
    "stands": {
        "definitions": [
            {"code": "N",  "name": "STAND_NORTH", "center_deg": 90.0,  "span_deg": 52.0, "blocks": 5},
            {"code": "NE", "name": "STAND_NE",    "center_deg": 45.0,  "span_deg": 34.0, "blocks": 3},
            {"code": "E",  "name": "STAND_EAST",  "center_deg": 0.0,   "span_deg": 52.0, "blocks": 5},
            {"code": "SE", "name": "STAND_SE",    "center_deg": 315.0, "span_deg": 34.0, "blocks": 3},
            {"code": "S",  "name": "STAND_SOUTH", "center_deg": 270.0, "span_deg": 52.0, "blocks": 5},
            {"code": "SW", "name": "STAND_SW",    "center_deg": 225.0, "span_deg": 34.0, "blocks": 3},
            {"code": "W",  "name": "STAND_WEST",  "center_deg": 180.0, "span_deg": 52.0, "blocks": 5},
            {"code": "NW", "name": "STAND_NW",    "center_deg": 135.0, "span_deg": 34.0, "blocks": 3},
        ],
        "angular_gap_deg": 1.0,         # Structural expansion joint gap between stands
    },

    # --- Premium Hospitality & Pavilion (Used in B4) ---
    "premium": {
        "vip_box_tier": 2,              # Placed behind/below Middle Tier
        "vip_glass_height": 2.8,        # Floor-to-ceiling curtain glass height (m)
        "vip_suite_depth": 5.5,         # Lounge room depth (m)
        "pavilion_stand": "S",          # South Stand houses main Player Pavilion & Dugouts
        "dugout_width": 8.0,            # Team dugout canopy width (m)
        "dugout_depth": 2.6,            # Team dugout depth (m)
    },

    # --- Roof & Canopy Parameters (Used in B5) ---
    "roof": {
        "inner_drip_margin": 4.0,       # How far inside Tier 2/3 front edge the roof reaches (m)
        "outer_rim_margin": 6.0,        # Overhang outside the top row of Tier 3 (m)
        "eave_height": 36.5,            # Height of outer roof ring above pitch (m)
        "inner_tip_height": 39.0,       # Upward tilt toward the pitch centre (m)
        "num_radial_ribs": 48,          # Primary steel radial boomerang trusses
        "num_support_columns": 24,      # Perimeter super-columns supporting the roof
        "fabric_sag_depth": 0.45,       # Pleated tension membrane sag between ribs (m)
    },

    # --- Structure, Facade & Safety Rails (Used in B4) ---
    "structure": {
        "handrail_height": 1.00,        # Regulation aisle handrail height (m)
        "parapet_wall_height": 1.10,    # Front-of-tier safety parapet height (m)
        "facade_height": 34.0,          # Outer stadium architectural wrap height (m)
        "num_entry_gates": 8,           # Major perimeter turnstile gates & ramps
    },

    # --- Extras: Floodlights, Scoreboards, Screens, Ad Boards (Used in B5) ---
    "extras": {
        "floodlight_count": 6,
        "floodlight_height": 64.0,      # Mast top elevation (m)
        "floodlight_angles_deg": [28.0, 90.0, 152.0, 208.0, 270.0, 332.0],
        "scoreboard_angles_deg": [45.0, 225.0],
        "led_screen_angles_deg": [135.0, 315.0],
        "screen_width": 24.0,
        "screen_height": 10.5,
        "sight_screen_angles_deg": [0.0, 180.0], # Behind the wickets along the X-axis!
        "sight_screen_width": 12.0,
        "sight_screen_height": 4.5,
        "ad_board_offset": 1.6,         # Distance outside boundary rope (m)
        "ad_board_height": 0.95,        # Perimeter LED ribbon height (m)
        "plaza_outer_margin": 38.0,     # Outer civic entry plaza width around stadium (m)
    },

    # --- Quality, LOD & Baking Options (Used in B3, B7, B8) ---
    "quality": {
        "enable_lod_generation": True,
        "seat_detail_level": "HIGH",    # HIGH = generates LOD0 (~2000 tris), LOD1 (~500), LOD2 (~100)
        "viewport_instance_limit": 60000,
        "bake_ao_uv1": False,           # Set True in B7 to run 2K Cycles AO bake
        "bake_lightmaps": False,        # Optional slow roof/concourse lightmap bake (off by default)
        "render_flyover_video": False,  # Optional 15-20s Cycles flyover animation (off by default)
        "flyover_samples": 64,
        "flyover_resolution": (1920, 1080),
        "flyover_fps": 30,
        "flyover_duration_sec": 16,
    },
}


# ==============================================================================
# 2. SCENE CLEANUP, UNIT SETUP & COLLECTION HIERARCHY (SECTION 1 & 8)
# ==============================================================================
REQUIRED_COLLECTIONS = [
    "STADIUM_SHELL",
    "SEATS_INSTANCED",
    "ROOF",
    "FLOODLIGHTS",
    "SCREENS",
    "PITCH",
    "ENVIRONMENT",
    "HELPERS",
]


def log(msg: str) -> None:
    """Prints a clearly formatted progress message to the Blender console/stdout."""
    print(f"[STADIUMX] {msg}")


def reset_and_prepare_scene(config: dict) -> dict:
    """
    Clears any previously generated objects, meshes, materials, and collections
    so the script is 100% idempotent and re-runnable without leaving orphan data.
    Configures Blender units to Metric (1 unit = 1 metre) and initializes RNG.
    """
    log("Resetting scene and clearing previous generator output...")
    random.seed(config["random_seed"])

    # Ensure we are in Object Mode if an active object exists
    if bpy.context.active_object and bpy.context.active_object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    # Remove all existing objects from the scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    # Remove all existing collections
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)

    # Purge orphan meshes, materials, curves, lights, cameras
    for block_store in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.curves,
        bpy.data.lights,
        bpy.data.cameras,
    ):
        for item in list(block_store):
            if item.users == 0:
                block_store.remove(item)

    # Configure Metric units: 1 Blender unit = 1.0 metre
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"

    # Create the exact Section 8 collection hierarchy
    collections = {}
    master_col = scene.collection
    for col_name in REQUIRED_COLLECTIONS:
        col = bpy.data.collections.new(col_name)
        master_col.children.link(col)
        collections[col_name] = col

    log(f"Created {len(collections)} standard collections: {', '.join(REQUIRED_COLLECTIONS)}")
    return collections


def link_object_exclusively(obj: bpy.types.Object, target_col: bpy.types.Collection) -> None:
    """Links `obj` only to `target_col` and unlinks it from any default scene collection."""
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    target_col.objects.link(obj)


def finalize_mesh_object(
    name: str,
    bm: bmesh.types.BMesh,
    target_col: bpy.types.Collection,
    material: bpy.types.Material = None,
    smooth_shade: bool = False,
) -> bpy.types.Object:
    """
    Validates BMesh geometry (removes doubles, recalculates outward normals,
    creates a default UV map if none exists), converts to a Blender Mesh & Object,
    applies transforms, assigns material, and links into `target_col`.
    """
    # Remove duplicate vertices within 0.1 mm tolerance
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    # Ensure UV0 exists on every mesh
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")

    if smooth_shade:
        for poly in mesh.polygons:
            poly.use_smooth = True

    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    link_object_exclusively(obj, target_col)

    if material is not None:
        if obj.data.materials:
            obj.data.materials[0] = material
        else:
            obj.data.materials.append(material)

    return obj


# ==============================================================================
# 3. STEP B1 PROCEDURAL PBR FALLBACK MATERIALS (UPGRADED IN STEP B6)
# ==============================================================================
def create_simple_pbr_material(
    name: str,
    base_color: tuple,
    roughness: float = 0.65,
    metallic: float = 0.0,
) -> bpy.types.Material:
    """
    Creates a clean node-based Principled BSDF material so Step B1 objects are
    immediately distinguishable in Blender's Material Preview / Rendered viewport.
    (Step B6 upgrades these with the full CC0 texture loader + procedural node graphs.)
    """
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = base_color
    return mat


def get_step_b1_materials() -> dict:
    """Initializes the core materials required for Step B1 ground & pitch meshes."""
    return {
        "grass_outfield": create_simple_pbr_material(
            "grass_outfield", (0.14, 0.42, 0.16, 1.0), roughness=0.78
        ),
        "grass_pitch": create_simple_pbr_material(
            "grass_pitch", (0.64, 0.54, 0.38, 1.0), roughness=0.82
        ),
        "soil": create_simple_pbr_material(
            "soil", (0.42, 0.33, 0.22, 1.0), roughness=0.90
        ),
        "white_line_decal": create_simple_pbr_material(
            "white_line_decal", (0.94, 0.95, 0.94, 1.0), roughness=0.55
        ),
        "wood_stumps": create_simple_pbr_material(
            "wood_stumps", (0.78, 0.60, 0.30, 1.0), roughness=0.35
        ),
        "rope": create_simple_pbr_material(
            "rope", (0.92, 0.93, 0.95, 1.0), roughness=0.45
        ),
        "concrete_steps": create_simple_pbr_material(
            "concrete_steps", (0.36, 0.38, 0.41, 1.0), roughness=0.80
        ),
    }


# ==============================================================================
# 4. STEP B1 BUILDERS: HELPERS, OUTFIELD, PITCH, CREASES, STUMPS, 30-YD, ROPE
# ==============================================================================
def build_camera_pitch_centre_helper(collections: dict) -> bpy.types.Object:
    """
    Creates the mandatory `CAMERA_PITCH_CENTRE` empty at the world origin (0, 0, 0)
    inside the `HELPERS` collection. Used as the target reference for web app cameras.
    """
    empty = bpy.data.objects.new("CAMERA_PITCH_CENTRE", None)
    empty.empty_display_type = "ARROWS"
    empty.empty_display_size = 3.5
    empty.location = (0.0, 0.0, 0.0)
    link_object_exclusively(empty, collections["HELPERS"])
    log("Created empty helper: CAMERA_PITCH_CENTRE at (0, 0, 0) [Pitch Axis = X]")
    return empty


def build_outfield(config: dict, collections: dict, materials: dict) -> bpy.types.Object:
    """
    Generates the elliptical (or circular) `OUTFIELD` turf mesh using concentric
    quad rings (avoiding a giant n-gon) with clean planar UV coordinates in [0, 1].
    """
    g_cfg = config["ground"]
    rx = g_cfg["boundary_radius_x"] + g_cfg["outfield_margin"]
    ry = (g_cfg["boundary_radius_y"] if g_cfg["is_elliptical"] else g_cfg["boundary_radius_x"]) + g_cfg["outfield_margin"]
    segs = g_cfg["outfield_segments"]
    rings = g_cfg["outfield_rings"]

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    # Build concentric rings of vertices from r_frac = 1/rings to 1.0, plus center vertex
    center_vert = bm.verts.new((0.0, 0.0, 0.0))
    ring_verts = []

    for r_idx in range(1, rings + 1):
        frac = r_idx / float(rings)
        # Crown the centre of the oval by 18 cm for realistic surface drainage
        z_crown = 0.18 * (1.0 - frac * frac)
        row = []
        for s_idx in range(segs):
            theta = (2.0 * math.pi * s_idx) / float(segs)
            x = rx * frac * math.cos(theta)
            y = ry * frac * math.sin(theta)
            row.append(bm.verts.new((x, y, z_crown)))
        ring_verts.append(row)

    center_vert.co.z = 0.18

    # Inner triangle fan around origin
    inner_ring = ring_verts[0]
    for s_idx in range(segs):
        v1 = inner_ring[s_idx]
        v2 = inner_ring[(s_idx + 1) % segs]
        face = bm.faces.new((center_vert, v1, v2))
        for loop in face.loops:
            co = loop.vert.co
            loop[uv_layer].uv = (0.5 + co.x / (2.0 * rx), 0.5 + co.y / (2.0 * ry))

    # Concentric quad strips for the rest of the outfield
    for r_idx in range(rings - 1):
        r_inner = ring_verts[r_idx]
        r_outer = ring_verts[r_idx + 1]
        for s_idx in range(segs):
            s_next = (s_idx + 1) % segs
            face = bm.faces.new((r_inner[s_idx], r_outer[s_idx], r_outer[s_next], r_inner[s_next]))
            for loop in face.loops:
                co = loop.vert.co
                loop[uv_layer].uv = (0.5 + co.x / (2.0 * rx), 0.5 + co.y / (2.0 * ry))

    obj = finalize_mesh_object(
        name="OUTFIELD",
        bm=bm,
        target_col=collections["PITCH"],
        material=materials["grass_outfield"],
        smooth_shade=True,
    )
    log(f"Created OUTFIELD: semi-axes=({rx:.1f}m x {ry:.1f}m), {len(obj.data.polygons)} faces")
    return obj


def add_decal_strip_quad(
    bm: bmesh.types.BMesh,
    uv_layer,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    z: float,
    mat_index: int = 1,
) -> None:
    """Helper to add a flat quad decal strip (e.g., crease line) at height `z`."""
    v0 = bm.verts.new((x0, y0, z))
    v1 = bm.verts.new((x1, y0, z))
    v2 = bm.verts.new((x1, y1, z))
    v3 = bm.verts.new((x0, y1, z))
    face = bm.faces.new((v0, v1, v2, v3))
    face.material_index = mat_index
    uvs = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    for loop, uv in zip(face.loops, uvs):
        loop[uv_layer].uv = uv


def build_pitch_strip_and_markings(
    config: dict, collections: dict, materials: dict
) -> tuple:
    """
    Builds:
    1. `PITCH_STRIP`: 22-yard (20.12 m wicket-to-wicket, 22.56 m clay bed) x 3.05 m
       pitch centered at (0,0,0) with its long axis along the X-axis, including
       painted bowling, popping, and return creases as clean quad geometry.
    2. `PITCH_STUMPS`: Regulation 3 stumps + 2 bails at both X-ends (+10.06m and -10.06m).
    3. `THIRTY_YARD_CIRCLE`: Painted white dashed fielding restriction oval decal mesh.
    """
    g_cfg = config["ground"]
    half_len = g_cfg["pitch_length"] * 0.5
    half_wid = g_cfg["pitch_width"] * 0.5
    z_clay = 0.18 + g_cfg["pitch_elevation"]
    z_line = z_clay + 0.004  # 4 mm above clay strip to avoid Z-fighting

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    # Subdivide the clay strip into a 16 x 4 quad grid for clean shading & UV mapping
    nx, ny = 16, 4
    grid_verts = []
    for ix in range(nx + 1):
        u = ix / float(nx)
        x = -half_len + u * (2.0 * half_len)
        col = []
        for iy in range(ny + 1):
            v = iy / float(ny)
            y = -half_wid + v * (2.0 * half_wid)
            col.append(bm.verts.new((x, y, z_clay)))
        grid_verts.append(col)

    for ix in range(nx):
        for iy in range(ny):
            v00 = grid_verts[ix][iy]
            v10 = grid_verts[ix + 1][iy]
            v11 = grid_verts[ix + 1][iy + 1]
            v01 = grid_verts[ix][iy + 1]
            face = bm.faces.new((v00, v10, v11, v01))
            face.material_index = 0
            for loop in face.loops:
                co = loop.vert.co
                loop[uv_layer].uv = (
                    (co.x + half_len) / (2.0 * half_len),
                    (co.y + half_wid) / (2.0 * half_wid),
                )

    # Add Bowling, Popping, and Return Creases at both ends (+X and -X)
    wicket_x = g_cfg["pitch_wicket_to_wicket"] * 0.5  # 10.06 m
    pop_offset = g_cfg["popping_crease_offset"]       # 1.22 m
    ret_half_y = g_cfg["return_crease_half_width"]    # 1.32 m
    lw = g_cfg["crease_line_width"] * 0.5             # Half line width

    for end_sign in (-1.0, 1.0):
        bx = end_sign * wicket_x
        px = end_sign * (wicket_x - pop_offset)
        back_x = end_sign * (wicket_x + 1.22)

        # Bowling crease (spans between return creases)
        add_decal_strip_quad(bm, uv_layer, bx - lw, -ret_half_y, bx + lw, ret_half_y, z_line, mat_index=1)
        # Popping crease (spans full pitch width)
        add_decal_strip_quad(bm, uv_layer, px - lw, -half_wid, px + lw, half_wid, z_line, mat_index=1)
        # Two return creases (perpendicular lines along X from popping crease to back of pitch)
        x_min, x_max = min(px, back_x), max(px, back_x)
        add_decal_strip_quad(bm, uv_layer, x_min, -ret_half_y - lw, x_max, -ret_half_y + lw, z_line, mat_index=1)
        add_decal_strip_quad(bm, uv_layer, x_min, ret_half_y - lw, x_max, ret_half_y + lw, z_line, mat_index=1)

    pitch_obj = finalize_mesh_object(
        name="PITCH_STRIP",
        bm=bm,
        target_col=collections["PITCH"],
        material=materials["grass_pitch"],
        smooth_shade=False,
    )
    pitch_obj.data.materials.append(materials["white_line_decal"])
    log("Created PITCH_STRIP: 22.56m x 3.05m along X-axis with regulation crease markings")

    # --- Build Stumps & Bails at both ends (+10.06m and -10.06m) ---
    bm_stumps = bmesh.new()
    uv_stumps = bm_stumps.loops.layers.uv.new("UVMap")
    sh = g_cfg["stump_height"]
    sr = g_cfg["stump_diameter"] * 0.5
    ww = g_cfg["wicket_width"]

    for end_sign in (-1.0, 1.0):
        wx = end_sign * wicket_x
        for s_idx in (-1, 0, 1):
            sy = s_idx * (ww * 0.5)
            bmesh.ops.create_cone(
                bm_stumps,
                cap_ends=True,
                cap_tris=False,
                segments=12,
                radius1=sr,
                radius2=sr * 0.92,
                depth=sh,
                matrix=Matrix.Translation((wx, sy, z_clay + sh * 0.5)),
            )
        # Two bails resting across the top of the 3 stumps
        for b_idx in (-0.5, 0.5):
            by = b_idx * (ww * 0.5)
            bmesh.ops.create_cube(
                bm_stumps,
                size=1.0,
                matrix=(
                    Matrix.Translation((wx, by, z_clay + sh + sr * 0.8))
                    @ Matrix.Diagonal((sr * 1.4, ww * 0.46, sr * 1.2, 1.0))
                ),
            )

    for face in bm_stumps.faces:
        for loop in face.loops:
            loop[uv_stumps].uv = (0.5, 0.5)

    stumps_obj = finalize_mesh_object(
        name="PITCH_STUMPS",
        bm=bm_stumps,
        target_col=collections["PITCH"],
        material=materials["wood_stumps"],
        smooth_shade=True,
    )

    # --- Build 30-Yard Fielding Circle Decal (`THIRTY_YARD_CIRCLE`) ---
    bm_circle = bmesh.new()
    uv_circle = bm_circle.loops.layers.uv.new("UVMap")
    r_30 = g_cfg["thirty_yard_radius"]
    n_dashes = g_cfg["thirty_yard_dash_count"]
    dw = g_cfg["thirty_yard_line_width"] * 0.5
    rx_out = g_cfg["boundary_radius_x"] + g_cfg["outfield_margin"]
    ry_out = g_cfg["boundary_radius_y"] + g_cfg["outfield_margin"]

    def sample_30_yard_point(angle_rad: float) -> tuple:
        """
        Parametric oval formed by two semicircles of radius 27.432m centered at
        the two wickets (-wicket_x, 0) and (+wicket_x, 0), connected along X.
        """
        ca = math.cos(angle_rad)
        sa = math.sin(angle_rad)
        shift_x = wicket_x if ca >= 0.0 else -wicket_x
        px = shift_x * abs(ca) + r_30 * ca
        py = r_30 * sa
        return px, py

    for i in range(n_dashes):
        t0 = (2.0 * math.pi * i) / float(n_dashes)
        t1 = (2.0 * math.pi * (i + 0.52)) / float(n_dashes)
        x0, y0 = sample_30_yard_point(t0)
        x1, y1 = sample_30_yard_point(t1)
        dx, dy = x1 - x0, y1 - y0
        seg_len = max(0.001, math.hypot(dx, dy))
        nx_perp, ny_perp = -dy / seg_len, dx / seg_len

        # Match outfield crown height + 8 mm offset
        r_frac0 = math.hypot(x0 / rx_out, y0 / ry_out)
        r_frac1 = math.hypot(x1 / rx_out, y1 / ry_out)
        z0 = 0.18 * (1.0 - r_frac0 * r_frac0) + 0.008
        z1 = 0.18 * (1.0 - r_frac1 * r_frac1) + 0.008

        v0 = bm_circle.verts.new((x0 - nx_perp * dw, y0 - ny_perp * dw, z0))
        v1 = bm_circle.verts.new((x1 - nx_perp * dw, y1 - ny_perp * dw, z1))
        v2 = bm_circle.verts.new((x1 + nx_perp * dw, y1 + ny_perp * dw, z1))
        v3 = bm_circle.verts.new((x0 + nx_perp * dw, y0 + ny_perp * dw, z0))
        face = bm_circle.faces.new((v0, v1, v2, v3))
        for loop in face.loops:
            loop[uv_circle].uv = (0.5, 0.5)

    circle_obj = finalize_mesh_object(
        name="THIRTY_YARD_CIRCLE",
        bm=bm_circle,
        target_col=collections["PITCH"],
        material=materials["white_line_decal"],
        smooth_shade=False,
    )
    log(f"Created PITCH_STUMPS and THIRTY_YARD_CIRCLE ({n_dashes} painted dashes)")
    return pitch_obj, stumps_obj, circle_obj


def build_boundary_rope(
    config: dict, collections: dict, materials: dict
) -> bpy.types.Object:
    """
    Builds the closed elliptical `ROPE` cushion torus around the boundary edge
    (`boundary_radius_x` x `boundary_radius_y`) with clean tubular quad topology.
    """
    g_cfg = config["ground"]
    rx = g_cfg["boundary_radius_x"]
    ry = g_cfg["boundary_radius_y"] if g_cfg["is_elliptical"] else rx
    segs = g_cfg["outfield_segments"]
    tube_r = g_cfg["rope_tube_radius"]
    tube_segs = g_cfg["rope_bevel_segments"]

    rx_out = rx + g_cfg["outfield_margin"]
    ry_out = ry + g_cfg["outfield_margin"]

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    ring_loops = []
    for i in range(segs):
        theta = (2.0 * math.pi * i) / float(segs)
        cx = rx * math.cos(theta)
        cy = ry * math.sin(theta)
        r_frac = math.hypot(cx / rx_out, cy / ry_out)
        cz = 0.18 * (1.0 - r_frac * r_frac) + tube_r * 0.85

        # Outward normal on ellipse
        nx = math.cos(theta)
        ny = math.sin(theta)
        cross_ring = []
        for j in range(tube_segs):
            phi = (2.0 * math.pi * j) / float(tube_segs)
            off_rad = tube_r * math.cos(phi)
            off_z = tube_r * math.sin(phi)
            vx = cx + nx * off_rad
            vy = cy + ny * off_rad
            vz = cz + off_z
            cross_ring.append(bm.verts.new((vx, vy, vz)))
        ring_loops.append(cross_ring)

    # Bridge consecutive cross-section rings into clean quads
    for i in range(segs):
        i_next = (i + 1) % segs
        u0 = i / float(segs)
        u1 = (i + 1) / float(segs)
        for j in range(tube_segs):
            j_next = (j + 1) % tube_segs
            v0 = j / float(tube_segs)
            v1 = (j + 1) / float(tube_segs)
            face = bm.faces.new(
                (
                    ring_loops[i][j],
                    ring_loops[i_next][j],
                    ring_loops[i_next][j_next],
                    ring_loops[i][j_next],
                )
            )
            for loop, uv in zip(face.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
                loop[uv_layer].uv = uv

    rope_obj = finalize_mesh_object(
        name="ROPE",
        bm=bm,
        target_col=collections["PITCH"],
        material=materials["rope"],
        smooth_shade=True,
    )
    log(f"Created ROPE: elliptical boundary ({rx:.1f}m x {ry:.1f}m), {len(rope_obj.data.polygons)} quad faces")
    return rope_obj


def compute_tier_radii(config: dict) -> list:
    """
    Computes the inner and outer elliptical semi-axes (rx, ry) and elevations
    for every tier in `config["bowl"]["tiers"]`. Used in Step B1 for the
    elliptical bowl footprint and in Step B2 for the full stepped bowl & seats.
    """
    g_cfg = config["ground"]
    b_cfg = config["bowl"]
    base_rx = g_cfg["boundary_radius_x"]
    base_ry = g_cfg["boundary_radius_y"] if g_cfg["is_elliptical"] else base_rx
    row_depth = b_cfg["row_depth"]

    computed = []
    prev_outer_rx = base_rx
    prev_outer_ry = base_ry
    prev_top_z = 0.0

    for idx, t in enumerate(b_cfg["tiers"]):
        rows = t["rows"]
        riser = t["riser_height"]
        if idx == 0:
            setback = t["setback_from_boundary"]
            inner_rx = base_rx + setback
            inner_ry = base_ry + setback
            z_start = t["base_elevation"]
        else:
            setback = t["setback_from_prev_tier"]
            inner_rx = prev_outer_rx + setback
            inner_ry = prev_outer_ry + setback
            z_start = prev_top_z + t["vertical_gap_concourse"]

        tier_run = rows * row_depth
        outer_rx = inner_rx + tier_run
        outer_ry = inner_ry + tier_run
        z_end = z_start + rows * riser

        computed.append(
            {
                "tier_index": t["tier_index"],
                "name": t["name"],
                "label": t["label"],
                "rows": rows,
                "riser_height": riser,
                "row_depth": row_depth,
                "inner_rx": inner_rx,
                "inner_ry": inner_ry,
                "outer_rx": outer_rx,
                "outer_ry": outer_ry,
                "z_start": z_start,
                "z_end": z_end,
                "aisles_per_stand": t["aisles_per_stand"],
                "category": t["category"],
            }
        )
        prev_outer_rx = outer_rx
        prev_outer_ry = outer_ry
        prev_top_z = z_end

    return computed


def build_bowl_footprint_plinth(
    config: dict, collections: dict, materials: dict
) -> bpy.types.Object:
    """
    Builds the architectural elliptical `BOWL_FOOTPRINT` concrete foundation
    annulus and inner field wall from the Tier 1 inner wall out to the outer
    perimeter of the seating bowl. This establishes the exact elliptical footprint
    in Step B1 before Step B2 builds the detailed stepped tiers, risers, and vomitories.
    """
    tier_Radii = compute_tier_radii(config)
    inner_rx = tier_Radii[0]["inner_rx"]
    inner_ry = tier_Radii[0]["inner_ry"]
    outer_rx = tier_Radii[-1]["outer_rx"] + 4.0  # Include outer concourse apron
    outer_ry = tier_Radii[-1]["outer_ry"] + 4.0
    wall_h = tier_Radii[0]["z_start"]

    segs = config["ground"]["outfield_segments"]
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    inner_bot = []
    inner_top = []
    outer_top = []
    outer_bot = []

    for i in range(segs):
        theta = (2.0 * math.pi * i) / float(segs)
        ct, st = math.cos(theta), math.sin(theta)
        inner_bot.append(bm.verts.new((inner_rx * ct, inner_ry * st, 0.0)))
        inner_top.append(bm.verts.new((inner_rx * ct, inner_ry * st, wall_h)))
        outer_top.append(bm.verts.new((outer_rx * ct, outer_ry * st, wall_h)))
        outer_bot.append(bm.verts.new((outer_rx * ct, outer_ry * st, 0.0)))

    for i in range(segs):
        i_next = (i + 1) % segs
        u0, u1 = i / float(segs), (i + 1) / float(segs)

        # Inner boundary podium wall facing the pitch
        f_inner = bm.faces.new((inner_bot[i], inner_bot[i_next], inner_top[i_next], inner_top[i]))
        # Top footprint slab of the bowl
        f_top = bm.faces.new((inner_top[i], inner_top[i_next], outer_top[i_next], outer_top[i]))
        # Outer perimeter ring wall
        f_outer = bm.faces.new((outer_top[i], outer_top[i_next], outer_bot[i_next], outer_bot[i]))

        for f in (f_inner, f_top, f_outer):
            for loop, uv in zip(f.loops, [(u0, 0.0), (u1, 0.0), (u1, 1.0), (u0, 1.0)]):
                loop[uv_layer].uv = uv

    footprint_obj = finalize_mesh_object(
        name="BOWL_FOOTPRINT",
        bm=bm,
        target_col=collections["STADIUM_SHELL"],
        material=materials["concrete_steps"],
        smooth_shade=False,
    )
    log(
        f"Created BOWL_FOOTPRINT: inner=({inner_rx:.1f}m x {inner_ry:.1f}m), "
        f"outer=({outer_rx:.1f}m x {outer_ry:.1f}m), podium_height={wall_h:.2f}m"
    )
    return footprint_obj


# ==============================================================================
# 5. MAIN ENTRY POINT (STEP B1)
# ==============================================================================
def run_step_b1(config: dict) -> dict:
    """Executes all Step B1 tasks and prints a clear summary report."""
    log("=" * 72)
    log("STARTING STEP B1: CONFIG, COLLECTIONS, GROUND, PITCH, ROPE & FOOTPRINT")
    log("=" * 72)

    collections = reset_and_prepare_scene(config)
    materials = get_step_b1_materials()

    helper_obj = build_camera_pitch_centre_helper(collections)
    outfield_obj = build_outfield(config, collections, materials)
    pitch_obj, stumps_obj, circle_obj = build_pitch_strip_and_markings(
        config, collections, materials
    )
    rope_obj = build_boundary_rope(config, collections, materials)
    footprint_obj = build_bowl_footprint_plinth(config, collections, materials)

    tier_radii = compute_tier_radii(config)
    log("-" * 72)
    log("STEP B1 COMPLETED SUCCESSFULLY — SUMMARY:")
    log(f"  - Units: Metric (1.0 unit = 1.0m), Pitch Centre = (0,0,0), Pitch Axis = X")
    log(f"  - Collections Created: {len(collections)} ({', '.join(collections.keys())})")
    log(f"  - Objects Created: CAMERA_PITCH_CENTRE, OUTFIELD, PITCH_STRIP, PITCH_STUMPS,")
    log(f"                     THIRTY_YARD_CIRCLE, ROPE, BOWL_FOOTPRINT")
    for tr in tier_radii:
        log(
            f"  - Planned {tr['name']} ({tr['label']}): {tr['rows']} rows, "
            f"inner=({tr['inner_rx']:.1f}m x {tr['inner_ry']:.1f}m), "
            f"outer=({tr['outer_rx']:.1f}m x {tr['outer_ry']:.1f}m), "
            f"z=[{tr['z_start']:.2f}m .. {tr['z_end']:.2f}m]"
        )
    log("=" * 72)

    return {
        "collections": collections,
        "materials": materials,
        "tier_radii": tier_radii,
        "objects": [
            helper_obj,
            outfield_obj,
            pitch_obj,
            stumps_obj,
            circle_obj,
            rope_obj,
            footprint_obj,
        ],
    }


if __name__ == "__main__":
    run_step_b1(CONFIG)
