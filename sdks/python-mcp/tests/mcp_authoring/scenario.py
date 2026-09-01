from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContentBlockText(StrictModel):
    type: Literal["text"]
    text: str


class ContentBlockImage(StrictModel):
    type: Literal["image"]
    data: str
    mimeType: str


class ContentBlockResource(StrictModel):
    type: Literal["resource"]
    resource: dict[str, Any]


ContentBlock = ContentBlockText | ContentBlockImage | ContentBlockResource


class NudgeSpec(StrictModel):
    kind: Literal["low-balance", "cycle-ending", "approaching-limit"]
    message: str


class ResponseOptions(StrictModel):
    text: str | None = None
    nudge: NudgeSpec | None = None
    units: float | None = None


class HandlerRespond(StrictModel):
    kind: Literal["respond"]
    data: Any
    options: ResponseOptions | None = None
    emit: list[ContentBlock] | None = None


class HandlerGate(StrictModel):
    kind: Literal["gate"]
    reason: str | None = None


class HandlerThrow(StrictModel):
    kind: Literal["throw"]
    message: str


Handler = HandlerRespond | HandlerGate | HandlerThrow


class Limits(StrictModel):
    withinLimits: bool
    remaining: float | None = None
    plan: str | None = None
    creditBalance: float | None = None
    checkoutUrl: str | None = None
    activationRequired: bool | None = None
    confirmationUrl: str | None = None
    plans: list[dict[str, Any]] | None = None
    balance: Any | None = None
    product: Any | None = None
    meterName: str | None = None


class ToolScenario(StrictModel):
    name: str = Field(min_length=1)
    title: str | None = None
    description: str | None = None
    inputSchema: dict[str, Any] | None = None
    args: dict[str, Any]


class Scenario(StrictModel):
    tool: ToolScenario
    product: str = Field(min_length=1)
    customerRef: str = Field(min_length=1)
    customerRefSource: Literal["hook", "toolArgs"]
    usageType: str | None = None
    limits: Limits
    handler: Handler


class UsageProjection(StrictModel):
    outcome: Literal["success", "paywall", "fail"]
    actionType: str
    units: float
    productRef: str
    customerRef: str
    metadata: dict[str, str]


class ToolResult(StrictModel):
    content: list[dict[str, Any]]
    structuredContent: Any | None = None
    isError: bool | None = None
    meta: dict[str, Any] | None = Field(default=None, alias="_meta")


class Observation(StrictModel):
    toolResult: ToolResult
    usage: list[UsageProjection]


def parse_scenario(args: dict[str, Any]) -> Scenario:
    return Scenario.model_validate(args)


def parse_observation(result: object) -> Observation:
    return Observation.model_validate(result)
