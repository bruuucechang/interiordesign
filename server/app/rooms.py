"""Room detection from a wall network.

A faithful port of the TypeScript implementation this replaced. The walls form a
planar graph; every bounded face of that graph is a room. Faces are traced with
a half-edge walk and the single unbounded face of each connected component is
discarded.

Kept server-side because it runs on a 150 ms debounce after wall edits, not on
every pointer move — unlike snapping and hit-testing, which stay in the browser
precisely because a round trip per frame would be felt.
"""
from __future__ import annotations

import math
from typing import Any, Iterable

Vec = dict[str, float]

MERGE_EPS = 2.0      # cm — endpoints closer than this are the same node
MIN_AREA = 2500.0    # cm² (0.25 m²) — ignore slivers between walls
ARC_SEG = 14         # tessellation of a curved wall when building a room outline


def polygon_signed_area(pts: list[Vec]) -> float:
    a = 0.0
    n = len(pts)
    for i in range(n):
        p, q = pts[i], pts[(i + 1) % n]
        a += p["x"] * q["y"] - q["x"] * p["y"]
    return a / 2


def _wall_control(a: Vec, b: Vec, bulge: float) -> Vec:
    """Quadratic control point placing the curve's midpoint exactly on the apex."""
    dx, dy = b["x"] - a["x"], b["y"] - a["y"]
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length
    return {
        "x": (a["x"] + b["x"]) / 2 + nx * 2 * bulge,
        "y": (a["y"] + b["y"]) / 2 + ny * 2 * bulge,
    }


def _quad_points(a: Vec, c: Vec, b: Vec, n: int = 20) -> list[Vec]:
    pts: list[Vec] = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append(
            {
                "x": u * u * a["x"] + 2 * u * t * c["x"] + t * t * b["x"],
                "y": u * u * a["y"] + 2 * u * t * c["y"] + t * t * b["y"],
            }
        )
    return pts


def _crossing_t(w: dict[str, Any], other: dict[str, Any]) -> float | None:
    """Where `other` crosses `w`, as a parameter along `w`, or None.

    Proper crossings only — both parameters strictly inside both segments.
    Touching at an end is already handled by the endpoint pass, and a shared
    corner must not be treated as a cut.
    """
    ax, ay = w["a"]["x"], w["a"]["y"]
    bx, by = w["b"]["x"], w["b"]["y"]
    cx, cy = other["a"]["x"], other["a"]["y"]
    dx2, dy2 = other["b"]["x"], other["b"]["y"]

    rx, ry = bx - ax, by - ay
    sx, sy = dx2 - cx, dy2 - cy
    denom = rx * sy - ry * sx
    if denom == 0:
        return None                       # parallel or collinear
    t = ((cx - ax) * sy - (cy - ay) * sx) / denom
    u = ((cx - ax) * ry - (cy - ay) * rx) / denom
    if 0 < t < 1 and 0 < u < 1:
        return t
    return None


def _split_at_junctions(walls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cut a wall wherever another wall meets it part-way along.

    The face walk below reads nodes off wall *endpoints*, so a partition whose
    ends stop against the middle of another wall never joins the graph — it is
    a dangling edge, and the two rooms it divides come back as one. Measured:
    a 6×4 m rectangle with a partition gives one room of 22.81 m² unsplit, and
    two of 13.58 and 9.23 once the outer walls are cut at the junction.

    That is what the module docstring already claims to be doing ("the walls
    form a planar graph"); this is the step that makes it true. It matters most
    for DXF import, which produces exactly this shape — CAD partitions are drawn
    against the face of the walls they meet, never split for us — but the
    editor's drawing tools do not split either.

    Two kinds of meeting, and both are needed.

    An **endpoint** landing on the interior is the editor's shape, and the
    shape a DXF has once dxf.py has pulled its loose ends onto the wall they
    stop against. It needs a tolerance, MERGE_EPS, the same one the node merge
    uses.

    A **crossing** is what tracing an underlay produces: the lines Hough finds
    overshoot each other by a few pixels, so nothing touches end to end and
    nothing lands on an interior either — every junction is an X. Traced walls
    gave zero rooms for a plan that plainly has two. A crossing needs no
    tolerance at all: two segments either intersect or they do not, and a
    planar graph is by definition split where they do.

    Curved walls are left whole. Cutting an arc means recomputing the bulge of
    each half, and no partition in practice is an arc.
    """
    ends = [w["a"] for w in walls] + [w["b"] for w in walls]
    out: list[dict[str, Any]] = []

    for w in walls:
        a, b = w["a"], w["b"]
        dx, dy = b["x"] - a["x"], b["y"] - a["y"]
        length = math.hypot(dx, dy)
        if w.get("bulge") or length == 0:
            out.append(w)
            continue

        cuts: list[float] = []
        for other in walls:
            if other is w or other.get("bulge"):
                continue
            t_cross = _crossing_t(w, other)
            if t_cross is not None:
                cuts.append(t_cross)
        for p in ends:
            t = ((p["x"] - a["x"]) * dx + (p["y"] - a["y"]) * dy) / (length * length)
            px, py = a["x"] + dx * t, a["y"] + dy * t
            if math.hypot(p["x"] - px, p["y"] - py) > MERGE_EPS:
                continue
            # Ignore anything at either end: those are already the same node.
            if t * length <= MERGE_EPS or (1 - t) * length <= MERGE_EPS:
                continue
            cuts.append(t)

        if not cuts:
            out.append(w)
            continue

        kept: list[float] = []
        for t in sorted(cuts):
            if not kept or (t - kept[-1]) * length > MERGE_EPS:
                kept.append(t)

        prev = a
        for t in kept:
            point = {"x": a["x"] + dx * t, "y": a["y"] + dy * t}
            out.append({**w, "a": prev, "b": point})
            prev = point
        out.append({**w, "a": prev, "b": b})

    return out


def detect_room_polygons(walls: Iterable[dict[str, Any]]) -> list[list[Vec]]:
    """Every region enclosed by the walls, as a polygon of wall-centreline points."""
    walls = _split_at_junctions(list(walls))

    # 1. merge endpoints into shared nodes
    nodes: list[Vec] = []

    def node_index(p: dict[str, Any]) -> int:
        for i, n in enumerate(nodes):
            if math.hypot(n["x"] - p["x"], n["y"] - p["y"]) <= MERGE_EPS:
                return i
        nodes.append({"x": float(p["x"]), "y": float(p["y"])})
        return len(nodes) - 1

    # 2. unique undirected edges, remembering which carry a curved wall so the
    #    outline can follow the arc instead of the straight chord
    seen: set[tuple[int, int]] = set()
    edges: list[tuple[int, int]] = []
    curved: dict[tuple[int, int], dict[str, Any]] = {}

    def ekey(a: int, b: int) -> tuple[int, int]:
        return (a, b) if a < b else (b, a)

    for w in walls:
        a, b = node_index(w["a"]), node_index(w["b"])
        if a == b:
            continue
        key = ekey(a, b)
        if w.get("bulge"):
            curved[key] = {"na": a, "a": w["a"], "b": w["b"], "bulge": float(w["bulge"])}
        if key in seen:
            continue
        seen.add(key)
        edges.append((a, b))

    if not edges:
        return []

    def arc_between(i: int, j: int) -> list[Vec]:
        """Arc points strictly between nodes i and j, in the i→j direction."""
        c = curved.get(ekey(i, j))
        if not c:
            return []
        pts = _quad_points(
            c["a"], _wall_control(c["a"], c["b"], c["bulge"]), c["b"], ARC_SEG
        )[1:-1]
        return pts if c["na"] == i else list(reversed(pts))

    # 3. outgoing half-edges per node, sorted counter-clockwise by direction
    out: dict[int, list[tuple[int, float]]] = {}
    for a, b in edges:
        for frm, to in ((a, b), (b, a)):
            ang = math.atan2(nodes[to]["y"] - nodes[frm]["y"], nodes[to]["x"] - nodes[frm]["x"])
            out.setdefault(frm, []).append((to, ang))
    for arr in out.values():
        arr.sort(key=lambda e: e[1])

    def idx_of(frm: int, to: int) -> int:
        return next(i for i, e in enumerate(out[frm]) if e[0] == to)

    # 4. trace faces: for half-edge (u→v) the next edge is the one just clockwise
    #    of the reverse (v→u) around v.
    visited: set[tuple[int, int]] = set()
    result: list[list[Vec]] = []

    for a, b in edges:
        for s0, e0 in ((a, b), (b, a)):
            if (s0, e0) in visited:
                continue
            face: list[int] = []
            cf, ct, guard = s0, e0, 0
            while guard < 100000:
                guard += 1
                visited.add((cf, ct))
                face.append(cf)
                arr = out[ct]
                ri = idx_of(ct, cf)
                nxt = arr[(ri - 1) % len(arr)][0]
                cf, ct = ct, nxt
                if cf == s0 and ct == e0:
                    break
            if len(face) < 3:
                continue
            # Classify on the straight-chord winding (stable), but return the
            # outline tessellated so a curved wall contributes its true area.
            area = polygon_signed_area([nodes[i] for i in face])
            if area <= MIN_AREA:
                continue
            poly: list[Vec] = []
            for k, i in enumerate(face):
                j = face[(k + 1) % len(face)]
                poly.append(nodes[i])
                poly.extend(arc_between(i, j))
            poly.reverse()   # keep the clockwise winding downstream code expects
            result.append(poly)

    return result
