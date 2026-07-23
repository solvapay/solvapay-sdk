"""Load and validate §5.3 golden fixtures for the Python contract suite."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Mapping


HttpMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE"]


@dataclass(frozen=True)
class FixtureErrorExpect:
    message: str
    name: str | None = None
    status: int | None = None
    kind: str | None = None
    code: str | None = None


@dataclass(frozen=True)
class WireRequest:
    method: HttpMethod
    path: str
    query: Mapping[str, str] | None = None
    headers: Mapping[str, str] | None = None
    body: Any | None = None


@dataclass(frozen=True)
class WireResponse:
    status: int
    body: Any


@dataclass(frozen=True)
class Wire:
    request: WireRequest
    response: WireResponse


@dataclass(frozen=True)
class FixtureInput:
    fn: str
    args: Mapping[str, Any]
    clock: str | None = None
    rng_seed: int | None = None


@dataclass(frozen=True)
class Fixture:
    suite: str
    case: str
    input: FixtureInput
    expect_kind: Literal["result", "error"]
    expect_result: Any | None
    expect_error: FixtureErrorExpect | None
    wire: Wire | None = None
    path: Path | None = None


def find_repo_root(start: Path | None = None) -> Path:
    """Walk parents until `contract/fixtures` is found."""
    cur = (start or Path(__file__)).resolve()
    if cur.is_file():
        cur = cur.parent
    for candidate in [cur, *cur.parents]:
        if (candidate / "contract" / "fixtures").is_dir():
            return candidate
    raise FileNotFoundError("could not locate repo root containing contract/fixtures")


def discover_fixture_files(fixtures_root: Path) -> list[Path]:
    files = sorted(fixtures_root.rglob("*.json"))
    return [path for path in files if path.is_file()]


def parse_fixture(raw: object, *, path: Path | None = None) -> Fixture:
    if not isinstance(raw, dict):
        raise ValueError("fixture root must be an object")

    suite = _require_str(raw, "suite")
    case = _require_str(raw, "case")
    input_raw = raw.get("input")
    if not isinstance(input_raw, dict):
        raise ValueError("fixture.input must be an object")

    fn = _require_str(input_raw, "fn")
    args_raw = input_raw.get("args", {})
    if args_raw is None:
        args_raw = {}
    if not isinstance(args_raw, dict):
        raise ValueError("fixture.input.args must be an object")
    args = dict(args_raw)

    clock = input_raw.get("clock")
    if clock is not None and (not isinstance(clock, str) or not clock):
        raise ValueError("fixture.input.clock must be a non-empty string when present")
    rng_seed = input_raw.get("rngSeed")
    if rng_seed is not None and not isinstance(rng_seed, int):
        raise ValueError("fixture.input.rngSeed must be an int when present")

    expect_raw = raw.get("expect")
    if not isinstance(expect_raw, dict):
        raise ValueError("fixture.expect must be an object")
    has_result = "result" in expect_raw
    has_error = "error" in expect_raw
    if has_result == has_error:
        raise ValueError("expect must contain exactly one of result or error")

    expect_result: Any | None = None
    expect_error: FixtureErrorExpect | None = None
    expect_kind: Literal["result", "error"]
    if has_result:
        expect_kind = "result"
        expect_result = expect_raw["result"]
    else:
        expect_kind = "error"
        error_raw = expect_raw["error"]
        if not isinstance(error_raw, dict):
            raise ValueError("expect.error must be an object")
        message = error_raw.get("message")
        if not isinstance(message, str):
            raise ValueError("expect.error.message must be a string")
        expect_error = FixtureErrorExpect(
            message=message,
            name=_optional_str(error_raw, "name"),
            status=_optional_int(error_raw, "status"),
            kind=_optional_str(error_raw, "kind"),
            code=_optional_str(error_raw, "code"),
        )

    wire = None
    if "wire" in raw and raw["wire"] is not None:
        wire = _parse_wire(raw["wire"])

    return Fixture(
        suite=suite,
        case=case,
        input=FixtureInput(fn=fn, args=args, clock=clock, rng_seed=rng_seed),
        expect_kind=expect_kind,
        expect_result=expect_result,
        expect_error=expect_error,
        wire=wire,
        path=path,
    )


def load_fixture(path: Path) -> Fixture:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return parse_fixture(raw, path=path)


def _parse_wire(raw: object) -> Wire:
    if not isinstance(raw, dict):
        raise ValueError("wire must be an object")
    req = raw.get("request")
    resp = raw.get("response")
    if not isinstance(req, dict) or not isinstance(resp, dict):
        raise ValueError("wire.request and wire.response are required objects")
    method = req.get("method")
    if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
        raise ValueError("wire.request.method must be an HTTP verb")
    path = _require_str(req, "path")
    query = req.get("query")
    if query is not None and not isinstance(query, dict):
        raise ValueError("wire.request.query must be an object when present")
    headers = req.get("headers")
    if headers is not None and not isinstance(headers, dict):
        raise ValueError("wire.request.headers must be an object when present")
    status = resp.get("status")
    if not isinstance(status, int):
        raise ValueError("wire.response.status must be an int")
    if "body" not in resp:
        raise ValueError("wire.response.body is required")
    return Wire(
        request=WireRequest(
            method=method,  # type: ignore[arg-type]
            path=path,
            query={str(k): str(v) for k, v in query.items()} if isinstance(query, dict) else None,
            headers=(
                {str(k): str(v) for k, v in headers.items()}
                if isinstance(headers, dict)
                else None
            ),
            body=req.get("body"),
        ),
        response=WireResponse(status=status, body=resp["body"]),
    )


def _require_str(obj: Mapping[str, Any], key: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _optional_str(obj: Mapping[str, Any], key: str) -> str | None:
    value = obj.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} must be a non-empty string when present")
    return value


def _optional_int(obj: Mapping[str, Any], key: str) -> int | None:
    value = obj.get(key)
    if value is None:
        return None
    if not isinstance(value, int):
        raise ValueError(f"{key} must be an int when present")
    return value
