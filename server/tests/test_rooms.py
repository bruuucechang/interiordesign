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


# ---------------------------------------------------------------- T 型接點

def test_a_partition_ending_mid_wall_divides_the_room():
    """房間偵測的節點是從牆端點來的，所以端點停在別道牆中段的隔間牆
    原本會變成懸空的邊——它分隔的兩個房間會合成一個回來。

    實測：不切 22.81 m² 一個；切開後 13.58 + 9.23，總和不變。
    """
    walls = [
        {"a": {"x": 6, "y": 394}, "b": {"x": 594, "y": 394}, "bulge": 0},
        {"a": {"x": 594, "y": 394}, "b": {"x": 594, "y": 6}, "bulge": 0},
        {"a": {"x": 594, "y": 6}, "b": {"x": 6, "y": 6}, "bulge": 0},
        {"a": {"x": 6, "y": 6}, "b": {"x": 6, "y": 394}, "bulge": 0},
        {"a": {"x": 356, "y": 394}, "b": {"x": 356, "y": 6}, "bulge": 0},
    ]
    polys = detect_room_polygons(walls)
    areas = sorted(abs(polygon_signed_area(p)) / 10000 for p in polys)
    assert len(polys) == 2
    assert abs(areas[0] - 9.23) < 0.05
    assert abs(areas[1] - 13.58) < 0.05
    assert abs(sum(areas) - 22.81) < 0.05, "切開不該改變總面積"


def test_a_wall_that_stops_short_is_still_a_dangling_edge():
    """只有真的碰到才切。差太遠的端點不該被當成接點——那會無中生有。"""
    walls = [
        {"a": {"x": 6, "y": 394}, "b": {"x": 594, "y": 394}, "bulge": 0},
        {"a": {"x": 594, "y": 394}, "b": {"x": 594, "y": 6}, "bulge": 0},
        {"a": {"x": 594, "y": 6}, "b": {"x": 6, "y": 6}, "bulge": 0},
        {"a": {"x": 6, "y": 6}, "b": {"x": 6, "y": 394}, "bulge": 0},
        # 兩端各差 50cm，遠超過 MERGE_EPS
        {"a": {"x": 356, "y": 344}, "b": {"x": 356, "y": 56}, "bulge": 0},
    ]
    assert len(detect_room_polygons(walls)) == 1


def test_splitting_leaves_a_plain_rectangle_alone():
    """沒有接點時不該多切出任何東西。"""
    walls = [
        {"a": {"x": 0, "y": 0}, "b": {"x": 400, "y": 0}, "bulge": 0},
        {"a": {"x": 400, "y": 0}, "b": {"x": 400, "y": 300}, "bulge": 0},
        {"a": {"x": 400, "y": 300}, "b": {"x": 0, "y": 300}, "bulge": 0},
        {"a": {"x": 0, "y": 300}, "b": {"x": 0, "y": 0}, "bulge": 0},
    ]
    polys = detect_room_polygons(walls)
    assert len(polys) == 1
    assert abs(abs(polygon_signed_area(polys[0])) / 10000 - 12) < 1e-6


def test_a_curved_wall_is_never_cut():
    """切弧要重算子弧的 bulge，而實務上沒有隔間牆是弧形的。"""
    walls = [
        {"a": {"x": 0, "y": 0}, "b": {"x": 400, "y": 0}, "bulge": 40},
        {"a": {"x": 400, "y": 0}, "b": {"x": 400, "y": 300}, "bulge": 0},
        {"a": {"x": 400, "y": 300}, "b": {"x": 0, "y": 300}, "bulge": 0},
        {"a": {"x": 0, "y": 300}, "b": {"x": 0, "y": 0}, "bulge": 0},
        {"a": {"x": 200, "y": 0}, "b": {"x": 200, "y": 300}, "bulge": 0},
    ]
    detect_room_polygons(walls)   # 不該拋例外
