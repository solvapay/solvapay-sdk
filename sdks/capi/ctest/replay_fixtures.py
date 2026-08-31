#!/usr/bin/env python3
"""Replay contract/mcp-fixtures through C solvapay_call / the MCP engine."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any


SKIP_FNS = {"registerPayable"}
CLIENT_FNS = {"mcpDispatch", "mcpOauthRequest", "mcpBootstrap", "mcpCallBuiltinTool"}


def discover(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.json") if p.is_file())


def compare_op(rel: str, fn: str, got: object, expect: object) -> None:
    if fn == "mcpHandleRequest" and "tools-list" in rel:
        assert isinstance(got, dict) and got.get("kind") == "rpc", rel
        tools = got["rpc"]["result"]["tools"]
        assert isinstance(tools, list) and len(tools) >= 8, rel
        for tool in tools:
            title = tool.get("title") if isinstance(tool, dict) else None
            assert title is None or isinstance(title, str), rel
        if rel.endswith("tools-list-modern.json"):
            assert got["rpc"]["result"]["resultType"] == "complete", rel
            assert got["rpc"]["result"]["ttlMs"] == 60_000, rel
            assert got["rpc"]["result"]["cacheScope"] == "public", rel
        return
    if fn in {"mcpHandleRequest", "mcpDispatch"} and rel.endswith("invoke-handler.json"):
        assert isinstance(got, dict) and got.get("kind") == "invokeHandler", rel
        assert isinstance(expect, dict)
        assert got.get("tool") == expect.get("tool"), rel
        assert got.get("args") == expect.get("args"), rel
        assert got.get("customerRef") == expect.get("customerRef"), rel
        token = got.get("token")
        assert isinstance(token, str) and len(token) > 8, rel
        return
    if fn == "mcpOauthRequest":
        compare_oauth(rel, got, expect)
        return
    assert got == expect, f"{rel}\ngot={got!r}\nwant={expect!r}"


def compare_oauth(rel: str, got: object, expect: object) -> None:
    assert isinstance(got, dict) and isinstance(expect, dict), rel
    assert got.get("status") == expect.get("status"), rel
    assert got.get("body") == expect.get("body"), f"{rel}\nbody got={got.get('body')!r}"
    if "authorize" in rel:
        loc = ""
        headers = got.get("headers")
        if isinstance(headers, dict):
            loc = str(headers.get("location") or "")
        assert loc.endswith("/v1/customer/auth/authorize?client_id=abc"), f"{rel} location={loc!r}"
        return
    want_headers = expect.get("headers")
    if isinstance(want_headers, dict):
        got_headers = got.get("headers")
        assert isinstance(got_headers, dict), rel
        for key, value in want_headers.items():
            assert got_headers.get(key) == value, f"{rel} header {key}"


def compare_http(rel: str, fn: str, got: dict[str, Any], expect: dict[str, Any]) -> None:
    if fn == "mcpOauthRequest":
        compare_oauth(rel, got, expect)
        return
    if expect.get("kind") == "challenge":
        assert got.get("status") == expect.get("status"), rel
        assert got.get("body") == expect.get("body"), rel
        headers = got.get("headers")
        assert isinstance(headers, dict), rel
        www = str(headers.get("WWW-Authenticate") or headers.get("www-authenticate") or "")
        assert "Bearer resource_metadata=" in www, f"{rel} WWW-Authenticate {www}"
        return
    assert got.get("status") == 200, f"{rel} status={got.get('status')}"
    assert got.get("body") == expect.get("rpc"), f"{rel}\ngot={got.get('body')!r}\nwant={expect.get('rpc')!r}"


def run_bin(binary: Path, args: list[str], stdin: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.setdefault("SOLVAPAY_API_BASE_URL", "http://127.0.0.1:1")
    return subprocess.run(
        [str(binary), *args],
        input=stdin,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


def replay_op(binary: Path, rel: str, fn: str, args: object, expect: object) -> None:
    proc = run_bin(binary, [fn, "-"], json.dumps(args))
    if proc.returncode != 0:
        raise RuntimeError(f"{rel}: {proc.stderr or proc.stdout}")
    envelope = json.loads(proc.stdout)
    if envelope.get("ok") is not True:
        raise RuntimeError(f"{rel}: {envelope}")
    compare_op(rel, fn, envelope.get("value"), expect)


def engine_request(fn: str, args: dict[str, Any]) -> dict[str, Any]:
    config = dict(args.get("config") or {})
    config.setdefault("apiBaseUrl", os.environ.get("SOLVAPAY_API_BASE_URL", "http://127.0.0.1:1"))
    if fn == "mcpDispatch":
        headers: dict[str, str] = {}
        auth = args.get("authHeader")
        if isinstance(auth, str) and auth:
            headers["authorization"] = auth
        return {
            "method": "POST",
            "path": config.get("mcpPath") or "/mcp",
            "headers": headers,
            "body": json.dumps(args.get("rpc")),
            "config": config,
        }
    headers = args.get("headers") if isinstance(args.get("headers"), dict) else {}
    return {
        "method": args.get("method") or "GET",
        "path": args.get("path") or "/",
        "headers": headers,
        "body": args.get("body") or "",
        "config": config,
    }


def replay_engine(binary: Path, rel: str, fn: str, args: dict[str, Any], expect: dict[str, Any]) -> None:
    proc = run_bin(binary, [], json.dumps(engine_request(fn, args)))
    if proc.returncode != 0:
        raise RuntimeError(f"engine {rel}: {proc.stderr or proc.stdout}")
    got = json.loads(proc.stdout)
    compare_http(rel, fn, got, expect)


DEFAULT_BOOTSTRAP = [
    {"method": "GET", "path": "/v1/sdk/platform-config", "status": 200, "body": {"stripePublishableKey": "pk_test"}},
    {"method": "GET", "path": "/v1/sdk/merchant", "status": 200, "body": {"displayName": "Acme"}},
    {"method": "GET", "path": "/v1/sdk/products/prd_demo", "status": 200, "body": {"name": "Demo"}},
    {"method": "GET", "path": "/v1/sdk/products/prd_demo/plans", "status": 200, "body": {"plans": [{"name": "Pro"}]}},
]


class StubServer:
    def __init__(self, stubs: list[dict[str, Any]]) -> None:
        routes = {(str(s.get("method") or "GET"), str(s["path"])): s for s in stubs}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_GET(self) -> None:  # noqa: N802
                self._serve("GET")

            def do_POST(self) -> None:  # noqa: N802
                self._serve("POST")

            def _serve(self, method: str) -> None:
                path = self.path.split("?", 1)[0]
                stub = routes.get((method, path))
                if stub is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                body = json.dumps(stub.get("body") or {}).encode()
                self.send_response(int(stub.get("status") or 200))
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self._httpd.server_address[1]}"
        self._thread = Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()


def fixture_needs_http(fn: str, fixture: dict[str, Any], expect: object) -> bool:
    if fn not in CLIENT_FNS:
        return False
    if isinstance(expect, dict) and expect.get("status") == 502:
        body = expect.get("body")
        if isinstance(body, dict) and body.get("error") == "upstream_unreachable":
            return False
    return True


def main() -> int:
    root = Path(os.environ["SOLVAPAY_MCP_FIXTURES"])
    call_bin = Path(os.environ["SOLVAPAY_MCP_CALL"])
    engine_bin = os.environ.get("SOLVAPAY_MCP_ENGINE")
    ran = 0
    engine_ran = 0
    for path in discover(root):
        rel = path.relative_to(root).as_posix()
        fixture = json.loads(path.read_text())
        fn = fixture["input"]["fn"]
        if fn in SKIP_FNS:
            continue
        args = fixture["input"].get("args") or {}
        expect = fixture["expect"]["result"]
        stubs = fixture.get("http") if isinstance(fixture.get("http"), list) else []
        if fn == "mcpBootstrap" and not stubs:
            stubs = DEFAULT_BOOTSTRAP
        server: StubServer | None = None
        prev_base = os.environ.get("SOLVAPAY_API_BASE_URL")
        if fixture_needs_http(fn, fixture, expect):
            server = StubServer([s for s in stubs if isinstance(s, dict)])
            os.environ["SOLVAPAY_API_BASE_URL"] = server.url
        elif fn in CLIENT_FNS:
            os.environ["SOLVAPAY_API_BASE_URL"] = "http://127.0.0.1:1"
        try:
            replay_op(call_bin, rel, fn, args, expect)
        except Exception as exc:  # noqa: BLE001 — surface the fixture id
            sys.stderr.write(f"FAIL {rel}: {exc}\n")
            return 1
        finally:
            if server is not None:
                server.close()
            if prev_base is None:
                os.environ.pop("SOLVAPAY_API_BASE_URL", None)
            else:
                os.environ["SOLVAPAY_API_BASE_URL"] = prev_base
        ran += 1
        print(f"ok: {rel}")
        if engine_bin and fn in {"mcpDispatch", "mcpOauthRequest"} and not rel.endswith("invoke-handler.json"):
            try:
                replay_engine(Path(engine_bin), rel, fn, args, expect)
            except Exception as exc:  # noqa: BLE001
                sys.stderr.write(f"FAIL engine {rel}: {exc}\n")
                return 1
            engine_ran += 1
            print(f"ok: engine {rel}")
    print(f"OK: C MCP fixture replay ({ran} cases, {engine_ran} engine)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
