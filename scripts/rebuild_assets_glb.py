#!/usr/bin/env python3
"""
Deterministic, 1:1 DEFAULT_STADIUM_SPEC GLB Asset Rebuilder for STADIUMX.
Builds photorealistic international cricket stadium geometry & textures:
  - public/models/stadium_venue.glb:
      * Seamless cosine-blended linear-mown Bermuda turf oval (zero checkerboard)
      * Rolled Bulli-clay 22-yard pitch with footmarks, practice square, creases, turned ash stumps & Zing LED bails
      * Contoured white boundary rope + alternating 3D sponsor boundary cushions + 360° glowing LED perimeter & tier fascia ribbons
      * Glazed team dugouts with steel ribs & seating benches + framed louvered cricket sight screens
      * 1:1 stepped precast concrete bowl across 8 stands × 3 tiers (33,600 seat parity), radial safety stairs + steel handrails, framed vomitory portals
      * VIP glazed hospitality suites with anodized window mullions & warm lounge soffits + multi-tier South Media & Members Pavilion
      * Two-story exterior colonnade drum with recessed atrium glazing, V-columns, fins & 8 Entry Gate canopies
      * Cantilevered scalloped translucent white PTFE roof + 3D triangular space-frame steel trusses, mast spires, tension cables & ring columns
      * 6 monumental tapered steel lattice floodlight towers with 24-pod luminaire arrays + 2 giant framed 8K LED scoreboards
      * Grounded composite 3D plaza trees (bark trunks + multi-lobe crowns), radial walkways, ring boulevard, parking bays & lit urban city skyline
  - public/models/spectator_crowd.glb: Sculpted seated spectator torso, arms, neck, head & legs
  - public/models/seat_lod2.glb: Contoured curved bucket seat shell, armrests & twin stanchions (~108 tris)
  - public/models/seat_lod3.glb: Sloped bucket silhouette + pedestal (~44 tris)
"""

import json
import math
import os
import struct
import zlib

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(ROOT_DIR, "public", "models")

# Exact 1:1 DEFAULT_STADIUM_SPEC dimensions (1 unit = 1 metre)
RX_BASE = 84.0
RZ_BASE = 72.0
ROOF_IN_X = 92.0
ROOF_IN_Z = 80.0
ROOF_OUT_X = 126.0
ROOF_OUT_Z = 114.0
ROOF_HEIGHT = 30.2

TIERS = [
    {"tier": 1, "offset": 4.0, "elev": 2.2, "riser": 0.30, "row_depth": 0.80, "rows": 10},
    {"tier": 2, "offset": 13.6, "elev": 8.2, "riser": 0.36, "row_depth": 0.80, "rows": 10},
    {"tier": 3, "offset": 23.2, "elev": 15.2, "riser": 0.42, "row_depth": 0.80, "rows": 10},
]

STAND_ANGLES = [0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0]


def encode_png_rgba(width, height, rgba_bytes):
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw_rows = bytearray()
    stride = width * 4
    for y in range(height):
        raw_rows.append(0)
        raw_rows.extend(rgba_bytes[y * stride : (y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw_rows), level=6)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def hash01(ix, iy, seed=17):
    h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def value_noise(x, y, seed=17):
    ix = math.floor(x)
    iy = math.floor(y)
    fx = x - ix
    fy = y - iy
    ux = fx * fx * (3.0 - 2.0 * fx)
    uy = fy * fy * (3.0 - 2.0 * fy)
    a = hash01(ix, iy, seed)
    b = hash01(ix + 1, iy, seed)
    c = hash01(ix, iy + 1, seed)
    d = hash01(ix + 1, iy + 1, seed)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy


def fbm2(x, y, seed=17):
    return (
        0.55 * value_noise(x, y, seed)
        + 0.30 * value_noise(x * 2.07 + 3.1, y * 2.07 - 1.7, seed + 13)
        + 0.15 * value_noise(x * 4.31 - 5.2, y * 4.31 + 2.9, seed + 29)
    )


def clamp_byte(v):
    return 0 if v < 0 else (255 if v > 255 else int(v))


def make_turf_pbr(albedo_size=1024, map_size=512):
    """
    Authentic international cricket outfield grass (albedo + tangent normal + metallicRoughnessAO):
      - Deep-to-medium natural emerald-sage grass (zero neon washout)
      - Pure longitudinal North-South mowing lanes (zero checkerboard/cross-wave)
      - World-aligned 30-yard fielding oval closer-mown contrast
      - Subtle boundary apron wear & baked blade-scale normal + matte roughness/AO
    """
    mrx, mrz = RX_BASE + 3.5, RZ_BASE + 3.5
    alb = bytearray(albedo_size * albedo_size * 4)
    inv_a = 1.0 / (albedo_size - 1)
    two_mrx, two_mrz = 2.0 * mrx, 2.0 * mrz

    for y in range(albedo_size):
        v = y * inv_a
        ny = v * 2.0 - 1.0
        wz = (v - 0.5) * two_mrz
        dz_oval = max(0.0, abs(wz) - 10.0584)
        for x in range(albedo_size):
            u = x * inv_a
            nx = u * 2.0 - 1.0
            wx = (u - 0.5) * two_mrx

            # 20 clean longitudinal North-South groundskeeping stripes (roller direction alternates lay)
            lane_wave = math.cos(nx * 10.0 * math.pi)
            stripe = 0.5 + 0.5 * max(-1.0, min(1.0, lane_wave * 4.2))

            # World-accurate 30-yard oval closer-mown sheen (radius 27.432m from +/-10.0584m stumps)
            d30 = math.hypot(wx, dz_oval)
            inner_mask = 1.0 - max(0.0, min(1.0, (d30 - 27.2) / 0.8))

            # Natural organic patches + fine blade tuft micro-variation (no periodic grid)
            macro_var = (fbm2(nx * 7.5, ny * 7.5, 19) - 0.5) * 11.0
            med_var = (value_noise(nx * 26.0, ny * 26.0, 37) - 0.5) * 6.5
            tuft = (hash01(x, y, 61) - 0.5) * 4.2 + (hash01(x >> 1, y >> 1, 73) - 0.5) * 3.0

            base_r = 25.0 + stripe * 7.5 + inner_mask * 3.0 + macro_var * 0.60 + med_var * 0.55 + tuft * 0.45
            base_g = 64.0 + stripe * 14.5 + inner_mask * 5.0 + macro_var * 0.90 + med_var * 0.80 + tuft * 0.70
            base_b = 21.0 + stripe * 4.0 + inner_mask * 1.5 + macro_var * 0.40 + med_var * 0.35 + tuft * 0.30

            # Outer perimeter boundary apron wear
            r_ell = math.hypot(nx, ny)
            if r_ell > 0.885:
                wear = min(1.0, (r_ell - 0.885) / 0.115)
                base_r = base_r * (1.0 - 0.18 * wear) + 46.0 * (0.18 * wear)
                base_g = base_g * (1.0 - 0.14 * wear) + 66.0 * (0.14 * wear)
                base_b = base_b * (1.0 - 0.10 * wear) + 30.0 * (0.10 * wear)

            idx = (y * albedo_size + x) * 4
            alb[idx] = clamp_byte(base_r)
            alb[idx + 1] = clamp_byte(base_g)
            alb[idx + 2] = clamp_byte(base_b)
            alb[idx + 3] = 255

    # Normal & MetallicRoughnessAO maps at map_size (512x512)
    hmap = [0.0] * (map_size * map_size)
    mr_ao = bytearray(map_size * map_size * 4)
    inv_m = 1.0 / (map_size - 1)
    for y in range(map_size):
        ny = (y * inv_m) * 2.0 - 1.0
        for x in range(map_size):
            nx = (x * inv_m) * 2.0 - 1.0
            stripe = 0.5 + 0.5 * max(-1.0, min(1.0, math.cos(nx * 10.0 * math.pi) * 4.2))
            blade_h = (hash01(x, y, 101) - 0.5) * 0.55 + (value_noise(nx * 44.0, ny * 44.0, 47) - 0.5) * 0.45
            hmap[y * map_size + x] = blade_h

            # Matte grass roughness: 0.85..0.96 varying gently with mowing lay & organic tuft
            rough = 0.93 - stripe * 0.055 + blade_h * 0.04
            ao = 0.86 + blade_h * 0.12
            idx = (y * map_size + x) * 4
            mr_ao[idx] = clamp_byte(ao * 255.0)       # R = AO
            mr_ao[idx + 1] = clamp_byte(rough * 255.0)  # G = Roughness
            mr_ao[idx + 2] = 0                          # B = Metallic (0)
            mr_ao[idx + 3] = 255

    norm = bytearray(map_size * map_size * 4)
    strength = 1.65
    for y in range(map_size):
        ym = max(0, y - 1)
        yp = min(map_size - 1, y + 1)
        for x in range(map_size):
            xm = max(0, x - 1)
            xp = min(map_size - 1, x + 1)
            dx = (hmap[y * map_size + xp] - hmap[y * map_size + xm]) * strength
            dy = (hmap[yp * map_size + x] - hmap[ym * map_size + x]) * strength
            inv_l = 1.0 / math.sqrt(dx * dx + dy * dy + 1.0)
            idx = (y * map_size + x) * 4
            norm[idx] = clamp_byte((-dx * inv_l * 0.5 + 0.5) * 255.0)
            norm[idx + 1] = clamp_byte((-dy * inv_l * 0.5 + 0.5) * 255.0)
            norm[idx + 2] = clamp_byte((inv_l * 0.5 + 0.5) * 255.0)
            norm[idx + 3] = 255

    return (
        encode_png_rgba(albedo_size, albedo_size, alb),
        encode_png_rgba(map_size, map_size, norm),
        encode_png_rgba(map_size, map_size, mr_ao),
    )


def make_square_pbr(size=512):
    """
    Unified feathered textured Cricket Square apron (21m x 22.8m):
      - Blends weathered practice lanes, rolled resting clay-grass strips, and close-mown grass dividers
      - Soft alpha-feathered periphery so zero flat slab edges appear against the outfield
    """
    alb = bytearray(size * size * 4)
    mr_ao = bytearray(size * size * 4)
    hmap = [0.0] * (size * size)
    inv_s = 1.0 / (size - 1)

    for y in range(size):
        v = y * inv_s
        # Soft feather along Z edges (outer ~7%)
        ez = min(v, 1.0 - v)
        feather_z = max(0.0, min(1.0, (ez - 0.01) / 0.065))
        crease_scar = max(
            math.exp(-((v - 0.11) / 0.03) ** 2),
            math.exp(-((v - 0.89) / 0.03) ** 2),
        )
        for x in range(size):
            u = x * inv_s
            ex = min(u, 1.0 - u)
            feather_x = max(0.0, min(1.0, (ex - 0.01) / 0.075))
            noise_edge = (value_noise(u * 28.0, v * 28.0, 91) - 0.5) * 0.28
            alpha_f = max(0.0, min(1.0, feather_x * feather_z + noise_edge * (1.0 - min(feather_x, feather_z))))

            # 7 parallel square lanes across u in [0..1] (21m width -> 3m per lane)
            lane_pos = u * 7.0
            lane_idx = min(6, int(lane_pos))
            lane_frac = lane_pos - lane_idx
            lane_dist = abs(lane_frac - 0.5) * 2.0  # 0 at lane center, 1 at lane edge

            # Center lane (3) holds the main pitch; lanes 2 & 4 are recently used practice strips; 1 & 5 light grassed clay; 0 & 6 tight grass apron
            mottle = (fbm2(u * 14.0, v * 16.0, 53) - 0.5) * 16.0
            grain = (hash01(x, y, 83) - 0.5) * 7.0
            roller = (value_noise(u * 48.0, v * 6.0, 79) - 0.5) * 6.0

            if lane_idx in (2, 4):
                # Used resting practice wicket: dried olive-tan rolled clay with fine grass regrowth
                clay_mix = max(0.0, min(1.0, (0.86 - lane_dist) / 0.25))
                scar = crease_scar * 14.0 * max(0.0, 1.0 - lane_dist * 1.3)
                r = (32.0 * (1.0 - clay_mix) + 104.0 * clay_mix) - scar + mottle * 0.6 + roller + grain * 0.5
                g = (72.0 * (1.0 - clay_mix) + 102.0 * clay_mix) - scar * 0.9 + mottle * 0.7 + roller + grain * 0.6
                b = (25.0 * (1.0 - clay_mix) + 64.0 * clay_mix) - scar * 0.7 + mottle * 0.4 + roller * 0.7 + grain * 0.4
                rough = 0.80 + (1.0 - clay_mix) * 0.12 + grain * 0.008
                h_val = (grain * 0.04 + roller * 0.03)
            elif lane_idx in (1, 5):
                # Older grassed-over practice strips
                clay_mix = max(0.0, min(1.0, (0.80 - lane_dist) / 0.28)) * 0.55
                r = 30.0 * (1.0 - clay_mix) + 74.0 * clay_mix + mottle * 0.55 + grain * 0.5
                g = 71.0 * (1.0 - clay_mix) + 88.0 * clay_mix + mottle * 0.75 + grain * 0.65
                b = 24.0 * (1.0 - clay_mix) + 46.0 * clay_mix + mottle * 0.40 + grain * 0.35
                rough = 0.87 + grain * 0.006
                h_val = grain * 0.05
            elif lane_idx == 3:
                # Directly under active pitch
                r = 128.0 + mottle * 0.5 + roller
                g = 114.0 + mottle * 0.5 + roller
                b = 76.0 + mottle * 0.4 + roller * 0.8
                rough = 0.76
                h_val = roller * 0.02
            else:
                # Outer tight-mown square apron
                r = 28.0 + mottle * 0.5 + grain * 0.45
                g = 69.0 + mottle * 0.7 + grain * 0.65
                b = 22.0 + mottle * 0.35 + grain * 0.30
                rough = 0.90 + grain * 0.005
                h_val = grain * 0.055

            hmap[y * size + x] = h_val
            idx = (y * size + x) * 4
            alb[idx] = clamp_byte(r)
            alb[idx + 1] = clamp_byte(g)
            alb[idx + 2] = clamp_byte(b)
            alb[idx + 3] = clamp_byte(alpha_f * 255.0)

            mr_ao[idx] = clamp_byte((0.88 + h_val * 0.12) * 255.0)
            mr_ao[idx + 1] = clamp_byte(max(0.65, min(0.96, rough)) * 255.0)
            mr_ao[idx + 2] = 0
            mr_ao[idx + 3] = 255

    norm = bytearray(size * size * 4)
    strength = 1.4
    for y in range(size):
        ym, yp = max(0, y - 1), min(size - 1, y + 1)
        for x in range(size):
            xm, xp = max(0, x - 1), min(size - 1, x + 1)
            dx = (hmap[y * size + xp] - hmap[y * size + xm]) * strength
            dy = (hmap[yp * size + x] - hmap[ym * size + x]) * strength
            inv_l = 1.0 / math.sqrt(dx * dx + dy * dy + 1.0)
            idx = (y * size + x) * 4
            norm[idx] = clamp_byte((-dx * inv_l * 0.5 + 0.5) * 255.0)
            norm[idx + 1] = clamp_byte((-dy * inv_l * 0.5 + 0.5) * 255.0)
            norm[idx + 2] = clamp_byte((inv_l * 0.5 + 0.5) * 255.0)
            norm[idx + 3] = 255

    return (
        encode_png_rgba(size, size, alb),
        encode_png_rgba(size, size, norm),
        encode_png_rgba(size, size, mr_ao),
    )


def make_pitch_pbr(w=256, h=512):
    """
    Rolled Bulli clay 22-yard cricket strip (albedo + tangent normal + roughness/AO):
      - Warm sun-baked tan-brown rolled soil with hairline drying cracks
      - Asymmetric bowler follow-through footmarks & popping-crease wear
      - Feathered grass border blending seamlessly into the cricket square
    """
    alb = bytearray(w * h * 4)
    mr_ao = bytearray(w * h * 4)
    hmap = [0.0] * (w * h)
    inv_w, inv_h = 1.0 / (w - 1), 1.0 / (h - 1)

    for y in range(h):
        v = y * inv_h
        foot_n = math.exp(-((v - 0.145) / 0.044) ** 2)
        foot_s = math.exp(-((v - 0.855) / 0.044) ** 2)
        crease_wear = max(
            math.exp(-((v - 0.095) / 0.024) ** 2),
            math.exp(-((v - 0.905) / 0.024) ** 2),
        )
        end_fade = max(0.0, min(1.0, min(v, 1.0 - v) / 0.025))
        for x in range(w):
            u = x * inv_w
            edge = min(u, 1.0 - u)
            side_fade = max(0.0, min(1.0, (edge - 0.015) / 0.065))

            scuff_l = math.exp(-((u - 0.25) / 0.105) ** 2) * foot_n
            scuff_r = math.exp(-((u - 0.75) / 0.105) ** 2) * foot_s
            footmark = min(1.0, scuff_l + scuff_r + 0.62 * crease_wear * math.exp(-((u - 0.5) / 0.30) ** 2))

            roller_striation = (value_noise(u * 40.0, v * 7.0, 71) - 0.5) * 8.0
            clay_mottle = (fbm2(u * 11.0, v * 22.0, 31) - 0.5) * 14.0
            fine_soil = (hash01(x, y, 131) - 0.5) * 6.5

            # Subtle dried clay hairline cracks near center length
            crack_n = abs(value_noise(u * 18.0, v * 46.0, 211) - 0.5)
            crack = max(0.0, 1.0 - crack_n / 0.032) * 0.45

            # Grass edge fringe transition before feathering out
            fringe = 1.0 - max(0.0, min(1.0, (edge - 0.03) / 0.055))
            r = 172.0 - footmark * 32.0 - crack * 24.0 + roller_striation + clay_mottle + fine_soil - fringe * 66.0
            g = 148.0 - footmark * 34.0 - crack * 22.0 + roller_striation + clay_mottle + fine_soil - fringe * 36.0
            b = 104.0 - footmark * 26.0 - crack * 18.0 + roller_striation * 0.7 + clay_mottle * 0.8 + fine_soil * 0.7 - fringe * 48.0

            h_val = -footmark * 0.45 - crack * 0.55 + fine_soil * 0.045 + roller_striation * 0.02
            hmap[y * w + x] = h_val

            alpha_f = max(0.0, min(1.0, side_fade * end_fade + (hash01(x, y, 41) - 0.5) * 0.12 * (1.0 - side_fade)))
            rough = 0.66 + footmark * 0.26 + fringe * 0.22 + abs(fine_soil) * 0.01
            ao = 0.94 - footmark * 0.16 - crack * 0.22

            idx = (y * w + x) * 4
            alb[idx] = clamp_byte(r)
            alb[idx + 1] = clamp_byte(g)
            alb[idx + 2] = clamp_byte(b)
            alb[idx + 3] = clamp_byte(alpha_f * 255.0)

            mr_ao[idx] = clamp_byte(max(0.55, min(1.0, ao)) * 255.0)
            mr_ao[idx + 1] = clamp_byte(max(0.55, min(0.96, rough)) * 255.0)
            mr_ao[idx + 2] = 0
            mr_ao[idx + 3] = 255

    norm = bytearray(w * h * 4)
    strength = 1.75
    for y in range(h):
        ym, yp = max(0, y - 1), min(h - 1, y + 1)
        for x in range(w):
            xm, xp = max(0, x - 1), min(w - 1, x + 1)
            dx = (hmap[y * w + xp] - hmap[y * w + xm]) * strength
            dy = (hmap[yp * w + x] - hmap[ym * w + x]) * strength
            inv_l = 1.0 / math.sqrt(dx * dx + dy * dy + 1.0)
            idx = (y * w + x) * 4
            norm[idx] = clamp_byte((-dx * inv_l * 0.5 + 0.5) * 255.0)
            norm[idx + 1] = clamp_byte((-dy * inv_l * 0.5 + 0.5) * 255.0)
            norm[idx + 2] = clamp_byte((inv_l * 0.5 + 0.5) * 255.0)
            norm[idx + 3] = 255

    return (
        encode_png_rgba(w, h, alb),
        encode_png_rgba(w, h, norm),
        encode_png_rgba(w, h, mr_ao),
    )


def make_concrete_png(size=256):
    """Architectural precast bush-hammered concrete with subtle expansion joint seams."""
    buf = bytearray(size * size * 4)
    for y in range(size):
        seam_y = 0.86 if (y % 64 < 2) else 1.0
        for x in range(size):
            seam_x = 0.88 if (x % 128 < 2) else 1.0
            mottle = (fbm2(x * 0.08, y * 0.08, 53) - 0.5) * 16.0
            pore = -12.0 if hash01(x // 2, y // 2, 97) > 0.965 else 0.0
            base = (214.0 + mottle + pore) * seam_x * seam_y
            idx = (y * size + x) * 4
            buf[idx] = clamp_byte(base)
            buf[idx + 1] = clamp_byte(base + 2)
            buf[idx + 2] = clamp_byte(base + 5)
            buf[idx + 3] = 255
    return encode_png_rgba(size, size, buf)


def make_led_ribbon_png(w=512, h=64):
    """Vibrant perimeter & tier-fascia broadcast LED advertising graphics."""
    buf = bytearray(w * h * 4)
    bands = [
        (6, 108, 178),
        (14, 158, 114),
        (212, 134, 16),
        (14, 72, 152),
    ]
    for y in range(h):
        for x in range(w):
            band = bands[(x // 128) % len(bands)]
            border = 1.0 if 6 <= y <= h - 7 else 0.30
            accent = 1.25 if (x % 64 < 6 or (18 <= y <= 24 and (x // 16) % 2 == 0)) else 1.0
            pixel_grid = 0.92 if (x % 2 == 0 or y % 2 == 0) else 1.04
            idx = (y * w + x) * 4
            buf[idx] = clamp_byte(band[0] * border * accent * pixel_grid)
            buf[idx + 1] = clamp_byte(band[1] * border * accent * pixel_grid)
            buf[idx + 2] = clamp_byte(band[2] * border * accent * pixel_grid)
            buf[idx + 3] = 255
    return encode_png_rgba(w, h, buf)


def make_ptfe_membrane_png(w=256, h=256):
    """Translucent architectural PTFE fiberglass canopy weave with radial tension weld seams."""
    buf = bytearray(w * h * 4)
    for y in range(h):
        seam_v = -16.0 if (y < 4 or y > h - 5 or abs(y - h // 2) < 2) else 0.0
        for x in range(w):
            seam_u = -18.0 if (x < 4 or x > w - 5) else 0.0
            weave = (value_noise(x * 0.45, y * 0.45, 88) - 0.5) * 6.0
            grad = 238.0 + (y / h) * 10.0 + seam_u + seam_v + weave
            idx = (y * w + x) * 4
            buf[idx] = clamp_byte(grad)
            buf[idx + 1] = clamp_byte(grad + 2)
            buf[idx + 2] = clamp_byte(grad + 5)
            buf[idx + 3] = 255
    return encode_png_rgba(w, h, buf)


class MeshBuilder:
    def __init__(self):
        self.positions = []
        self.normals = []
        self.uvs = []
        self.indices = []

    def add_tri(self, p0, p1, p2, uv0=(0, 0), uv1=(1, 0), uv2=(0, 1), flip=False):
        if flip:
            p1, p2 = p2, p1
            uv1, uv2 = uv2, uv1
        ax, ay, az = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        bx, by, bz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        nx = ay * bz - az * by
        ny = az * bx - ax * bz
        nz = ax * by - ay * bx
        l = math.sqrt(nx * nx + ny * ny + nz * nz)
        if l < 1e-8:
            return
        nx, ny, nz = nx / l, ny / l, nz / l
        base = len(self.positions) // 3
        for p, uv in ((p0, uv0), (p1, uv1), (p2, uv2)):
            self.positions.extend((float(p[0]), float(p[1]), float(p[2])))
            self.normals.extend((nx, ny, nz))
            self.uvs.extend((float(uv[0]), float(uv[1])))
        self.indices.extend((base, base + 1, base + 2))

    def add_quad(self, p0, p1, p2, p3, uv0=(0, 0), uv1=(1, 0), uv2=(1, 1), uv3=(0, 1)):
        self.add_tri(p0, p1, p2, uv0, uv1, uv2)
        self.add_tri(p0, p2, p3, uv0, uv2, uv3)

    def add_box(self, cx, cy, cz, sx, sy, sz, rot_y=0.0):
        hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
        c, s = math.cos(rot_y), math.sin(rot_y)

        def xf(lx, ly, lz):
            return (cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c)

        corners = [
            xf(-hx, -hy, -hz),  # 0
            xf(hx, -hy, -hz),   # 1
            xf(hx, hy, -hz),    # 2
            xf(-hx, hy, -hz),   # 3
            xf(-hx, -hy, hz),   # 4
            xf(hx, -hy, hz),    # 5
            xf(hx, hy, hz),     # 6
            xf(-hx, hy, hz),    # 7
        ]
        self.add_quad(corners[4], corners[5], corners[6], corners[7])  # +Z front
        self.add_quad(corners[1], corners[0], corners[3], corners[2])  # -Z back
        self.add_quad(corners[5], corners[1], corners[2], corners[6])  # +X right
        self.add_quad(corners[0], corners[4], corners[7], corners[3])  # -X left
        self.add_quad(corners[7], corners[6], corners[2], corners[3])  # +Y top
        self.add_quad(corners[0], corners[1], corners[5], corners[4])  # -Y bottom

    def add_strut(self, p0, p1, radius=0.18, segs=6):
        """Adds an oriented cylindrical/polygonal steel strut connecting arbitrary 3D endpoints p0 -> p1."""
        dx, dy, dz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        if length < 1e-4:
            return
        ux, uy, uz = dx / length, dy / length, dz / length
        # Pick non-collinear up reference
        ref = (1.0, 0.0, 0.0) if abs(uy) > 0.92 else (0.0, 1.0, 0.0)
        # tx = normalize(cross(ref, u))
        tx = ref[1] * uz - ref[2] * uy
        ty = ref[2] * ux - ref[0] * uz
        tz = ref[0] * uy - ref[1] * ux
        tl = math.sqrt(tx * tx + ty * ty + tz * tz)
        if tl < 1e-6:
            return
        tx, ty, tz = tx / tl, ty / tl, tz / tl
        # bx = cross(u, t)
        bx = uy * tz - uz * ty
        by = uz * tx - ux * tz
        bz = ux * ty - uy * tx

        ring0 = []
        ring1 = []
        for i in range(segs):
            a = (i / segs) * 2.0 * math.pi
            ca, sa = math.cos(a) * radius, math.sin(a) * radius
            ox = tx * ca + bx * sa
            oy = ty * ca + by * sa
            oz = tz * ca + bz * sa
            ring0.append((p0[0] + ox, p0[1] + oy, p0[2] + oz))
            ring1.append((p1[0] + ox, p1[1] + oy, p1[2] + oz))
        for i in range(segs):
            n = (i + 1) % segs
            self.add_quad(ring0[i], ring0[n], ring1[n], ring1[i])

    def add_cylinder(self, cx, y0, y1, cz, r_bot, r_top, segs=10, cap_top=True, cap_bot=True):
        ring_b = []
        ring_t = []
        for i in range(segs):
            a = (i / segs) * 2.0 * math.pi
            sa, ca = math.sin(a), math.cos(a)
            ring_b.append((cx + r_bot * sa, y0, cz + r_bot * ca))
            ring_t.append((cx + r_top * sa, y1, cz + r_top * ca))
        for i in range(segs):
            n = (i + 1) % segs
            self.add_quad(ring_b[i], ring_b[n], ring_t[n], ring_t[i])
        if cap_top and r_top > 1e-4:
            ct = (cx, y1, cz)
            for i in range(segs):
                n = (i + 1) % segs
                self.add_tri(ct, ring_t[i], ring_t[n])
        if cap_bot and r_bot > 1e-4:
            cb = (cx, y0, cz)
            for i in range(segs):
                n = (i + 1) % segs
                self.add_tri(cb, ring_b[n], ring_b[i])

    def add_sphere(self, cx, cy, cz, rx, ry, rz, rings=6, segs=10):
        grid = []
        for ir in range(rings + 1):
            phi = (ir / rings) * math.pi
            sp, cp = math.sin(phi), math.cos(phi)
            row = []
            for iseg in range(segs):
                th = (iseg / segs) * 2.0 * math.pi
                row.append((
                    cx + rx * sp * math.sin(th),
                    cy + ry * cp,
                    cz + rz * sp * math.cos(th),
                ))
            grid.append(row)
        for ir in range(rings):
            for iseg in range(segs):
                n = (iseg + 1) % segs
                p00 = grid[ir][iseg]
                p10 = grid[ir][n]
                p01 = grid[ir + 1][iseg]
                p11 = grid[ir + 1][n]
                if ir > 0:
                    self.add_tri(p00, p01, p11)
                if ir < rings - 1:
                    self.add_tri(p00, p11, p10)


class GlbWriter:
    def __init__(self):
        self.bin_parts = []
        self.byte_len = 0
        self.buffer_views = []
        self.accessors = []
        self.meshes = []
        self.nodes = []
        self.materials = []
        self.images = []
        self.textures = []
        self.samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]

    def _append_bytes(self, data, target=None):
        pad = (4 - (len(data) % 4)) % 4
        offset = self.byte_len
        self.bin_parts.append(data + (b"\x00" * pad))
        self.byte_len += len(data) + pad
        bv = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target is not None:
            bv["target"] = target
        idx = len(self.buffer_views)
        self.buffer_views.append(bv)
        return idx

    def add_png_texture(self, name, png_bytes):
        bv_idx = self._append_bytes(png_bytes)
        img_idx = len(self.images)
        self.images.append({"name": name, "mimeType": "image/png", "bufferView": bv_idx})
        tex_idx = len(self.textures)
        self.textures.append({"sampler": 0, "source": img_idx})
        return tex_idx

    def add_material(
        self,
        name,
        base_color=None,
        roughness=0.6,
        metallic=0.0,
        tex_idx=None,
        normal_tex_idx=None,
        mr_tex_idx=None,
        occ_tex_idx=None,
        normal_scale=1.0,
        occ_strength=0.65,
        double_sided=False,
        alpha_mode=None,
        emissive=None,
    ):
        pbr = {"roughnessFactor": float(roughness), "metallicFactor": float(metallic)}
        if base_color is not None:
            pbr["baseColorFactor"] = [float(c) for c in base_color]
        if tex_idx is not None:
            pbr["baseColorTexture"] = {"index": tex_idx}
        if mr_tex_idx is not None:
            pbr["metallicRoughnessTexture"] = {"index": mr_tex_idx}
        mat = {"name": name, "pbrMetallicRoughness": pbr, "doubleSided": bool(double_sided)}
        if normal_tex_idx is not None:
            mat["normalTexture"] = {"index": normal_tex_idx, "scale": float(normal_scale)}
        if occ_tex_idx is not None:
            mat["occlusionTexture"] = {"index": occ_tex_idx, "strength": float(occ_strength)}
        if alpha_mode:
            mat["alphaMode"] = alpha_mode
        if emissive is not None:
            mat["emissiveFactor"] = [float(e) for e in emissive]
        idx = len(self.materials)
        self.materials.append(mat)
        return idx

    def add_mesh_node(self, name, builder, material_idx):
        if not builder.indices:
            return
        pos_bytes = struct.pack(f"<{len(builder.positions)}f", *builder.positions)
        norm_bytes = struct.pack(f"<{len(builder.normals)}f", *builder.normals)
        uv_bytes = struct.pack(f"<{len(builder.uvs)}f", *builder.uvs)
        idx_bytes = struct.pack(f"<{len(builder.indices)}I", *builder.indices)

        pos_bv = self._append_bytes(pos_bytes, 34962)
        norm_bv = self._append_bytes(norm_bytes, 34962)
        uv_bv = self._append_bytes(uv_bytes, 34962)
        ind_bv = self._append_bytes(idx_bytes, 34963)

        xs = builder.positions[0::3]
        ys = builder.positions[1::3]
        zs = builder.positions[2::3]
        vcount = len(xs)

        pos_acc = len(self.accessors)
        self.accessors.append({
            "bufferView": pos_bv, "componentType": 5126, "count": vcount, "type": "VEC3",
            "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)],
        })
        norm_acc = len(self.accessors)
        self.accessors.append({
            "bufferView": norm_bv, "componentType": 5126, "count": vcount, "type": "VEC3",
        })
        uv_acc = len(self.accessors)
        self.accessors.append({
            "bufferView": uv_bv, "componentType": 5126, "count": vcount, "type": "VEC2",
        })
        ind_acc = len(self.accessors)
        self.accessors.append({
            "bufferView": ind_bv, "componentType": 5125, "count": len(builder.indices), "type": "SCALAR",
        })

        mesh_idx = len(self.meshes)
        self.meshes.append({
            "name": name,
            "primitives": [{
                "attributes": {"POSITION": pos_acc, "NORMAL": norm_acc, "TEXCOORD_0": uv_acc},
                "indices": ind_acc,
                "material": material_idx,
            }],
        })
        self.nodes.append({"name": name, "mesh": mesh_idx})

    def write(self, out_path):
        gltf = {
            "asset": {"version": "2.0", "generator": "STADIUMX Asset Pipeline v3"},
            "scene": 0,
            "scenes": [{"nodes": list(range(len(self.nodes)))}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "accessors": self.accessors,
            "bufferViews": self.buffer_views,
            "buffers": [{"byteLength": self.byte_len}],
        }
        if self.images:
            gltf["images"] = self.images
            gltf["textures"] = self.textures
            gltf["samplers"] = self.samplers

        json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        jpad = (4 - (len(json_bytes) % 4)) % 4
        json_bytes += b" " * jpad

        total_len = 12 + 8 + len(json_bytes) + 8 + self.byte_len
        with open(out_path, "wb") as f:
            f.write(struct.pack("<3I", 0x46546C67, 2, total_len))
            f.write(struct.pack("<2I", len(json_bytes), 0x4E4F534A))
            f.write(json_bytes)
            f.write(struct.pack("<2I", self.byte_len, 0x004E4942))
            for part in self.bin_parts:
                f.write(part)


def turf_y(x, z):
    rn = min(1.0, math.hypot(x / (RX_BASE + 3.5), z / (RZ_BASE + 3.5)))
    return 0.34 * (math.cos(rn * math.pi * 0.5) ** 1.5)


def build_stadium_venue():
    w = GlbWriter()
    turf_alb_b, turf_norm_b, turf_mr_b = make_turf_pbr(1024, 512)
    sq_alb_b, sq_norm_b, sq_mr_b = make_square_pbr(512)
    pitch_alb_b, pitch_norm_b, pitch_mr_b = make_pitch_pbr(256, 512)

    tex_turf = w.add_png_texture("turf_albedo", turf_alb_b)
    tex_turf_norm = w.add_png_texture("turf_normal", turf_norm_b)
    tex_turf_mr = w.add_png_texture("turf_mr_ao", turf_mr_b)

    tex_square = w.add_png_texture("square_albedo", sq_alb_b)
    tex_square_norm = w.add_png_texture("square_normal", sq_norm_b)
    tex_square_mr = w.add_png_texture("square_mr_ao", sq_mr_b)

    tex_pitch = w.add_png_texture("pitch_albedo", pitch_alb_b)
    tex_pitch_norm = w.add_png_texture("pitch_normal", pitch_norm_b)
    tex_pitch_mr = w.add_png_texture("pitch_mr_ao", pitch_mr_b)

    tex_concrete = w.add_png_texture("concrete_albedo", make_concrete_png(256))
    tex_led = w.add_png_texture("led_ribbon", make_led_ribbon_png(512, 64))
    tex_ptfe = w.add_png_texture("ptfe_membrane", make_ptfe_membrane_png(256, 256))

    mat_turf = w.add_material(
        "Outfield_Bermuda_Turf",
        [1, 1, 1, 1],
        roughness=1.0,
        metallic=0.0,
        tex_idx=tex_turf,
        normal_tex_idx=tex_turf_norm,
        mr_tex_idx=tex_turf_mr,
        occ_tex_idx=tex_turf_mr,
        normal_scale=0.65,
        occ_strength=0.45,
    )
    mat_square = w.add_material(
        "Cricket_Square_Apron_Mat",
        [1, 1, 1, 1],
        roughness=1.0,
        metallic=0.0,
        tex_idx=tex_square,
        normal_tex_idx=tex_square_norm,
        mr_tex_idx=tex_square_mr,
        occ_tex_idx=tex_square_mr,
        normal_scale=0.70,
        occ_strength=0.40,
        alpha_mode="BLEND",
    )
    mat_pitch = w.add_material(
        "Pitch_22Yard_Clay",
        [1, 1, 1, 1],
        roughness=1.0,
        metallic=0.0,
        tex_idx=tex_pitch,
        normal_tex_idx=tex_pitch_norm,
        mr_tex_idx=tex_pitch_mr,
        occ_tex_idx=tex_pitch_mr,
        normal_scale=0.85,
        occ_strength=0.50,
        alpha_mode="BLEND",
    )
    mat_crease = w.add_material("Crease_Line_Paint", [0.78, 0.80, 0.78, 1.0], roughness=0.84, metallic=0.0)
    mat_stump = w.add_material("Polished_Ash_Stumps", [0.92, 0.77, 0.43, 1.0], roughness=0.30, metallic=0.06)
    mat_bail = w.add_material("Zing_LED_Bail_Glow", [1.0, 0.28, 0.14, 1.0], roughness=0.22, emissive=[1.0, 0.24, 0.10])
    mat_rope = w.add_material("Boundary_Cushion_Rope", [0.89, 0.90, 0.92, 1.0], roughness=0.54, metallic=0.02)
    mat_cushion_blue = w.add_material("Boundary_Sponsor_Navy", [0.04, 0.18, 0.44, 1.0], roughness=0.42, metallic=0.06)
    mat_cushion_emerald = w.add_material("Boundary_Sponsor_Emerald", [0.03, 0.32, 0.22, 1.0], roughness=0.42, metallic=0.06)
    mat_led = w.add_material("Perimeter_Sponsor_LED", [1, 1, 1, 1], roughness=0.26, metallic=0.1, tex_idx=tex_led, emissive=[1.0, 1.0, 1.0])
    mat_glass = w.add_material("VIP_Suite_Reflective_Glass", [0.025, 0.07, 0.14, 0.78], roughness=0.07, metallic=0.38, alpha_mode="BLEND", double_sided=True)
    mat_balustrade = w.add_material("Tier_Safety_Glass", [0.16, 0.34, 0.48, 0.32], roughness=0.10, metallic=0.18, alpha_mode="BLEND", double_sided=True)
    mat_concrete = w.add_material("Stadium_Precast_Concrete", [0.38, 0.41, 0.46, 1.0], roughness=0.80, metallic=0.03, tex_idx=tex_concrete)
    mat_aisle = w.add_material("Aisle_Safety_Stair", [0.78, 0.52, 0.04, 1.0], roughness=0.48, metallic=0.06)
    mat_vip_warm = w.add_material("VIP_Interior_Warm_Soffit", [0.99, 0.80, 0.42, 1.0], roughness=0.40, emissive=[0.42, 0.26, 0.08])
    mat_vip_back = w.add_material("VIP_Interior_Dark_Wall", [0.06, 0.08, 0.11, 1.0], roughness=0.78, metallic=0.05)
    mat_dark_shell = w.add_material("Stadium_Substructure_Architect", [0.24, 0.28, 0.35, 1.0], roughness=0.72, metallic=0.12)
    mat_facade_cladding = w.add_material("Exterior_Architectural_Cladding", [0.58, 0.62, 0.69, 1.0], roughness=0.52, metallic=0.18)
    mat_vomitory = w.add_material("Vomitory_Tunnel_Portal", [0.02, 0.03, 0.05, 1.0], roughness=0.90, metallic=0.02)
    mat_roof_ptfe = w.add_material(
        "Cantilever_PTFE_Membrane",
        [0.95, 0.96, 0.99, 0.84],
        roughness=0.34,
        metallic=0.04,
        tex_idx=tex_ptfe,
        emissive=[0.06, 0.08, 0.11],
        alpha_mode="BLEND",
        double_sided=True,
    )
    mat_steel = w.add_material("Structural_Truss_Steel", [0.56, 0.62, 0.70, 1.0], roughness=0.26, metallic=0.84)
    mat_handrail = w.add_material("Aisle_Stainless_Steel", [0.46, 0.52, 0.60, 1.0], roughness=0.28, metallic=0.84)
    mat_dark_steel = w.add_material("Dark_Anodized_Steel", [0.10, 0.13, 0.18, 1.0], roughness=0.34, metallic=0.74)
    mat_sight_white = w.add_material("SightScreen_White_Louvers", [0.92, 0.94, 0.97, 1.0], roughness=0.52, metallic=0.04)
    mat_screen_face = w.add_material("Giant_8K_Scoreboard_LED", [1, 1, 1, 1], roughness=0.22, metallic=0.1)
    mat_flood_led = w.add_material("Floodlight_Luminaire_Array", [0.98, 0.99, 1.0, 1.0], roughness=0.15, emissive=[0.95, 0.97, 1.0])
    mat_trunk = w.add_material("Plaza_Tree_Bark", [0.22, 0.15, 0.10, 1.0], roughness=0.90, metallic=0.0)
    mat_foliage = w.add_material("Plaza_Canopy_Foliage", [0.06, 0.24, 0.09, 1.0], roughness=0.82, metallic=0.0)
    mat_foliage_alt = w.add_material("Plaza_Canopy_Foliage_Olive", [0.09, 0.29, 0.10, 1.0], roughness=0.82, metallic=0.0)
    mat_plaza = w.add_material("Exterior_Plaza_Granite", [0.34, 0.37, 0.42, 1.0], roughness=0.78, metallic=0.04, tex_idx=tex_concrete)
    mat_asphalt = w.add_material("Exterior_Ring_Asphalt", [0.10, 0.12, 0.15, 1.0], roughness=0.88, metallic=0.02)
    mat_park_ground = w.add_material("Exterior_Park_Lawn", [0.06, 0.16, 0.07, 1.0], roughness=0.92, metallic=0.0)
    mat_city_tower = w.add_material("City_Skyline_Buildings", [0.18, 0.22, 0.29, 1.0], roughness=0.56, metallic=0.28)
    mat_city_glass = w.add_material("City_Skyline_Windows", [0.22, 0.32, 0.46, 1.0], roughness=0.25, metallic=0.45, emissive=[0.18, 0.16, 0.12])

    # -----------------------------------------------------------------------
    # A. Outfield Turf Field (12 rings x 96 segs, normals strictly +Y)
    # -----------------------------------------------------------------------
    mb = MeshBuilder()
    segs, rings = 96, 12
    mrx, mrz = RX_BASE + 3.5, RZ_BASE + 3.5
    ring_pts = []
    for ir in range(1, rings + 1):
        f = ir / rings
        row = []
        for k in range(segs):
            th = (k / segs) * 2.0 * math.pi
            vx, vz = mrx * f * math.sin(theta := th), -mrz * f * math.cos(theta)
            row.append(((vx, turf_y(vx, vz), vz), (0.5 + vx / (2 * mrx), 0.5 + vz / (2 * mrz))))
        ring_pts.append(row)
    c0 = (0.0, turf_y(0.0, 0.0), 0.0)
    for k in range(segs):
        n = (k + 1) % segs
        p0, u0 = ring_pts[0][k]
        p1, u1 = ring_pts[0][n]
        mb.add_tri(c0, p1, p0, (0.5, 0.5), u1, u0)
    for ir in range(rings - 1):
        for k in range(segs):
            n = (k + 1) % segs
            p00, u00 = ring_pts[ir][k]
            p10, u10 = ring_pts[ir][n]
            p11, u11 = ring_pts[ir + 1][n]
            p01, u01 = ring_pts[ir + 1][k]
            mb.add_quad(p00, p10, p11, p01, u00, u10, u11, u01)
    w.add_mesh_node("Outfield_Turf_Field", mb, mat_turf)

    # -----------------------------------------------------------------------
    # B. Unified Feathered Cricket Square + Rolled 22-Yard Pitch + Creases + 30-Yard Oval + Stumps
    # -----------------------------------------------------------------------
    def build_contoured_apron(target, width, length, y_lift, nx=14, nz=24):
        grid = []
        for ix in range(nx + 1):
            u = ix / nx
            px = (u - 0.5) * width
            row = []
            for iz in range(nz + 1):
                v = iz / nz
                pz = (v - 0.5) * length
                row.append(((px, turf_y(px, pz) + y_lift, pz), (u, v)))
            grid.append(row)
        for ix in range(nx):
            for iz in range(nz):
                p00, u00 = grid[ix][iz]
                p10, u10 = grid[ix + 1][iz]
                p11, u11 = grid[ix + 1][iz + 1]
                p01, u01 = grid[ix][iz + 1]
                target.add_quad(p00, p01, p11, p10, u00, u01, u11, u10)

    mb_square = MeshBuilder()
    build_contoured_apron(mb_square, 21.0, 22.8, 0.008, nx=14, nz=24)
    w.add_mesh_node("Cricket_Square_Apron", mb_square, mat_square)

    mb_pitch = MeshBuilder()
    build_contoured_apron(mb_pitch, 3.05, 22.56, 0.014, nx=6, nz=24)
    w.add_mesh_node("Cricket_Pitch_22Yard", mb_pitch, mat_pitch)

    mb_creases = MeshBuilder()
    lw = 0.026  # 5.2 cm crisp chalk line
    for sgn in (-1.0, 1.0):
        zs, zp, zb = sgn * 10.0584, sgn * 8.8392, sgn * 11.2776
        for x0, z0, x1, z1 in (
            (-1.32, zs - lw, 1.32, zs + lw),                             # Bowling crease (2.64 m)
            (-1.83, zp - lw, 1.83, zp + lw),                             # Popping crease (3.66 m)
            (-1.32 - lw, min(zp, zb), -1.32 + lw, max(zp, zb)),          # Return crease left
            (1.32 - lw, min(zp, zb), 1.32 + lw, max(zp, zb)),            # Return crease right
            (-0.89 - lw * 0.75, min(zp, zs), -0.89 + lw * 0.75, max(zp, zs)),  # Wide guideline left
            (0.89 - lw * 0.75, min(zp, zs), 0.89 + lw * 0.75, max(zp, zs)),    # Wide guideline right
        ):
            mb_creases.add_quad(
                (x0, turf_y(x0, z0) + 0.020, z0),
                (x0, turf_y(x0, z1) + 0.020, z1),
                (x1, turf_y(x1, z1) + 0.020, z1),
                (x1, turf_y(x1, z0) + 0.020, z0),
            )

    # Authentic ICC 30-yard oval (27.432 m semicircles centered at z = +/-10.0584 m joined by parallel straight sides)
    r30_in, r30_out = 27.375, 27.489
    for cz, a_start, a_end in (
        (-10.0584, -0.5 * math.pi, 0.5 * math.pi),
        (10.0584, 0.5 * math.pi, 1.5 * math.pi),
    ):
        arc_dashes = 44
        span = a_end - a_start
        for i in range(arc_dashes):
            t0 = a_start + ((i + 0.16) / arc_dashes) * span
            t1 = a_start + ((i + 0.74) / arc_dashes) * span
            x0i, z0i = r30_in * math.sin(t0), cz - r30_in * math.cos(t0)
            x0o, z0o = r30_out * math.sin(t0), cz - r30_out * math.cos(t0)
            x1o, z1o = r30_out * math.sin(t1), cz - r30_out * math.cos(t1)
            x1i, z1i = r30_in * math.sin(t1), cz - r30_in * math.cos(t1)
            mb_creases.add_quad(
                (x0i, turf_y(x0i, z0i) + 0.018, z0i),
                (x1i, turf_y(x1i, z1i) + 0.018, z1i),
                (x1o, turf_y(x1o, z1o) + 0.018, z1o),
                (x0o, turf_y(x0o, z0o) + 0.018, z0o),
            )
    side_dashes = 11
    for sx in (-1.0, 1.0):
        xi = sx * r30_in if sx > 0 else sx * r30_out
        xo = sx * r30_out if sx > 0 else sx * r30_in
        for i in range(side_dashes):
            z0 = -10.0584 + ((i + 0.16) / side_dashes) * 20.1168
            z1 = -10.0584 + ((i + 0.74) / side_dashes) * 20.1168
            mb_creases.add_quad(
                (xi, turf_y(xi, z0) + 0.018, z0),
                (xi, turf_y(xi, z1) + 0.018, z1),
                (xo, turf_y(xo, z1) + 0.018, z1),
                (xo, turf_y(xo, z0) + 0.018, z0),
            )
    w.add_mesh_node("Cricket_Pitch_Creases_And_30Yard_Circle", mb_creases, mat_crease)

    # Turned Ash Stumps & Glowing Zing LED Bails
    mb_stumps = MeshBuilder()
    mb_bails = MeshBuilder()
    for ez in (-10.0584, 10.0584):
        by = turf_y(0.0, ez) + 0.014
        for sx in (-0.114, 0.0, 0.114):
            mb_stumps.add_cylinder(sx, by, by + 0.675, ez, 0.0195, 0.0185, segs=10)
            mb_stumps.add_cylinder(sx, by + 0.675, by + 0.711, ez, 0.0185, 0.014, segs=10)
        for bx in (-0.057, 0.057):
            mb_bails.add_box(bx, by + 0.722, ez, 0.105, 0.017, 0.017)
    w.add_mesh_node("Cricket_Stumps_And_Bails", mb_stumps, mat_stump)
    w.add_mesh_node("Cricket_Zing_LED_Bails", mb_bails, mat_bail)

    # -----------------------------------------------------------------------
    # C. Cylindrical 8-Sided Boundary Rope + Alternating Triangular Sponsor Cushions + Perimeter LED + Dugouts
    # -----------------------------------------------------------------------
    mb_rope = MeshBuilder()
    mb_cush_blue = MeshBuilder()
    mb_cush_em = MeshBuilder()
    mb_led = MeshBuilder()
    b_segs = 96
    bound_rx, bound_rz = RX_BASE * 0.90, RZ_BASE * 0.90
    led_rx, led_rz = RX_BASE + 1.4, RZ_BASE + 1.4
    rope_r = 0.105
    for i in range(b_segs):
        t0 = (i / b_segs) * 2.0 * math.pi
        t1 = ((i + 1) / b_segs) * 2.0 * math.pi
        s0, c0_ = math.sin(t0), -math.cos(t0)
        s1, c1_ = math.sin(t1), -math.cos(t1)
        x0, z0 = bound_rx * s0, bound_rz * c0_
        x1, z1 = bound_rx * s1, bound_rz * c1_
        yc0, yc1 = turf_y(x0, z0) + rope_r, turf_y(x1, z1) + rope_r
        mb_rope.add_strut((x0, yc0, z0), (x1, yc1, z1), radius=rope_r, segs=8)

        # Alternating triangular sponsor boundary cushions behind white rope
        if i % 2 == 0:
            tm = 0.5 * (t0 + t1)
            cx = (bound_rx + 0.72) * math.sin(tm)
            cz = -(bound_rz + 0.72) * math.cos(tm)
            yaw = math.atan2(-cx, -cz)
            target_cush = mb_cush_blue if ((i // 2) % 2 == 0) else mb_cush_em
            target_cush.add_box(cx, turf_y(cx, cz) + 0.20, cz, 3.2, 0.38, 0.42, rot_y=yaw)

        deg = (i / b_segs) * 360.0
        if not (deg < 5.0 or deg > 355.0):
            lx0, lz0 = led_rx * s0, led_rz * c0_
            lx1, lz1 = led_rx * s1, led_rz * c1_
            u0, u1 = (i % 12) / 12.0, ((i % 12) + 1) / 12.0
            mb_led.add_quad((lx0, 0.0, lz0), (lx1, 0.0, lz1), (lx1, 1.12, lz1), (lx0, 1.12, lz0), (u0, 0), (u1, 0), (u1, 1), (u0, 1))
    w.add_mesh_node("Boundary_Padded_Rope", mb_rope, mat_rope)
    w.add_mesh_node("Boundary_Sponsor_Cushions_Navy", mb_cush_blue, mat_cushion_blue)
    w.add_mesh_node("Boundary_Sponsor_Cushions_Emerald", mb_cush_em, mat_cushion_emerald)

    # Architectural Team Dugouts
    mb_dugouts = MeshBuilder()
    mb_dugout_benches = MeshBuilder()
    for dd in (-24.0, 24.0):
        dr = math.radians(dd)
        dx, dz = (RX_BASE - 1.35) * math.sin(dr), -(RZ_BASE - 1.35) * math.cos(dr)
        yaw = math.atan2(-dx, -dz)
        mb_dugouts.add_box(dx, 2.08, dz, 8.6, 0.09, 2.2, rot_y=yaw)
        mb_dugouts.add_box(dx - math.sin(yaw) * 0.95, 1.05, dz - math.cos(yaw) * 0.95, 8.6, 2.02, 0.08, rot_y=yaw)
        mb_dugout_benches.add_box(dx, 0.42, dz, 7.8, 0.16, 0.56, rot_y=yaw)
        for p_off in (-4.1, -1.4, 1.4, 4.1):
            px = dx + math.cos(yaw) * p_off - math.sin(yaw) * 0.92
            pz = dz - math.sin(yaw) * p_off - math.cos(yaw) * 0.92
            mb_dugout_benches.add_box(px, 1.04, pz, 0.12, 2.08, 0.14, rot_y=yaw)
    w.add_mesh_node("Team_Boundary_Dugouts", mb_dugouts, mat_balustrade)
    w.add_mesh_node("Team_Dugout_Structures", mb_dugout_benches, mat_steel)

    # -----------------------------------------------------------------------
    # D. Full 360° Stepped Concrete Bowl, Radial Stairs, Handrails, LED Fascia Rings, Vomitories & VIP Suites
    # -----------------------------------------------------------------------
    mb_bowl = MeshBuilder()
    mb_stairs = MeshBuilder()
    mb_handrails = MeshBuilder()
    mb_rail = MeshBuilder()
    mb_vip = MeshBuilder()
    mb_vip_mullions = MeshBuilder()
    mb_vip_glow = MeshBuilder()
    mb_vip_back = MeshBuilder()

    bowl_segs = 96
    for tcfg in TIERS:
        step_h = tcfg["row_depth"]
        step_v = tcfg["riser"]
        rows = tcfg["rows"]
        for r in range(1, rows + 1):
            rad_c = tcfg["offset"] + (r - 1) * step_h
            rad_in = rad_c - 0.41
            rad_out = rad_c + 0.41
            y_top = tcfg["elev"] + (r - 1) * step_v
            y_bot = y_top - step_v - 0.03
            rxi, rzi = RX_BASE + rad_in, RZ_BASE + rad_in
            rxo, rzo = RX_BASE + rad_out, RZ_BASE + rad_out

            for i in range(bowl_segs):
                a0 = (i / bowl_segs) * 2.0 * math.pi
                a1 = ((i + 1) / bowl_segs) * 2.0 * math.pi
                x0i, z0i = rxi * math.sin(a0), -rzi * math.cos(a0)
                x1i, z1i = rxi * math.sin(a1), -rzi * math.cos(a1)
                x0o, z0o = rxo * math.sin(a0), -rzo * math.cos(a0)
                x1o, z1o = rxo * math.sin(a1), -rzo * math.cos(a1)
                mb_bowl.add_quad((x0i, y_bot, z0i), (x1i, y_bot, z1i), (x1i, y_top, z1i), (x0i, y_top, z0i), (0, 0), (1, 0), (1, 0.35), (0, 0.35))
                mb_bowl.add_quad((x0i, y_top, z0i), (x1i, y_top, z1i), (x1o, y_top, z1o), (x0o, y_top, z0o), (0, 0.35), (1, 0.35), (1, 1.0), (0, 1.0))

        # Concourse walkway deck behind row 10 of each tier
        back_rad_in = tcfg["offset"] + (rows - 1) * step_h + 0.40
        back_rad_out = back_rad_in + (2.0 if tcfg["tier"] < 3 else 1.3)
        y_back = tcfg["elev"] + (rows - 1) * step_v
        brxi, brzi = RX_BASE + back_rad_in, RZ_BASE + back_rad_in
        brxo, brzo = RX_BASE + back_rad_out, RZ_BASE + back_rad_out
        for i in range(bowl_segs):
            a0 = (i / bowl_segs) * 2.0 * math.pi
            a1 = ((i + 1) / bowl_segs) * 2.0 * math.pi
            mb_bowl.add_quad(
                (brxi * math.sin(a0), y_back, -brzi * math.cos(a0)),
                (brxi * math.sin(a1), y_back, -brzi * math.cos(a1)),
                (brxo * math.sin(a1), y_back, -brzo * math.cos(a1)),
                (brxo * math.sin(a0), y_back, -brzo * math.cos(a0)),
                (0, 0), (1, 0), (1, 1), (0, 1),
            )

        # Front Tier Parapet Wall / Fascia Beam + 360° Glowing LED Fascia Ribbon on Tier 2 & 3!
        f_rad = tcfg["offset"] - 0.50
        frx, frz = RX_BASE + f_rad, RZ_BASE + f_rad
        y_fascia_bot = 0.0 if tcfg["tier"] == 1 else (4.9 if tcfg["tier"] == 2 else 14.75)
        y_fascia_top = tcfg["elev"] - 0.14
        frx_top = RX_BASE + tcfg["offset"] - 0.40
        frz_top = RZ_BASE + tcfg["offset"] - 0.40
        for i in range(bowl_segs):
            a0 = (i / bowl_segs) * 2.0 * math.pi
            a1 = ((i + 1) / bowl_segs) * 2.0 * math.pi
            x0, z0 = frx * math.sin(a0), -frz * math.cos(a0)
            x1, z1 = frx * math.sin(a1), -frz * math.cos(a1)
            tx0, tz0 = frx_top * math.sin(a0), -frz_top * math.cos(a0)
            tx1, tz1 = frx_top * math.sin(a1), -frz_top * math.cos(a1)
            mb_bowl.add_quad((x0, y_fascia_bot, z0), (x1, y_fascia_bot, z1), (x1, y_fascia_top, z1), (x0, y_fascia_top, z0))
            mb_bowl.add_quad((x0, y_fascia_top, z0), (x1, y_fascia_top, z1), (tx1, y_fascia_top, tz1), (tx0, y_fascia_top, tz0))
            mb_rail.add_quad((x0, y_fascia_top, z0), (x1, y_fascia_top, z1), (x1, y_fascia_top + 0.68, z1), (x0, y_fascia_top + 0.68, z0))

            if tcfg["tier"] in (2, 3):
                # Glowing 360° LED Fascia Ribbon cleanly visible in front of Tier 2 parapet & Tier 3 crown above VIP boxes
                led_y0 = y_fascia_top - 1.32 if tcfg["tier"] == 2 else 13.92
                led_y1 = led_y0 + 1.12
                lx0, lz0 = (frx - 0.18) * math.sin(a0), -(frz - 0.18) * math.cos(a0)
                lx1, lz1 = (frx - 0.18) * math.sin(a1), -(frz - 0.18) * math.cos(a1)
                if tcfg["tier"] == 3:
                    # Place Tier 3 LED crown proud in front of VIP roof edge (rad ~21.50m)
                    lx0, lz0 = (RX_BASE + 21.48) * math.sin(a0), -(RZ_BASE + 21.48) * math.cos(a0)
                    lx1, lz1 = (RX_BASE + 21.48) * math.sin(a1), -(RZ_BASE + 21.48) * math.cos(a1)
                u0, u1 = (i % 12) / 12.0, ((i % 12) + 1) / 12.0
                mb_led.add_quad((lx0, led_y0, lz0), (lx1, led_y0, lz1), (lx1, led_y1, lz1), (lx0, led_y1, lz0), (u0, 0), (u1, 0), (u1, 1), (u0, 1))

    w.add_mesh_node("Perimeter_LED_Sponsor_Boards", mb_led, mat_led)

    # Radial safety aisle steps + slim dual-bar stainless steel handrails
    for c_deg in STAND_ANGLES:
        for tcfg in TIERS:
            for aisle_deg in (-7.6, 7.6):
                a_mid = math.radians(c_deg + aisle_deg)
                r0_rail = tcfg["offset"] + 0.85
                r1_rail = tcfg["offset"] + (tcfg["rows"] - 1.6) * tcfg["row_depth"]
                y0_base = tcfg["elev"] + 1.0 * tcfg["riser"]
                y1_base = tcfg["elev"] + (tcfg["rows"] - 2.6) * tcfg["riser"]
                p_start_top = ((RX_BASE + r0_rail) * math.sin(a_mid), y0_base + 0.78, -(RZ_BASE + r0_rail) * math.cos(a_mid))
                p_end_top = ((RX_BASE + r1_rail) * math.sin(a_mid), y1_base + 0.78, -(RZ_BASE + r1_rail) * math.cos(a_mid))
                p_start_mid = ((RX_BASE + r0_rail) * math.sin(a_mid), y0_base + 0.40, -(RZ_BASE + r0_rail) * math.cos(a_mid))
                p_end_mid = ((RX_BASE + r1_rail) * math.sin(a_mid), y1_base + 0.40, -(RZ_BASE + r1_rail) * math.cos(a_mid))
                mb_handrails.add_strut(p_start_top, p_end_top, radius=0.018, segs=6)
                mb_handrails.add_strut(p_start_mid, p_end_mid, radius=0.014, segs=5)
                for post_f in (0.0, 0.5, 1.0):
                    pr = r0_rail + (r1_rail - r0_rail) * post_f
                    py_b = y0_base + (y1_base - y0_base) * post_f
                    px_p = (RX_BASE + pr) * math.sin(a_mid)
                    pz_p = -(RZ_BASE + pr) * math.cos(a_mid)
                    mb_handrails.add_cylinder(px_p, py_b, py_b + 0.79, pz_p, 0.016, 0.016, segs=6)

            for r in range(1, tcfg["rows"] + 1):
                rad_c = tcfg["offset"] + (r - 1) * tcfg["row_depth"]
                rxi, rzi = RX_BASE + rad_c - 0.38, RZ_BASE + rad_c - 0.38
                rxo, rzo = RX_BASE + rad_c + 0.38, RZ_BASE + rad_c + 0.38
                yt = tcfg["elev"] + (r - 1) * tcfg["riser"] + 0.015
                yb = yt - tcfg["riser"] * 0.45
                for aisle_deg in (-7.6, 7.6):
                    a0 = math.radians(c_deg + aisle_deg - 0.48)
                    a1 = math.radians(c_deg + aisle_deg + 0.48)
                    x0i, z0i = rxi * math.sin(a0), -rzi * math.cos(a0)
                    x1i, z1i = rxi * math.sin(a1), -rzi * math.cos(a1)
                    x0o, z0o = rxo * math.sin(a0), -rzo * math.cos(a0)
                    x1o, z1o = rxo * math.sin(a1), -rzo * math.cos(a1)
                    mb_stairs.add_quad((x0i, yt, z0i), (x1i, yt, z1i), (x1o, yt, z1o), (x0o, yt, z0o))
                    mb_stairs.add_quad((x0i, yb, z0i), (x1i, yb, z1i), (x1i, yt, z1i), (x0i, yt, z0i))

    # VIP Hospitality Suites (y = 11.45..13.88m): Deep Dark Reflective Smoke Glass below Tier 3 LED Fascia Crown
    vip_rad_in = 21.65
    vip_rad_out = 23.20
    vrx_i, vrz_i = RX_BASE + vip_rad_in, RZ_BASE + vip_rad_in
    vrx_o, vrz_o = RX_BASE + vip_rad_out, RZ_BASE + vip_rad_out
    for i in range(64):
        a0 = (i / 64.0) * 2.0 * math.pi
        a1 = ((i + 1) / 64.0) * 2.0 * math.pi
        vx0, vz0 = vrx_i * math.sin(a0), -vrz_i * math.cos(a0)
        vx1, vz1 = vrx_i * math.sin(a1), -vrz_i * math.cos(a1)
        ox0, oz0 = vrx_o * math.sin(a0), -vrz_o * math.cos(a0)
        ox1, oz1 = vrx_o * math.sin(a1), -vrz_o * math.cos(a1)
        mb_vip.add_quad((vx0, 11.52, vz0), (vx1, 11.52, vz1), (vx1, 13.88, vz1), (vx0, 13.88, vz0))
        mb_vip_back.add_quad((ox0, 11.48, oz0), (ox1, 11.48, oz1), (ox1, 13.45, oz1), (ox0, 13.45, oz0))
        mb_vip_glow.add_quad((ox0, 13.45, oz0), (ox1, 13.45, oz1), (ox1, 13.86, oz1), (ox0, 13.86, oz0))
        mb_vip_glow.add_quad((vx0, 13.86, vz0), (ox0, 13.86, oz0), (ox1, 13.86, oz1), (vx1, 13.86, vz1))
        # Dark anodized structural mullions, bottom floor sill & upper lintel fascia
        mb_vip_mullions.add_cylinder(vx0, 11.44, 13.92, vz0, 0.11, 0.11, segs=6)
        mb_vip_mullions.add_strut((vx0, 11.50, vz0), (vx1, 11.50, vz1), radius=0.10, segs=4)
        mb_vip_mullions.add_strut((vx0, 12.85, vz0), (vx1, 12.85, vz1), radius=0.06, segs=4)

    w.add_mesh_node("Seating_Bowl_Stepped_Tiers", mb_bowl, mat_concrete)
    w.add_mesh_node("Radial_Aisle_Safety_Stairs", mb_stairs, mat_aisle)
    w.add_mesh_node("Aisle_Stainless_Handrails", mb_handrails, mat_handrail)
    w.add_mesh_node("Tier_Glass_Balustrades", mb_rail, mat_balustrade)
    w.add_mesh_node("VIP_Hospitality_Glass_Curtain", mb_vip, mat_glass)
    w.add_mesh_node("VIP_Hospitality_Mullions", mb_vip_mullions, mat_dark_steel)
    w.add_mesh_node("VIP_Hospitality_Dark_Lounges", mb_vip_back, mat_vip_back)
    w.add_mesh_node("VIP_Hospitality_Warm_Lounges", mb_vip_glow, mat_vip_warm)

    # Flush-Recessed U-Framed Vomitory Access Portals built tightly against Tier 2 Riser & Tier 3 Back Wall
    mb_vom = MeshBuilder()
    mb_vom_frame = MeshBuilder()
    for c_deg in STAND_ANGLES:
        rad = math.radians(c_deg)
        for vy_floor, v_rad in ((4.90, 12.75), (18.98, 30.85)):
            vx = (RX_BASE + v_rad) * math.sin(rad)
            vz = -(RZ_BASE + v_rad) * math.cos(rad)
            yaw = math.atan2(-vx, -vz)
            ux, uz = math.cos(yaw), -math.sin(yaw)
            # Deep dark tunnel throat
            mb_vom.add_box(vx, vy_floor + 1.05, vz, 2.7, 2.1, 0.9, rot_y=yaw)
            # Left & right cheek concrete walls + top lintel flush over opening (zero floating cap!)
            for s_off in (-1.52, 1.52):
                mb_vom_frame.add_box(vx + ux * s_off, vy_floor + 1.15, vz + uz * s_off, 0.36, 2.3, 1.1, rot_y=yaw)
            mb_vom_frame.add_box(vx, vy_floor + 2.22, vz, 3.4, 0.32, 1.1, rot_y=yaw)
    w.add_mesh_node("Concourse_Vomitory_Tunnels", mb_vom, mat_vomitory)
    w.add_mesh_node("Vomitory_Portal_Surrounds", mb_vom_frame, mat_concrete)

    # -----------------------------------------------------------------------
    # E. Two-Story Exterior Architectural Colonnade Drum, Glazed Atrium, V-Columns & Entry Gate Canopies
    # -----------------------------------------------------------------------
    mb_shell = MeshBuilder()
    mb_cladding = MeshBuilder()
    mb_fins = MeshBuilder()
    mb_atrium_glass = MeshBuilder()
    mb_plaza = MeshBuilder()
    mb_gates = MeshBuilder()

    for i in range(64):
        t0 = (i / 64.0) * 2.0 * math.pi
        t1 = ((i + 1) / 64.0) * 2.0 * math.pi
        bx0_b, bz0_b = (RX_BASE + 34.4) * math.sin(t0), -(RZ_BASE + 34.4) * math.cos(t0)
        bx1_b, bz1_b = (RX_BASE + 34.4) * math.sin(t1), -(RZ_BASE + 34.4) * math.cos(t1)
        bx0_m, bz0_m = (RX_BASE + 33.2) * math.sin(t0), -(RZ_BASE + 33.2) * math.cos(t0)
        bx1_m, bz1_m = (RX_BASE + 33.2) * math.sin(t1), -(RZ_BASE + 33.2) * math.cos(t1)
        bx0_t, bz0_t = (RX_BASE + 31.2) * math.sin(t0), -(RZ_BASE + 31.2) * math.cos(t0)
        bx1_t, bz1_t = (RX_BASE + 31.2) * math.sin(t1), -(RZ_BASE + 31.2) * math.cos(t1)

        # Lower concourse glazed atrium curtain wall (y = 0..10.2m) recessed slightly behind outer colonnade
        gx0, gz0 = (RX_BASE + 32.8) * math.sin(t0), -(RZ_BASE + 32.8) * math.cos(t0)
        gx1, gz1 = (RX_BASE + 32.8) * math.sin(t1), -(RZ_BASE + 32.8) * math.cos(t1)
        mb_atrium_glass.add_quad((gx1, 0.2, gz1), (gx0, 0.2, gz0), (gx0, 10.2, gz0), (gx1, 10.2, gz1))
        # Mid-height architectural cornice ring beam (y = 9.8..11.2m)
        mb_cladding.add_quad((bx1_b, 9.8, bz1_b), (bx0_b, 9.8, bz0_b), (bx0_m, 11.2, bz0_m), (bx1_m, 11.2, bz1_m))
        # Upper exterior architectural facade cladding (y = 11.2..24.2m)
        mb_shell.add_quad((bx1_m, 11.2, bz1_m), (bx0_m, 11.2, bz0_m), (bx0_t, 24.2, bz0_t), (bx1_t, 24.2, bz1_t))
        # Top cornice cap + Tier-3 upper parapet back wall facing INWARD toward pitch
        mb_cladding.add_quad((bx1_t, 23.8, bz1_t), (bx0_t, 23.8, bz0_t), (bx0_t, 24.6, bz0_t), (bx1_t, 24.6, bz1_t))
        mb_shell.add_quad((bx0_t, 18.98, bz0_t), (bx1_t, 18.98, bz1_t), (bx1_t, 24.4, bz1_t), (bx0_t, 24.4, bz0_t))

        # Exterior diagrid architectural facade fins & twin V-columns
        if i % 2 == 0:
            fx = (RX_BASE + 33.8) * math.sin(t0)
            fz = -(RZ_BASE + 33.8) * math.cos(t0)
            mb_fins.add_box(fx, 12.3, fz, 0.45, 24.6, 2.1, rot_y=t0)
            # Ground-level V-column struts supporting upper drum
            p_base = ((RX_BASE + 35.0) * math.sin(t0), 0.0, -(RZ_BASE + 35.0) * math.cos(t0))
            p_top_l = ((RX_BASE + 33.4) * math.sin(t0 - 0.045), 10.6, -(RZ_BASE + 33.4) * math.cos(t0 - 0.045))
            p_top_r = ((RX_BASE + 33.4) * math.sin(t0 + 0.045), 10.6, -(RZ_BASE + 33.4) * math.cos(t0 + 0.045))
            mb_cladding.add_strut(p_base, p_top_l, radius=0.32, segs=6)
            mb_cladding.add_strut(p_base, p_top_r, radius=0.32, segs=6)

        # Granite outer podium & entry plaza ring (y = 0.00m)
        px0, pz0 = (RX_BASE + 68.0) * math.sin(t0), -(RZ_BASE + 68.0) * math.cos(t0)
        px1, pz1 = (RX_BASE + 68.0) * math.sin(t1), -(RZ_BASE + 68.0) * math.cos(t1)
        mb_plaza.add_quad((bx0_b, 0.0, bz0_b), (bx1_b, 0.0, bz1_b), (px1, 0.0, pz1), (px0, 0.0, pz0))

    # 8 Architectural Stadium Entry Gate Turnstile Canopies around perimeter plaza
    for g_deg in STAND_ANGLES:
        grad = math.radians(g_deg)
        gx = (RX_BASE + 45.0) * math.sin(grad)
        gz = -(RZ_BASE + 45.0) * math.cos(grad)
        yaw = math.atan2(-gx, -gz)
        mb_gates.add_box(gx, 4.4, gz, 13.5, 0.48, 5.2, rot_y=yaw)
        for col_off in (-5.8, 0.0, 5.8):
            cx_g = gx + math.cos(yaw) * col_off
            cz_g = gz - math.sin(yaw) * col_off
            mb_gates.add_cylinder(cx_g, 0.0, 4.3, cz_g, 0.24, 0.20, segs=8)

    w.add_mesh_node("Stadium_Substructure_And_Concourse", mb_shell, mat_dark_shell)
    w.add_mesh_node("Stadium_Architectural_Cladding", mb_cladding, mat_facade_cladding)
    w.add_mesh_node("Stadium_Exterior_Facade_Fins", mb_fins, mat_steel)
    w.add_mesh_node("Exterior_Atrium_Glazing", mb_atrium_glass, mat_glass)
    w.add_mesh_node("Exterior_Granite_Plaza", mb_plaza, mat_plaza)
    w.add_mesh_node("Exterior_Entry_Gates", mb_gates, mat_facade_cladding)

    # -----------------------------------------------------------------------
    # F. Translucent Scalloped PTFE Canopy Roof + True 3D Steel Space-Frame Trusses, Mast Spires & Tension Cables
    # -----------------------------------------------------------------------
    mb_roof = MeshBuilder()
    mb_truss = MeshBuilder()
    r_segs = 64
    for i in range(r_segs):
        t0 = (i / r_segs) * 2.0 * math.pi
        t1 = ((i + 1) / r_segs) * 2.0 * math.pi
        pl0 = abs(math.sin(t0 * 8.0)) * 0.78
        pl1 = abs(math.sin(t1 * 8.0)) * 0.78
        ix0, iz0 = ROOF_IN_X * math.sin(t0), -ROOF_IN_Z * math.cos(t0)
        ix1, iz1 = ROOF_IN_X * math.sin(t1), -ROOF_IN_Z * math.cos(t1)
        ox0, oz0 = ROOF_OUT_X * math.sin(t0), -ROOF_OUT_Z * math.cos(t0)
        ox1, oz1 = ROOF_OUT_X * math.sin(t1), -ROOF_OUT_Z * math.cos(t1)
        iy0, iy1 = ROOF_HEIGHT + 2.2 + pl0 * 0.35, ROOF_HEIGHT + 2.2 + pl1 * 0.35
        oy0, oy1 = ROOF_HEIGHT - 1.3 + pl0 * 0.85, ROOF_HEIGHT - 1.3 + pl1 * 0.85

        u0, u1 = (i % 4) / 4.0, ((i % 4) + 1) / 4.0
        # Translucent tensioned PTFE membrane shell (DoubleSide, slight upward camber UV)
        mb_roof.add_quad((ix0, iy0, iz0), (ix1, iy1, iz1), (ox1, oy1, oz1), (ox0, oy0, oz0), (u0, 0), (u1, 0), (u1, 1), (u0, 1))

        # Inner tension ring twin chords + diagonal web lacing around the oval oculus
        mb_truss.add_strut((ix0, iy0 - 0.12, iz0), (ix1, iy1 - 0.12, iz1), radius=0.22, segs=6)
        mb_truss.add_strut((ix0, iy0 - 1.35, iz0), (ix1, iy1 - 1.35, iz1), radius=0.18, segs=6)
        mb_truss.add_strut((ix0, iy0 - 0.12, iz0), (ix1, iy1 - 1.35, iz1), radius=0.10, segs=5)
        # Outer compression ring girder
        mb_truss.add_strut((ox0, oy0 - 0.25, oz0), (ox1, oy1 - 0.25, oz1), radius=0.30, segs=6)
        mb_truss.add_strut((ox0, oy0 - 1.65, oz0), (ox1, oy1 - 1.65, oz1), radius=0.24, segs=6)
        # Mid-span secondary purlin ring connecting ribs
        mx0, mz0 = 0.5 * (ix0 + ox0), 0.5 * (iz0 + oz0)
        mx1, mz1 = 0.5 * (ix1 + ox1), 0.5 * (iz1 + oz1)
        my0, my1 = 0.5 * (iy0 + oy0) - 0.45, 0.5 * (iy1 + oy1) - 0.45
        mb_truss.add_strut((mx0, my0, mz0), (mx1, my1, mz1), radius=0.12, segs=5)

        if i % 2 == 0:
            # True 3D Triangular Space-Frame Cantilever Truss (top chord + bottom chord + 6 diagonal web members!)
            top_in = (ix0, iy0 - 0.12, iz0)
            top_out = (ox0, oy0 - 0.25, oz0)
            bot_in = (ix0 * 1.01, iy0 - 1.35, iz0 * 1.01)
            bot_out = (ox0, oy0 - 1.85, oz0)
            mb_truss.add_strut(top_in, top_out, radius=0.22, segs=6)
            mb_truss.add_strut(bot_in, bot_out, radius=0.20, segs=6)

            bays = 5
            for b in range(bays):
                f0 = b / bays
                f1 = (b + 1) / bays
                p_t0 = (top_in[0] + (top_out[0] - top_in[0]) * f0, top_in[1] + (top_out[1] - top_in[1]) * f0, top_in[2] + (top_out[2] - top_in[2]) * f0)
                p_t1 = (top_in[0] + (top_out[0] - top_in[0]) * f1, top_in[1] + (top_out[1] - top_in[1]) * f1, top_in[2] + (top_out[2] - top_in[2]) * f1)
                p_b0 = (bot_in[0] + (bot_out[0] - bot_in[0]) * f0, bot_in[1] + (bot_out[1] - bot_in[1]) * f0, bot_in[2] + (bot_out[2] - bot_in[2]) * f0)
                p_b1 = (bot_in[0] + (bot_out[0] - bot_in[0]) * f1, bot_in[1] + (bot_out[1] - bot_in[1]) * f1, bot_in[2] + (bot_out[2] - bot_in[2]) * f1)
                mb_truss.add_strut(p_t0, p_b0, radius=0.11, segs=5)
                mb_truss.add_strut(p_t0, p_b1, radius=0.11, segs=5)

            # Outrigger support column + mast spire + cantilever tension stay cables!
            col_x = (ROOF_OUT_X + 1.6) * math.sin(t0)
            col_z = -(ROOF_OUT_Z + 1.6) * math.cos(t0)
            spire_top_y = ROOF_HEIGHT + 7.2
            mb_truss.add_cylinder(col_x, 0.0, oy0 - 0.1, col_z, 0.50, 0.36, segs=8)
            mb_truss.add_cylinder(col_x, oy0 - 0.1, spire_top_y, col_z, 0.28, 0.14, segs=6)
            # Forestay tension cable from mast spire peak to cantilevered nose + mid-rib
            spire_pt = (col_x, spire_top_y - 0.3, col_z)
            mb_truss.add_strut(spire_pt, top_in, radius=0.065, segs=5)
            mb_truss.add_strut(spire_pt, (mx0, my0 + 0.45, mz0), radius=0.06, segs=5)
            # Structural node hub cylinder at outer support junction
            mb_truss.add_cylinder(ox0, oy0 - 1.9, oy0 + 0.1, oz0, 0.55, 0.55, segs=8)

    w.add_mesh_node("Cantilevered_PTFE_Roof_Canopy", mb_roof, mat_roof_ptfe)
    w.add_mesh_node("Roof_Steel_SpaceFrame_Trusses", mb_truss, mat_steel)

    # -----------------------------------------------------------------------
    # G. Framed Cricket Sight Screens (North/South) & Multi-Tier South Media & Members Pavilion
    # -----------------------------------------------------------------------
    mb_sight_white = MeshBuilder()
    mb_sight_frame = MeshBuilder()
    for sgn in (-1.0, 1.0):
        sz = sgn * (RZ_BASE + 1.35)
        # Crisp white louvered sight screen face facing inward
        mb_sight_white.add_box(0.0, 1.55, sz, 11.4, 2.75, 0.18)
        # Dark steel perimeter frame + rear bracing + wheeled bogie base
        mb_sight_frame.add_box(0.0, 2.98, sz, 11.8, 0.18, 0.42)
        mb_sight_frame.add_box(0.0, 0.16, sz, 11.8, 0.28, 0.72)
        mb_sight_frame.add_box(-5.8, 1.55, sz, 0.22, 2.95, 0.42)
        mb_sight_frame.add_box(5.8, 1.55, sz, 0.22, 2.95, 0.42)

    # Multi-Tier South Media & Broadcast Pavilion Pod (clear above Tier 3 back concourse)
    mb_pavilion_frame = MeshBuilder()
    mb_pavilion_glass = MeshBuilder()
    pz_pod = RZ_BASE + 31.8
    # Structural lower deck, cantilevered visor roof & flanking broadcast wings
    mb_pavilion_frame.add_box(0.0, 20.4, pz_pod, 24.0, 0.55, 5.4)
    mb_pavilion_frame.add_box(0.0, 24.8, pz_pod + 0.4, 25.4, 0.48, 6.4)
    mb_pavilion_frame.add_box(-11.8, 22.6, pz_pod, 0.85, 4.4, 5.2)
    mb_pavilion_frame.add_box(11.8, 22.6, pz_pod, 0.85, 4.4, 5.2)
    # Tinted observation glass + vertical mullions
    mb_pavilion_glass.add_box(0.0, 22.6, pz_pod - 2.35, 22.8, 3.85, 0.12)
    for mx in (-8.0, -4.0, 0.0, 4.0, 8.0):
        mb_pavilion_frame.add_box(mx, 22.6, pz_pod - 2.32, 0.18, 3.9, 0.22)

    w.add_mesh_node("SightScreens_Louver_Panels", mb_sight_white, mat_sight_white)
    w.add_mesh_node("SightScreens_Steel_Frames", mb_sight_frame, mat_dark_steel)
    w.add_mesh_node("South_Media_Pavilion_Complex", mb_pavilion_frame, mat_facade_cladding)
    w.add_mesh_node("South_Media_Pavilion_Glass", mb_pavilion_glass, mat_glass)

    # -----------------------------------------------------------------------
    # H. Twin Giant 8K LED Scoreboards (NE 45° & SW 225°) with Architectural Steel Crown Trusses
    # -----------------------------------------------------------------------
    mb_scr = MeshBuilder()
    mb_scr_fr = MeshBuilder()
    for sb_deg in (45.0, 225.0):
        rad = math.radians(sb_deg)
        cx, cz = (RX_BASE + 29.5) * math.sin(rad), -(RZ_BASE + 29.5) * math.cos(rad)
        cy = 23.6
        yaw = math.atan2(-cx, -cz)
        ux, uz = math.cos(yaw), -math.sin(yaw)
        fx, fz = math.sin(yaw), math.cos(yaw)
        hw, hh = 13.8, 5.2
        mb_scr.add_quad(
            (cx - ux * hw + fx * 0.48, cy - hh, cz - uz * hw + fz * 0.48),
            (cx + ux * hw + fx * 0.48, cy - hh, cz + uz * hw + fz * 0.48),
            (cx + ux * hw + fx * 0.48, cy + hh, cz + uz * hw + fz * 0.48),
            (cx - ux * hw + fx * 0.48, cy + hh, cz - uz * hw + fz * 0.48),
            (0, 0), (1, 0), (1, 1), (0, 1),
        )
        mb_scr_fr.add_box(cx, cy, cz, hw * 2 + 1.6, hh * 2 + 1.3, 0.85, rot_y=yaw)
        # Crown header truss & twin support pylons cleanly below roof inner edge
        mb_scr_fr.add_box(cx, cy + hh + 1.15, cz, hw * 2 + 2.2, 0.85, 1.0, rot_y=yaw)
        for p_off in (-9.6, 9.6):
            mb_scr_fr.add_box(cx + ux * p_off - fx * 0.6, cy - hh - 2.6, cz + uz * p_off - fz * 0.6, 1.05, 5.2, 1.05, rot_y=yaw)
    w.add_mesh_node("Giant_8K_LED_Scoreboard_Screens", mb_scr, mat_screen_face)
    w.add_mesh_node("Giant_Scoreboard_Steel_Frames", mb_scr_fr, mat_dark_steel)

    # -----------------------------------------------------------------------
    # I. 6 Monumental Lattice Floodlight Towers & 24-Pod Recessed LED Arrays
    # -----------------------------------------------------------------------
    mb_towers = MeshBuilder()
    mb_lights = MeshBuilder()
    for t_deg in (25.0, 85.0, 145.0, 205.0, 265.0, 325.0):
        rad = math.radians(t_deg)
        tx, tz = (ROOF_OUT_X + 7.5) * math.sin(rad), -(ROOF_OUT_Z + 7.5) * math.cos(rad)
        yaw = math.atan2(-tx, -tz)
        ux, uz = math.cos(yaw), -math.sin(yaw)
        fx, fz = math.sin(yaw), math.cos(yaw)
        # Tapered 4-chord structural pylon mast + horizontal ring collars + angled gantry head
        for corner_u in (-1.1, 1.1):
            for corner_f in (-1.1, 1.1):
                p_bot = (tx + ux * corner_u + fx * corner_f, 0.0, tz + uz * corner_u + fz * corner_f)
                p_top = (tx + ux * (corner_u * 0.45) + fx * (corner_f * 0.45), 55.0, tz + uz * (corner_u * 0.45) + fz * (corner_f * 0.45))
                mb_towers.add_strut(p_bot, p_top, radius=0.26, segs=6)
        for ring_y in (12.0, 24.0, 36.0, 48.0, 54.6):
            s_fac = 1.0 - 0.55 * (ring_y / 55.0)
            mb_towers.add_box(tx, ring_y, tz, 2.5 * s_fac, 0.45, 2.5 * s_fac, rot_y=yaw)

        # Cantilevered forward-tilted headframe gantry
        hx, hz = tx + fx * 1.4, tz + fz * 1.4
        mb_towers.add_box(hx, 58.6, hz, 17.6, 10.2, 0.95, rot_y=yaw)
        mb_towers.add_box(hx + fx * 0.5, 63.9, hz + fz * 0.5, 18.0, 0.55, 1.8, rot_y=yaw)
        # 6x3 individual high-output luminaire pods
        for px_step in (-6.5, -3.9, -1.3, 1.3, 3.9, 6.5):
            for py_step in (55.4, 58.6, 61.8):
                px = hx + ux * px_step + fx * 0.65
                pz = hz + uz * px_step + fz * 0.65
                pw, ph = 0.95, 1.05
                mb_lights.add_quad(
                    (px - ux * pw, py_step - ph, pz - uz * pw),
                    (px + ux * pw, py_step - ph, pz + uz * pw),
                    (px + ux * pw - fx * 0.28, py_step + ph, pz + uz * pw - fz * 0.28),
                    (px - ux * pw - fx * 0.28, py_step + ph, pz - uz * pw - fz * 0.28),
                )
    w.add_mesh_node("Floodlight_Steel_Towers", mb_towers, mat_steel)
    w.add_mesh_node("Floodlight_LED_Luminaire_Arrays", mb_lights, mat_flood_led)

    # -----------------------------------------------------------------------
    # J. Grounded Composite 3D Trees (Bark Trunks + Multi-Lobe Crowns), Ring Roads, Parking & City Skyline
    # -----------------------------------------------------------------------
    mb_trunks = MeshBuilder()
    mb_trees_a = MeshBuilder()
    mb_trees_b = MeshBuilder()
    for i in range(44):
        t = (i / 44.0) * 2.0 * math.pi
        if abs(math.sin(t * 2.0)) < 0.12:
            continue
        ring_off = 22.0 + (i % 3) * 5.2
        tx = (ROOF_OUT_X + ring_off) * math.sin(t)
        tz = -(ROOF_OUT_Z + ring_off) * math.cos(t)
        h_scale = 0.88 + (i % 4) * 0.14
        trunk_h = 3.8 * h_scale
        # Grounded tapered bark trunk (y = 0.0 -> trunk_h)
        mb_trunks.add_cylinder(tx, -0.04, trunk_h, tz, 0.34, 0.20, segs=7)
        # Multi-lobe organic canopy cluster (3 overlapping offset spheres)
        cr = 2.9 * h_scale
        target_canopy = mb_trees_a if (i % 2 == 0) else mb_trees_b
        target_canopy.add_sphere(tx, trunk_h + cr * 0.62, tz, cr, cr * 0.85, cr, rings=5, segs=8)
        target_canopy.add_sphere(tx + cr * 0.45, trunk_h + cr * 0.38, tz + cr * 0.28, cr * 0.72, cr * 0.66, cr * 0.72, rings=4, segs=7)
        target_canopy.add_sphere(tx - cr * 0.42, trunk_h + cr * 0.42, tz - cr * 0.30, cr * 0.68, cr * 0.64, cr * 0.68, rings=4, segs=7)

    w.add_mesh_node("Stadium_Tree_Trunks", mb_trunks, mat_trunk)
    w.add_mesh_node("Perimeter_Plaza_Trees", mb_trees_a, mat_foliage)
    w.add_mesh_node("Perimeter_Plaza_Trees_Olive", mb_trees_b, mat_foliage_alt)

    # Outer Ring Boulevard Asphalt, Radial Approach Roads & Parking Bays (y = -0.04m)
    mb_roads = MeshBuilder()
    road_segs = 64
    r_road_in_x, r_road_in_z = RX_BASE + 68.0, RZ_BASE + 68.0
    r_road_out_x, r_road_out_z = RX_BASE + 86.0, RZ_BASE + 86.0
    for i in range(road_segs):
        t0 = (i / road_segs) * 2.0 * math.pi
        t1 = ((i + 1) / road_segs) * 2.0 * math.pi
        mb_roads.add_quad(
            (r_road_in_x * math.sin(t0), -0.04, -r_road_in_z * math.cos(t0)),
            (r_road_in_x * math.sin(t1), -0.04, -r_road_in_z * math.cos(t1)),
            (r_road_out_x * math.sin(t1), -0.04, -r_road_out_z * math.cos(t1)),
            (r_road_out_x * math.sin(t0), -0.04, -r_road_out_z * math.cos(t0)),
        )
    # 4 Cardinal Approach Boulevards + Parking Plazas
    for a_deg in (0.0, 90.0, 180.0, 270.0):
        arad = math.radians(a_deg)
        cx_r = 250.0 * math.sin(arad)
        cz_r = -250.0 * math.cos(arad)
        mb_roads.add_box(cx_r, -0.05, cz_r, 18.0, 0.04, 195.0, rot_y=arad)
    for p_deg in (45.0, 135.0, 225.0, 315.0):
        prad = math.radians(p_deg)
        px_lot = 198.0 * math.sin(prad)
        pz_lot = -190.0 * math.cos(prad)
        mb_roads.add_box(px_lot, -0.045, pz_lot, 42.0, 0.05, 32.0, rot_y=prad)
    w.add_mesh_node("Exterior_Roads_And_Parking", mb_roads, mat_asphalt)

    # Continuous Ground Terrain extending smoothly out to r=500m (just inside 520m sky dome!)
    mb_ground = MeshBuilder()
    g_segs = 48
    gr_in = 148.0
    gr_out = 505.0
    for i in range(g_segs):
        t0 = (i / g_segs) * 2.0 * math.pi
        t1 = ((i + 1) / g_segs) * 2.0 * math.pi
        mb_ground.add_quad(
            (gr_in * math.sin(t0), -0.08, -gr_in * math.cos(t0)),
            (gr_in * math.sin(t1), -0.08, -gr_in * math.cos(t1)),
            (gr_out * math.sin(t1), -0.08, -gr_out * math.cos(t1)),
            (gr_out * math.sin(t0), -0.08, -gr_out * math.cos(t0)),
        )
    w.add_mesh_node("Exterior_Terrain_Ground", mb_ground, mat_park_ground)

    # Multi-Layered Architectural City Skyline Backdrop (r = 325..475m, slender stepped skyscrapers)
    mb_city = MeshBuilder()
    mb_city_win = MeshBuilder()
    for b_idx in range(52):
        ang = (b_idx / 52.0) * 2.0 * math.pi + hash01(b_idx, 3, 21) * 0.055
        dist = 325.0 + hash01(b_idx, 7, 31) * 145.0
        bx = dist * math.sin(ang)
        bz = -dist * math.cos(ang)
        bw = 9.0 + hash01(b_idx, 11, 41) * 9.5
        bd = 9.0 + hash01(b_idx, 13, 51) * 9.5
        bh = 24.0 + hash01(b_idx, 17, 61) * 58.0
        yaw_b = ang + hash01(b_idx, 19, 71) * 0.45
        mb_city.add_box(bx, bh * 0.5 - 0.1, bz, bw, bh, bd, rot_y=yaw_b)
        if bh > 50.0:
            mb_city.add_box(bx, bh + 6.0, bz, bw * 0.56, 12.0, bd * 0.56, rot_y=yaw_b)
            mb_city_win.add_box(bx, bh * 0.52, bz, bw + 0.28, bh * 0.84, bd + 0.28, rot_y=yaw_b)
        else:
            mb_city_win.add_box(bx, bh * 0.52, bz, bw + 0.24, bh * 0.80, bd + 0.24, rot_y=yaw_b)

    w.add_mesh_node("Exterior_City_Skyline", mb_city, mat_city_tower)
    w.add_mesh_node("City_Skyline_Windows", mb_city_win, mat_city_glass)

    out_path = os.path.join(MODELS_DIR, "stadium_venue.glb")
    w.write(out_path)
    print(f"Wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KB, {len(w.nodes)} nodes)")


def build_spectator_crowd():
    w = GlbWriter()
    mat_jersey = w.add_material("Spectator_Jersey_Mat", [1, 1, 1, 1], roughness=0.65)
    mat_body = w.add_material("Spectator_Body_Mat", [0.22, 0.27, 0.36, 1.0], roughness=0.72)

    mb_j = MeshBuilder()
    mb_j.add_box(0.0, 0.64, -0.02, 0.33, 0.36, 0.18)   # torso
    mb_j.add_box(0.0, 0.78, -0.02, 0.40, 0.10, 0.17)   # shoulders
    mb_j.add_box(-0.18, 0.66, 0.04, 0.08, 0.22, 0.09)  # left upper arm
    mb_j.add_box(0.18, 0.66, 0.04, 0.08, 0.22, 0.09)   # right upper arm
    w.add_mesh_node("Spectator_Jersey", mb_j, mat_jersey)

    mb_b = MeshBuilder()
    mb_b.add_cylinder(0.0, 0.81, 0.88, -0.01, 0.045, 0.042, segs=6)
    mb_b.add_sphere(0.0, 0.96, -0.01, 0.095, 0.108, 0.098, rings=6, segs=10)
    mb_b.add_box(-0.085, 0.45, 0.11, 0.12, 0.095, 0.26)
    mb_b.add_box(0.085, 0.45, 0.11, 0.12, 0.095, 0.26)
    w.add_mesh_node("Spectator_Body", mb_b, mat_body)

    out_path = os.path.join(MODELS_DIR, "spectator_crowd.glb")
    w.write(out_path)
    print(f"Wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KB)")


def build_seat_lod2():
    """
    Contoured ergonomic bucket seat (~108 tris) facing +Z:
      - Curved multi-segment backrest with rounded shoulder arch
      - Contoured angled seat pan
      - Sculpted side armrest bolsters
      - Twin riser mounting stanchions
    """
    w = GlbWriter()
    mat_seat = w.add_material("Seat_LOD2_Shell", [1, 1, 1, 1], roughness=0.34, metallic=0.05)
    mb = MeshBuilder()

    # 1. Curved contoured backrest (4 horizontal segments x 2 vertical segments, bowed inward toward +Z sides)
    nu = 4
    nv = 2
    half_w = 0.215
    thick = 0.042
    grid_f = []
    grid_b = []
    for iv in range(nv + 1):
        v = iv / nv
        y = 0.41 + v * 0.435
        z_rake = -0.015 - v * 0.055
        row_f = []
        row_b = []
        for iu in range(nu + 1):
            u = (iu / nu) * 2.0 - 1.0
            x = u * half_w * (1.0 - 0.06 * v * v)
            bow = 0.036 * (1.0 - u * u)
            row_f.append((x, y, z_rake - bow + thick))
            row_b.append((x, y, z_rake - bow))
        grid_f.append(row_f)
        grid_b.append(row_b)

    for iv in range(nv):
        for iu in range(nu):
            mb.add_quad(grid_f[iv][iu], grid_f[iv][iu + 1], grid_f[iv + 1][iu + 1], grid_f[iv + 1][iu])
            mb.add_quad(grid_b[iv][iu + 1], grid_b[iv][iu], grid_b[iv + 1][iu], grid_b[iv + 1][iu + 1])
    # Top rim & side edges
    for iu in range(nu):
        mb.add_quad(grid_f[nv][iu], grid_f[nv][iu + 1], grid_b[nv][iu + 1], grid_b[nv][iu])
    for iv in range(nv):
        mb.add_quad(grid_b[iv][0], grid_f[iv][0], grid_f[iv + 1][0], grid_b[iv + 1][0])
        mb.add_quad(grid_f[iv][nu], grid_b[iv][nu], grid_b[iv + 1][nu], grid_f[iv + 1][nu])

    # 2. Angled contoured cushion pan + sculpted side bolsters + twin stanchion pedestals
    mb.add_box(0.0, 0.39, 0.145, 0.40, 0.072, 0.31)
    mb.add_box(-0.205, 0.495, 0.10, 0.036, 0.045, 0.22)
    mb.add_box(0.205, 0.495, 0.10, 0.036, 0.045, 0.22)
    mb.add_box(-0.13, 0.19, 0.06, 0.055, 0.38, 0.075)
    mb.add_box(0.13, 0.19, 0.06, 0.055, 0.38, 0.075)

    w.add_mesh_node("Seat_LOD2_Mesh", mb, mat_seat)
    out_path = os.path.join(MODELS_DIR, "seat_lod2.glb")
    w.write(out_path)
    print(f"Wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KB, tris={len(mb.indices)//3})")


def build_seat_lod3():
    """Lean contoured 44-tri bucket seat facing +Z for macro bowl views."""
    w = GlbWriter()
    mat_seat = w.add_material("Seat_LOD3_HDPE", [1, 1, 1, 1], roughness=0.35, metallic=0.05)
    mb = MeshBuilder()
    # Curved 2-segment angled bucket backrest + seat cushion pan + pedestal
    mb.add_box(0.0, 0.39, 0.15, 0.41, 0.075, 0.31)
    mb.add_box(0.0, 0.64, 0.005, 0.41, 0.45, 0.055)
    mb.add_box(-0.20, 0.52, 0.10, 0.035, 0.12, 0.18)
    mb.add_box(0.20, 0.52, 0.10, 0.035, 0.12, 0.18)
    mb.add_box(0.0, 0.19, 0.10, 0.16, 0.38, 0.08)
    w.add_mesh_node("Seat_LOD3_Mesh", mb, mat_seat)

    out_path = os.path.join(MODELS_DIR, "seat_lod3.glb")
    w.write(out_path)
    print(f"Wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KB, tris={len(mb.indices)//3})")


if __name__ == "__main__":
    build_stadium_venue()
    build_spectator_crowd()
    build_seat_lod2()
    build_seat_lod3()
