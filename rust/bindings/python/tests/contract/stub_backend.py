"""Local stub HTTP backend for client wire fixtures (stdlib only)."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Mapping
from urllib.parse import parse_qs, urlparse


@dataclass
class CapturedRequest:
    method: str
    path: str
    query: dict[str, str]
    headers: dict[str, str]
    body: Any | None


@dataclass
class StubBackend:
    """Threading HTTP server that serves one programmed response and records requests."""

    host: str = "127.0.0.1"
    port: int = 0
    response_status: int = 200
    response_body: Any = None
    captured: list[CapturedRequest] = field(default_factory=list)
    _server: ThreadingHTTPServer | None = field(default=None, init=False, repr=False)
    _thread: threading.Thread | None = field(default=None, init=False, repr=False)

    @property
    def base_url(self) -> str:
        if self._server is None:
            raise RuntimeError("stub backend is not running")
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def __enter__(self) -> StubBackend:
        backend = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                self._handle()

            def do_POST(self) -> None:  # noqa: N802
                self._handle()

            def do_PUT(self) -> None:  # noqa: N802
                self._handle()

            def do_PATCH(self) -> None:  # noqa: N802
                self._handle()

            def do_DELETE(self) -> None:  # noqa: N802
                self._handle()

            def _handle(self) -> None:
                parsed = urlparse(self.path)
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw = self.rfile.read(length) if length > 0 else b""
                body: Any | None
                if not raw:
                    body = None
                else:
                    try:
                        body = json.loads(raw.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        body = raw.decode("utf-8", errors="replace")

                query: dict[str, str] = {}
                for key, values in parse_qs(parsed.query, keep_blank_values=True).items():
                    if values:
                        query[key] = values[0]

                headers = {k: v for k, v in self.headers.items()}
                backend.captured.append(
                    CapturedRequest(
                        method=self.command,
                        path=parsed.path,
                        query=query,
                        headers=headers,
                        body=body,
                    )
                )

                payload = backend.response_body
                if isinstance(payload, (dict, list)):
                    data = json.dumps(payload).encode("utf-8")
                    content_type = "application/json"
                elif isinstance(payload, str):
                    data = payload.encode("utf-8")
                    content_type = "text/plain; charset=utf-8"
                elif payload is None:
                    data = b""
                    content_type = "application/octet-stream"
                else:
                    data = json.dumps(payload).encode("utf-8")
                    content_type = "application/json"

                self.send_response(backend.response_status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if self.command != "HEAD" and data:
                    self.wfile.write(data)

            def log_message(self, format: str, *args: object) -> None:  # noqa: A003
                return

        self._server = ThreadingHTTPServer((self.host, self.port), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self._server = None
        self._thread = None


def assert_wire_request(actual: CapturedRequest, expected: Mapping[str, Any] | Any) -> None:
    """Assert a captured request matches `wire.request` (method/path/query/headers/body)."""
    assert actual.method == expected.method, (
        f"wire.request.method mismatch: {actual.method!r} != {expected.method!r}"
    )
    assert actual.path == expected.path, (
        f"wire.request.path mismatch: {actual.path!r} != {expected.path!r}"
    )
    if expected.query is not None:
        assert actual.query == dict(expected.query), (
            f"wire.request.query mismatch: {actual.query!r} != {expected.query!r}"
        )
    if expected.headers is not None:
        actual_norm = {k.lower(): v for k, v in actual.headers.items()}
        for key, value in expected.headers.items():
            assert actual_norm.get(key.lower()) == value, (
                f"wire.request.headers[{key}] mismatch: "
                f"{actual_norm.get(key.lower())!r} != {value!r}"
            )
    if expected.body is not None:
        assert actual.body == expected.body, (
            f"wire.request.body mismatch:\n  got: {actual.body!r}\n  expected: {expected.body!r}"
        )
