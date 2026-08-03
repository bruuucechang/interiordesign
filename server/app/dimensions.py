"""Dimension chains.

An architectural plan dimensions a wall as a run of consecutive measurements —
corner to opening, across the opening, opening to the next junction — not as one
figure for the whole wall. Placing those by hand, one at a time, is exactly the
tedium the drawing tools are supposed to remove.

Pure geometry, so it lives here with tests rather than in the editor's hot path.
"""
from __future__ import annotations

import math
from typing import Any, Iterable

Vec = dict[str, float]

ON_WALL_TOL = 12.0     # cm — how far off the line a junction or opening may sit
MIN_SEGMENT = 5.0      # cm — shorter runs are noise, not a dimension
DEFAULT_OFFSET = 60.0  # cm — how far the dimension line stands off the wall


def _sub(a: Vec, b: Vec) -> tuple[float, float]:
    return a["x"] - b["x"], a["y"] - b["y"]


def _project(p: Vec, a: Vec, b: Vec) -> tuple[float, float]:
    """Parameter along a→b and perpendicular distance, for a point p."""
    dx, dy = _sub(b, a)
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return 0.0, math.dist((p["x"], p["y"]), (a["x"], a["y"]))
    t = ((p["x"] - a["x"]) * dx + (p["y"] - a["y"]) * dy) / L2
    px, py = a["x"] + dx * t, a["y"] + dy * t
    return t, math.dist((p["x"], p["y"]), (px, py))


def _at(a: Vec, b: Vec, t: float) -> Vec:
    dx, dy = _sub(b, a)
    return {"x": a["x"] + dx * t, "y": a["y"] + dy * t}


def _breaks_from_openings(wall: dict, openings: Iterable[dict], length: float) -> list[float]:
    """Both edges of every door or window sitting on this wall."""
    out: list[float] = []
    for o in openings:
        centre = {"x": float(o["x"]), "y": float(o["y"])}
        t, dist = _project(centre, wall["a"], wall["b"])
        if dist > ON_WALL_TOL or not (0 <= t <= 1):
            continue
        half = float(o.get("width", 0)) / 2
        for edge in (t - half / length, t + half / length):
            if 0 < edge < 1:
                out.append(edge)
    return out


def _breaks_from_junctions(wall: dict, walls: Iterable[dict]) -> list[float]:
    """Where another wall's end lands on this one — a T-junction."""
    out: list[float] = []
    for w in walls:
        if w is wall:
            continue
        for end in (w["a"], w["b"]):
            t, dist = _project(end, wall["a"], wall["b"])
            if dist <= ON_WALL_TOL and 0 < t < 1:
                out.append(t)
    return out


def dimension_chain(
    wall: dict[str, Any],
    objects: Iterable[dict[str, Any]] = (),
    offset: float = DEFAULT_OFFSET,
) -> list[dict[str, Any]]:
    """One dimension per run along `wall`, broken at openings and junctions.

    `offset` is signed; the caller decides which side of the wall the chain
    stands on. Returns dimension objects in the editor's own shape.
    """
    a, b = wall["a"], wall["b"]
    length = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
    if length < MIN_SEGMENT:
        return []

    objects = list(objects)
    openings = [o for o in objects if o.get("kind") in ("door", "window")]
    walls = [o for o in objects if o.get("kind") == "wall"]

    ts = [0.0, 1.0]
    ts += _breaks_from_openings(wall, openings, length)
    ts += _breaks_from_junctions(wall, walls)

    # Collapse breaks that land on top of each other; a door meeting a corner
    # would otherwise leave a 1 mm dimension between them.
    ts.sort()
    keep: list[float] = []
    for t in ts:
        if not keep or (t - keep[-1]) * length >= MIN_SEGMENT:
            keep.append(t)
    if keep[-1] < 1.0:
        if (1.0 - keep[-1]) * length >= MIN_SEGMENT:
            keep.append(1.0)
        else:
            keep[-1] = 1.0

    return [
        {"a": _at(a, b, t0), "b": _at(a, b, t1), "offset": offset}
        for t0, t1 in zip(keep, keep[1:])
    ]


def outward_offset(wall: dict[str, Any], objects: Iterable[dict[str, Any]],
                   distance: float = DEFAULT_OFFSET) -> float:
    """Signed offset that puts the chain on the outside of the plan.

    Dimensions belong outside the building, not across the room they measure,
    so the sign is chosen by pushing away from the centre of everything drawn.
    """
    pts: list[tuple[float, float]] = []
    for o in objects:
        if o.get("kind") == "wall":
            pts += [(o["a"]["x"], o["a"]["y"]), (o["b"]["x"], o["b"]["y"])]
    if not pts:
        return distance

    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)

    a, b = wall["a"], wall["b"]
    dx, dy = _sub(b, a)
    L = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / L, dx / L                       # the +offset direction
    mid_x, mid_y = (a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2
    # positive when the normal already points away from the centre
    away = (mid_x - cx) * nx + (mid_y - cy) * ny
    return distance if away >= 0 else -distance
