"""Reading a stored plan through the generated schema.

`plan_schema.py` is generated from the editor's TypeScript and must not be
edited; this module is the hand-written layer around it — the union alias, the
error type, and the three ways the backend is allowed to look at a plan:

  check_stored_plan   the write path. Logs and returns; never rejects.
  load_plan           the read path. Raises PlanFormatError on a plan it
                      cannot understand, rather than quietly reporting nothing.
  parse_objects       a request's object list. Drops what will not parse and
                      carries on, because these arrive mid-edit.

The asymmetry is deliberate. Refusing a save would lose work the user can see
on screen, and the client is free to run ahead of the schema — it owns it. A
report built from a plan the backend could not parse is the opposite: it looks
like an answer. That failure has to be loud, and used to not be: before this
existed, `project.get("floors")` on a pre-floors plan returned an empty report
with no error at all.
"""
from __future__ import annotations

import logging
from typing import Any, get_args

from pydantic import TypeAdapter, ValidationError

from .plan_schema import (
    Beam,
    Dimension,
    Electrical,
    Floor,
    Furniture,
    ImageObj,
    Opening,
    Project,
    Room,
    Wall,
)

log = logging.getLogger("interior.plan")

# The generated code inlines this union into Floor.objects and so leaves it
# unnamed. Naming it here is safe because test_plan.py asserts the two are the
# same type — adding a kind to schema.ts without updating this fails the suite.
Obj = Wall | Beam | Room | Opening | Furniture | Dimension | ImageObj | Electrical

OBJ_ADAPTER: TypeAdapter[Obj] = TypeAdapter(Obj)

#: The element type the generated Floor actually holds; test_plan.py pins Obj to it.
GENERATED_OBJ = get_args(Floor.model_fields["objects"].annotation)[0]


class PlanFormatError(ValueError):
    """A stored plan the backend cannot read."""


def _brief(exc: ValidationError, limit: int = 3) -> str:
    parts = [
        f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:limit]
    ]
    if exc.error_count() > limit:
        parts.append(f"(+{exc.error_count() - limit} more)")
    return "; ".join(parts)


def check_stored_plan(data: Any, *, project_id: str) -> None:
    """Note a plan that does not match the schema. Storing it goes ahead anyway."""
    try:
        Project.model_validate(data)
    except ValidationError as exc:
        log.warning(
            "plan %s does not match the schema (%d issue(s)), stored as-is: %s",
            project_id,
            exc.error_count(),
            _brief(exc),
        )


def load_plan(data: Any, *, project_id: str) -> Project:
    """The stored plan as a typed document, or PlanFormatError."""
    try:
        return Project.model_validate(data)
    except ValidationError as exc:
        raise PlanFormatError(
            f"存檔 {project_id} 的格式無法解析（{_brief(exc)}）"
        ) from exc


def parse_objects(raw: list[Any], *, where: str) -> list[Obj]:
    """Objects sent with a request; unreadable entries are dropped, not fatal."""
    out: list[Obj] = []
    dropped = 0
    for item in raw:
        try:
            out.append(OBJ_ADAPTER.validate_python(item))
        except ValidationError:
            dropped += 1
    if dropped:
        log.info("%s: ignored %d object(s) that do not match the schema", where, dropped)
    return out
