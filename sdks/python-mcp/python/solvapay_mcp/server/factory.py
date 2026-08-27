from __future__ import annotations

import inspect
import json
from collections.abc import Awaitable, Callable

from mcp.server.lowlevel.server import Server
from mcp.types import Icon, Prompt, PromptArgument, Resource, Tool, ToolAnnotations
from solvapay.facade import SolvaPay

from solvapay_mcp.register import (
    register_builtin_tool,
    register_prompt,
    register_resource,
    set_hide_tools_by_audience,
)
from solvapay_mcp.server.descriptors import build_solvapay_descriptors
from solvapay_mcp.widget import default_mcp_app_html


async def _await_if_needed(value: object) -> object:
    if inspect.isawaitable(value):
        return await value
    return value


def _bool_hint(raw: dict[str, object], key: str) -> bool | None:
    value = raw.get(key)
    return value if isinstance(value, bool) else None


def _tool_annotations(raw: object) -> ToolAnnotations | None:
    if not isinstance(raw, dict):
        return None
    return ToolAnnotations(
        read_only_hint=_bool_hint(raw, "readOnlyHint"),
        destructive_hint=_bool_hint(raw, "destructiveHint"),
        idempotent_hint=_bool_hint(raw, "idempotentHint"),
        open_world_hint=_bool_hint(raw, "openWorldHint"),
    )


def _icons(raw: object) -> list[Icon] | None:
    if not isinstance(raw, list):
        return None
    icons: list[Icon] = []
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("src"), str):
            sizes = item.get("sizes")
            icons.append(
                Icon(
                    src=str(item["src"]),
                    sizes=[str(s) for s in sizes] if isinstance(sizes, list) else None,
                )
            )
    return icons or None


def create_solvapay_mcp_server(
    *,
    solvapay: SolvaPay,
    product_ref: str,
    public_base_url: str,
    resource_uri: str = "ui://solvapay/mcp-app.html",
    read_html: Callable[[], Awaitable[str]] | None = None,
    views: list[str] | None = None,
    csp: dict[str, list[str]] | None = None,
    api_base_url: str | None = None,
    server_name: str = "solvapay-mcp-server",
    hide_tools_by_audience: list[str] | None = None,
) -> Server[object]:
    bundle = build_solvapay_descriptors(
        solvapay=solvapay,
        product_ref=product_ref,
        resource_uri=resource_uri,
        public_base_url=public_base_url,
        read_html=read_html,
        views=views,
        csp=csp,
        api_base_url=api_base_url,
    )
    server: Server[object] = Server(server_name)
    tools = bundle["tools"]
    if isinstance(tools, list):
        for item in tools:
            if not isinstance(item, dict):
                continue
            handler = item["handler"]
            schema = item.get("inputSchema")
            input_schema = (
                schema if isinstance(schema, dict) else {"type": "object", "properties": {}}
            )
            raw_meta = item.get("meta") if isinstance(item.get("meta"), dict) else None
            tool = Tool(
                name=str(item["name"]),
                description=str(item.get("description") or ""),
                input_schema=input_schema,
                title=str(item["title"]) if isinstance(item.get("title"), str) else None,
                annotations=_tool_annotations(item.get("annotations")),
                icons=_icons(item.get("icons")),
                _meta=raw_meta,
            )
            register_builtin_tool(server, tool, handler)

    resource = bundle["resource"]
    if isinstance(resource, dict):
        csp_meta = {"ui": {"csp": resource.get("csp"), "prefersBorder": False}}

        async def read_ui() -> str:
            reader = resource.get("readHtml")
            if callable(reader):
                text = await _await_if_needed(reader())
                if not isinstance(text, str):
                    raise TypeError("readHtml must return str")
                return text
            return default_mcp_app_html()

        register_resource(
            server,
            Resource(
                name="mcp-app",
                uri=str(resource["uri"]),
                mime_type=str(resource.get("mimeType") or "text/html;profile=mcp-app"),
                _meta=csp_meta,
            ),
            read_ui,
        )

    docs = bundle["docs"]
    if isinstance(docs, dict):
        body = str(docs.get("body") or "")

        async def read_docs() -> str:
            return body

        raw_description = docs.get("description")
        description = str(raw_description) if isinstance(raw_description, str) else None
        register_resource(
            server,
            Resource(
                name=str(docs.get("name") or "overview"),
                uri=str(docs["uri"]),
                title=str(docs["title"]) if isinstance(docs.get("title"), str) else None,
                description=description,
                mime_type=str(docs.get("mimeType") or "text/markdown"),
            ),
            read_docs,
        )

    bootstrap = bundle["bootstrap"]
    if isinstance(bootstrap, dict):
        async def read_bootstrap() -> str:
            reader = bootstrap.get("readPayload")
            payload = await _await_if_needed(reader()) if callable(reader) else {}
            return json.dumps(payload)

        register_resource(
            server,
            Resource(
                name=str(bootstrap.get("name") or "bootstrap"),
                uri=str(bootstrap["uri"]),
                title=str(bootstrap["title"]) if isinstance(bootstrap.get("title"), str) else None,
                description=str(bootstrap["description"])
                if isinstance(bootstrap.get("description"), str)
                else None,
                mime_type=str(bootstrap.get("mimeType") or "application/json"),
            ),
            read_bootstrap,
        )

    prompts = bundle["prompts"]
    if isinstance(prompts, list):
        for item in prompts:
            if not isinstance(item, dict):
                continue
            handler = item["handler"]
            args: list[PromptArgument] | None = None
            name = str(item.get("name") or "")
            if name in ("upgrade", "activate_plan"):
                args = [PromptArgument(name="planRef", required=False)]
            elif name == "topup":
                args = [PromptArgument(name="amount", required=False)]
            register_prompt(
                server,
                Prompt(
                    name=name,
                    title=str(item["title"]) if isinstance(item.get("title"), str) else None,
                    description=str(item.get("description") or ""),
                    arguments=args,
                ),
                handler,
            )
    if hide_tools_by_audience:
        set_hide_tools_by_audience(server, hide_tools_by_audience)
    return server
