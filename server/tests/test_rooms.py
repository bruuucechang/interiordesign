"""Room detection.

Ported case-for-case from the TypeScript suite this replaced, so a behaviour
change during the move would show up rather than be discovered later in the
editor.
"""
from __future__ import annotations

from app.rooms import detect_room_polygons, polygon_signed_area


def area(poly) -> float:
    return abs(polygon_signed_area(poly))


def wall(wid: str, ax: float, ay: float, bx: float, by: float, bulge: float = 0):
    return {
        "id": wid, "kind": "wall", "layer": "walls",
        "a": {"x": ax, "y": ay}, "b": {"x": bx, "y": by},
        "thickness": 12, "bulge": bulge,
    }


def square(prefix: str, x: float, y: float, s: float):
    return [
        wall(prefix + "1", x, y, x + s, y),
        wall(prefix + "2", x + s, y, x + s, y + s),
        wall(prefix + "3", x + s, y + s, x, y + s),
        wall(prefix + "4", x, y + s, x, y),
    ]


def test_a_closed_square_yields_exactly_one_room():
    polys = detect_room_polygons(square("a", 0, 0, 400))
    assert len(polys) == 1
    assert abs(area(polys[0]) - 400 * 400) < 1


def test_an_open_loop_yields_no_room():
    walls = [wall("1", 0, 0, 400, 0), wall("2", 400, 0, 400, 400), wall("3", 400, 400, 0, 400)]
    assert detect_room_polygons(walls) == []


def test_two_separate_squares_yield_two_rooms():
    polys = detect_room_polygons(square("a", 0, 0, 300) + square("b", 1000, 0, 300))
    assert len(polys) == 2


def test_an_interior_divider_wall_yields_two_rooms():
    walls = [
        wall("t1", 0, 0, 200, 0), wall("t2", 200, 0, 400, 0),
        wall("b1", 0, 300, 200, 300), wall("b2", 200, 300, 400, 300),
        wall("l", 0, 0, 0, 300), wall("r", 400, 0, 400, 300),
        wall("m", 200, 0, 200, 300),   # divider
    ]
    polys = detect_room_polygons(walls)
    assert len(polys) == 2
    assert all(abs(area(p) - 200 * 300) < 1 for p in polys)


def test_nearly_touching_endpoints_still_close_the_loop():
    walls = [
        wall("1", 0, 0, 400, 0),
        wall("2", 400, 0, 400, 400),
        wall("3", 400, 400, 0, 400),
        wall("4", 0, 400, 1, 1),   # ends ~1.4 cm from the start, under the 2 cm merge epsilon
    ]
    assert len(detect_room_polygons(walls)) == 1


def test_slivers_below_the_minimum_area_are_ignored():
    assert detect_room_polygons(square("a", 0, 0, 30)) == []   # 900 cm² < 2500


def test_a_curved_wall_contributes_its_arc_area():
    s, bulge = 400, 60
    walls = [
        wall("a1", 0, 0, s, 0, bulge=bulge),
        wall("a2", s, 0, s, s), wall("a3", s, s, 0, s), wall("a4", 0, s, 0, 0),
    ]
    polys = detect_room_polygons(walls)
    assert len(polys) == 1
    got = area(polys[0])
    seg = (2 / 3) * s * bulge          # parabolic-segment area of the bulge
    assert abs(got - s * s) > 1000, f"area {got} should not equal the straight-chord area"
    assert abs(abs(got - s * s) - seg) < 250, f"arc area off: got {got}"


def test_walls_with_no_length_are_ignored():
    polys = detect_room_polygons(square("a", 0, 0, 400) + [wall("dot", 50, 50, 50, 50)])
    assert len(polys) == 1


def test_duplicate_walls_do_not_create_extra_rooms():
    walls = square("a", 0, 0, 400) + square("a_dup", 0, 0, 400)
    assert len(detect_room_polygons(walls)) == 1


def test_no_walls_returns_nothing():
    assert detect_room_polygons([]) == []
