#!/usr/bin/env python3
"""
Generate KanbAgent application icons (pure Python, no dependencies).
Design: dark kanban board with 3 columns (a_faire/en_cours/terminé)
Palette: zinc-900 bg, zinc-800 columns, indigo/amber/green cards
"""
import struct
import zlib
import math
import os

# Color palette (R, G, B, A)
TRANSPARENT = (0, 0, 0, 0)
BG          = (24, 24, 27, 255)    # zinc-900  #18181b
BG2         = (39, 39, 42, 255)    # zinc-800  #27272a
COL_0       = (99, 102, 241, 255)  # indigo-500 — a_faire
COL_1       = (245, 158, 11, 255)  # amber-500  — en_cours
COL_2       = (34, 197, 94, 255)   # green-500  — terminé


def make_pixels(size):
    """Returns list of (R,G,B,A) tuples representing the icon at given size."""
    def idx(x, y):
        return y * size + x

    def blend(bg, fg):
        """Alpha-blend fg over bg (fg alpha drives blending)."""
        a = fg[3] / 255.0
        return (
            int(bg[0] * (1 - a) + fg[0] * a),
            int(bg[1] * (1 - a) + fg[1] * a),
            int(bg[2] * (1 - a) + fg[2] * a),
            255,
        )

    px = [BG] * (size * size)

    # --- Rounded corners (transparent outside) ---
    corner_r = max(2, size // 5)
    for y in range(size):
        for x in range(size):
            cx = corner_r if x < corner_r else (size - 1 - corner_r if x > size - 1 - corner_r else x)
            cy = corner_r if y < corner_r else (size - 1 - corner_r if y > size - 1 - corner_r else y)
            if (x - cx) ** 2 + (y - cy) ** 2 > corner_r * corner_r:
                px[idx(x, y)] = TRANSPARENT

    # --- Layout ---
    margin   = max(1, size // 8)
    inner_w  = size - 2 * margin
    inner_h  = size - 2 * margin
    gap      = max(1, size // 20)
    col_w    = (inner_w - 2 * gap) // 3

    col_starts = [
        margin,
        margin + col_w + gap,
        margin + 2 * (col_w + gap),
    ]
    col_top = margin
    col_bot = size - margin

    # --- Column backgrounds (zinc-800) ---
    for cx in col_starts:
        for y in range(col_top, col_bot):
            for x in range(cx, cx + col_w):
                if 0 <= x < size and 0 <= y < size and px[idx(x, y)][3] > 0:
                    px[idx(x, y)] = BG2

    # --- Cards ---
    card_margin = max(0, col_w // 8)
    card_w      = col_w - 2 * card_margin
    header_h    = max(2, size // 10)
    card_h      = max(2, inner_h // 7)
    card_gap    = max(1, size // 32)

    col_data = [
        (COL_0, 1),  # indigo — 1 card
        (COL_1, 2),  # amber  — 2 cards
        (COL_2, 3),  # green  — 3 cards
    ]

    for i, (color, n_cards) in enumerate(col_data):
        cx = col_starts[i]

        # Header dot
        dot_cx = cx + col_w // 2
        dot_cy = col_top + header_h // 2
        dot_r  = max(1, header_h // 3)
        for dy in range(int(dot_cy - dot_r - 1), int(dot_cy + dot_r + 2)):
            for dx in range(int(dot_cx - dot_r - 1), int(dot_cx + dot_r + 2)):
                dist = math.sqrt((dx - dot_cx) ** 2 + (dy - dot_cy) ** 2)
                if dist <= dot_r and 0 <= dx < size and 0 <= dy < size and px[idx(dx, dy)][3] > 0:
                    px[idx(dx, dy)] = color

        # Cards in column
        card_area_top = col_top + header_h + card_gap
        for j in range(n_cards):
            cy_top = card_area_top + j * (card_h + card_gap)
            cy_bot = cy_top + card_h
            if cy_bot > col_bot - card_margin:
                break
            for y in range(cy_top, cy_bot):
                for x in range(cx + card_margin, cx + card_margin + card_w):
                    if 0 <= x < size and 0 <= y < size and px[idx(x, y)][3] > 0:
                        px[idx(x, y)] = color

    return px


def make_png(size):
    """Encode pixels as PNG bytes."""
    px = make_pixels(size)

    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # RGBA

    raw = b''
    for y in range(size):
        raw += b'\x00'  # filter: None
        for x in range(size):
            r, g, b, a = px[y * size + x]
            raw += bytes([r, g, b, a])

    compressed = zlib.compress(raw, 9)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', compressed)
        + chunk(b'IEND', b'')
    )


def make_ico(sizes):
    """Pack multiple PNG images into a multi-resolution ICO file."""
    images = [(s, make_png(s)) for s in sizes]
    n = len(images)

    header = struct.pack('<HHH', 0, 1, n)   # reserved, type=1 (ICO), count

    offset = 6 + n * 16
    entries = b''
    image_data = b''

    for size, png_data in images:
        w = size if size < 256 else 0   # 256 encoded as 0 per ICO spec
        h = size if size < 256 else 0
        entries += struct.pack(
            '<BBBBHHII',
            w, h,          # width, height
            0, 0,          # colorCount (0=256+), reserved
            1, 32,         # planes, bitCount
            len(png_data),
            offset,
        )
        offset += len(png_data)
        image_data += png_data

    return header + entries + image_data


if __name__ == '__main__':
    os.makedirs('build', exist_ok=True)

    # 512×512 PNG (Linux + macOS source)
    png_512 = make_png(512)
    with open('build/icon.png', 'wb') as f:
        f.write(png_512)
    print(f'  build/icon.png  ({len(png_512):,} bytes)')

    # Multi-resolution ICO (Windows)
    ico_data = make_ico([16, 32, 48, 128, 256])
    with open('build/icon.ico', 'wb') as f:
        f.write(ico_data)
    print(f'  build/icon.ico  ({len(ico_data):,} bytes)  — 5 resolutions: 16/32/48/128/256')

    print('Done.')
