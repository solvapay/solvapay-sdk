//! Generated host driver loops (gate + payable action dispatch).

use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::Ir;

/// `sdks/typescript/server/src/drivers.generated.ts`
pub fn emit_drivers_ts(_ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::Block, "ts-drivers-out");
    out.push('\n');
    out.push_str(
        "export type GateDriverHost = {\n\
         \x20 ensureCustomer(customerRef: string): Promise<string>\n\
         \x20 readLimitsCache(key: string): Promise<\n\
         \x20   | { found: false }\n\
         \x20   | { found: true; remaining: number; limits: unknown; timestampMs: number }\n\
         \x20 >\n\
         \x20 checkLimits(args: {\n\
         \x20   customerRef: string\n\
         \x20   productRef: string\n\
         \x20   meterName: string\n\
         \x20   includeCheckoutSession: boolean\n\
         \x20   cacheDeleteKey?: string\n\
         \x20 }): Promise<unknown>\n\
         \x20 applyCache(cache: unknown): void\n\
         \x20 nowMs(): number\n\
         }\n\n\
         export type GateDriverStep = {\n\
         \x20 state: unknown\n\
         \x20 action: { kind: string; [key: string]: unknown }\n\
         }\n\n\
         export async function runGeneratedGateLoop(\n\
         \x20 gateNext: (state: unknown, event: unknown) => GateDriverStep,\n\
         \x20 host: GateDriverHost,\n\
         \x20 startEvent: Record<string, unknown>,\n\
         ): Promise<GateDriverStep> {\n\
         \x20 let state: unknown = null\n\
         \x20 let event: Record<string, unknown> = startEvent\n\
         \x20 for (;;) {\n\
         \x20   const out = gateNext(state, event)\n\
         \x20   state = out.state\n\
         \x20   const action = out.action\n\
         \x20   if (action.kind === 'ensureCustomer') {\n\
         \x20     const backendRef = await host.ensureCustomer(String(action.customerRef))\n\
         \x20     event = { kind: 'customerResolved', backendRef, nowMs: host.nowMs() }\n\
         \x20     continue\n\
         \x20   }\n\
         \x20   if (action.kind === 'readLimitsCache') {\n\
         \x20     const cached = await host.readLimitsCache(String(action.key))\n\
         \x20     event = cached.found\n\
         \x20       ? {\n\
         \x20           kind: 'limitsCacheEntry',\n\
         \x20           found: true,\n\
         \x20           remaining: cached.remaining,\n\
         \x20           limits: cached.limits,\n\
         \x20           timestampMs: cached.timestampMs,\n\
         \x20           nowMs: host.nowMs(),\n\
         \x20         }\n\
         \x20       : { kind: 'limitsCacheEntry', found: false, nowMs: host.nowMs() }\n\
         \x20     continue\n\
         \x20   }\n\
         \x20   if (action.kind === 'checkLimits') {\n\
         \x20     const limits = await host.checkLimits({\n\
         \x20       customerRef: String(action.customerRef),\n\
         \x20       productRef: String(action.productRef),\n\
         \x20       meterName: String(action.meterName),\n\
         \x20       includeCheckoutSession: action.includeCheckoutSession === true,\n\
         \x20       ...(typeof action.cacheDeleteKey === 'string'\n\
         \x20         ? { cacheDeleteKey: action.cacheDeleteKey }\n\
         \x20         : {}),\n\
         \x20     })\n\
         \x20     event = { kind: 'limitsResult', limits, nowMs: host.nowMs() }\n\
         \x20     continue\n\
         \x20   }\n\
         \x20   if (action.kind === 'allow' || action.kind === 'gate') {\n\
         \x20     host.applyCache(action.cache)\n\
         \x20     return { state, action }\n\
         \x20   }\n\
         \x20   if (action.kind === 'emitUsage' || action.kind === 'skipUsage') {\n\
         \x20     throw new Error(`gate_next returned ${String(action.kind)} during decide; usage actions belong on handler events`)\n\
         \x20   }\n\
         \x20   throw new Error(`gate_next returned unknown action: ${String(action.kind)}`)\n\
         \x20 }\n\
         }\n\n\
         export type PayableGateHostResult =\n\
         \x20 | { kind: 'paywall'; gate: unknown; message: string }\n\
         \x20 | { kind: 'allow'; customerRef: string; limits: unknown }\n\
         \x20 | { kind: 'return'; result: unknown }\n\n\
         export type PayableHandlerHostResult =\n\
         \x20 | { kind: 'ok'; envelope: unknown }\n\
         \x20 | { kind: 'paywall'; gate: unknown; message: string }\n\
         \x20 | { kind: 'err'; message: string }\n\
         \x20 | { kind: 'return'; result: unknown }\n\
         \x20 | { kind: 'fatal'; error: unknown }\n\n\
         export type PayableDriverHost = {\n\
         \x20 runGate(args: {\n\
         \x20   customerRef: string\n\
         \x20   product: string\n\
         \x20   usageType: string\n\
         \x20 }): Promise<PayableGateHostResult>\n\
         \x20 invokeHandler(args: {\n\
         \x20   customerRef: string\n\
         \x20   limits: unknown\n\
         \x20 }): Promise<PayableHandlerHostResult>\n\
         \x20 trackUsage(request: unknown): Promise<void>\n\
         \x20 nowMs(): number\n\
         \x20 randomUnit(): number\n\
         }\n\n\
         export async function runGeneratedPayableLoop(\n\
         \x20 payableNext: (state: unknown, event: unknown) => GateDriverStep,\n\
         \x20 host: PayableDriverHost,\n\
         \x20 startEvent: Record<string, unknown>,\n\
         ): Promise<unknown> {\n\
         \x20 let state: unknown = null\n\
         \x20 let event: Record<string, unknown> = startEvent\n\
         \x20 for (;;) {\n\
         \x20   const out = payableNext(state, event)\n\
         \x20   state = out.state\n\
         \x20   const action = out.action\n\
         \x20   if (action.kind === 'runGate') {\n\
         \x20     const gate = await host.runGate({\n\
         \x20       customerRef: String(action.customerRef),\n\
         \x20       product: String(action.product),\n\
         \x20       usageType: String(action.usageType),\n\
         \x20     })\n\
         \x20     if (gate.kind === 'return') return gate.result\n\
         \x20     if (gate.kind === 'paywall') {\n\
         \x20       event = { kind: 'gatePaywall', gate: gate.gate, message: gate.message }\n\
         \x20       continue\n\
         \x20     }\n\
         \x20     event = { kind: 'gateAllow', customerRef: gate.customerRef, limits: gate.limits }\n\
         \x20     continue\n\
         \x20   }\n\
         \x20   if (action.kind === 'invokeHandler') {\n\
         \x20     const invoked = await host.invokeHandler({\n\
         \x20       customerRef: String(action.customerRef),\n\
         \x20       limits: action.limits,\n\
         \x20     })\n\
         \x20     if (invoked.kind === 'return') return invoked.result\n\
         \x20     if (invoked.kind === 'fatal') throw invoked.error\n\
         \x20     if (invoked.kind === 'paywall') {\n\
         \x20       event = { kind: 'handlerPaywall', gate: invoked.gate, message: invoked.message }\n\
         \x20       continue\n\
         \x20     }\n\
         \x20     if (invoked.kind === 'err') {\n\
         \x20       event = {\n\
         \x20         kind: 'handlerErr',\n\
         \x20         message: invoked.message,\n\
         \x20         nowMs: host.nowMs(),\n\
         \x20         randomUnit: host.randomUnit(),\n\
         \x20       }\n\
         \x20       continue\n\
         \x20     }\n\
         \x20     event = {\n\
         \x20       kind: 'handlerOk',\n\
         \x20       envelope: invoked.envelope,\n\
         \x20       nowMs: host.nowMs(),\n\
         \x20       randomUnit: host.randomUnit(),\n\
         \x20     }\n\
         \x20     continue\n\
         \x20   }\n\
         \x20   if (action.kind === 'done') {\n\
         \x20     const track = action.track as { request?: unknown } | null | undefined\n\
         \x20     if (track?.request !== undefined && track.request !== null && typeof track.request === 'object') {\n\
         \x20       await host.trackUsage(track.request)\n\
         \x20     }\n\
         \x20     return action.result\n\
         \x20   }\n\
         \x20   throw new Error(`invokePayableNext unknown action kind: ${String(action.kind)}`)\n\
         \x20 }\n\
         }\n",
    );
    Ok(out)
}

/// `sdks/python/python/solvapay/drivers.generated.py`
pub fn emit_drivers_py(_ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::Hash, "py-drivers-out");
    out.push_str(
        "\n\"\"\"Generated gate driver loop. Host supplies I/O only.\"\"\"\n\n\
         from __future__ import annotations\n\n\
         from collections.abc import Awaitable, Callable\n\
         from typing import Any, Protocol\n\n\n\
         class GateDriverHost(Protocol):\n\
         \x20   def ensure_customer(self, customer_ref: str) -> str: ...\n\
         \x20   def read_limits_cache(self, key: str) -> dict[str, Any] | None: ...\n\
         \x20   def check_limits(self, action: dict[str, Any]) -> object: ...\n\
         \x20   def apply_cache(self, cache: object) -> None: ...\n\
         \x20   def now_ms(self) -> int: ...\n\n\n\
         class AsyncGateDriverHost(Protocol):\n\
         \x20   def ensure_customer(self, customer_ref: str) -> Awaitable[str]: ...\n\
         \x20   def read_limits_cache(self, key: str) -> dict[str, Any] | None: ...\n\
         \x20   def check_limits(self, action: dict[str, Any]) -> Awaitable[object]: ...\n\
         \x20   def apply_cache(self, cache: object) -> None: ...\n\
         \x20   def now_ms(self) -> int: ...\n\n\n\
         def _cache_event(\n\
         \x20   host: GateDriverHost | AsyncGateDriverHost,\n\
         \x20   action: dict[str, Any],\n\
         ) -> dict[str, Any]:\n\
         \x20   cached = host.read_limits_cache(str(action[\"key\"]))\n\
         \x20   now = host.now_ms()\n\
         \x20   if cached is None:\n\
         \x20       return {\"kind\": \"limitsCacheEntry\", \"found\": False, \"nowMs\": now}\n\
         \x20   return {\n\
         \x20       \"kind\": \"limitsCacheEntry\",\n\
         \x20       \"found\": True,\n\
         \x20       \"remaining\": cached[\"remaining\"],\n\
         \x20       \"limits\": cached[\"limits\"],\n\
         \x20       \"timestampMs\": cached[\"timestampMs\"],\n\
         \x20       \"nowMs\": now,\n\
         \x20   }\n\n\n\
         def run_generated_gate_loop(\n\
         \x20   gate_next: Callable[[object, object], dict[str, Any]],\n\
         \x20   host: GateDriverHost,\n\
         \x20   start_event: dict[str, Any],\n\
         ) -> dict[str, Any]:\n\
         \x20   state: object = None\n\
         \x20   event: dict[str, Any] = start_event\n\
         \x20   while True:\n\
         \x20       out = gate_next(state, event)\n\
         \x20       state = out[\"state\"]\n\
         \x20       action = out[\"action\"]\n\
         \x20       kind = action[\"kind\"]\n\
         \x20       if kind == \"ensureCustomer\":\n\
         \x20           backend_ref = host.ensure_customer(str(action[\"customerRef\"]))\n\
         \x20           event = {\"kind\": \"customerResolved\", \"backendRef\": backend_ref, \"nowMs\": host.now_ms()}\n\
         \x20           continue\n\
         \x20       if kind == \"readLimitsCache\":\n\
         \x20           event = _cache_event(host, action)\n\
         \x20           continue\n\
         \x20       if kind == \"checkLimits\":\n\
         \x20           limits = host.check_limits(action)\n\
         \x20           event = {\"kind\": \"limitsResult\", \"limits\": limits, \"nowMs\": host.now_ms()}\n\
         \x20           continue\n\
         \x20       if kind in (\"allow\", \"gate\"):\n\
         \x20           host.apply_cache(action.get(\"cache\"))\n\
         \x20           return {\"state\": state, \"action\": action}\n\
         \x20       if kind in (\"emitUsage\", \"skipUsage\"):\n\
         \x20           raise RuntimeError(f\"gate_next returned {kind} during decide\")\n\
         \x20       raise RuntimeError(f\"gate_next returned unknown action: {kind}\")\n\n\n\
         async def run_generated_gate_loop_async(\n\
         \x20   gate_next: Callable[[object, object], dict[str, Any]],\n\
         \x20   host: AsyncGateDriverHost,\n\
         \x20   start_event: dict[str, Any],\n\
         ) -> dict[str, Any]:\n\
         \x20   state: object = None\n\
         \x20   event: dict[str, Any] = start_event\n\
         \x20   while True:\n\
         \x20       out = gate_next(state, event)\n\
         \x20       state = out[\"state\"]\n\
         \x20       action = out[\"action\"]\n\
         \x20       kind = action[\"kind\"]\n\
         \x20       if kind == \"ensureCustomer\":\n\
         \x20           backend_ref = await host.ensure_customer(str(action[\"customerRef\"]))\n\
         \x20           event = {\"kind\": \"customerResolved\", \"backendRef\": backend_ref, \"nowMs\": host.now_ms()}\n\
         \x20           continue\n\
         \x20       if kind == \"readLimitsCache\":\n\
         \x20           event = _cache_event(host, action)\n\
         \x20           continue\n\
         \x20       if kind == \"checkLimits\":\n\
         \x20           limits = await host.check_limits(action)\n\
         \x20           event = {\"kind\": \"limitsResult\", \"limits\": limits, \"nowMs\": host.now_ms()}\n\
         \x20           continue\n\
         \x20       if kind in (\"allow\", \"gate\"):\n\
         \x20           host.apply_cache(action.get(\"cache\"))\n\
         \x20           return {\"state\": state, \"action\": action}\n\
         \x20       if kind in (\"emitUsage\", \"skipUsage\"):\n\
         \x20           raise RuntimeError(f\"gate_next returned {kind} during decide\")\n\
         \x20       raise RuntimeError(f\"gate_next returned unknown action: {kind}\")\n\n\n\
         class PayableDriverHost(Protocol):\n\
         \x20   def run_gate(self, action: dict[str, Any]) -> dict[str, Any]: ...\n\
         \x20   def invoke_handler(self, action: dict[str, Any]) -> dict[str, Any]: ...\n\
         \x20   def track_usage(self, request: object) -> None: ...\n\
         \x20   def now_ms(self) -> int: ...\n\
         \x20   def random_unit(self) -> float: ...\n\n\n\
         class AsyncPayableDriverHost(Protocol):\n\
         \x20   def run_gate(self, action: dict[str, Any]) -> Awaitable[dict[str, Any]]: ...\n\
         \x20   def invoke_handler(self, action: dict[str, Any]) -> Awaitable[dict[str, Any]]: ...\n\
         \x20   def track_usage(self, request: object) -> Awaitable[None]: ...\n\
         \x20   def now_ms(self) -> int: ...\n\
         \x20   def random_unit(self) -> float: ...\n\n\n\
         def _apply_payable_host_result(\n\
         \x20   host: PayableDriverHost | AsyncPayableDriverHost,\n\
         \x20   result: dict[str, Any],\n\
         ) -> dict[str, Any] | object:\n\
         \x20   kind = result.get(\"kind\")\n\
         \x20   if kind == \"return\":\n\
         \x20       return result[\"result\"]\n\
         \x20   if kind == \"paywall\":\n\
         \x20       return {\"kind\": \"paywall\", \"gate\": result[\"gate\"], \"message\": result[\"message\"]}\n\
         \x20   if kind == \"allow\":\n\
         \x20       return {\"kind\": \"allow\", \"customerRef\": result[\"customerRef\"], \"limits\": result[\"limits\"]}\n\
         \x20   if kind == \"ok\":\n\
         \x20       return {\"kind\": \"ok\", \"envelope\": result[\"envelope\"]}\n\
         \x20   if kind == \"err\":\n\
         \x20       return {\"kind\": \"err\", \"message\": result[\"message\"]}\n\
         \x20   if kind == \"fatal\":\n\
         \x20       raise result[\"error\"]\n\
         \x20   raise RuntimeError(f\"payable host returned unknown kind: {kind}\")\n\n\n\
         def run_generated_payable_loop(\n\
         \x20   payable_next: Callable[[object, object], dict[str, Any]],\n\
         \x20   host: PayableDriverHost,\n\
         \x20   start_event: dict[str, Any],\n\
         ) -> object:\n\
         \x20   state: object = None\n\
         \x20   event: dict[str, Any] = start_event\n\
         \x20   while True:\n\
         \x20       out = payable_next(state, event)\n\
         \x20       state = out[\"state\"]\n\
         \x20       action = out[\"action\"]\n\
         \x20       kind = action[\"kind\"]\n\
         \x20       if kind == \"runGate\":\n\
         \x20           gate = _apply_payable_host_result(host, host.run_gate(action))\n\
         \x20           if not isinstance(gate, dict):\n\
         \x20               return gate\n\
         \x20           if gate[\"kind\"] == \"paywall\":\n\
         \x20               event = {\"kind\": \"gatePaywall\", \"gate\": gate[\"gate\"], \"message\": gate[\"message\"]}\n\
         \x20           else:\n\
         \x20               event = {\n\
         \x20                   \"kind\": \"gateAllow\",\n\
         \x20                   \"customerRef\": gate[\"customerRef\"],\n\
         \x20                   \"limits\": gate[\"limits\"],\n\
         \x20               }\n\
         \x20           continue\n\
         \x20       if kind == \"invokeHandler\":\n\
         \x20           invoked = _apply_payable_host_result(host, host.invoke_handler(action))\n\
         \x20           if not isinstance(invoked, dict):\n\
         \x20               return invoked\n\
         \x20           if invoked[\"kind\"] == \"paywall\":\n\
         \x20               event = {\n\
         \x20                   \"kind\": \"handlerPaywall\",\n\
         \x20                   \"gate\": invoked[\"gate\"],\n\
         \x20                   \"message\": invoked[\"message\"],\n\
         \x20               }\n\
         \x20           elif invoked[\"kind\"] == \"err\":\n\
         \x20               event = {\n\
         \x20                   \"kind\": \"handlerErr\",\n\
         \x20                   \"message\": invoked[\"message\"],\n\
         \x20                   \"nowMs\": host.now_ms(),\n\
         \x20                   \"randomUnit\": host.random_unit(),\n\
         \x20               }\n\
         \x20           else:\n\
         \x20               event = {\n\
         \x20                   \"kind\": \"handlerOk\",\n\
         \x20                   \"envelope\": invoked[\"envelope\"],\n\
         \x20                   \"nowMs\": host.now_ms(),\n\
         \x20                   \"randomUnit\": host.random_unit(),\n\
         \x20               }\n\
         \x20           continue\n\
         \x20       if kind == \"done\":\n\
         \x20           track = action.get(\"track\")\n\
         \x20           if isinstance(track, dict) and track.get(\"request\") is not None:\n\
         \x20               host.track_usage(track[\"request\"])\n\
         \x20           return action.get(\"result\")\n\
         \x20       raise RuntimeError(f\"invoke_payable_next unknown action kind: {kind}\")\n\n\n\
         async def run_generated_payable_loop_async(\n\
         \x20   payable_next: Callable[[object, object], dict[str, Any]],\n\
         \x20   host: AsyncPayableDriverHost,\n\
         \x20   start_event: dict[str, Any],\n\
         ) -> object:\n\
         \x20   state: object = None\n\
         \x20   event: dict[str, Any] = start_event\n\
         \x20   while True:\n\
         \x20       out = payable_next(state, event)\n\
         \x20       state = out[\"state\"]\n\
         \x20       action = out[\"action\"]\n\
         \x20       kind = action[\"kind\"]\n\
         \x20       if kind == \"runGate\":\n\
         \x20           gate = _apply_payable_host_result(host, await host.run_gate(action))\n\
         \x20           if not isinstance(gate, dict):\n\
         \x20               return gate\n\
         \x20           if gate[\"kind\"] == \"paywall\":\n\
         \x20               event = {\"kind\": \"gatePaywall\", \"gate\": gate[\"gate\"], \"message\": gate[\"message\"]}\n\
         \x20           else:\n\
         \x20               event = {\n\
         \x20                   \"kind\": \"gateAllow\",\n\
         \x20                   \"customerRef\": gate[\"customerRef\"],\n\
         \x20                   \"limits\": gate[\"limits\"],\n\
         \x20               }\n\
         \x20           continue\n\
         \x20       if kind == \"invokeHandler\":\n\
         \x20           invoked = _apply_payable_host_result(host, await host.invoke_handler(action))\n\
         \x20           if not isinstance(invoked, dict):\n\
         \x20               return invoked\n\
         \x20           if invoked[\"kind\"] == \"paywall\":\n\
         \x20               event = {\n\
         \x20                   \"kind\": \"handlerPaywall\",\n\
         \x20                   \"gate\": invoked[\"gate\"],\n\
         \x20                   \"message\": invoked[\"message\"],\n\
         \x20               }\n\
         \x20           elif invoked[\"kind\"] == \"err\":\n\
         \x20               event = {\n\
         \x20                   \"kind\": \"handlerErr\",\n\
         \x20                   \"message\": invoked[\"message\"],\n\
         \x20                   \"nowMs\": host.now_ms(),\n\
         \x20                   \"randomUnit\": host.random_unit(),\n\
         \x20               }\n\
         \x20           else:\n\
         \x20               event = {\n\
         \x20                   \"kind\": \"handlerOk\",\n\
         \x20                   \"envelope\": invoked[\"envelope\"],\n\
         \x20                   \"nowMs\": host.now_ms(),\n\
         \x20                   \"randomUnit\": host.random_unit(),\n\
         \x20               }\n\
         \x20           continue\n\
         \x20       if kind == \"done\":\n\
         \x20           track = action.get(\"track\")\n\
         \x20           if isinstance(track, dict) and track.get(\"request\") is not None:\n\
         \x20               await host.track_usage(track[\"request\"])\n\
         \x20           return action.get(\"result\")\n\
         \x20       raise RuntimeError(f\"invoke_payable_next unknown action kind: {kind}\")\n",
    );
    Ok(out)
}

/// `sdks/go/drivers_generated.go`
pub fn emit_drivers_go(_ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::Go, "go-drivers-out");
    out.push_str(
        "\npackage solvapay\n\n\
         import (\n\
         \t\"context\"\n\
         \t\"fmt\"\n\
         )\n\n\
         // GateDriverHost is the I/O surface for [`RunGeneratedGateLoop`].\n\
         type GateDriverHost interface {\n\
         \tEnsureCustomer(ctx context.Context, customerRef string) (string, error)\n\
         \tReadLimitsCache(key string) (found bool, remaining any, limits map[string]any, timestampMs int64)\n\
         \tCheckLimits(ctx context.Context, action map[string]any) (any, error)\n\
         \tApplyCache(cache any) error\n\
         \tNowMs() int64\n\
         }\n\n\
         // RunGeneratedGateLoop drives `gate_next` until allow or gate.\n\
         func RunGeneratedGateLoop(\n\
         \tctx context.Context,\n\
         \tgateNext func(state any, event map[string]any) (any, map[string]any, error),\n\
         \thost GateDriverHost,\n\
         \tstartEvent map[string]any,\n\
         ) (any, map[string]any, error) {\n\
         \tstate := any(nil)\n\
         \tevent := startEvent\n\
         \tfor {\n\
         \t\tnextState, action, err := gateNext(state, event)\n\
         \t\tif err != nil {\n\
         \t\t\treturn nil, nil, err\n\
         \t\t}\n\
         \t\tstate = nextState\n\
         \t\tkind, _ := action[\"kind\"].(string)\n\
         \t\tswitch kind {\n\
         \t\tcase \"ensureCustomer\":\n\
         \t\t\tref, _ := action[\"customerRef\"].(string)\n\
         \t\t\tbackendRef, err := host.EnsureCustomer(ctx, ref)\n\
         \t\t\tif err != nil {\n\
         \t\t\t\treturn nil, nil, err\n\
         \t\t\t}\n\
         \t\t\tevent = map[string]any{\"kind\": \"customerResolved\", \"backendRef\": backendRef, \"nowMs\": host.NowMs()}\n\
         \t\tcase \"readLimitsCache\":\n\
         \t\t\tkey, _ := action[\"key\"].(string)\n\
         \t\t\tfound, remaining, limits, timestampMs := host.ReadLimitsCache(key)\n\
         \t\t\tnow := host.NowMs()\n\
         \t\t\tif found {\n\
         \t\t\t\tevent = map[string]any{\n\
         \t\t\t\t\t\"kind\": \"limitsCacheEntry\", \"found\": true, \"remaining\": remaining,\n\
         \t\t\t\t\t\"limits\": limits, \"timestampMs\": timestampMs, \"nowMs\": now,\n\
         \t\t\t\t}\n\
         \t\t\t} else {\n\
         \t\t\t\tevent = map[string]any{\"kind\": \"limitsCacheEntry\", \"found\": false, \"nowMs\": now}\n\
         \t\t\t}\n\
         \t\tcase \"checkLimits\":\n\
         \t\t\tlimits, err := host.CheckLimits(ctx, action)\n\
         \t\t\tif err != nil {\n\
         \t\t\t\treturn nil, nil, err\n\
         \t\t\t}\n\
         \t\t\tevent = map[string]any{\"kind\": \"limitsResult\", \"limits\": limits, \"nowMs\": host.NowMs()}\n\
         \t\tcase \"allow\", \"gate\":\n\
         \t\t\tif err := host.ApplyCache(action[\"cache\"]); err != nil {\n\
         \t\t\t\treturn nil, nil, err\n\
         \t\t\t}\n\
         \t\t\treturn state, action, nil\n\
         \t\tcase \"emitUsage\", \"skipUsage\":\n\
         \t\t\treturn nil, nil, fmt.Errorf(\"solvapay: gate_next returned %s during decide\", kind)\n\
         \t\tdefault:\n\
         \t\t\treturn nil, nil, fmt.Errorf(\"solvapay: gate_next returned unknown action kind %s\", kind)\n\
         \t\t}\n\
         \t}\n\
         }\n\n\
         // PayableGateHostResult is the I/O result of RunGate.\n\
         type PayableGateHostResult struct {\n\
         \tKind        string\n\
         \tGate        any\n\
         \tMessage     string\n\
         \tCustomerRef string\n\
         \tLimits      any\n\
         \tResult      any\n\
         }\n\n\
         // PayableHandlerHostResult is the I/O result of InvokeHandler.\n\
         type PayableHandlerHostResult struct {\n\
         \tKind     string\n\
         \tEnvelope any\n\
         \tGate     any\n\
         \tMessage  string\n\
         \tResult   any\n\
         \tFatal    error\n\
         }\n\n\
         // PayableDriverHost is the I/O surface for [`RunGeneratedPayableLoop`].\n\
         type PayableDriverHost interface {\n\
         \tRunGate(ctx context.Context, customerRef, product, usageType string) (PayableGateHostResult, error)\n\
         \tInvokeHandler(ctx context.Context, customerRef string, limits any) (PayableHandlerHostResult, error)\n\
         \tTrackUsage(ctx context.Context, request any) error\n\
         \tNowMs() int64\n\
         \tRandomUnit() float64\n\
         }\n\n\
         // RunGeneratedPayableLoop drives `invoke_payable_next` until done.\n\
         func RunGeneratedPayableLoop(\n\
         \tctx context.Context,\n\
         \tpayableNext func(state any, event map[string]any) (any, map[string]any, error),\n\
         \thost PayableDriverHost,\n\
         \tstartEvent map[string]any,\n\
         ) (any, error) {\n\
         \tstate := any(nil)\n\
         \tevent := startEvent\n\
         \tfor {\n\
         \t\tnextState, action, err := payableNext(state, event)\n\
         \t\tif err != nil {\n\
         \t\t\treturn nil, err\n\
         \t\t}\n\
         \t\tstate = nextState\n\
         \t\tkind, _ := action[\"kind\"].(string)\n\
         \t\tswitch kind {\n\
         \t\tcase \"runGate\":\n\
         \t\t\tref, _ := action[\"customerRef\"].(string)\n\
         \t\t\tproduct, _ := action[\"product\"].(string)\n\
         \t\t\tusageType, _ := action[\"usageType\"].(string)\n\
         \t\t\tgate, err := host.RunGate(ctx, ref, product, usageType)\n\
         \t\t\tif err != nil {\n\
         \t\t\t\treturn nil, err\n\
         \t\t\t}\n\
         \t\t\tswitch gate.Kind {\n\
         \t\t\tcase \"return\":\n\
         \t\t\t\treturn gate.Result, nil\n\
         \t\t\tcase \"paywall\":\n\
         \t\t\t\tevent = map[string]any{\"kind\": \"gatePaywall\", \"gate\": gate.Gate, \"message\": gate.Message}\n\
         \t\t\tdefault:\n\
         \t\t\t\tevent = map[string]any{\"kind\": \"gateAllow\", \"customerRef\": gate.CustomerRef, \"limits\": gate.Limits}\n\
         \t\t\t}\n\
         \t\tcase \"invokeHandler\":\n\
         \t\t\tref, _ := action[\"customerRef\"].(string)\n\
         \t\t\tinvoked, err := host.InvokeHandler(ctx, ref, action[\"limits\"])\n\
         \t\t\tif err != nil {\n\
         \t\t\t\treturn nil, err\n\
         \t\t\t}\n\
         \t\t\tif invoked.Fatal != nil {\n\
         \t\t\t\treturn nil, invoked.Fatal\n\
         \t\t\t}\n\
         \t\t\tswitch invoked.Kind {\n\
         \t\t\tcase \"return\":\n\
         \t\t\t\treturn invoked.Result, nil\n\
         \t\t\tcase \"paywall\":\n\
         \t\t\t\tevent = map[string]any{\"kind\": \"handlerPaywall\", \"gate\": invoked.Gate, \"message\": invoked.Message}\n\
         \t\t\tcase \"err\":\n\
         \t\t\t\tevent = map[string]any{\"kind\": \"handlerErr\", \"message\": invoked.Message, \"nowMs\": host.NowMs(), \"randomUnit\": host.RandomUnit()}\n\
         \t\t\tdefault:\n\
         \t\t\t\tevent = map[string]any{\"kind\": \"handlerOk\", \"envelope\": invoked.Envelope, \"nowMs\": host.NowMs(), \"randomUnit\": host.RandomUnit()}\n\
         \t\t\t}\n\
         \t\tcase \"done\":\n\
         \t\t\tif track, ok := action[\"track\"].(map[string]any); ok {\n\
         \t\t\t\tif req := track[\"request\"]; req != nil {\n\
         \t\t\t\t\tif err := host.TrackUsage(ctx, req); err != nil {\n\
         \t\t\t\t\t\treturn nil, err\n\
         \t\t\t\t\t}\n\
         \t\t\t\t}\n\
         \t\t\t}\n\
         \t\t\treturn action[\"result\"], nil\n\
         \t\tdefault:\n\
         \t\t\treturn nil, fmt.Errorf(\"solvapay: invokePayableNext unknown action kind %s\", kind)\n\
         \t\t}\n\
         \t}\n\
         }\n",
    );
    Ok(out)
}

/// `sdks/ruby/lib/solvapay/drivers.generated.rb`
pub fn emit_drivers_rb(_ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::Hash, "rb-drivers-out");
    out.push_str(
        "\n# frozen_string_literal: true\n\n\
         module SolvaPay\n\
         \x20 module GeneratedGateLoop\n\
         \x20   def self.run(gate_next:, host:, start_event:)\n\
         \x20     state = nil\n\
         \x20     event = start_event\n\
         \x20     loop do\n\
         \x20       out = gate_next.call(state, event)\n\
         \x20       unless out.is_a?(Hash)\n\
         \x20         raise SolvaPay::SolvaPayError.new(\"gate_next returned unexpected value\", code: \"internal_error\")\n\
         \x20       end\n\
         \n\
         \x20       state = out[\"state\"]\n\
         \x20       action = out[\"action\"]\n\
         \x20       unless action.is_a?(Hash)\n\
         \x20         raise SolvaPay::SolvaPayError.new(\"gate_next returned unexpected action\", code: \"internal_error\")\n\
         \x20       end\n\
         \n\
         \x20       case action[\"kind\"]\n\
         \x20       when \"ensureCustomer\"\n\
         \x20         backend_ref = host.ensure_customer(action[\"customerRef\"])\n\
         \x20         event = { \"kind\" => \"customerResolved\", \"backendRef\" => backend_ref, \"nowMs\" => host.now_ms }\n\
         \x20       when \"readLimitsCache\"\n\
         \x20         cached = host.read_limits_cache(action[\"key\"])\n\
         \x20         now = host.now_ms\n\
         \x20         event = if cached.is_a?(Hash)\n\
         \x20                   {\n\
         \x20                     \"kind\" => \"limitsCacheEntry\",\n\
         \x20                     \"found\" => true,\n\
         \x20                     \"remaining\" => cached.fetch(:remaining),\n\
         \x20                     \"limits\" => cached[:limits],\n\
         \x20                     \"timestampMs\" => cached.fetch(:timestamp),\n\
         \x20                     \"nowMs\" => now,\n\
         \x20                   }\n\
         \x20                 else\n\
         \x20                   { \"kind\" => \"limitsCacheEntry\", \"found\" => false, \"nowMs\" => now }\n\
         \x20                 end\n\
         \x20       when \"checkLimits\"\n\
         \x20         limits = host.check_limits(action)\n\
         \x20         event = { \"kind\" => \"limitsResult\", \"limits\" => limits, \"nowMs\" => host.now_ms }\n\
         \x20       when \"allow\", \"gate\"\n\
         \x20         host.apply_cache(action[\"cache\"])\n\
         \x20         return { \"state\" => state, \"action\" => action }\n\
         \x20       when \"emitUsage\", \"skipUsage\"\n\
         \x20         kind = action[\"kind\"]\n\
         \x20         raise SolvaPay::SolvaPayError.new(\n\
         \x20           \"gate_next returned #{kind} during decide\",\n\
         \x20           code: \"internal_error\",\n\
         \x20         )\n\
         \x20       else\n\
         \x20         raise SolvaPay::SolvaPayError.new(\"gate_next returned unknown action kind\", code: \"internal_error\")\n\
         \x20       end\n\
         \x20     end\n\
         \x20   end\n\
         \x20 end\n\n\
         \x20 module GeneratedPayableLoop\n\
         \x20   def self.run(payable_next:, host:, start_event:)\n\
         \x20     state = nil\n\
         \x20     event = start_event\n\
         \x20     loop do\n\
         \x20       out = payable_next.call(state, event)\n\
         \x20       unless out.is_a?(Hash)\n\
         \x20         raise SolvaPay::SolvaPayError.new(\n\
         \x20           \"invoke_payable_next returned unexpected value\",\n\
         \x20           code: \"internal_error\",\n\
         \x20         )\n\
         \x20       end\n\
         \n\
         \x20       state = out[\"state\"]\n\
         \x20       action = out[\"action\"]\n\
         \x20       unless action.is_a?(Hash)\n\
         \x20         raise SolvaPay::SolvaPayError.new(\n\
         \x20           \"invoke_payable_next returned unexpected action\",\n\
         \x20           code: \"internal_error\",\n\
         \x20         )\n\
         \x20       end\n\
         \n\
         \x20       case action[\"kind\"]\n\
         \x20       when \"runGate\"\n\
         \x20         gate = host.run_gate(action)\n\
         \x20         return gate[:result] if gate[:kind] == :return || gate[\"kind\"] == \"return\"\n\
         \n\
         \x20         kind = gate[:kind] || gate[\"kind\"]\n\
         \x20         event = if [:paywall, \"paywall\"].include?(kind)\n\
         \x20                   {\n\
         \x20                     \"kind\" => \"gatePaywall\",\n\
         \x20                     \"gate\" => gate[:gate] || gate[\"gate\"],\n\
         \x20                     \"message\" => gate[:message] || gate[\"message\"],\n\
         \x20                   }\n\
         \x20                 else\n\
         \x20                   {\n\
         \x20                     \"kind\" => \"gateAllow\",\n\
         \x20                     \"customerRef\" => gate[:customerRef] || gate[\"customerRef\"],\n\
         \x20                     \"limits\" => gate[:limits] || gate[\"limits\"],\n\
         \x20                   }\n\
         \x20                 end\n\
         \x20       when \"invokeHandler\"\n\
         \x20         invoked = host.invoke_handler(action)\n\
         \x20         return invoked[:result] if invoked[:kind] == :return || invoked[\"kind\"] == \"return\"\n\
         \n\
         \x20         kind = invoked[:kind] || invoked[\"kind\"]\n\
         \x20         event = if [:paywall, \"paywall\"].include?(kind)\n\
         \x20                   {\n\
         \x20                     \"kind\" => \"handlerPaywall\",\n\
         \x20                     \"gate\" => invoked[:gate] || invoked[\"gate\"],\n\
         \x20                     \"message\" => invoked[:message] || invoked[\"message\"],\n\
         \x20                   }\n\
         \x20                 elsif [:err, \"err\"].include?(kind)\n\
         \x20                   {\n\
         \x20                     \"kind\" => \"handlerErr\",\n\
         \x20                     \"message\" => invoked[:message] || invoked[\"message\"],\n\
         \x20                     \"nowMs\" => host.now_ms,\n\
         \x20                     \"randomUnit\" => host.random_unit,\n\
         \x20                   }\n\
         \x20                 else\n\
         \x20                   {\n\
         \x20                     \"kind\" => \"handlerOk\",\n\
         \x20                     \"envelope\" => invoked[:envelope] || invoked[\"envelope\"],\n\
         \x20                     \"nowMs\" => host.now_ms,\n\
         \x20                     \"randomUnit\" => host.random_unit,\n\
         \x20                   }\n\
         \x20                 end\n\
         \x20       when \"done\"\n\
         \x20         track = action[\"track\"]\n\
         \x20         host.track_usage(track[\"request\"]) if track.is_a?(Hash) && !track[\"request\"].nil?\n\
         \x20         return action[\"result\"]\n\
         \x20       else\n\
         \x20         kind = action[\"kind\"]\n\
         \x20         raise SolvaPay::SolvaPayError.new(\n\
         \x20           \"invoke_payable_next unknown action kind: #{kind}\",\n\
         \x20           code: \"internal_error\",\n\
         \x20         )\n\
         \x20       end\n\
         \x20     end\n\
         \x20   end\n\
         \x20 end\n\
         end\n",
    );
    Ok(out)
}

/// `sdks/rust/src/drivers.generated.rs`
pub fn emit_drivers_rs(_ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::LineSlash, "rs-drivers-out");
    out.push_str(
        "\n//! Generated host driver loops.\n\n\
         #![allow(\n\
         \x20   missing_docs,\n\
         \x20   clippy::missing_docs_in_private_items,\n\
         \x20   clippy::missing_errors_doc,\n\
         \x20   clippy::missing_panics_doc,\n\
         \x20   clippy::manual_async_fn,\n\
         )]\n\n\
         use std::future::Future;\n\n\
         use serde_json::Value;\n\
         use solvapay_core::{\n\
         \x20   gate_next, GateAction, GateCacheOp, HelperErrorResult, SdkError,\n\
         };\n\n\
         pub trait GateDriverHost {\n\
         \x20   fn now_ms(&self) -> i64;\n\
         \x20   fn ensure_customer(&self, customer_ref: &str) -> impl Future<Output = Result<String, SdkError>>;\n\
         \x20   fn read_limits_cache(\n\
         \x20       &self,\n\
         \x20       key: &str,\n\
         \x20   ) -> impl Future<Output = Option<(f64, Value, u64)>>;\n\
         \x20   fn check_limits(\n\
         \x20       &self,\n\
         \x20       customer_ref: &str,\n\
         \x20       product_ref: &str,\n\
         \x20       meter_name: &str,\n\
         \x20       include_checkout_session: bool,\n\
         \x20       cache_delete_key: Option<&str>,\n\
         \x20   ) -> impl Future<Output = Result<Value, SdkError>>;\n\
         \x20   fn apply_cache(&self, cache: Option<GateCacheOp>) -> impl Future<Output = ()>;\n\
         }\n\n\
         fn helper_to_sdk(err: HelperErrorResult) -> SdkError {\n\
         \x20   SdkError::transport(err.details.unwrap_or(err.error), false)\n\
         }\n\n\
         pub async fn run_generated_gate_loop<H: GateDriverHost>(\n\
         \x20   host: &H,\n\
         \x20   start_event: Value,\n\
         ) -> Result<(Value, GateAction), SdkError> {\n\
         \x20   let mut state: Option<Value> = None;\n\
         \x20   let mut event = start_event;\n\
         \x20   loop {\n\
         \x20       let out = gate_next(state.as_ref(), Some(&event)).map_err(helper_to_sdk)?;\n\
         \x20       state = Some(serde_json::to_value(&out.state).map_err(|err| {\n\
         \x20           SdkError::transport(format!(\"serialize gate state: {err}\"), false)\n\
         \x20       })?);\n\
         \x20       match out.action {\n\
         \x20           GateAction::EnsureCustomer { customer_ref } => {\n\
         \x20               let backend = host.ensure_customer(&customer_ref).await?;\n\
         \x20               event = serde_json::json!({\n\
         \x20                   \"kind\": \"customerResolved\",\n\
         \x20                   \"backendRef\": backend,\n\
         \x20                   \"nowMs\": host.now_ms(),\n\
         \x20               });\n\
         \x20           }\n\
         \x20           GateAction::ReadLimitsCache { key } => {\n\
         \x20               let now = host.now_ms();\n\
         \x20               event = match host.read_limits_cache(&key).await {\n\
         \x20                   Some((remaining, limits, timestamp_ms)) => serde_json::json!({\n\
         \x20                       \"kind\": \"limitsCacheEntry\",\n\
         \x20                       \"found\": true,\n\
         \x20                       \"remaining\": remaining,\n\
         \x20                       \"limits\": limits,\n\
         \x20                       \"timestampMs\": timestamp_ms,\n\
         \x20                       \"nowMs\": now,\n\
         \x20                   }),\n\
         \x20                   None => serde_json::json!({\n\
         \x20                       \"kind\": \"limitsCacheEntry\",\n\
         \x20                       \"found\": false,\n\
         \x20                       \"nowMs\": now,\n\
         \x20                   }),\n\
         \x20               };\n\
         \x20           }\n\
         \x20           GateAction::CheckLimits {\n\
         \x20               customer_ref,\n\
         \x20               product_ref,\n\
         \x20               meter_name,\n\
         \x20               include_checkout_session,\n\
         \x20               cache_delete_key,\n\
         \x20           } => {\n\
         \x20               let limits = host\n\
         \x20                   .check_limits(\n\
         \x20                       &customer_ref,\n\
         \x20                       &product_ref,\n\
         \x20                       &meter_name,\n\
         \x20                       include_checkout_session,\n\
         \x20                       cache_delete_key.as_deref(),\n\
         \x20                   )\n\
         \x20                   .await?;\n\
         \x20               event = serde_json::json!({\n\
         \x20                   \"kind\": \"limitsResult\",\n\
         \x20                   \"limits\": limits,\n\
         \x20                   \"nowMs\": host.now_ms(),\n\
         \x20               });\n\
         \x20           }\n\
         \x20           action @ GateAction::Allow { .. } => {\n\
         \x20               if let GateAction::Allow { cache, .. } = &action {\n\
         \x20                   host.apply_cache(cache.clone()).await;\n\
         \x20               }\n\
         \x20               return Ok((state.clone().unwrap_or(Value::Null), action));\n\
         \x20           }\n\
         \x20           action @ GateAction::Gate { .. } => {\n\
         \x20               if let GateAction::Gate { cache, .. } = &action {\n\
         \x20                   host.apply_cache(cache.clone()).await;\n\
         \x20               }\n\
         \x20               return Ok((state.clone().unwrap_or(Value::Null), action));\n\
         \x20           }\n\
         \x20           GateAction::EmitUsage { .. } | GateAction::SkipUsage => {\n\
         \x20               return Err(SdkError::transport(\n\
         \x20                   \"gate_next returned a usage action during decide\",\n\
         \x20                   false,\n\
         \x20               ));\n\
         \x20           }\n\
         \x20       }\n\
         \x20   }\n\
         }\n\n\
         pub enum PayableGateEffect {\n\
         \x20   Paywall { gate: Value, message: String },\n\
         \x20   Allow { customer_ref: String, limits: Value },\n\
         \x20   Early(Value),\n\
         }\n\n\
         pub enum PayableHandlerEffect {\n\
         \x20   Ok { envelope: Value },\n\
         \x20   Paywall { gate: Value, message: String },\n\
         \x20   Err { message: String },\n\
         \x20   Early(Value),\n\
         }\n\n\
         pub trait PayableDriverHost {\n\
         \x20   fn now_ms(&self) -> i64;\n\
         \x20   fn random_unit(&self) -> f64;\n\
         \x20   fn run_gate(\n\
         \x20       &self,\n\
         \x20       customer_ref: &str,\n\
         \x20       product: &str,\n\
         \x20       usage_type: &str,\n\
         \x20   ) -> impl Future<Output = Result<PayableGateEffect, SdkError>>;\n\
         \x20   fn invoke_handler(\n\
         \x20       &self,\n\
         \x20       customer_ref: &str,\n\
         \x20       limits: Value,\n\
         \x20   ) -> impl Future<Output = Result<PayableHandlerEffect, SdkError>>;\n\
         \x20   fn track_usage(&self, request: Value) -> impl Future<Output = Result<(), SdkError>>;\n\
         }\n\n\
         pub async fn run_generated_payable_loop<H: PayableDriverHost>(\n\
         \x20   host: &H,\n\
         \x20   start_event: Value,\n\
         ) -> Result<Value, SdkError> {\n\
         \x20   use solvapay_core::{invoke_payable_next, InvokePayableAction};\n\
         \x20   let mut state: Option<Value> = None;\n\
         \x20   let mut event = start_event;\n\
         \x20   loop {\n\
         \x20       let out = invoke_payable_next(state.as_ref(), Some(&event)).map_err(helper_to_sdk)?;\n\
         \x20       state = Some(serde_json::to_value(&out.state).map_err(|err| {\n\
         \x20           SdkError::transport(format!(\"serialize invoke_payable state: {err}\"), false)\n\
         \x20       })?);\n\
         \x20       match out.action {\n\
         \x20           InvokePayableAction::RunGate {\n\
         \x20               customer_ref,\n\
         \x20               product,\n\
         \x20               usage_type,\n\
         \x20           } => match host.run_gate(&customer_ref, &product, &usage_type).await? {\n\
         \x20               PayableGateEffect::Early(result) => return Ok(result),\n\
         \x20               PayableGateEffect::Paywall { gate, message } => {\n\
         \x20                   event = serde_json::json!({\n\
         \x20                       \"kind\": \"gatePaywall\",\n\
         \x20                       \"gate\": gate,\n\
         \x20                       \"message\": message,\n\
         \x20                   });\n\
         \x20               }\n\
         \x20               PayableGateEffect::Allow {\n\
         \x20                   customer_ref,\n\
         \x20                   limits,\n\
         \x20               } => {\n\
         \x20                   event = serde_json::json!({\n\
         \x20                       \"kind\": \"gateAllow\",\n\
         \x20                       \"customerRef\": customer_ref,\n\
         \x20                       \"limits\": limits,\n\
         \x20                   });\n\
         \x20               }\n\
         \x20           },\n\
         \x20           InvokePayableAction::InvokeHandler {\n\
         \x20               customer_ref,\n\
         \x20               limits,\n\
         \x20           } => match host.invoke_handler(&customer_ref, limits).await? {\n\
         \x20               PayableHandlerEffect::Early(result) => return Ok(result),\n\
         \x20               PayableHandlerEffect::Paywall { gate, message } => {\n\
         \x20                   event = serde_json::json!({\n\
         \x20                       \"kind\": \"handlerPaywall\",\n\
         \x20                       \"gate\": gate,\n\
         \x20                       \"message\": message,\n\
         \x20                   });\n\
         \x20               }\n\
         \x20               PayableHandlerEffect::Err { message } => {\n\
         \x20                   event = serde_json::json!({\n\
         \x20                       \"kind\": \"handlerErr\",\n\
         \x20                       \"message\": message,\n\
         \x20                       \"nowMs\": host.now_ms(),\n\
         \x20                       \"randomUnit\": host.random_unit(),\n\
         \x20                   });\n\
         \x20               }\n\
         \x20               PayableHandlerEffect::Ok { envelope } => {\n\
         \x20                   event = serde_json::json!({\n\
         \x20                       \"kind\": \"handlerOk\",\n\
         \x20                       \"envelope\": envelope,\n\
         \x20                       \"nowMs\": host.now_ms(),\n\
         \x20                       \"randomUnit\": host.random_unit(),\n\
         \x20                   });\n\
         \x20               }\n\
         \x20           },\n\
         \x20           InvokePayableAction::Done { result, track } => {\n\
         \x20               if let Some(track) = track {\n\
         \x20                   host.track_usage(track.request).await?;\n\
         \x20               }\n\
         \x20               return Ok(result);\n\
         \x20           }\n\
         \x20       }\n\
         \x20   }\n\
         }\n",
    );
    Ok(out)
}
