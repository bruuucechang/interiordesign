"""DXF import.

Fixtures are drawn with ezdxf so the expected geometry is exact and readable
here, rather than depending on a binary sample nobody can inspect.
"""
from __future__ import annotations

import base64
import io
import math

import ezdxf
import pytest
from ezdxf import units as ezunits

from app.dxf import DxfError, convert, inspect


def as_b64(doc, data_url: bool = True) -> str:
    stream = io.StringIO()
    doc.write(stream)
    b64 = base64.b64encode(stream.getvalue().encode("utf-8")).decode()
    return f"data:image/vnd.dxf;base64,{b64}" if data_url else b64


def new_doc(insunits=ezunits.MM):
    doc = ezdxf.new("R2010", setup=True)
    doc.units = insunits
    return doc


def wall_len(w) -> float:
    return math.hypot(w["b"]["x"] - w["a"]["x"], w["b"]["y"] - w["a"]["y"])


# ---------------------------------------------------------------- inspect


def test_inspect_reports_layers_with_their_content():
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0), dxfattribs={"layer": "WALL"})
    msp.add_line((0, 0), (0, 3000), dxfattribs={"layer": "WALL"})
    msp.add_line((100, 100), (200, 100), dxfattribs={"layer": "DIM"})

    out = inspect(as_b64(doc))
    by_name = {layer["layer"]: layer for layer in out["layers"]}
    assert by_name["WALL"]["segments"] == 2
    assert abs(by_name["WALL"]["length"] - 8000) < 1
    assert by_name["DIM"]["segments"] == 1


def test_inspect_suggests_wall_layers_and_not_annotation_ones():
    doc = new_doc()
    msp = doc.modelspace()
    for layer in ("A-WALL", "牆體", "DIM-標註", "FURN", "HATCH"):
        msp.add_line((0, 0), (1000, 0), dxfattribs={"layer": layer})
    suggested = {layer["layer"]: layer["suggested"] for layer in inspect(as_b64(doc))["layers"]}
    assert suggested["A-WALL"] and suggested["牆體"]
    assert not suggested["DIM-標註"]
    assert not suggested["FURN"]
    assert not suggested["HATCH"]


def test_inspect_reads_the_declared_unit():
    doc = new_doc(ezunits.M)
    doc.modelspace().add_line((0, 0), (5, 0), dxfattribs={"layer": "WALL"})
    out = inspect(as_b64(doc))
    assert out["unit"] == "m"
    assert out["unitGuessed"] is False


def test_inspect_guesses_and_says_so_when_the_file_is_unitless():
    doc = new_doc(0)
    doc.modelspace().add_line((0, 0), (8000, 0), dxfattribs={"layer": "WALL"})
    out = inspect(as_b64(doc))
    assert out["unitGuessed"] is True
    assert out["unit"] == "mm"      # 8000 units across reads as millimetres


def test_garbage_is_rejected_clearly():
    with pytest.raises(DxfError):
        inspect("data:x;base64,!!!!")
    with pytest.raises(DxfError):
        inspect(base64.b64encode(b"this is not a dxf").decode())


# ---------------------------------------------------------------- convert


def test_a_single_line_becomes_one_wall_in_centimetres():
    doc = new_doc(ezunits.MM)
    doc.modelspace().add_line((0, 0), (5000, 0), dxfattribs={"layer": "WALL"})
    walls = convert(as_b64(doc), ["WALL"], "mm")["walls"]
    assert len(walls) == 1
    assert abs(wall_len(walls[0]) - 500) < 0.1     # 5000 mm = 500 cm


def test_only_the_chosen_layers_are_imported():
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0), dxfattribs={"layer": "WALL"})
    msp.add_line((0, 1000), (5000, 1000), dxfattribs={"layer": "DIM"})
    walls = convert(as_b64(doc), ["WALL"], "mm")["walls"]
    assert len(walls) == 1


def test_two_parallel_faces_become_one_wall_with_the_measured_thickness():
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0), dxfattribs={"layer": "WALL"})
    msp.add_line((0, 150), (5000, 150), dxfattribs={"layer": "WALL"})   # 150 mm apart
    out = convert(as_b64(doc), ["WALL"], "mm")
    assert out["merged"] == 1
    assert len(out["walls"]) == 1
    assert abs(out["walls"][0]["thickness"] - 15) < 0.2                 # 150 mm = 15 cm


def test_a_lone_line_keeps_the_default_thickness():
    doc = new_doc()
    doc.modelspace().add_line((0, 0), (5000, 0), dxfattribs={"layer": "WALL"})
    assert convert(as_b64(doc), ["WALL"], "mm")["walls"][0]["thickness"] == 12


def test_parallel_lines_too_far_apart_are_not_one_wall():
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0), dxfattribs={"layer": "WALL"})
    msp.add_line((0, 4000), (5000, 4000), dxfattribs={"layer": "WALL"})   # 4 m apart
    out = convert(as_b64(doc), ["WALL"], "mm")
    assert out["merged"] == 0
    assert len(out["walls"]) == 2


def test_the_y_axis_is_flipped_because_dxf_is_y_up():
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_line((0, 0), (1000, 0), dxfattribs={"layer": "WALL"})       # bottom in DXF
    msp.add_line((0, 3000), (1000, 3000), dxfattribs={"layer": "WALL"})  # top in DXF
    walls = sorted(convert(as_b64(doc), ["WALL"], "mm")["walls"], key=lambda w: w["a"]["y"])
    # the DXF top edge must come out at the smaller editor y
    assert walls[0]["a"]["y"] == 0      # was y=3000 in DXF
    assert abs(walls[1]["a"]["y"] - 300) < 0.1


def test_the_drawing_is_shifted_to_the_origin():
    doc = new_doc()
    doc.modelspace().add_line((250000, 130000), (255000, 130000), dxfattribs={"layer": "WALL"})
    walls = convert(as_b64(doc), ["WALL"], "mm")["walls"]
    assert walls[0]["a"]["x"] == 0 and walls[0]["a"]["y"] == 0


def test_a_closed_polyline_becomes_four_walls():
    doc = new_doc()
    doc.modelspace().add_lwpolyline(
        [(0, 0), (6000, 0), (6000, 4000), (0, 4000)],
        close=True, dxfattribs={"layer": "WALL"},
    )
    walls = convert(as_b64(doc), ["WALL"], "mm")["walls"]
    assert len(walls) == 4


def test_an_arc_becomes_a_curved_wall():
    doc = new_doc()
    doc.modelspace().add_arc((0, 0), radius=2000, start_angle=0, end_angle=90,
                             dxfattribs={"layer": "WALL"})
    walls = convert(as_b64(doc), ["WALL"], "mm")["walls"]
    assert len(walls) == 1
    assert "bulge" in walls[0], "the curve must survive as a curved wall"
    assert abs(walls[0]["bulge"]) > 1


def test_a_polyline_bulge_becomes_a_curved_wall():
    doc = new_doc()
    doc.modelspace().add_lwpolyline(
        [(0, 0, 0.5), (4000, 0, 0)], format="xyb", dxfattribs={"layer": "WALL"},
    )
    walls = convert(as_b64(doc), ["WALL"], "mm")["walls"]
    assert "bulge" in walls[0]


def test_the_unit_override_wins_over_the_file_header():
    doc = new_doc(ezunits.MM)
    doc.modelspace().add_line((0, 0), (500, 0), dxfattribs={"layer": "WALL"})
    as_mm = convert(as_b64(doc), ["WALL"], "mm")["walls"][0]
    as_cm = convert(as_b64(doc), ["WALL"], "cm")["walls"][0]
    assert abs(wall_len(as_mm) - 50) < 0.1
    assert abs(wall_len(as_cm) - 500) < 0.1


def test_text_and_dimensions_are_not_turned_into_walls():
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0), dxfattribs={"layer": "WALL"})
    msp.add_text("客廳", dxfattribs={"layer": "WALL"}).set_placement((100, 100))
    msp.add_circle((2000, 1000), 300, dxfattribs={"layer": "WALL"})
    assert len(convert(as_b64(doc), ["WALL"], "mm")["walls"]) == 1


def test_an_empty_selection_imports_nothing():
    doc = new_doc()
    doc.modelspace().add_line((0, 0), (5000, 0), dxfattribs={"layer": "WALL"})
    assert convert(as_b64(doc), [], "mm")["walls"] == []
