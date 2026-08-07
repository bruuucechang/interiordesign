# Generated from client/src/model/schema.ts by `npm run codegen`.
# Do not edit: `npm test` fails when this file and the schema disagree.

from __future__ import annotations

from enum import StrEnum
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
    exhaust = 'exhaust'


class Kind(StrEnum):
    door = 'door'
    window = 'window'


class Opening(BaseModel):
    angle: float
    bulge: float | None = None
    elevation: float | None = None
    group: str | None = None
    height: float | None = None
    id: str
    kind: Kind
    layer: str
    style: str | None = None
    width: float
    x: float
    y: float


class Vec(BaseModel):
    x: float
    y: float


class Wall(BaseModel):
    a: Vec
    b: Vec
    bulge: float | None = None
    color: str | None = None
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
        Wall | Beam | Room | Opening | Furniture | Dimension | ImageObj | Electrical
    ]


class Project(BaseModel):
    activeFloorId: str
    floors: list[Floor]
    id: str
    layers: list[Layer]
    name: str


class Plan(RootModel[Project]):
    root: Project
