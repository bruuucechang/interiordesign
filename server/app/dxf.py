"""Import walls from a DXF drawing.

This is the format the original plan actually arrives in — developers and
surveyors hand over DWG/DXF, and until now the only way in was to trace a
bitmap by hand. ezdxf is the reason this lives on the Python side; the
JavaScript ecosystem has nothing comparable.

Import is two-stage on purpose. A real architectural drawing carries dozens of
layers — walls, openings, furniture, dimensions, grid lines, hatching, the title
block — and importing all of them yields hundreds of nonsense "walls". So
`inspect` reports what is in the file and the user chooses layers before
`convert` runs.
"""
from __future__ import annotations

import base64
import binascii
import io
import math
import re
from typing import Any, Iterable

import ezdxf
from ezdxf import units as ezunits

Vec = dict[str, float]

# Editor units are centimetres. Anything not listed is treated as unknown.
UNIT_TO_CM: dict[int, float] = {
    ezunits.IN: 2.54,
    ezunits.FT: 30.48,
    ezunits.MM: 0.1,
    ezunits.CM: 1.0,
    ezunits.M: 100.0,
}
UNIT_NAMES: dict[str, float] = {"mm": 0.1, "cm": 1.0, "m": 100.0, "in": 2.54, "ft": 30.48}

WALL_ENTITIES = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC"}
DEFAULT_THICKNESS = 12.0     # cm, when a wall is drawn as a single line
MAX_THICKNESS = 60.0         # cm — beyond this two lines are not one wall
ANGLE_TOL_DEG = 2.0          # DXF is exact geometry, so this can be tight
ARC_MIN_BULGE = 0.5          # cm — below this an arc is just a straight run

# Layer names that in practice hold something other than walls. Matched
# case-insensitively as substrings, used only to pre-suggest checkboxes.
NON_WALL_HINTS = (
    "dim", "text", "note", "hatch", "grid", "axis", "title", "frame", "furn",
    "標註", "尺寸", "文字", "圖框", "軸線", "家具", "填充",
)
WALL_HINTS = ("wall", "牆", "w-", "a-wall", "arch")

_DATA_URL = re.compile(r"^data:[^;]*;base64,", re.I)


class DxfError(ValueError):
    pass


def _read(payload: str):
    raw = _DATA_URL.sub("", payload.strip())
    try:
        blob = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as e:
        raise DxfError(f"not valid base64: {e}") from e
    try:
        # DXF is text; ezdxf sniffs the encoding itself.
        return ezdxf.read(io.StringIO(blob.decode("utf-8", errors="replace")))
    except Exception as e:                       # ezdxf raises several types
        raise DxfError(f"not a readable DXF: {e}") from e


# ------------------------------------------------------------------ geometry


def _segments_of(entity) -> list[tuple[tuple[float, float], tuple[float, float], float]]:
    """Flatten one entity into (start, end, bulge) runs in DXF coordinates.

    `bulge` is the editor's signed sagitta, not the DXF bulge factor, so arcs and
    polyline bulges both arrive as curved walls rather than being straightened.
    """
    kind = entity.dxftype()
    out: list[tuple[tuple[float, float], tuple[float, float], float]] = []

    if kind == "LINE":
        a, b = entity.dxf.start, entity.dxf.end
        out.append(((a.x, a.y), (b.x, b.y), 0.0))

    elif kind == "LWPOLYLINE":
        pts = list(entity.get_points("xyb"))      # x, y, bulge-at-this-vertex
        if entity.closed and len(pts) > 2:
            pts = pts + [pts[0]]
        for (x1, y1, bulge), (x2, y2, _) in zip(pts, pts[1:]):
            out.append(((x1, y1), (x2, y2), _bulge_factor_to_sagitta(bulge, x1, y1, x2, y2)))

    elif kind == "POLYLINE":
        verts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
        if getattr(entity, "is_closed", False) and len(verts) > 2:
            verts = verts + [verts[0]]
        for a, b in zip(verts, verts[1:]):
            out.append((a, b, 0.0))

    elif kind == "ARC":
        c = entity.dxf.center
        r = float(entity.dxf.radius)
        a0 = math.radians(float(entity.dxf.start_angle))
        a1 = math.radians(float(entity.dxf.end_angle))
        sweep = (a1 - a0) % (2 * math.pi)
        p0 = (c.x + r * math.cos(a0), c.y + r * math.sin(a0))
        p1 = (c.x + r * math.cos(a1), c.y + r * math.sin(a1))
        # sagitta of the arc; sign follows the sweep direction
        sagitta = r * (1 - math.cos(sweep / 2))
        out.append((p0, p1, sagitta))

    return out


def _bulge_factor_to_sagitta(bulge: float, x1: float, y1: float, x2: float, y2: float) -> float:
    """DXF bulge is tan(sweep/4); the editor stores the arc's height instead."""
    if not bulge:
        return 0.0
    chord = math.hypot(x2 - x1, y2 - y1)
    return (chord / 2) * bulge


def _length(seg) -> float:
    (x1, y1), (x2, y2), _ = seg
    return math.hypot(x2 - x1, y2 - y1)


def _angle(seg) -> float:
    (x1, y1), (x2, y2), _ = seg
    return math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180.0


# ------------------------------------------------------------------ inspect


def inspect(payload: str) -> dict[str, Any]:
    """What is in this file: layers, their content, and the unit situation."""
    doc = _read(payload)
    msp = doc.modelspace()

    per_layer: dict[str, dict[str, Any]] = {}
    minx = miny = math.inf
    maxx = maxy = -math.inf

    for e in msp:
        if e.dxftype() not in WALL_ENTITIES:
            continue
        segs = _segments_of(e)
        if not segs:
            continue
        layer = str(e.dxf.layer)
        rec = per_layer.setdefault(layer, {"layer": layer, "segments": 0, "length": 0.0})
        for s in segs:
            rec["segments"] += 1
            rec["length"] += _length(s)
            for (x, y) in (s[0], s[1]):
                minx, miny = min(minx, x), min(miny, y)
                maxx, maxy = max(maxx, x), max(maxy, y)

    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    extent = (maxx - minx, maxy - miny) if per_layer else (0.0, 0.0)
    unit, guessed = _resolve_unit(insunits, max(extent))

    layers = []
    for rec in per_layer.values():
        layers.append({**rec, "suggested": _looks_like_walls(rec["layer"])})
    layers.sort(key=lambda r: -r["length"])

    return {
        "layers": layers,
        "insunits": insunits,
        "unit": unit,
        "unitGuessed": guessed,
        "extent": {"w": extent[0], "h": extent[1]},
        "dxfversion": doc.dxfversion,
    }


def _resolve_unit(insunits: int, largest: float) -> tuple[str, bool]:
    """Return the unit name and whether it had to be guessed.

    $INSUNITS is often 0 (unitless) in files exported from older CAD, and
    getting this wrong scales the whole plan by 1000, so the guess is reported
    to the user rather than applied silently.
    """
    for name, cm in UNIT_NAMES.items():
        if insunits in UNIT_TO_CM and abs(UNIT_TO_CM[insunits] - cm) < 1e-9:
            return name, False
    # Unitless: assume the drawing is a building, a few metres across.
    if largest <= 0:
        return "mm", True
    if largest > 2000:
        return "mm", True        # 2000+ units across → millimetres
    if largest > 200:
        return "cm", True
    return "m", True


def _looks_like_walls(layer: str) -> bool:
    low = layer.lower()
    if any(h in low for h in NON_WALL_HINTS):
        return False
    if any(h in low for h in WALL_HINTS):
        return True
    return layer in ("0", "")     # everything dumped on layer 0 is common


# ------------------------------------------------------------------ convert


def convert(payload: str, layers: Iterable[str] | None = None,
            unit: str | None = None) -> dict[str, Any]:
    """Turn the chosen layers into editor walls, in centimetres."""
    doc = _read(payload)
    msp = doc.modelspace()
    wanted = set(layers) if layers is not None else None

    raw: list[tuple[tuple[float, float], tuple[float, float], float]] = []
    for e in msp:
        if e.dxftype() not in WALL_ENTITIES:
            continue
        if wanted is not None and str(e.dxf.layer) not in wanted:
            continue
        raw.extend(_segments_of(e))

    if not raw:
        return {"walls": [], "unit": unit or "mm", "merged": 0}

    scale = UNIT_NAMES.get((unit or "").lower()) or UNIT_TO_CM.get(
        int(doc.header.get("$INSUNITS", 0) or 0), 1.0
    )

    # DXF is Y-up, the editor is Y-down, and drawings often sit far from the
    # origin (site coordinates), so shift to the origin and flip.
    xs = [p[0] for s in raw for p in (s[0], s[1])]
    ys = [p[1] for s in raw for p in (s[0], s[1])]
    minx, maxy = min(xs), max(ys)

    def to_world(p: tuple[float, float]) -> tuple[float, float]:
        return ((p[0] - minx) * scale, (maxy - p[1]) * scale)

    scaled = [
        (to_world(a), to_world(b), -bulge * scale)   # flip bulge with the Y axis
        for a, b, bulge in raw
        if math.hypot(b[0] - a[0], b[1] - a[1]) * scale >= 1.0
    ]

    walls, merged = _merge_parallel_pairs(scaled)
    _connect_ends(walls)
    return {"walls": walls, "unit": unit or "auto", "merged": merged}


def _connect_ends(walls: list[dict[str, Any]]) -> None:
    """Pull a wall's loose ends onto the centreline of the wall it stops against.

    Merging the two drawn faces moves every centreline inward by half a
    thickness, and that is enough to disconnect the network. A partition drawn
    against the *inner faces* of the walls it meets — which is how partitions
    are drawn — ends up half a thickness short of their centrelines at both
    ends. Drawn through instead, it overshoots by the same amount and crosses
    them. Either way the ends are near the other wall but not on it, so the
    room finder sees a dangling edge and returns the outer boundary as a single
    room: a 6×4 m plan with one partition came back as 22.81 m² instead of
    13.58 and 9.23.

    The tolerance is the wall's own thickness. Half of it is what the merge
    just introduced; the whole of it covers the two ends being different
    thicknesses without reaching far enough to invent a junction that is not
    there. Ends are moved onto the target's centreline, never along it, so a
    wall's length changes by at most that half-thickness.

    rooms.py then cuts the target at the point we landed on — this function
    only makes the two touch.
    """
    for w in walls:
        if w.get("bulge"):
            continue                      # an arc's end is not a straight extension
        for key in ("a", "b"):
            end = w[key]
            best: tuple[float, dict[str, float]] | None = None
            for other in walls:
                if other is w or other.get("bulge"):
                    continue
                foot = _foot_on(end, other)
                if foot is None:
                    continue
                gap = math.hypot(end["x"] - foot["x"], end["y"] - foot["y"])
                tol = max(w["thickness"], other["thickness"])
                if gap <= tol and (best is None or gap < best[0]):
                    best = (gap, foot)
            if best is not None:
                w[key] = best[1]


def _foot_on(p: dict[str, float], seg: dict[str, Any]) -> dict[str, float] | None:
    """Where p lands on seg's centreline, or None if it is past either end.

    The interior only: an end that reaches another wall's *end* is already a
    shared node and needs no help.
    """
    a, b = seg["a"], seg["b"]
    dx, dy = b["x"] - a["x"], b["y"] - a["y"]
    length = math.hypot(dx, dy)
    if length == 0:
        return None
    t = ((p["x"] - a["x"]) * dx + (p["y"] - a["y"]) * dy) / (length * length)
    if not (0 < t < 1):
        return None
    return {"x": a["x"] + dx * t, "y": a["y"] + dy * t}


def _merge_parallel_pairs(segs: list) -> tuple[list[dict[str, Any]], int]:
    """Collapse a wall's two drawn faces into one centreline with a thickness.

    Architectural drawings show a wall as its two faces. Left as-is, each real
    wall becomes two overlapping editor walls and the planar-graph room finder
    traces the cavity between them as a room, so the areas come out wrong.
    """
    used = [False] * len(segs)
    walls: list[dict[str, Any]] = []
    merged = 0

    for i, a in enumerate(segs):
        if used[i]:
            continue
        partner = -1
        best_gap = math.inf
        for j in range(i + 1, len(segs)):
            if used[j]:
                continue
            gap = _parallel_offset(a, segs[j])
            if gap is not None and gap < best_gap:
                partner, best_gap = j, gap
        if partner >= 0:
            used[i] = used[partner] = True
            merged += 1
            walls.append(_centre_wall(a, segs[partner], best_gap))
        else:
            used[i] = True
            (x1, y1), (x2, y2), bulge = a
            walls.append(_wall(x1, y1, x2, y2, DEFAULT_THICKNESS, bulge))

    return walls, merged


def _parallel_offset(a, b) -> float | None:
    """Perpendicular gap between two segments if they are the faces of one wall."""
    if abs(((_angle(a) - _angle(b)) + 90) % 180 - 90) > ANGLE_TOL_DEG:
        return None

    ang = math.radians(_angle(a))
    d = (math.cos(ang), math.sin(ang))
    n = (-d[1], d[0])

    pa = [a[0], a[1]]
    pb = [b[0], b[1]]
    off_a = sum(p[0] * n[0] + p[1] * n[1] for p in pa) / 2
    off_b = sum(p[0] * n[0] + p[1] * n[1] for p in pb) / 2
    gap = abs(off_a - off_b)
    if not (0 < gap <= MAX_THICKNESS):
        return None

    # they must actually run alongside each other, not merely be parallel
    proj = lambda p: p[0] * d[0] + p[1] * d[1]
    a0, a1 = sorted(proj(p) for p in pa)
    b0, b1 = sorted(proj(p) for p in pb)
    overlap = min(a1, b1) - max(a0, b0)
    if overlap <= 0 or overlap < 0.5 * min(a1 - a0, b1 - b0):
        return None
    return gap


def _centre_wall(a, b, thickness: float) -> dict[str, Any]:
    (ax1, ay1), (ax2, ay2), bulge = a
    (bx1, by1), (bx2, by2), _ = b
    # pair the endpoints by proximity so the centreline does not cross over
    if math.dist((ax1, ay1), (bx1, by1)) > math.dist((ax1, ay1), (bx2, by2)):
        bx1, by1, bx2, by2 = bx2, by2, bx1, by1
    return _wall((ax1 + bx1) / 2, (ay1 + by1) / 2,
                 (ax2 + bx2) / 2, (ay2 + by2) / 2, thickness, bulge)


def _wall(x1: float, y1: float, x2: float, y2: float,
          thickness: float, bulge: float) -> dict[str, Any]:
    w: dict[str, Any] = {
        "a": {"x": round(x1, 2), "y": round(y1, 2)},
        "b": {"x": round(x2, 2), "y": round(y2, 2)},
        "thickness": round(thickness, 1),
    }
    if abs(bulge) >= ARC_MIN_BULGE:
        w["bulge"] = round(bulge, 2)
    return w
