# Generated from client/src/model/schema.ts by `npm run codegen`.
# Do not edit: `npm test` fails when this file and the schema disagree.

from __future__ import annotations

from enum import Enum, StrEnum
from typing import Literal

from pydantic import BaseModel, Field, RootModel


class ElectricalId(StrEnum):
    socket = 'socket'
    socket2 = 'socket2'
    socketWater = 'socketWater'
    tv = 'tv'
    network = 'network'
    switch1 = 'switch1'
    switch2 = 'switch2'
    switch3 = 'switch3'
    ceilingLight = 'ceilingLight'
    downlight = 'downlight'
    spotlight = 'spotlight'
    pendant = 'pendant'
    wallLight = 'wallLight'
    batten = 'batten'
    exhaust = 'exhaust'


class Hinge(StrEnum):
    left = 'left'
    right = 'right'


class Kind(StrEnum):
    door = 'door'
    window = 'window'


class Swing(StrEnum):
    in_ = 'in'
    out = 'out'


class T5Size(Enum):
    number_1 = 1
    number_2 = 2
    number_3 = 3
    number_4 = 4


class Vec(BaseModel):
    x: float
    y: float


class Wall(BaseModel):
    a: Vec
    b: Vec
    bulge: float | None = None
    color: str | None = None
    finish: str | None = None
    group: str | None = None
    height: float | None = None
    id: str
    kind: Literal['wall']
    layer: str
    thickness: float


class Beam(BaseModel):
    a: Vec
    b: Vec
    elevation: float
    group: str | None = None
    height: float
    id: str
    kind: Literal['beam']
    layer: str
    width: float


class Dimension(BaseModel):
    a: Vec
    b: Vec
    group: str | None = None
    id: str
    kind: Literal['dimension']
    layer: str
    offset: float


class Electrical(BaseModel):
    angle: float
    beam: float | None = Field(
        None, description='Full beam angle (degrees) of a downward light.'
    )
    cct: float | None = Field(
        None,
        description='Colour temperature (K). Recorded, not used by the illuminance maths.',
    )
    circuit: float | None = Field(
        None,
        description='Switch group for the on/off comparison — not wiring (no cable is drawn or sized).',
    )
    elevation: float | None = Field(
        None,
        description='Height above the floor (cm). Sockets sit low, switches at handle height.',
    )
    group: str | None = None
    id: str
    item: ElectricalId
    kind: Literal['electrical']
    label: str | None = None
    layer: str
    lumens: float | None = Field(
        None, description='Luminous flux (lm), overriding the catalogue default.'
    )
    size: T5Size | None = Field(
        None,
        description='T5 batten length in feet. The tube runs along the symbol\'s local x and lights its "up" side (-y, into the room).',
    )
    x: float
    y: float


class Furniture(BaseModel):
    angle: float
    color: str | None = None
    elevation: float | None = None
    group: str | None = None
    h: float
    height: float | None = None
    id: str
    item: str
    kind: Literal['furniture']
    label: str
    layer: str
    w: float
    x: float
    y: float


class ImageObj(BaseModel):
    group: str | None = None
    h: float
    id: str
    kind: Literal['image']
    layer: str
    opacity: float
    src: str
    w: float
    x: float
    y: float


class Layer(BaseModel):
    color: str
    id: str
    locked: bool
    name: str
    visible: bool


class Opening(BaseModel):
    angle: float
    bulge: float | None = None
    elevation: float | None = None
    group: str | None = None
    height: float | None = None
    hinge: Hinge | None = None
    id: str
    kind: Kind
    layer: str
    style: str | None = None
    swing: Swing | None = None
    width: float
    x: float
    y: float


class Partition(BaseModel):
    a: Vec
    b: Vec
    group: str | None = None
    id: str
    kind: Literal['partition']
    layer: str


class Room(BaseModel):
    auto: bool | None = None
    floor: str | None = None
    group: str | None = None
    h: float
    id: str
    kind: Literal['room']
    layer: str
    name: str
    poly: list[Vec] | None = None
    w: float
    x: float
    y: float


class Floor(BaseModel):
    elevation: float
    height: float
    id: str
    name: str
    objects: list[
        Wall
        | Beam
        | Partition
        | Room
        | Opening
        | Furniture
        | Dimension
        | ImageObj
        | Electrical
    ]


class Project(BaseModel):
    activeFloorId: str
    floors: list[Floor]
    id: str
    layers: list[Layer]
    name: str
    schemaVersion: float = Field(
        ...,
        description='Which revision of this schema the plan was written against. Bumped only by a change that older plans cannot satisfy; migrate.ts holds the step that moves a plan up to it, and the backend can then assume one shape.',
    )


class Plan(RootModel[Project]):
    root: Project
