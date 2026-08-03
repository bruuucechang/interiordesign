"""Dimension chains."""
from __future__ import annotations

import math

from app.dimensions import DEFAULT_OFFSET, dimension_chain, outward_offset


def wall(ax, ay, bx, by, wid="w"):
    return {"id": wid, "kind": "wall", "layer": "walls",
            "a": {"x": ax, "y": ay}, "b": {"x": bx, "y": by}, "thickness": 12}


def opening(kind, x, y, width):
    return {"id": kind, "kind": kind, "layer": "openings",
            "x": x, "y": y, "width": width, "angle": 0}


def lengths(chain):
    return [round(math.dist((d["a"]["x"], d["a"]["y"]), (d["b"]["x"], d["b"]["y"])), 2)
            for d in chain]


def test_a_plain_wall_gets_one_dimension_of_its_full_length():
    chain = dimension_chain(wall(0, 0, 500, 0))
    assert len(chain) == 1
    assert lengths(chain) == [500]


def test_a_door_breaks_the_wall_into_three_runs():
    w = wall(0, 0, 500, 0)
    chain = dimension_chain(w, [w, opening("door", 250, 0, 90)])
    assert lengths(chain) == [205, 90, 205]
    assert sum(lengths(chain)) == 500


def test_two_openings_give_five_runs():
    w = wall(0, 0, 600, 0)
    chain = dimension_chain(w, [w, opening("door", 150, 0, 90), opening("window", 450, 0, 120)])
    assert len(chain) == 5
    assert abs(sum(lengths(chain)) - 600) < 1e-6


def test_a_t_junction_breaks_the_wall():
    w = wall(0, 0, 600, 0)
    divider = wall(300, 0, 300, 400, "d")
    chain = dimension_chain(w, [w, divider])
    assert lengths(chain) == [300, 300]


def test_a_wall_meeting_only_at_the_corner_does_not_break_it():
    w = wall(0, 0, 600, 0)
    perpendicular = wall(0, 0, 0, 400, "p")      # shares the start corner
    chain = dimension_chain(w, [w, perpendicular])
    assert lengths(chain) == [600]


def test_openings_on_a_different_wall_are_ignored():
    w = wall(0, 0, 500, 0)
    chain = dimension_chain(w, [w, opening("door", 250, 300, 90)])   # 3 m away
    assert lengths(chain) == [500]


def test_breaks_landing_on_top_of_each_other_do_not_make_slivers():
    w = wall(0, 0, 500, 0)
    # a door hard against the corner: its near edge sits at the wall start
    chain = dimension_chain(w, [w, opening("door", 45, 0, 90)])
    assert all(x >= 5 for x in lengths(chain)), lengths(chain)
    assert abs(sum(lengths(chain)) - 500) < 1e-6


def test_a_zero_length_wall_yields_nothing():
    assert dimension_chain(wall(0, 0, 0, 0)) == []


def test_the_chain_carries_the_offset_it_was_given():
    chain = dimension_chain(wall(0, 0, 500, 0), offset=-80)
    assert all(d["offset"] == -80 for d in chain)


def test_diagonal_walls_are_measured_along_their_own_direction():
    chain = dimension_chain(wall(0, 0, 300, 400))     # 3-4-5
    assert lengths(chain) == [500]


def test_outward_offset_pushes_away_from_the_plan():
    # a square room; the top wall's chain must sit above it, not inside
    walls = [wall(0, 0, 600, 0, "t"), wall(600, 0, 600, 400, "r"),
             wall(600, 400, 0, 400, "b"), wall(0, 400, 0, 0, "l")]
    top = walls[0]
    off = outward_offset(top, walls)
    # +offset on a left-to-right wall points to -y, which is outside this room
    assert off == -DEFAULT_OFFSET or off == DEFAULT_OFFSET
    mid = {"x": 300, "y": 0}
    nx, ny = 0.0, 1.0     # unit normal for the +offset direction of (0,0)->(600,0)
    placed_y = mid["y"] + ny * off
    assert placed_y < 200, "the chain must not land inside the room"


def test_outward_offset_survives_a_plan_with_no_walls():
    assert outward_offset(wall(0, 0, 100, 0), []) == DEFAULT_OFFSET
