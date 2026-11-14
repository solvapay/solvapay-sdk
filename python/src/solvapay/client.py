"""The SolvaPay API client: every operation in the spec, async or blocking.

```python
from solvapay import AsyncApiClient

async with AsyncApiClient(api_key="sk_sandbox_...") as api:
    customer = await api.get_customer(reference="cus_123")
```

The methods are generated from ``openapi/sdk-v1.json``; this module only
adds construction and lifecycle.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import TracebackType
from typing import Any

import httpx

from ._generated.operations import AsyncSolvaPayApi, SolvaPayApi
from ._http import (
    DEFAULT_API_BASE_URL,
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT_SECONDS,
    AsyncTransport,
    SyncTransport,
)

__all__ = ["ApiClient", "AsyncApiClient"]


class AsyncApiClient(AsyncSolvaPayApi):
    """Async client. Use it as an async context manager, or call ``aclose()``."""

    def __init__(
        self,
        *,
        api_key: str,
        api_base_url: str = DEFAULT_API_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(
            AsyncTransport(
                api_key=api_key,
                api_base_url=api_base_url,
                timeout=timeout,
                max_retries=max_retries,
                client=http_client,
            )
        )

    @property
    def api_base_url(self) -> str:
        return self._transport.api_base_url

    async def request_json(
        self,
        method: str,
        path: str,
        *,
        query: Mapping[str, Any] | None = None,
        headers: Mapping[str, Any] | None = None,
        body: Any = None,
    ) -> Any:
        """One API request, answering the JSON the API sent, not read into a model.

        For code that passes the API's answer on unchanged (``solvapay.web``'s
        routes answer React with it). ``path`` is the API path with its
        parameters already encoded (``_http.path_segment``). Failures raise
        ``SolvaPayError`` as every generated method does.
        """
        return await self._transport.request(
            method, path, query=query or {}, headers=headers or {}, body=body
        )

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def __aenter__(self) -> AsyncApiClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()


class ApiClient(SolvaPayApi):
    """Blocking client. Use it as a context manager, or call ``close()``."""

    def __init__(
        self,
        *,
        api_key: str,
        api_base_url: str = DEFAULT_API_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        http_client: httpx.Client | None = None,
    ) -> None:
        super().__init__(
            SyncTransport(
                api_key=api_key,
                api_base_url=api_base_url,
                timeout=timeout,
                max_retries=max_retries,
                client=http_client,
            )
        )

    @property
    def api_base_url(self) -> str:
        return self._transport.api_base_url

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> ApiClient:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
