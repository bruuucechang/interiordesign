"""The CRUD contract the client depends on.

These shapes are not incidental — client/src/net/api.ts reads exactly these
keys, and the Express backend this replaced produced them, so a change here
silently breaks the editor.
"""
from __future__ import annotations

PLAN = {
    # schemaVersion is required: the client stamps every plan it saves, and the
    # backfill script put it on the ones stored before it existed.
    "schemaVersion": 1,
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
    assert r.json()["id"] == "proj_x"
    assert r.json()["name"] == "測試平面圖"

    got = client.get("/api/projects/proj_x").json()
    assert got["id"] == "proj_x"
    assert got["name"] == "測試平面圖"
    assert got["data"] == PLAN            # JSONB must not reorder or coerce anything
    assert got["updatedAt"]


def test_list_returns_id_name_updatedAt(client):
    client.put("/api/projects/a", json={"name": "A", "data": PLAN})
    rows = client.get("/api/projects").json()["projects"]
    assert len(rows) == 1
    assert set(rows[0]) == {"id", "name", "updatedAt", "updatedAtIso"}   # no data blob


def test_timestamps_come_in_both_a_readable_and_a_comparable_form(client):
    # updatedAt is whatever zone the database hands back, unmarked — fine to
    # show, useless to compare. The offline mirror compares, so it reads
    # updatedAtIso, which is the same instant spelled out in UTC.
    from datetime import datetime, timezone

    body = client.put("/api/projects/a", json={"name": "甲", "data": PLAN}).json()
    for source in (body, client.get("/api/projects/a").json(),
                   client.get("/api/projects").json()["projects"][0]):
        iso = source["updatedAtIso"]
        parsed = datetime.fromisoformat(iso)
        assert parsed.tzinfo is not None, iso
        assert parsed.utcoffset().total_seconds() == 0, iso
        assert abs((datetime.now(timezone.utc) - parsed).total_seconds()) < 60
        assert len(source["updatedAt"]) == len("YYYY-MM-DD HH:MM:SS")


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


def test_delete_hides_it_and_is_forgiving_of_repeats(client):
    client.put("/api/projects/a", json={"name": "A", "data": PLAN})
    assert client.delete("/api/projects/a").json() == {"ok": True}
    assert client.get("/api/projects/a").status_code == 404
    assert [p["id"] for p in client.get("/api/projects").json()["projects"]] == []
    # the client fires delete without checking existence first
    assert client.delete("/api/projects/a").json() == {"ok": True}


def test_a_deleted_plan_is_in_the_bin_not_gone(client):
    """Deletion is recoverable. A plan is hours of work and the only copy."""
    client.put("/api/projects/a", json={"name": "A", "data": PLAN})
    client.delete("/api/projects/a")
    binned = client.get("/api/projects-deleted").json()["projects"]
    assert [p["id"] for p in binned] == ["a"]
    assert binned[0]["deletedAtIso"], "要說得出什麼時候刪的，使用者才知道還剩多久"


def test_restore_brings_it_back_with_its_data(client):
    client.put("/api/projects/a", json={"name": "A", "data": PLAN})
    client.delete("/api/projects/a")
    assert client.post("/api/projects/a/restore").json() == {"ok": True}
    assert client.get("/api/projects/a").status_code == 200
    assert client.get("/api/projects/a").json()["data"] == PLAN
    assert [p["id"] for p in client.get("/api/projects").json()["projects"]] == ["a"]
    assert client.get("/api/projects-deleted").json()["projects"] == []


def test_restoring_something_that_is_not_in_the_bin_is_a_404(client):
    client.put("/api/projects/a", json={"name": "A", "data": PLAN})
    assert client.post("/api/projects/a/restore").status_code == 404
    assert client.post("/api/projects/nope/restore").status_code == 404


def test_a_deleted_plan_does_not_come_back_through_the_open_list(client):
    """The list defaults to live. Forgetting the filter would put deleted plans
    back in the open dialog, where opening and editing one resurrects it."""
    client.put("/api/projects/a", json={"name": "A", "data": PLAN})
    client.put("/api/projects/b", json={"name": "B", "data": PLAN})
    client.delete("/api/projects/a")
    assert [p["id"] for p in client.get("/api/projects").json()["projects"]] == ["b"]


def test_purge_only_takes_what_is_past_the_grace_period(client):
    """The bin is a grace period, not a second archive — but it must not eat
    something deleted this morning."""
    from datetime import datetime, timedelta, timezone

    from app import db as store

    client.put("/api/projects/old", json={"name": "old", "data": PLAN})
    client.put("/api/projects/new", json={"name": "new", "data": PLAN})
    client.delete("/api/projects/old")
    client.delete("/api/projects/new")
    with store.SessionLocal() as db:
        row = db.get(store.Floorplan, "old")
        row.deleted_at = datetime.now(timezone.utc) - timedelta(days=store.PURGE_AFTER_DAYS + 1)
        db.commit()
        assert store.purge_deleted(db) == 1
    assert [p["id"] for p in client.get("/api/projects-deleted").json()["projects"]] == ["new"]


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


def test_report_endpoint_summarises_the_saved_plan(client):
    client.put("/api/projects/a", json={"name": "報表測試", "data": PLAN})
    r = client.get("/api/projects/a/report")
    assert r.status_code == 200
    body = r.json()
    assert body["project"] == "報表測試"
    assert body["floors"][0]["counts"]["wall"] == 1


def test_a_plan_the_schema_cannot_read_is_still_saved(client):
    # The client owns the schema and may run ahead of us; refusing the write
    # would lose work the user can see on screen.
    legacy = {"id": "proj_old", "name": "舊檔", "layers": [], "objects": []}
    assert client.put("/api/projects/old", json={"name": "舊檔", "data": legacy}).status_code == 200
    assert client.get("/api/projects/old").json()["data"] == legacy


def test_a_report_on_an_unreadable_plan_says_so_instead_of_coming_back_empty(client):
    # Regression: pre-floors saves used to produce a report with no rooms and
    # no error — indistinguishable from a plan that genuinely has none.
    legacy = {"id": "proj_old", "name": "舊檔", "layers": [], "objects": []}
    client.put("/api/projects/old", json={"name": "舊檔", "data": legacy})
    assert client.get("/api/projects/old/report").status_code == 422
    assert client.get("/api/projects/old/report.xlsx").status_code == 422


def test_report_endpoint_404s_for_a_missing_project(client):
    assert client.get("/api/projects/nope/report").status_code == 404
    assert client.get("/api/projects/nope/report.xlsx").status_code == 404


def test_xlsx_endpoint_returns_a_spreadsheet_attachment(client):
    client.put("/api/projects/a", json={"name": "報表測試", "data": PLAN})
    r = client.get("/api/projects/a/report.xlsx")
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers["content-type"]
    assert "attachment" in r.headers["content-disposition"]
    assert r.content[:2] == b"PK"        # xlsx is a zip


# ---- DXF import ----

def _dxf_b64() -> str:
    import base64, io, ezdxf
    from ezdxf import units
    doc = ezdxf.new("R2010", setup=True)
    doc.units = units.MM
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (6000, 0), (6000, 4000), (0, 4000)],
                       close=True, dxfattribs={"layer": "WALL"})
    msp.add_line((0, 0), (100, 0), dxfattribs={"layer": "DIM"})
    stream = io.StringIO(); doc.write(stream)
    return "data:image/vnd.dxf;base64," + base64.b64encode(stream.getvalue().encode()).decode()


def test_dxf_inspect_lists_layers(client):
    r = client.post("/api/dxf/inspect", json={"file": _dxf_b64()})
    assert r.status_code == 200
    names = {layer["layer"] for layer in r.json()["layers"]}
    assert {"WALL", "DIM"} <= names
    assert r.json()["unit"] == "mm"


def test_dxf_import_returns_walls_for_the_chosen_layers(client):
    r = client.post("/api/dxf/import",
                    json={"file": _dxf_b64(), "layers": ["WALL"], "unit": "mm"})
    assert r.status_code == 200
    walls = r.json()["walls"]
    assert len(walls) == 4
    assert all({"a", "b", "thickness"} <= set(w) for w in walls)


def test_dxf_endpoints_reject_a_non_dxf(client):
    import base64
    bad = base64.b64encode(b"not a dxf").decode()
    assert client.post("/api/dxf/inspect", json={"file": bad}).status_code == 400
    assert client.post("/api/dxf/import", json={"file": bad}).status_code == 400


# ---- dimension chains ----
#
# `objects` carries the floor's real contents — the client sends doc.objects —
# so these fixtures are whole plan objects, not bare segments. Anything the
# schema cannot read is dropped before the geometry runs.

def a_wall(oid, ax, ay, bx, by):
    return {"id": oid, "kind": "wall", "layer": "walls", "thickness": 12,
            "a": {"x": ax, "y": ay}, "b": {"x": bx, "y": by}}


def test_dimension_chain_breaks_at_an_opening(client):
    w = {"a": {"x": 0, "y": 0}, "b": {"x": 500, "y": 0}}
    objs = [a_wall("w1", 0, 0, 500, 0),
            {"id": "d1", "kind": "door", "layer": "openings",
             "x": 250, "y": 0, "width": 90, "angle": 0}]
    r = client.post("/api/dimensions/chain", json={"wall": w, "objects": objs, "offset": 60})
    assert r.status_code == 200
    dims = r.json()["dimensions"]
    assert len(dims) == 3
    assert all(d["offset"] == 60 for d in dims)


def test_dimension_chain_picks_a_side_when_none_is_given(client):
    w = {"a": {"x": 0, "y": 0}, "b": {"x": 600, "y": 0}}
    room = [a_wall("t", 0, 0, 600, 0), a_wall("r", 600, 0, 600, 400),
            a_wall("b", 600, 400, 0, 400), a_wall("l", 0, 400, 0, 0)]
    dims = client.post("/api/dimensions/chain", json={"wall": w, "objects": room}).json()["dimensions"]
    assert dims and dims[0]["offset"] != 0


def test_dimension_chain_ignores_objects_it_cannot_read(client):
    w = {"a": {"x": 0, "y": 0}, "b": {"x": 500, "y": 0}}
    objs = [a_wall("w1", 0, 0, 500, 0), {"id": "?", "kind": "not-a-kind"}]
    r = client.post("/api/dimensions/chain", json={"wall": w, "objects": objs})
    assert r.status_code == 200
    assert len(r.json()["dimensions"]) == 1
