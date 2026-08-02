"""Wall tracing from an image.

Tests draw their own plans with OpenCV so the expected geometry is known
exactly, rather than asserting against a fixture nobody can check by eye.
"""
from __future__ import annotations

import base64
import math

import cv2
import numpy as np
import pytest

from app.detect import DecodeError, decode_image, detect_walls


def png_b64(img: np.ndarray, as_data_url: bool = True) -> str:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    b64 = base64.b64encode(buf.tobytes()).decode()
    return f"data:image/png;base64,{b64}" if as_data_url else b64


def blank(w: int = 600, h: int = 400) -> np.ndarray:
    return np.full((h, w, 3), 255, np.uint8)


def seg_len(s) -> float:
    return math.hypot(s[1]["x"] - s[0]["x"], s[1]["y"] - s[0]["y"])


def seg_angle(s) -> float:
    return math.degrees(math.atan2(s[1]["y"] - s[0]["y"], s[1]["x"] - s[0]["x"])) % 180.0


def test_a_drawn_rectangle_yields_four_walls():
    img = blank()
    cv2.rectangle(img, (80, 60), (520, 340), (0, 0, 0), 4)
    out = detect_walls(png_b64(img))
    assert out["w"] == 600 and out["h"] == 400
    assert len(out["segments"]) == 4, f"got {len(out['segments'])}"
    angles = sorted(round(seg_angle(s)) % 180 for s in out["segments"])
    # two horizontals near 0/180 and two verticals near 90
    assert sum(1 for a in angles if a < 5 or a > 175) == 2
    assert sum(1 for a in angles if 85 < a < 95) == 2


def test_a_walls_two_drawn_faces_become_one_centreline():
    img = blank()
    # a 12 px thick wall drawn as two parallel lines
    cv2.line(img, (60, 200), (540, 200), (0, 0, 0), 2)
    cv2.line(img, (60, 212), (540, 212), (0, 0, 0), 2)
    out = detect_walls(png_b64(img))
    assert len(out["segments"]) == 1
    y = (out["segments"][0][0]["y"] + out["segments"][0][1]["y"]) / 2
    assert 200 <= y <= 212, f"centreline at {y} should sit between the faces"


def test_a_diagonal_wall_is_found():
    # the scanline detector this replaced could only see axis-aligned ink
    img = blank()
    cv2.line(img, (80, 320), (520, 80), (0, 0, 0), 4)
    out = detect_walls(png_b64(img))
    assert len(out["segments"]) == 1
    assert 140 < seg_angle(out["segments"][0]) < 160


def test_a_wall_is_found_despite_surrounding_lettering():
    """Lettering is not fully rejected — it is kept small and secondary.

    A row of characters leaves collinear ink along its baseline, and no
    threshold separates that from a genuinely short wall. Rather than tune
    constants until one synthetic image passes, the detector is best-effort and
    the user reviews the traced walls. What must hold is that the real wall is
    found and that any lettering strays stay clearly shorter than it.
    """
    img = blank()
    cv2.line(img, (100, 100), (515, 100), (0, 0, 0), 4)   # the wall
    cv2.putText(img, "4.20 m", (240, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(img, "客廳 LIVING", (150, 320), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    out = detect_walls(png_b64(img))

    lengths = sorted((seg_len(s) for s in out["segments"]), reverse=True)
    assert lengths[0] > 380, "the wall itself must be traced"
    assert all(x < lengths[0] * 0.5 for x in lengths[1:]), \
        f"lettering produced a wall-sized stray: {lengths}"


def test_a_dashed_wall_comes_back_as_fragments_not_one_line():
    # Documents a deliberate limitation. Bridging dash gaps and rejecting text
    # baselines pull in opposite directions, and text is far more common on a
    # plan than dashed walls, so the gap is kept tight. A dashed wall therefore
    # traces as several pieces the user joins by hand.
    img = blank()
    for x in range(80, 520, 24):
        cv2.line(img, (x, 200), (x + 14, 200), (0, 0, 0), 4)
    out = detect_walls(png_b64(img))
    assert len(out["segments"]) != 1 or seg_len(out["segments"][0]) < 380


def test_a_blank_image_yields_nothing():
    assert detect_walls(png_b64(blank()))["segments"] == []


def test_large_images_are_worked_at_reduced_resolution():
    img = blank(3000, 2000)
    cv2.rectangle(img, (400, 300), (2600, 1700), (0, 0, 0), 12)
    out = detect_walls(png_b64(img))
    assert max(out["w"], out["h"]) == 1000       # MAX_DIM
    assert len(out["segments"]) == 4


def test_bare_base64_without_the_data_url_prefix_also_works():
    img = blank()
    cv2.line(img, (60, 200), (540, 200), (0, 0, 0), 4)
    assert len(detect_walls(png_b64(img, as_data_url=False))["segments"]) == 1


def test_garbage_input_is_rejected_clearly():
    with pytest.raises(DecodeError):
        decode_image("data:image/png;base64,!!!not base64!!!")
    with pytest.raises(DecodeError):
        decode_image(base64.b64encode(b"not an image at all").decode())
