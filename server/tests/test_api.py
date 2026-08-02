"""The CRUD contract the client depends on.

These shapes are not incidental — client/src/net/api.ts reads exactly these
keys, and the Express backend this replaced produced them, so a change here
silently breaks the editor.
"""
from __future__ import annotations

PLAN = {
    "id": "proj_x",
    "name": "測試平面圖",
    "activeFloorId": "f1",
    "layers": [],
    "floors": [
        {
            "id": "f1", "name": "1F", "elevation": 0, "height": 280,
            "objects": [
                {"id": "w1", "kind": "wall", "layer": "walls",
                 "a": {"x": 0, "y": 0}, "b": {"x": 400, "y": 0},
                 "thickness": 12, "bulge": 0},
            ],
        }
    ],
}


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_list_is_empty_to_start(client):
    assert client.get("/api/projects").json() == {"projects": []}


def test_put_then_get_round_trips_the_plan_unchanged(client):
    r = client.put("/api/projects/proj_x", json={"name": "測試平面圖", "data": PLAN})
    assert r.status_code == 200
    assert r.json() == {"id": "proj_x", "name": "測試平面圖"}

    got = client.get("/api/projects/proj_x").json()
    assert got["id"] == "proj_x"
    assert got["name"] == "測試平面圖"
    assert got["data"] == PLAN            # JSONB must not reorder or coerce anything
    assert got["updatedAt"]


def test_list_returns_id_name_updatedAt(client):
    client.put("/api/projects/a", json={"name": "A", "data": PLAN})
    rows = client.get("/api/projects").json()["projects"]
    assert len(rows) == 1
    assert set(rows[0]) == {"id", "name", "updatedAt"}   # no data blob in the list


def test_list_is_newest_first(client):
    client.put("/api/projects/old", json={"name": "old", "data": PLAN})
    client.put("/api/projects/new", json={"name": "new", "data": PLAN})
    ids = [r["id"] for r in client.get("/api/projects").json()["projects"]]
    assert ids[0] == "new"


def test_put_twice_updates_rather_than_duplicating(client):
    client.put("/api/projects/a", json={"name": "第一版", "data": PLAN})
    client.put("/api/projects/a", json={"name": "第二版", "data": PLAN})
    rows = client.get("/api/projects").json()["projects"]
    assert len(rows) == 1
    assert rows[0]["name"] == "第二版"


def test_missing_project_is_404(client):
    assert client.get("/api/projects/nope").status_code == 404


def test_delete_removes_it_and_is_forgiving_of_repeats(client):
    client.put("/api/projects/a", json={"name": "A", "data": PLAN})
    assert client.delete("/api/projects/a").json() == {"ok": True}
    assert client.get("/api/projects/a").status_code == 404
    # the client fires delete without checking existence first
    assert client.delete("/api/projects/a").json() == {"ok": True}


def test_a_blank_name_is_rejected(client):
    r = client.put("/api/projects/a", json={"name": "", "data": PLAN})
    assert r.status_code == 422


def test_missing_data_is_rejected(client):
    assert client.put("/api/projects/a", json={"name": "A"}).status_code == 422


def test_a_plan_with_no_objects_is_still_valid(client):
    empty = {**PLAN, "floors": [{**PLAN["floors"][0], "objects": []}]}
    client.put("/api/projects/a", json={"name": "空白", "data": empty})
    assert client.get("/api/projects/a").json()["data"]["floors"][0]["objects"] == []


def test_unicode_names_survive(client):
    client.put("/api/projects/a", json={"name": "客廳・2F 平面圖", "data": PLAN})
    assert client.get("/api/projects/a").json()["name"] == "客廳・2F 平面圖"


# ---- compute endpoints ----

SQUARE = [
    {"a": {"x": 0, "y": 0},     "b": {"x": 400, "y": 0}},
    {"a": {"x": 400, "y": 0},   "b": {"x": 400, "y": 400}},
    {"a": {"x": 400, "y": 400}, "b": {"x": 0, "y": 400}},
    {"a": {"x": 0, "y": 400},   "b": {"x": 0, "y": 0}},
]


def test_rooms_detect_finds_the_enclosed_square(client):
    r = client.post("/api/rooms/detect", json={"walls": SQUARE})
    assert r.status_code == 200
    polys = r.json()["polygons"]
    assert len(polys) == 1
    assert {"x", "y"} == set(polys[0][0])


def test_rooms_detect_on_an_open_loop_returns_nothing(client):
    r = client.post("/api/rooms/detect", json={"walls": SQUARE[:3]})
    assert r.json()["polygons"] == []


def test_rooms_detect_accepts_no_walls(client):
    assert client.post("/api/rooms/detect", json={"walls": []}).json()["polygons"] == []


def test_rooms_detect_defaults_bulge_when_absent(client):
    # the client omits bulge on straight walls
    assert len(client.post("/api/rooms/detect", json={"walls": SQUARE}).json()["polygons"]) == 1
