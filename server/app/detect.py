"""Trace wall centrelines out of a scanned or exported floor-plan image.

Replaces a hand-rolled scanline detector that could only see axis-aligned ink:
it swept for horizontal runs, then vertical runs, and merged adjacent ones. A
plan drawn at any other angle was invisible to it.

This uses Otsu thresholding then a probabilistic Hough transform, so walls at
arbitrary angles are found, and then merges each wall's two drawn faces into one
centreline — which is what the editor wants, since its walls are centrelines
with a thickness.

Known limits, both deliberate:

  - Lettering is not fully rejected. A row of characters leaves collinear ink
    along its baseline, and nothing cheaply separates that from a genuinely
    short wall. Strays come back short, so they are easy to spot and delete.
  - A dashed wall traces as several pieces. Bridging dash gaps and rejecting
    text baselines pull in opposite directions; plans nearly always carry text
    and only sometimes carry dashed walls, so the gap is kept tight.

The result is a starting point the user corrects, not an authoritative trace.
"""
from __future__ import annotations

import base64
import binascii
import math
import re

import cv2
import numpy as np

MAX_DIM = 1000          # work at this resolution regardless of the upload size
MAX_WALL_THICKNESS = 18  # px — parallel lines closer than this are one wall's two faces
ANGLE_TOL_DEG = 6.0      # lines within this of each other count as parallel
MAX_ALONG_GAP = 6.0      # px — how far apart collinear pieces may be and still be one wall

_DATA_URL = re.compile(r"^data:[^;]*;base64,", re.I)


class DecodeError(ValueError):
    pass


def decode_image(payload: str) -> np.ndarray:
    """Accept a data URL or bare base64 and return a BGR image."""
    raw = _DATA_URL.sub("", payload.strip())
    try:
        buf = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as e:
        raise DecodeError(f"not valid base64: {e}") from e
    img = cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise DecodeError("not a decodable image")
    return img


def _binarise(img: np.ndarray) -> np.ndarray:
    """Ink as white on black, at working resolution."""
    h, w = img.shape[:2]
    scale = min(1.0, MAX_DIM / max(w, h))
    if scale < 1.0:
        img = cv2.resize(img, (max(1, round(w * scale)), max(1, round(h * scale))),
                         interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # THRESH_BINARY_INV so dark ink becomes the foreground Hough looks for.
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    # Close 1px gaps from anti-aliasing and dashed linework.
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def _angle(seg) -> float:
    """Direction in degrees, folded to [0, 180) so a line equals its reverse."""
    x1, y1, x2, y2 = seg
    return math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180.0


def _angles_close(a: float, b: float, tol: float = ANGLE_TOL_DEG) -> bool:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d) <= tol


def _merge_group(segs: list) -> tuple[tuple[float, float], tuple[float, float]]:
    """Collapse near-parallel, near-touching segments into one centreline.

    The endpoints are the extremes along the group's average direction, and the
    line sits at the average perpendicular offset — so a wall drawn as two
    parallel faces comes back as the single line between them.
    """
    pts = np.array([[[s[0], s[1]], [s[2], s[3]]] for s in segs], dtype=float).reshape(-1, 2)
    mean_ang = math.radians(_circular_mean([_angle(s) for s in segs]))
    d = np.array([math.cos(mean_ang), math.sin(mean_ang)])
    n = np.array([-d[1], d[0]])
    centre = pts.mean(axis=0)
    rel = pts - centre
    along = rel @ d
    off = float((rel @ n).mean())
    p0 = centre + d * float(along.min()) + n * off
    p1 = centre + d * float(along.max()) + n * off
    return (float(p0[0]), float(p0[1])), (float(p1[0]), float(p1[1]))


def _circular_mean(degrees: list[float]) -> float:
    """Mean of directions on a 180° circle (0° and 179° are 1° apart, not 179°)."""
    two = [math.radians(a * 2) for a in degrees]
    s = sum(math.sin(a) for a in two) / len(two)
    c = sum(math.cos(a) for a in two) / len(two)
    return (math.degrees(math.atan2(s, c)) / 2) % 180.0


def _should_merge(a, b) -> bool:
    """Do two Hough hits belong to the same wall?

    The two directions have to be judged separately. Across the line, a wall is
    drawn as two faces up to MAX_WALL_THICKNESS apart and both belong to it.
    Along the line, a real wall is continuous, so only touching or overlapping
    pieces may join — bridging a long along-line gap is what turned the baseline
    of a row of lettering into a convincing 150 px wall.
    """
    if not _angles_close(_angle(a), _angle(b)):
        return False

    ang = math.radians(_circular_mean([_angle(a), _angle(b)]))
    d = np.array([math.cos(ang), math.sin(ang)])
    n = np.array([-d[1], d[0]])

    pa = np.array([[a[0], a[1]], [a[2], a[3]]], float)
    pb = np.array([[b[0], b[1]], [b[2], b[3]]], float)

    # across: distance between the two lines
    if abs(float((pa @ n).mean() - (pb @ n).mean())) > MAX_WALL_THICKNESS:
        return False

    # along: require overlap, or a gap no wider than the Hough one
    a0, a1 = sorted(pa @ d)
    b0, b1 = sorted(pb @ d)
    gap = max(a0, b0) - min(a1, b1)
    return gap <= MAX_ALONG_GAP


def detect_walls(image_b64: str) -> dict:
    """Wall centrelines in processed pixel space, with that space's dimensions.

    Same contract as the TypeScript detector it replaces: the caller maps pixels
    to centimetres using the underlay's placement.
    """
    img = decode_image(image_b64)
    binary = _binarise(img)
    h, w = binary.shape[:2]

    min_len = max(24, round(0.05 * max(w, h)))
    # maxLineGap is deliberately small. A generous gap bridges dashed linework,
    # but it also bridges the baseline of a row of lettering — "客廳 LIVING" came
    # back as a 150 px wall. Plans nearly always carry labels and dimension text,
    # and only sometimes carry dashed walls, so this errs towards rejecting text.
    # The 3x3 close above still absorbs anti-aliasing gaps.
    lines = cv2.HoughLinesP(
        binary, rho=1, theta=np.pi / 360, threshold=60,
        minLineLength=min_len, maxLineGap=4,
    )
    if lines is None or len(lines) == 0:
        return {"segments": [], "w": w, "h": h}

    # OpenCV 4 hands back (N, 1, 4); OpenCV 5 hands back (N, 4).
    segs = [tuple(map(float, row)) for row in np.asarray(lines).reshape(-1, 4)]

    # Group parallel neighbours — a wall is usually drawn as two faces, and Hough
    # also returns several overlapping hits along one long line.
    used = [False] * len(segs)
    groups: list[list] = []
    for i, s in enumerate(segs):
        if used[i]:
            continue
        group, used[i] = [s], True
        changed = True
        while changed:
            changed = False
            for j, t in enumerate(segs):
                if used[j]:
                    continue
                if any(_should_merge(t, g) for g in group):
                    group.append(t)
                    used[j] = True
                    changed = True
        groups.append(group)

    out = []
    for g in groups:
        (x1, y1), (x2, y2) = _merge_group(g)
        if math.hypot(x2 - x1, y2 - y1) < min_len:
            continue
        out.append([{"x": x1, "y": y1}, {"x": x2, "y": y2}])
    return {"segments": out, "w": w, "h": h}

