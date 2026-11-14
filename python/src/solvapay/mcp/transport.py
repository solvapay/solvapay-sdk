"""The widget's transport tools, ported from ``@solvapay/mcp-core``'s ``descriptors.ts``
and the ``@solvapay/server`` ``*Core`` helpers they call.

The SolvaPay widget calls these from its iframe (``app.callServerTool``) to pay, top
up, cancel or reactivate a renewal, open a hosted page and load history. They are
not for the model: each carries ``_meta.ui.visibility: ['app']`` and
``_meta.audience: 'ui'`` (see ``app.transport_tool_meta``).

Each answers like TypeScript's ``toolResult`` (the data as JSON text and as
structured content) or ``toolErrorResult`` (``{error, status, details}``), so the
widget sees the same responses from either SDK; ``conformance/cases/transport-tools``
pins them down. Unlike TypeScript, which goes through ``ensureCustomer``, the
customer is the signed-in ``cus_`` ref, used as is.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import Context, MCPServer
from mcp.types import CallToolResult, TextContent, ToolAnnotations
from pydantic import BaseModel, ConfigDict, Field, WithJsonSchema

from .._http import path_segment
from ..business_details import TAX_ID_TYPES, validate_business_details
from ..errors import SolvaPayError
from ..solvapay import SolvaPay
from .app import transport_tool_meta
from .intent import (
    _CONTEXT_PARAM,
    GetCustomerRef,
    _annotate,
    _error_from,
    _resolve_customer,
    tool_error_result,
)
from .narrate import ACTIVATE_PLAN_TOOL_NAME, VIEWER_TOOL_NAME
from .tools import default_customer_ref

Json = dict[str, Any]

CREATE_HOSTED_SESSION = "create_hosted_session"
CREATE_PAYMENT_INTENT = "create_payment_intent"
PROCESS_PAYMENT = "process_payment"
ATTACH_BUSINESS_DETAILS = "attach_business_details"
SET_RENEWAL = "set_renewal"
GET_HISTORY = "get_history"

TRANSPORT_TOOL_NAMES = (
    CREATE_HOSTED_SESSION,
    CREATE_PAYMENT_INTENT,
    PROCESS_PAYMENT,
    ATTACH_BUSINESS_DETAILS,
    SET_RENEWAL,
    GET_HISTORY,
)

UI_ONLY_PREFIX = (
    f"UI-only; agents should prefer `{VIEWER_TOOL_NAME}` / `{ACTIVATE_PLAN_TOOL_NAME}`. "
)

SETTLE_SECONDS = 0.5
"""How long ``set_renewal`` waits after the API answers, as TypeScript's
``cancelPurchaseCore`` and ``reactivatePurchaseCore`` do, so the widget's next read
sees the change."""

TaxIdType = Literal[TAX_ID_TYPES]  # type: ignore[valid-type]


MAX_SAFE_INTEGER = 9007199254740991
"""zod's ``int()`` bound, which TypeScript's input schemas advertise as ``maximum``."""

# A positive amount in major units. ``int | float`` keeps a whole number whole on the
# wire; the schema says ``number``, as zod's ``z.number().positive()`` does.
PositiveMajor = Annotated[
    int | float, Field(gt=0), WithJsonSchema({"type": "number", "exclusiveMinimum": 0})
]


# ``autoRecharge`` on a top-up: save the card as the auto-recharge funding source.
# (A comment, not a docstring: pydantic would publish a docstring as the schema's
# description, and TypeScript's has none.)
class AutoRechargeArg(BaseModel):
    # zod drops keys it does not know, so this does too.
    model_config = ConfigDict(extra="ignore")

    enabled: bool
    triggerType: Literal["balance"]
    thresholdAmountMajor: PositiveMajor | None = None
    topupAmountMajor: PositiveMajor | None = None
    maxMonthlySpendMajor: PositiveMajor | None = None
    currency: Annotated[str, Field(min_length=3, max_length=3)]


def tool_result(data: Any) -> CallToolResult:
    """``toolResult``: the data as JSON text and as structured content."""
    return CallToolResult(
        content=[
            TextContent(
                type="text", text=json.dumps(data, separators=(",", ":"), ensure_ascii=False)
            )
        ],
        structured_content=data,
    )


def _dump(model: BaseModel) -> Any:
    return model.model_dump(mode="json", by_alias=True, exclude_unset=True)


def _idempotency_key(prefix: str) -> str:
    return f"{prefix}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:9]}"


def _text(value: Any) -> str | None:
    """A string argument, or None when it is missing or empty (TypeScript's
    ``typeof x === 'string' && x ? x : undefined``)."""
    return value if isinstance(value, str) and value else None


def _solvapay_tool(**hints: bool) -> ToolAnnotations:
    """Every SolvaPay tool talks to the SolvaPay API, so ``openWorldHint`` is always set."""
    return ToolAnnotations(open_world_hint=True, **hints)


def _param(name: str, annotation: Any, default: Any = inspect.Parameter.empty) -> inspect.Parameter:
    return inspect.Parameter(
        name, inspect.Parameter.KEYWORD_ONLY, default=default, annotation=annotation
    )


def _optional(name: str, annotation: Any) -> inspect.Parameter:
    return _param(name, annotation | None, None)


ToolBody = Callable[[str, Mapping[str, Any]], Awaitable[CallToolResult]]


def register_transport_tools(
    server: MCPServer,
    *,
    solvapay: SolvaPay,
    product_ref: str,
    resource_uri: str,
    get_customer_ref: GetCustomerRef | None = None,
) -> None:
    """Registers the six tools the widget calls. ``account`` and ``activate_plan`` come
    from ``register_intent_tools``."""
    api = solvapay.api
    resolve = get_customer_ref or default_customer_ref
    meta = transport_tool_meta(resource_uri)

    def add(
        name: str,
        body: ToolBody,
        params: list[inspect.Parameter],
        description: str,
        annotations: ToolAnnotations,
    ) -> None:
        async def tool(**kwargs: Any) -> CallToolResult:
            context: Context = kwargs.pop(_CONTEXT_PARAM)
            customer_ref = await _resolve_customer(resolve, kwargs, context)
            if customer_ref is None:
                return tool_error_result(
                    "Unauthorized", 401, "customer_ref missing from MCP auth context"
                )
            return await body(customer_ref, kwargs)

        tool.__name__ = name
        _annotate(tool, params)
        server.add_tool(
            tool,
            name=name,
            description=UI_ONLY_PREFIX + description,
            annotations=annotations,
            meta=meta,
            structured_output=False,
        )

    # ---- create_hosted_session -----------------------------------------------

    async def create_hosted_session(customer_ref: str, args: Mapping[str, Any]) -> CallToolResult:
        kind = args.get("kind")
        if kind not in ("checkout", "portal"):
            return tool_error_result(
                "create_hosted_session requires kind",
                400,
                'Pass kind: "checkout" or kind: "portal".',
            )
        try:
            if kind == "portal":
                portal = await api.create_customer_session(body={"customerRef": customer_ref})
                return tool_result(_dump(portal))
            body: Json = {
                "productRef": _text(args.get("productRef")) or product_ref,
                "customerRef": customer_ref,
            }
            plan_ref = _text(args.get("planRef"))
            if plan_ref:
                body["planRef"] = plan_ref
            # MCP has no page to come back to, so no returnUrl (createMcpCheckoutSession).
            session = await api.create_checkout_session(body=body)
        except SolvaPayError as error:
            return _error_from(error)
        return tool_result({"sessionId": session.session_id, "checkoutUrl": session.checkout_url})

    add(
        CREATE_HOSTED_SESSION,
        create_hosted_session,
        [
            _param(
                "kind",
                Annotated[
                    Literal["checkout", "portal"],
                    Field(
                        description='"checkout" for hosted checkout; "portal" for customer portal.'
                    ),
                ],
            ),
            _optional("planRef", str),
            _optional("productRef", str),
        ],
        'Create a SolvaPay hosted session and return its URL. Pass kind: "checkout" for a '
        'hosted checkout URL (fallback when Stripe Elements is blocked) or kind: "portal" for '
        "the customer portal URL.",
        _solvapay_tool(read_only_hint=False, destructive_hint=False, idempotent_hint=True),
    )

    # ---- create_payment_intent -----------------------------------------------

    def intent_result(intent: Any, customer_ref: str) -> CallToolResult:
        data: Json = {
            "processorPaymentId": intent.processor_payment_id,
            "clientSecret": intent.client_secret,
            "publishableKey": intent.publishable_key,
        }
        if intent.account_id is not None:
            data["accountId"] = intent.account_id
        data["customerRef"] = customer_ref
        return tool_result(data)

    async def create_payment_intent(customer_ref: str, args: Mapping[str, Any]) -> CallToolResult:
        purpose = args.get("purpose")
        if purpose not in ("plan", "topup"):
            return tool_error_result(
                "create_payment_intent requires purpose",
                400,
                'Pass purpose: "plan" or purpose: "topup".',
            )
        auto_recharge = args.get("autoRecharge")
        if purpose == "plan" and auto_recharge is not None:
            return tool_error_result(
                "create_payment_intent plan does not accept autoRecharge",
                400,
                'autoRecharge is only honoured on purpose: "topup".',
            )

        if purpose == "topup":
            amount = args.get("amount")
            currency = _text(args.get("currency"))
            if not amount or not currency:
                return tool_error_result(
                    "create_payment_intent topup requires amount and currency",
                    400,
                    'Pass purpose: "topup" with amount (integer cents) and currency.',
                )
            if currency != currency.upper():
                return tool_error_result(
                    f'Invalid currency "{currency}": must be an uppercase ISO 4217 code '
                    '(e.g. "USD", "EUR")',
                    400,
                )
            body: Json = {
                "customerRef": customer_ref,
                "purpose": "credit_topup",
                "amount": amount,
                "currency": currency,
            }
            description = args.get("description")
            if isinstance(description, str):
                body["description"] = description
            if auto_recharge is not None:
                body["autoRecharge"] = AutoRechargeArg.model_validate(auto_recharge).model_dump(
                    exclude_none=True
                )
            try:
                intent = await api.create_payment_intent(
                    body=body, idempotency_key=_idempotency_key("topup")
                )
            except SolvaPayError as error:
                return _error_from(error)
            return intent_result(intent, customer_ref)

        plan_ref = _text(args.get("planRef"))
        if not plan_ref:
            return tool_error_result(
                "create_payment_intent plan requires planRef",
                400,
                'Pass purpose: "plan" with planRef and productRef.',
            )
        plan_body: Json = {
            "productRef": _text(args.get("productRef")) or product_ref,
            "planRef": plan_ref,
            "customerRef": customer_ref,
        }
        plan_currency = _text(args.get("currency"))
        if plan_currency:
            plan_body["currency"] = plan_currency
        try:
            intent = await api.create_payment_intent(
                body=plan_body, idempotency_key=_idempotency_key(f"payment-{plan_ref}")
            )
        except SolvaPayError as error:
            return _error_from(error)
        return intent_result(intent, customer_ref)

    add(
        CREATE_PAYMENT_INTENT,
        create_payment_intent,
        [
            _param(
                "purpose",
                Annotated[
                    Literal["plan", "topup"],
                    Field(description='"plan" for plan checkout; "topup" for credit top-up.'),
                ],
            ),
            _optional("planRef", str),
            _optional("productRef", str),
            _optional("currency", str),
            _optional("amount", Annotated[int, Field(gt=0, le=MAX_SAFE_INTEGER)]),
            _optional("description", str),
            _optional("autoRecharge", AutoRechargeArg),
        ],
        "Create a Stripe payment intent for the authenticated customer. Pass purpose: "
        '"plan" to purchase a plan (returns { clientSecret, publishableKey, accountId?, '
        'customerRef }) or purpose: "topup" for a credit top-up (credits are recorded by '
        "webhook after confirmation). A topup may carry autoRecharge so the card entered for "
        "the top-up is saved as the auto-recharge funding source.",
        _solvapay_tool(read_only_hint=False, destructive_hint=False),
    )

    # ---- process_payment -----------------------------------------------------

    async def process_payment(customer_ref: str, args: Mapping[str, Any]) -> CallToolResult:
        payment_intent_id = _text(args.get("paymentIntentId"))
        product = _text(args.get("productRef")) or product_ref
        if not payment_intent_id:
            return tool_error_result("paymentIntentId and productRef are required", 400)
        body: Json = {"productRef": product, "customerRef": customer_ref}
        plan_ref = _text(args.get("planRef"))
        if plan_ref:
            body["planRef"] = plan_ref
        try:
            result = await api.process_payment_intent(
                processor_payment_id=payment_intent_id, body=body
            )
        except SolvaPayError as error:
            return _error_from(error)
        return tool_result(_dump(result))

    add(
        PROCESS_PAYMENT,
        process_payment,
        [
            _param("paymentIntentId", str),
            _param("productRef", str),
            _optional("planRef", str),
        ],
        "Process a Stripe payment intent after client-side confirmation and create the "
        "SolvaPay purchase. Call after confirmPayment resolves to short-circuit webhook latency.",
        _solvapay_tool(destructive_hint=True),
    )

    # ---- attach_business_details ---------------------------------------------

    async def attach_business_details(customer_ref: str, args: Mapping[str, Any]) -> CallToolResult:
        payment_intent_id = _text(args.get("paymentIntentId"))
        if not payment_intent_id:
            return tool_error_result("paymentIntentId is required", 400)
        try:
            details = validate_business_details(
                is_business=args.get("isBusiness") is True,
                business_name=args.get("businessName"),
                country=args.get("country"),
                customer_country=args.get("customerCountry"),
                customer_name=args.get("customerName"),
                customer_state=args.get("customerState"),
                customer_postal_code=args.get("customerPostalCode"),
                tax_id=args.get("taxId"),
            )
        except SolvaPayError as error:
            return tool_error_result(error.message, 400)
        try:
            result = await api.attach_business_details(
                processor_payment_id=payment_intent_id,
                body={**details, "customerRef": customer_ref},
            )
        except SolvaPayError as error:
            return _error_from(error)
        return tool_result(_dump(result))

    add(
        ATTACH_BUSINESS_DETAILS,
        attach_business_details,
        [
            _param("paymentIntentId", str),
            _param("isBusiness", bool),
            _optional("businessName", str),
            _optional("country", str),
            _optional("customerCountry", str),
            _optional("customerName", str),
            _optional("customerState", str),
            _optional("customerPostalCode", str),
            _optional("taxId", str),
            _optional("taxIdType", TaxIdType),
        ],
        "Attach business purchase details to a payment intent and retrieve the computed "
        "tax breakdown.",
        _solvapay_tool(read_only_hint=False, destructive_hint=False, idempotent_hint=True),
    )

    # ---- set_renewal ---------------------------------------------------------

    def renewal_error(error: SolvaPayError, refused: str) -> CallToolResult:
        if error.status == 404:
            return tool_error_result("Purchase not found", 404, error.message)
        if error.status == 400:
            return tool_error_result(refused, 400, error.message)
        return tool_error_result(error.message, 500, error.message)

    async def require_own_purchase(customer_ref: str, purchase_ref: str) -> CallToolResult | None:
        """The purchase must be the signed-in customer's (TypeScript's ``requireOwnPurchase``):
        renewal acts on a purchase by reference, so without this any customer could cancel
        or reactivate another's. Read as the API sends it: only its ``customerRef`` counts."""
        try:
            purchase = await api.request_json(
                "GET", f"/v1/sdk/purchases/{path_segment(purchase_ref)}"
            )
        except SolvaPayError as error:
            if error.status == 404:
                return tool_error_result("Purchase not found", 404, error.message)
            return tool_error_result(error.message, 500, error.message)
        if not isinstance(purchase, dict):
            raise SolvaPayError(
                f"GET /v1/sdk/purchases/{purchase_ref} answered with something that is not "
                f"a purchase: {purchase!r}",
                code="invalid_response",
            )
        if purchase.get("customerRef") != customer_ref:
            return tool_error_result("Forbidden", 403, "This purchase belongs to another customer")
        return None

    async def set_renewal(customer_ref: str, args: Mapping[str, Any]) -> CallToolResult:
        enabled = args.get("enabled")
        if enabled is not True and enabled is not False:
            return tool_error_result(
                "set_renewal requires enabled",
                400,
                "Pass enabled: true to reactivate auto-renewal or enabled: false to cancel.",
            )
        purchase_ref = _text(args.get("purchaseRef"))
        if not purchase_ref:
            return tool_error_result("Missing required parameter: purchaseRef is required", 400)
        refused = await require_own_purchase(customer_ref, purchase_ref)
        if refused is not None:
            return refused

        if enabled:
            try:
                response: Json = _dump(await api.reactivate_purchase(purchase_ref=purchase_ref))
            except SolvaPayError as error:
                return renewal_error(error, "Purchase cannot be reactivated")
            purchase = response.get("purchase")
            purchase = purchase if isinstance(purchase, dict) else response
            if not purchase.get("reference"):
                return tool_error_result(
                    "Reactivate purchase response missing required fields", 500
                )
            if purchase.get("cancelledAt"):
                return tool_error_result(
                    "Purchase reactivation failed: cancelledAt is still set", 500
                )
            await asyncio.sleep(SETTLE_SECONDS)
            return tool_result(purchase)

        reason = args.get("reason")
        try:
            response = _dump(
                await api.cancel_purchase(
                    purchase_ref=purchase_ref,
                    body={"reason": reason} if isinstance(reason, str) and reason else {},
                )
            )
        except SolvaPayError as error:
            return renewal_error(
                error, "Purchase cannot be cancelled or does not belong to provider"
            )
        purchase = response.get("purchase")
        purchase = purchase if isinstance(purchase, dict) else response
        if not purchase.get("reference"):
            return tool_error_result("Cancel purchase response missing required fields", 500)
        if purchase.get("status") != "cancelled" and not purchase.get("cancelledAt"):
            return tool_error_result(
                "Purchase cancellation failed: backend returned status "
                f"'{purchase.get('status')}' without cancelledAt timestamp",
                500,
            )
        await asyncio.sleep(SETTLE_SECONDS)
        return tool_result(purchase)

    add(
        SET_RENEWAL,
        set_renewal,
        [
            _param("purchaseRef", str),
            _param(
                "enabled",
                Annotated[
                    bool,
                    Field(description="true to reactivate auto-renewal; false to cancel renewal."),
                ],
            ),
            _optional("reason", str),
        ],
        "Toggle auto-renewal on an active purchase. Pass enabled: false to cancel (access "
        "continues until period end) or enabled: true to undo a pending cancellation.",
        _solvapay_tool(destructive_hint=True, idempotent_hint=True),
    )

    # ---- get_history ---------------------------------------------------------

    async def get_history(customer_ref: str, args: Mapping[str, Any]) -> CallToolResult:
        product = _text(args.get("productRef")) or product_ref
        limit = args.get("limit")
        try:
            purchases, activity = await asyncio.gather(
                api.list_purchases(customer_ref=customer_ref, product_ref=product),
                api.get_credit_activity(customer_ref=customer_ref, limit=limit),
            )
        except SolvaPayError as error:
            return _error_from(error)
        return tool_result(
            {
                "charges": [_dump(purchase) for purchase in purchases.purchases or []],
                "creditActivity": _dump(activity),
            }
        )

    add(
        GET_HISTORY,
        get_history,
        [
            _optional("productRef", str),
            _optional("limit", Annotated[int, Field(gt=0, le=100)]),
        ],
        "Load product charge history and account-wide credit activity for the authenticated "
        "customer. Charges come from purchases for this product; credit activity is every "
        "credit event on the account.",
        _solvapay_tool(read_only_hint=True, idempotent_hint=True),
    )


__all__ = [
    "TRANSPORT_TOOL_NAMES",
    "UI_ONLY_PREFIX",
    "AutoRechargeArg",
    "register_transport_tools",
    "tool_result",
]
