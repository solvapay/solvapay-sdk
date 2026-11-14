"""Python backend for the @solvapay/react web checkout proof.

Serves the routes the React components call under /api with solvapay.web.routes(),
plus a demo login at POST /auth/demo-login. Run: uv run python main.py (port 4010).
"""

from __future__ import annotations

import os
import time

import jwt
import uvicorn
from dotenv import load_dotenv
from solvapay import create_solvapay
from solvapay.web import User, routes
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

load_dotenv()

DEMO_JWT_SECRET = os.environ.get("DEMO_JWT_SECRET")
if not DEMO_JWT_SECRET:
    raise SystemExit("Set DEMO_JWT_SECRET (e.g. `openssl rand -hex 32`) in .env")
for name in ("SOLVAPAY_SECRET_KEY", "SOLVAPAY_API_BASE_URL", "SOLVAPAY_PRODUCT_REF"):
    if not os.environ.get(name):
        raise SystemExit(f"Set {name} in .env")

TOKEN_SECONDS = 3600
PORT = 4010


async def demo_login(request: Request) -> JSONResponse:
    """DEMO ONLY: signs a token for whatever id is posted. A real app signs people
    in with its own auth and get_user verifies that."""
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"error": "Body must be JSON"}, status_code=400)
    user_id = body.get("userId") if isinstance(body, dict) else None
    if not isinstance(user_id, str) or not user_id.strip():
        return JSONResponse({"error": "userId is required"}, status_code=400)
    now = int(time.time())
    token = jwt.encode(
        {"sub": user_id, "email": f"{user_id}@example.com", "iat": now, "exp": now + TOKEN_SECONDS},
        DEMO_JWT_SECRET,
        algorithm="HS256",
    )
    return JSONResponse({"token": token, "userId": user_id})


def get_user(request: Request) -> User | None:
    """The only identity the routes see: the verified bearer token, or None (401)."""
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        claims = jwt.decode(
            token, DEMO_JWT_SECRET, algorithms=["HS256"], options={"require": ["sub", "exp"]}
        )
    except jwt.InvalidTokenError:
        return None
    return User(id=claims["sub"], email=claims.get("email"))


app = Starlette(
    routes=[
        Route("/auth/demo-login", demo_login, methods=["POST"]),
        Mount("/api", app=routes(create_solvapay(), get_user=get_user, base_path="")),
    ]
)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
