#!/usr/bin/env python3
"""Draw the five tab icons. No third-party image library."""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "miniprogram" / "assets" / "tab"
SIZE = 81
OFF = (139, 147, 152, 255)
ON = (244, 245, 242, 255)


def write_png(path, pixels):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + pixels[y * SIZE * 4 : (y + 1) * SIZE * 4] for y in range(SIZE))
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    blob = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(blob)


def blank():
    return bytearray(SIZE * SIZE * 4)


def dot(pixels, x, y, color, radius):
    for yy in range(int(y - radius - 1), int(y + radius + 2)):
        for xx in range(int(x - radius - 1), int(x + radius + 2)):
            if 0 <= xx < SIZE and 0 <= yy < SIZE and (xx - x) ** 2 + (yy - y) ** 2 <= radius ** 2:
                index = (yy * SIZE + xx) * 4
                pixels[index : index + 4] = bytes(color)


def stroke(pixels, x0, y0, x1, y1, color, radius=1.6):
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 4) + 1
    for step in range(steps + 1):
        t = step / steps
        dot(pixels, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, color, radius)


def rect(pixels, x0, y0, x1, y1, color, radius=1.6):
    stroke(pixels, x0, y0, x1, y0, color, radius)
    stroke(pixels, x1, y0, x1, y1, color, radius)
    stroke(pixels, x1, y1, x0, y1, color, radius)
    stroke(pixels, x0, y1, x0, y0, color, radius)


def home(pixels, color):
    stroke(pixels, 22, 38, 40, 20, color)
    stroke(pixels, 40, 20, 58, 38, color)
    rect(pixels, 26, 36, 54, 62, color)


def cats(pixels, color):
    for x in (24, 44):
        for y in (24, 44):
            rect(pixels, x, y, x + 14, y + 14, color)


def latest(pixels, color):
    rect(pixels, 24, 22, 58, 60, color)
    stroke(pixels, 24, 32, 58, 32, color)
    stroke(pixels, 32, 42, 50, 42, color)
    stroke(pixels, 32, 50, 44, 50, color)


def contact(pixels, color):
    rect(pixels, 30, 16, 52, 64, color, 1.8)
    dot(pixels, 41, 26, color, 2.2)
    stroke(pixels, 35, 54, 47, 54, color, 1.8)


def about(pixels, color):
    import math

    radius = 18
    for step in range(360):
        angle = step / 360 * math.tau
        dot(pixels, 40 + radius * math.cos(angle), 40 + radius * math.sin(angle), color, 1.7)
    dot(pixels, 40, 31, color, 2.3)
    stroke(pixels, 40, 38, 40, 52, color, 1.9)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    drawers = {"home": home, "cats": cats, "latest": latest, "contact": contact, "about": about}
    for name, draw in drawers.items():
        for suffix, color in (("", OFF), ("-on", ON)):
            pixels = blank()
            draw(pixels, color)
            write_png(OUT / f"{name}{suffix}.png", pixels)


if __name__ == "__main__":
    main()
