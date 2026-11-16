"""The HTTP layer under the generated client: auth, timeouts, retries, errors.

The generated methods (``_generated/operations.py``) only build a request and
parse its response. Everything about talking to the API lives here, once,
for both the async and the blocking client.
"""

from __future__ import annotations

import asyncio
import time
import weakref
from collections.abc import Mapping
from importlib.metadata import PackageNotFoundError, version
from typing import Any, TypeVar
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ValidationError

from .errors import SolvaPayError

DEFAULT_API_BASE_URL = "https://api.solvapay.com"
DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_MAX_RETRIES = 2
# Statuses worth a retry: rate limited, or the platform briefly unavailable.
RETRY_STATUSES = frozenset({429, 502, 503, 504})

M = TypeVar("M", bound=BaseModel)

try:
    _VERSION = version("solvapay")
except PackageNotFoundError:  # running from a source checkout
    _VERSION = "0.0.0+source"

USER_AGENT = f"solvapay-python/{_VERSION}"


def path_segment(value: str) -> str:
    """A path parameter, percent-encoded so a reference can never change the path."""
    if not value:
        raise SolvaPayError("A path parameter is empty", code="invalid_argument")
    return quote(value, safe="")


def encode_body(body: BaseModel | Mapping[str, Any] | None) -> Any:
    """A request body as JSON-ready data.

    A model is sent with its wire names and only the fields that were set, so
    an explicit ``None`` is sent as ``null`` and an unset field is left out.
    """
    if body is None:
        return None
    if isinstance(body, BaseModel):
        return body.model_dump(mode="json", by_alias=True, exclude_unset=True)
    return dict(body)


def _error_from_response(response: httpx.Response) -> SolvaPayError:
    status = response.status_code
    try:
        body = response.json()
    except ValueError:
        snippet = response.text[:240]
        return SolvaPayError(
            f"The SolvaPay API answered {status} with a body that is not JSON: {snippet}",
            code="non_json_response",
            status=status,
            body=snippet,
        )
    message: Any = body.get("message") if isinstance(body, dict) else None
    if isinstance(message, list):
        message = "; ".join(str(part) for part in message)
    # Only a non-empty string is the API's own code, as in the TypeScript SDK.
    code = body.get("code") if isinstance(body, dict) else None
    return SolvaPayError(
        str(message or f"The SolvaPay API answered {status}"),
        code=code if isinstance(code, str) and code else f"http_{status}",
        status=status,
        body=body,
    )


def _retry_after(response: httpx.Response | None, attempt: int) -> float:
    if response is not None:
        header = response.headers.get("retry-after")
        if header and header.isdigit():
            return min(float(header), 30.0)
    return float(0.5 * 2**attempt)


class _Transport:
    def __init__(
        self,
        *,
        api_key: str,
        api_base_url: str,
        timeout: float,
        max_retries: int,
    ) -> None:
        if not api_key:
            raise SolvaPayError(
                "A SolvaPay secret key is required (SOLVAPAY_SECRET_KEY).", code="missing_secret"
            )
        if max_retries < 0:
            raise SolvaPayError("max_retries cannot be negative", code="invalid_argument")
        self.api_base_url = api_base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }

    def _build(
        self,
        method: str,
        path: str,
        query: Mapping[str, Any],
        headers: Mapping[str, Any],
        body: Any,
    ) -> dict[str, Any]:
        params = {
            key: ("true" if value is True else "false" if value is False else value)
            for key, value in query.items()
            if value is not None
        }
        merged = {**self._headers, **{k: str(v) for k, v in headers.items() if v is not None}}
        return {
            "method": method,
            "url": f"{self.api_base_url}{path}",
            "params": params,
            "headers": merged,
            "json": body,
        }

    def _retryable(self, request: dict[str, Any]) -> bool:
        """Only requests that are safe to send twice: reads, and writes with an idempotency key."""
        has_key = any(k.lower() == "idempotency-key" for k in request["headers"])
        return request["method"] in {"GET", "HEAD"} or has_key

    @staticmethod
    def parse(model: type[M], data: Any) -> M:
        try:
            return model.model_validate(data)
        except ValidationError as error:
            raise SolvaPayError(
                f"The SolvaPay API answered with a {model.__name__} this SDK cannot read: {error}",
                code="invalid_response",
                body=data,
            ) from error


class SyncTransport(_Transport):
    """Blocking transport over ``httpx.Client``."""

    def __init__(self, *, client: httpx.Client | None = None, **options: Any) -> None:
        super().__init__(**options)
        self._client = client or httpx.Client(timeout=self.timeout)

    def close(self) -> None:
        self._client.close()

    def request(
        self,
        method: str,
        path: str,
        *,
        query: Mapping[str, Any],
        headers: Mapping[str, Any],
        body: Any,
    ) -> Any:
        request = self._build(method, path, query, headers, body)
        retries = self.max_retries if self._retryable(request) else 0
        for attempt in range(retries + 1):
            try:
                response = self._client.request(**request)
            except httpx.TransportError as error:
                if attempt < retries:
                    time.sleep(_retry_after(None, attempt))
                    continue
                raise SolvaPayError(
                    f"Could not reach the SolvaPay API: {error}", code="network_error"
                ) from error
            if response.status_code in RETRY_STATUSES and attempt < retries:
                time.sleep(_retry_after(response, attempt))
                continue
            return _result(response)
        raise AssertionError("unreachable")


class AsyncTransport(_Transport):
    """Async transport over ``httpx.AsyncClient``."""

    def __init__(self, *, client: httpx.AsyncClient | None = None, **options: Any) -> None:
        super().__init__(**options)
        # A client passed in is used as given, on whatever loop its owner runs it.
        self._given = client
        # Clients this transport made, one per event loop. An httpx.AsyncClient's
        # connections belong to the loop that opened them, so a client reused on
        # another loop fails ("Event loop is closed"). That happens whenever one
        # SolvaPay instance serves several loops: a test client that starts a loop
        # per request, or asyncio.run() called more than once.
        self._owned: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, httpx.AsyncClient] = (
            weakref.WeakKeyDictionary()
        )

    def _client_for_loop(self) -> httpx.AsyncClient:
        if self._given is not None:
            return self._given
        loop = asyncio.get_running_loop()
        client = self._owned.get(loop)
        if client is None:
            client = httpx.AsyncClient(timeout=self.timeout)
            self._owned[loop] = client
        return client

    async def aclose(self) -> None:
        if self._given is not None:
            await self._given.aclose()
            return
        # Only this loop's client can be closed from here; the others' loops are
        # closed or belong to other threads, and their clients go with them.
        client = self._owned.pop(asyncio.get_running_loop(), None)
        if client is not None:
            await client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        query: Mapping[str, Any],
        headers: Mapping[str, Any],
        body: Any,
    ) -> Any:
        request = self._build(method, path, query, headers, body)
        retries = self.max_retries if self._retryable(request) else 0
        for attempt in range(retries + 1):
            try:
                response = await self._client_for_loop().request(**request)
            except httpx.TransportError as error:
                if attempt < retries:
                    await asyncio.sleep(_retry_after(None, attempt))
                    continue
                raise SolvaPayError(
                    f"Could not reach the SolvaPay API: {error}", code="network_error"
                ) from error
            if response.status_code in RETRY_STATUSES and attempt < retries:
                await asyncio.sleep(_retry_after(response, attempt))
                continue
            return _result(response)
        raise AssertionError("unreachable")


def _result(response: httpx.Response) -> Any:
    if response.status_code >= 400:
        raise _error_from_response(response)
    if response.status_code == 204 or not response.content:
        return None
    try:
        return response.json()
    except ValueError as error:
        raise SolvaPayError(
            f"The SolvaPay API answered {response.status_code} with a body that is not JSON",
            code="non_json_response",
            status=response.status_code,
            body=response.text[:240],
        ) from error
