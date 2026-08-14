#!/usr/bin/env python3
"""Generate the landing page's image assets (12-3): the hero photograph and the header logo.

    python3 scripts/build-landing-images.py

Reads `assets/landing/hero-source.jpg` and `assets/images/harp2tab-icon.png`, and writes into
`public/hero/` and `public/logo/`, which Expo copies to the site root during
`expo export -p web`. The landing page is plain DOM rather than react-native-web, so it cannot
`require()` an asset the way the app does — it references these by URL, which is why they are
emitted as real files instead of being bundled.

**Why Python rather than a `.ts` script like the rest of `scripts/`.** The repo has no image
toolchain — no `sharp`, no `cwebp`, no ImageMagick — and adding one for six files would put a
native build step in front of `npm install`. Pillow is already present and does WebP. AVIF is
deliberately skipped: Pillow has no AVIF support here without `pillow-avif-plugin`, and WebP
already carries most of the saving.

The hero is the landing page's LCP element, so the numbers matter more than usual:
`<picture>` serves the WebP and falls back to the JPEG, and every file is written with an
explicit size so the markup's `width`/`height` can hold CLS at zero.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "landing" / "hero-source.jpg"
OUT_DIR = ROOT / "public" / "hero"

# The app icon, reused as the header mark. Already cyan on transparent, so it needs no
# recolouring to sit on the dark page — only shrinking: the source is 512px for launcher use,
# which is ~40 KB to render a 42px mark.
#
# 42px because that is exactly what the app's own header uses (`logoIcon` in
# `src/components/TopBar.web.tsx`). The landing page and the app must show the same mark at the
# same size, so a visitor crossing from `/` to `/app` sees no change.
LOGO_SOURCE = ROOT / "assets" / "images" / "harp2tab-icon.png"
LOGO_OUT_DIR = ROOT / "public" / "logo"
LOGO_SIZES = (42, 84)  # 1x and 2x

# 960 covers phones at 2x and small laptops; 1440 is the common desktop; 1920 is the source's
# own width, so nothing is ever upscaled.
WIDTHS = (960, 1440, 1920)

# Quality falls as the variant grows, which is the opposite of the instinct but the right call
# here. The large variants only ever reach big or 2x displays, where per-pixel artefacts are
# smaller than a device pixel; and most of this photograph sits under an 88% scrim on the
# landing page, so the compressor is being judged on a region the visitor barely sees. Flat 72
# put the 1920 WebP at 309 KB, which is too much for an LCP element.
WEBP_QUALITY = {960: 74, 1440: 68, 1920: 60}
JPEG_QUALITY = {960: 78, 1440: 74, 1920: 68}


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing source image: {SOURCE}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    src = Image.open(SOURCE).convert("RGB")
    src_w, src_h = src.size
    print(f"source  {SOURCE.relative_to(ROOT)}  {src_w}x{src_h}  "
          f"{SOURCE.stat().st_size / 1024:.0f} KB\n")

    for width in WIDTHS:
        height = round(width * src_h / src_w)
        resized = src if width == src_w else src.resize(
            (width, height), Image.Resampling.LANCZOS)

        for ext, params in (
            ("webp", {"quality": WEBP_QUALITY[width], "method": 6}),
            # `progressive` so the fallback degrades gracefully on a slow connection rather
            # than painting top-to-bottom; `optimize` runs a second Huffman pass.
            ("jpg", {"quality": JPEG_QUALITY[width], "progressive": True, "optimize": True}),
        ):
            path = OUT_DIR / f"harmonicas-{width}.{ext}"
            resized.save(path, **params)
            print(f"  {path.relative_to(ROOT)}  {width}x{height}  "
                  f"{path.stat().st_size / 1024:.0f} KB")

    print(f"\nintrinsic aspect ratio: {src_w}/{src_h} — use these in width/height attributes")

    if not LOGO_SOURCE.exists():
        raise SystemExit(f"missing logo source: {LOGO_SOURCE}")

    LOGO_OUT_DIR.mkdir(parents=True, exist_ok=True)
    logo = Image.open(LOGO_SOURCE).convert("RGBA")
    print(f"\nlogo    {LOGO_SOURCE.relative_to(ROOT)}  {logo.width}x{logo.height}  "
          f"{LOGO_SOURCE.stat().st_size / 1024:.0f} KB\n")
    for size in LOGO_SIZES:
        path = LOGO_OUT_DIR / f"harp2tab-icon-{size}.png"
        logo.resize((size, size), Image.Resampling.LANCZOS).save(path, optimize=True)
        print(f"  {path.relative_to(ROOT)}  {size}x{size}  "
              f"{path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
