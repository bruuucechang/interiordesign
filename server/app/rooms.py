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


def detect_room_polygons(walls: Iterable[dict[str, Any]]) -> list[list[Vec]]:
    """Every region enclosed by the walls, as a polygon of wall-centreline points."""
    walls = list(walls)

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
