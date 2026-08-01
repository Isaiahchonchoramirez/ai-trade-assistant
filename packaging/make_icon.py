"""Draw the app icon with real transparency, then build a macOS .icns.

A screenshot cannot carry an alpha channel, and an app icon without one shows
white corners on every dock and Finder background. So the mark is drawn
directly — supersampled 4x and downsampled for clean edges.

    python make_icon.py <output-dir>

Writes icon_1024.png and, on macOS, AppIcon.icns.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

S = 4  # supersampling factor
SIZE = 1024
GREEN_TOP = (22, 181, 22)
GREEN_BOT = (8, 132, 8)
WHITE = (255, 255, 255)


def lerp(a: tuple[int, ...], b: tuple[int, ...], t: float) -> tuple[int, ...]:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def draw_icon(size: int) -> Image.Image:
    w = size * S
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))

    # Vertical gradient, clipped to a rounded square (the macOS "squircle"
    # approximation). Drawn as a full-bleed gradient then masked.
    grad = Image.new("RGBA", (w, w))
    gd = ImageDraw.Draw(grad)
    for y in range(w):
        gd.line([(0, y), (w, y)], fill=(*lerp(GREEN_TOP, GREEN_BOT, y / w), 255))

    mask = Image.new("L", (w, w), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [w * 0.055, w * 0.055, w * 0.945, w * 0.945], radius=w * 0.205, fill=255
    )
    img.paste(grad, (0, 0), mask)

    u = w / 96.0  # the SVG was authored on a 96-unit grid

    def stroke(layer, pts, width, alpha):
        """Draw a round-capped, round-joined polyline onto its own layer.

        Drawn separately and composited because ImageDraw *replaces* pixels
        rather than blending them — painting semi-transparent white directly
        onto the gradient punches a translucent hole through the icon instead
        of tinting it.
        """
        d = ImageDraw.Draw(layer)
        px = [(x * u, y * u) for x, y in pts]
        d.line(px, fill=(*WHITE, alpha), width=round(width * u), joint="curve")
        r = width * u / 2
        for x, y in px:
            d.ellipse([x - r, y - r, x + r, y + r], fill=(*WHITE, alpha))

    # Faint candles sit behind, on their own layer so they tint the green.
    behind = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    stroke(behind, [(30, 40), (30, 60)], 3.4, 115)
    stroke(behind, [(66, 52), (66, 70)], 3.4, 115)
    img = Image.alpha_composite(img, behind)

    # The breakout line and its arrow head, fully opaque, in front.
    front = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    stroke(front, [(24, 66), (39, 50), (50, 60), (70, 34)], 6.2, 255)
    stroke(front, [(58, 32), (72, 32)], 6.2, 255)
    stroke(front, [(72, 32), (72, 46)], 6.2, 255)
    img = Image.alpha_composite(img, front)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    out.mkdir(parents=True, exist_ok=True)

    master = draw_icon(SIZE)
    png = out / "icon_1024.png"
    master.save(png)
    print(f"  {png.name}")

    # macOS iconset: each size, plus @2x retina variants.
    iconset = out / "AppIcon.iconset"
    if iconset.exists():
        for f in iconset.iterdir():
            f.unlink()
    iconset.mkdir(exist_ok=True)

    for base in (16, 32, 128, 256, 512):
        master.resize((base, base), Image.LANCZOS).save(iconset / f"icon_{base}x{base}.png")
        master.resize((base * 2, base * 2), Image.LANCZOS).save(
            iconset / f"icon_{base}x{base}@2x.png"
        )

    icns = out / "AppIcon.icns"
    try:
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], check=True)
        print(f"  {icns.name}")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("  (iconutil unavailable — .icns not built)")


if __name__ == "__main__":
    main()
