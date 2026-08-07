"""Reading stored plans through the generated schema.

The point of these is the first one: it is what stops the backend drifting away
from the editor's TypeScript again.
"""
from __future__ import annotations

import logging

import pytest

from app import plan
from app.plan_schema import Floor, Layer, Project, Room, Vec, Wall


def test_the_object_union_matches_the_generated_schema():
    # plan.Obj is written by hand because the generator inlines the union into
    # Floor.objects. Adding a kind to schema.ts and not to plan.py fails here.
    assert plan.Obj == plan.GENERATED_OBJ


def valid_plan() -> dict:
    return {
        "id": "p1",
        "name": "案子",
        "layers": [{"id": "walls", "name": "牆體", "visible": True,
                    "locked": False, "color": "#fff"}],
        "activeFloorId": "f1",
        "floors": [{
            "id": "f1", "name": "1F", "elevation": 0, "height": 280,
            "objects": [{"id": "w1", "kind": "wall", "layer": "walls",
                         "a": {"x": 0, "y": 0}, "b": {"x": 100, "y": 0},
                         "thickness": 12}],
        }],
    }


def test_load_plan_returns_a_typed_document():
    p = plan.load_plan(valid_plan(), project_id="p1")
    assert isinstance(p, Project)
    assert isinstance(p.floors[0].objects[0], Wall)


def test_load_plan_refuses_a_plan_it_cannot_read():
    # the shape every pre-floors save has: objects at the top level
    legacy = {"id": "p1", "name": "案子", "layers": [], "objects": []}
    with pytest.raises(plan.PlanFormatError):
        plan.load_plan(legacy, project_id="p1")


def test_a_newer_client_may_add_fields_we_do_not_know():
    data = valid_plan()
    data["floors"][0]["objects"][0]["someFutureField"] = 42
    p = plan.load_plan(data, project_id="p1")
    assert isinstance(p.floors[0].objects[0], Wall)


def test_check_stored_plan_logs_but_never_raises(caplog):
    with caplog.at_level(logging.WARNING, logger="interior.plan"):
        plan.check_stored_plan({"nonsense": True}, project_id="p9")
    assert "p9" in caplog.text
    assert "stored as-is" in caplog.text


def test_check_stored_plan_is_silent_on_a_good_plan(caplog):
    with caplog.at_level(logging.WARNING, logger="interior.plan"):
        plan.check_stored_plan(valid_plan(), project_id="p1")
    assert caplog.text == ""


def test_parse_objects_drops_what_it_cannot_read_and_keeps_the_rest(caplog):
    raw = [
        {"id": "w1", "kind": "wall", "layer": "walls",
         "a": {"x": 0, "y": 0}, "b": {"x": 100, "y": 0}, "thickness": 12},
        {"id": "x", "kind": "not-a-kind"},
        {"id": "r1", "kind": "room", "layer": "rooms",
         "x": 0, "y": 0, "w": 10, "h": 10, "name": "客廳"},
    ]
    with caplog.at_level(logging.INFO, logger="interior.plan"):
        objects = plan.parse_objects(raw, where="test")
    assert [type(o) for o in objects] == [Wall, Room]
    assert "ignored 1 object" in caplog.text


def test_parse_objects_is_silent_when_everything_parses(caplog):
    with caplog.at_level(logging.INFO, logger="interior.plan"):
        objects = plan.parse_objects(
            [{"id": "r1", "kind": "room", "layer": "rooms",
              "x": 0, "y": 0, "w": 10, "h": 10, "name": "客廳"}],
            where="test",
        )
    assert len(objects) == 1
    assert caplog.text == ""


def test_a_room_keeps_its_polygon_through_validation():
    p = Project(
        id="p", name="n", layers=[Layer(id="rooms", name="房間", visible=True,
                                        locked=False, color="#fff")],
        activeFloorId="f",
        floors=[Floor(id="f", name="1F", elevation=0, height=280, objects=[
            Room(id="r", kind="room", layer="rooms", x=0, y=0, w=1, h=1,
                 name="客廳", poly=[Vec(x=0, y=0), Vec(x=1, y=0), Vec(x=1, y=1)]),
        ])],
    )
    reloaded = plan.load_plan(p.model_dump(), project_id="p")
    room = reloaded.floors[0].objects[0]
    assert isinstance(room, Room)
    assert room.poly is not None and len(room.poly) == 3
