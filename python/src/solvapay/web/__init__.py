"""The HTTP routes ``@solvapay/react``'s components call, for a Python backend.

Install with ``pip install 'solvapay[web]'``.

```python
from starlette.applications import Starlette
from starlette.routing import Mount

from solvapay import create_solvapay
from solvapay.web import User, routes


async def get_user(request) -> User | None:
    ...  # verify the request with your own auth; None when it has no signed-in user


solvapay = create_solvapay()
app = Starlette(
    routes=[Mount("/api", app=routes(solvapay, get_user=get_user, base_path=""))]
)
```

They answer as TypeScript's ``solvapayRoutes()`` (``@solvapay/server/fetch``)
does; ``conformance/cases/web-routes`` pins them down.
"""

from .routes import SOLVAPAY_ROUTES, GetUser, SolvaPayRoutes, User, routes

__all__ = ["SOLVAPAY_ROUTES", "GetUser", "SolvaPayRoutes", "User", "routes"]
