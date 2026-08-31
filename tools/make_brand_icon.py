"""Device Saver brand icon: a question mark built from a device network.

Nodes and edges trace the glyph, so the silhouette still reads as "?" at
sidebar size while the node-link construction carries the network metaphor.
The detached node is amber - the device in question.
"""
import math
from PIL import Image, ImageDraw

SS = 8                  # supersampling
OUT = 256
S = OUT * SS

GREEN_TOP = (74, 190, 110)
GREEN_BOT = (26, 118, 72)
WHITE = (255, 255, 255, 255)
AMBER = (255, 193, 74, 255)

# Node-link path tracing a question mark, in 0..1 icon space.
HOOK = [
    (0.354, 0.413),      # open tail of the hook
    (0.366, 0.283),
    (0.473, 0.207),
    (0.600, 0.241),
    (0.654, 0.347),
    (0.558, 0.455),
    (0.502, 0.560),
    (0.500, 0.655),      # foot of the stem
]
DOT = (0.500, 0.793)

NODE_R = 0.0360          # standard node radius
BIG_R = 0.0560           # the detached node
EDGE_W = 0.0235


def squircle_mask(size, radius_frac=0.235, inset_frac=0.0):
    """Rounded-square silhouette - solid at small sizes, softer than a circle."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    i = inset_frac * size
    d.rounded_rectangle([i, i, size - i, size - i],
                        radius=radius_frac * size, fill=255)
    return m


def vertical_gradient(size, top, bottom):
    g = Image.new("RGB", (1, size))
    px = g.load()
    for y in range(size):
        t = y / (size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return g.resize((size, size), Image.NEAREST)


def disc(draw, cx, cy, r, fill):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def main():
    mask = squircle_mask(S)
    body = vertical_gradient(S, GREEN_TOP, GREEN_BOT).convert("RGBA")
    body.putalpha(mask)

    # soft highlight across the top, clipped to the tile
    hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hi).ellipse([-0.15 * S, -0.55 * S, 1.15 * S, 0.40 * S],
                               fill=(255, 255, 255, 30))
    hi.putalpha(Image.composite(hi.getchannel("A"), Image.new("L", (S, S), 0), mask))
    body = Image.alpha_composite(body, hi)

    d = ImageDraw.Draw(body)
    pts = [(x * S, y * S) for x, y in HOOK]

    # edges first, so the nodes sit on top of the joins
    d.line(pts, fill=WHITE, width=int(EDGE_W * S), joint="curve")

    # The node in question stays deliberately unconnected - that is the point:
    # it dropped off the network. It also gives the glyph its detached dot.
    x1, y1 = DOT[0] * S, DOT[1] * S

    for cx, cy in pts:
        disc(d, cx, cy, NODE_R * S, WHITE)
    disc(d, x1, y1, BIG_R * S, AMBER)

    icon = body.resize((OUT, OUT), Image.LANCZOS)
    icon.save("icon.png", optimize=True)
    body.resize((OUT * 2, OUT * 2), Image.LANCZOS).save("icon@2x.png", optimize=True)

    # small-size legibility check
    icon.resize((48, 48), Image.LANCZOS).resize((192, 192), Image.NEAREST).save("preview_48.png")
    icon.resize((24, 24), Image.LANCZOS).resize((192, 192), Image.NEAREST).save("preview_24.png")
    print("wrote icon.png, icon@2x.png, preview_48.png, preview_24.png")


main()
