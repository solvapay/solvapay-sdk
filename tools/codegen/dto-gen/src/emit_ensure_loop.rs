//! `runGeneratedEnsureCustomerLoop` appended to each driver emitter.
//!
//! The manifest names the I/O pairs. These templates own the event-field wiring,
//! the same way the gate and payable loops do.

pub const TYPESCRIPT: &str = r#"
export type EnsureCustomerCacheHit =
  | { found: true; backendRef: string; timestampMs: number }
  | { found: false }

export type EnsureCustomerLookup = {
  found: boolean
  customer?: unknown
  errorMessage?: string
}

export type EnsureCustomerCreate = {
  ok: boolean
  customer?: unknown
  errorMessage?: string
}

export type EnsureCustomerUpdate = {
  ok: boolean
  errorMessage?: string
}

export type EnsureCustomerHost = {
  readCustomerCache(key: string): Promise<EnsureCustomerCacheHit>
  getCustomer(args: { byExternalRef?: string; byEmail?: string }): Promise<EnsureCustomerLookup>
  createCustomer(params: unknown): Promise<EnsureCustomerCreate>
  updateCustomer(args: { customerRef: string; patch: unknown }): Promise<EnsureCustomerUpdate>
  writeCustomerCache(entry: { key: string; backendRef: string; timestampMs: number }): Promise<void> | void
  nowMs(): number
}

export async function runGeneratedEnsureCustomerLoop(
  ensureCustomerNext: (
    state: unknown,
    event: unknown,
  ) => { state: unknown; action: { kind: string; [key: string]: unknown } },
  host: EnsureCustomerHost,
  startEvent: Record<string, unknown>,
): Promise<string> {
  let state: unknown = null
  let event: Record<string, unknown> = startEvent
  for (;;) {
    const out = ensureCustomerNext(state, event)
    state = out.state
    const action = out.action
    if (action.kind === 'readCustomerCache') {
      const cached = await host.readCustomerCache(String(action.key))
      const nowMs = host.nowMs()
      event = cached.found
        ? {
            kind: 'customerCacheEntry',
            found: true,
            backendRef: cached.backendRef,
            timestampMs: cached.timestampMs,
            nowMs,
          }
        : { kind: 'customerCacheEntry', found: false, nowMs }
      continue
    }
    if (action.kind === 'getCustomer') {
      const lookup = await host.getCustomer({
        ...(typeof action.byExternalRef === 'string' ? { byExternalRef: action.byExternalRef } : {}),
        ...(typeof action.byEmail === 'string' ? { byEmail: action.byEmail } : {}),
      })
      const nowMs = host.nowMs()
      event = lookup.found
        ? {
            kind: 'customerLookupResult',
            found: true,
            customer: lookup.customer,
            nowMs,
          }
        : {
            kind: 'customerLookupResult',
            found: false,
            nowMs,
            ...(lookup.errorMessage ? { errorMessage: lookup.errorMessage } : {}),
          }
      continue
    }
    if (action.kind === 'createCustomer') {
      const created = await host.createCustomer(action.params)
      const nowMs = host.nowMs()
      event = created.ok
        ? { kind: 'customerCreateResult', ok: true, customer: created.customer, nowMs }
        : {
            kind: 'customerCreateResult',
            ok: false,
            errorMessage: created.errorMessage ?? '',
            nowMs,
          }
      continue
    }
    if (action.kind === 'updateCustomer') {
      const updated = await host.updateCustomer({
        customerRef: String(action.customerRef),
        patch: action.patch ?? {},
      })
      const nowMs = host.nowMs()
      event = updated.ok
        ? { kind: 'customerUpdateResult', ok: true, nowMs }
        : {
            kind: 'customerUpdateResult',
            ok: false,
            errorMessage: updated.errorMessage ?? '',
            nowMs,
          }
      continue
    }
    if (action.kind === 'resolved') {
      const cache = action.cache as
        | { key?: unknown; backendRef?: unknown; timestampMs?: unknown }
        | null
        | undefined
      if (cache && typeof cache.key === 'string') {
        await host.writeCustomerCache({
          key: cache.key,
          backendRef: String(cache.backendRef ?? action.backendRef),
          timestampMs: Number(cache.timestampMs),
        })
      }
      if (typeof action.backendRef !== 'string' || action.backendRef.length === 0) {
        throw new Error('ensure_customer_next resolved without backendRef')
      }
      return action.backendRef
    }
    throw new Error(`ensure_customer_next unknown action: ${String(action.kind)}`)
  }
}
"#;

pub const PYTHON: &str = r#"

class EnsureCustomerHost(Protocol):
    def read_customer_cache(self, key: str) -> dict[str, object] | None: ...
    def get_customer(self, action: dict[str, object]) -> dict[str, object]: ...
    def create_customer(self, params: object) -> dict[str, object]: ...
    def update_customer(self, customer_ref: object, patch: object) -> dict[str, object]: ...
    def write_customer_cache(self, entry: dict[str, object]) -> None: ...
    def now_ms(self) -> int: ...


class AsyncEnsureCustomerHost(Protocol):
    def read_customer_cache(self, key: str) -> Awaitable[dict[str, object] | None]: ...
    def get_customer(self, action: dict[str, object]) -> Awaitable[dict[str, object]]: ...
    def create_customer(self, params: object) -> Awaitable[dict[str, object]]: ...
    def update_customer(
        self, customer_ref: object, patch: object
    ) -> Awaitable[dict[str, object]]: ...
    def write_customer_cache(self, entry: dict[str, object]) -> Awaitable[None] | None: ...
    def now_ms(self) -> int: ...


def _ensure_cache_event(cached: dict[str, object] | None, now_ms: int) -> dict[str, object]:
    if cached is None:
        return {"kind": "customerCacheEntry", "found": False, "nowMs": now_ms}
    return {
        "kind": "customerCacheEntry",
        "found": True,
        "backendRef": cached["backendRef"],
        "timestampMs": cached["timestampMs"],
        "nowMs": now_ms,
    }


def _ensure_lookup_event(lookup: dict[str, object], now_ms: int) -> dict[str, object]:
    if lookup.get("found") is True:
        return {
            "kind": "customerLookupResult",
            "found": True,
            "customer": lookup.get("customer"),
            "nowMs": now_ms,
        }
    event: dict[str, object] = {"kind": "customerLookupResult", "found": False, "nowMs": now_ms}
    message = lookup.get("errorMessage")
    if isinstance(message, str) and message:
        event["errorMessage"] = message
    return event


def _ensure_create_event(created: dict[str, object], now_ms: int) -> dict[str, object]:
    if created.get("ok") is True:
        return {
            "kind": "customerCreateResult",
            "ok": True,
            "customer": created.get("customer"),
            "nowMs": now_ms,
        }
    message = created.get("errorMessage")
    return {
        "kind": "customerCreateResult",
        "ok": False,
        "errorMessage": message if isinstance(message, str) else "",
        "nowMs": now_ms,
    }


def _ensure_update_event(updated: dict[str, object], now_ms: int) -> dict[str, object]:
    if updated.get("ok") is True:
        return {"kind": "customerUpdateResult", "ok": True, "nowMs": now_ms}
    message = updated.get("errorMessage")
    return {
        "kind": "customerUpdateResult",
        "ok": False,
        "errorMessage": message if isinstance(message, str) else "",
        "nowMs": now_ms,
    }


def _ensure_apply_cache(host: EnsureCustomerHost, action: dict[str, object]) -> str:
    cache = action.get("cache")
    if isinstance(cache, dict) and isinstance(cache.get("key"), str):
        backend = cache.get("backendRef", action.get("backendRef"))
        host.write_customer_cache(
            {
                "key": cache["key"],
                "backendRef": backend,
                "timestampMs": cache.get("timestampMs"),
            }
        )
    backend_ref = action.get("backendRef")
    if not isinstance(backend_ref, str) or not backend_ref:
        raise RuntimeError("ensure_customer_next resolved without backendRef")
    return backend_ref


def run_generated_ensure_customer_loop(
    ensure_next: Callable[[object, object], dict[str, object]],
    host: EnsureCustomerHost,
    start_event: dict[str, object],
) -> str:
    state: object = None
    event: dict[str, object] = start_event
    while True:
        out = ensure_next(state, event)
        state = out["state"]
        action = _as_map(out["action"])
        kind = action["kind"]
        if kind == "readCustomerCache":
            event = _ensure_cache_event(
                host.read_customer_cache(str(action.get("key") or "")),
                host.now_ms(),
            )
            continue
        if kind == "getCustomer":
            event = _ensure_lookup_event(host.get_customer(action), host.now_ms())
            continue
        if kind == "createCustomer":
            event = _ensure_create_event(
                host.create_customer(action.get("params")),
                host.now_ms(),
            )
            continue
        if kind == "updateCustomer":
            event = _ensure_update_event(
                host.update_customer(action.get("customerRef"), action.get("patch")),
                host.now_ms(),
            )
            continue
        if kind == "resolved":
            return _ensure_apply_cache(host, action)
        raise RuntimeError(f"ensure_customer_next unknown action kind: {kind}")


async def run_generated_ensure_customer_loop_async(
    ensure_next: Callable[[object, object], dict[str, object]],
    host: AsyncEnsureCustomerHost,
    start_event: dict[str, object],
) -> str:
    state: object = None
    event: dict[str, object] = start_event
    while True:
        out = ensure_next(state, event)
        state = out["state"]
        action = _as_map(out["action"])
        kind = action["kind"]
        if kind == "readCustomerCache":
            cached = await host.read_customer_cache(str(action.get("key") or ""))
            event = _ensure_cache_event(cached, host.now_ms())
            continue
        if kind == "getCustomer":
            event = _ensure_lookup_event(await host.get_customer(action), host.now_ms())
            continue
        if kind == "createCustomer":
            event = _ensure_create_event(
                await host.create_customer(action.get("params")),
                host.now_ms(),
            )
            continue
        if kind == "updateCustomer":
            event = _ensure_update_event(
                await host.update_customer(action.get("customerRef"), action.get("patch")),
                host.now_ms(),
            )
            continue
        if kind == "resolved":
            cache = action.get("cache")
            if isinstance(cache, dict) and isinstance(cache.get("key"), str):
                backend = cache.get("backendRef", action.get("backendRef"))
                write = host.write_customer_cache(
                    {
                        "key": cache["key"],
                        "backendRef": backend,
                        "timestampMs": cache.get("timestampMs"),
                    }
                )
                if write is not None:
                    await write
            backend_ref = action.get("backendRef")
            if not isinstance(backend_ref, str) or not backend_ref:
                raise RuntimeError("ensure_customer_next resolved without backendRef")
            return backend_ref
        raise RuntimeError(f"ensure_customer_next unknown action kind: {kind}")
"#;

pub const GO: &str = r#"
// EnsureCustomerCacheHit is a raw customer-cache map read.
type EnsureCustomerCacheHit struct {
	Found       bool
	BackendRef  string
	TimestampMs int64
}

// EnsureCustomerLookup is a getCustomer result.
type EnsureCustomerLookup struct {
	Found        bool
	Customer     any
	ErrorMessage string
}

// EnsureCustomerCreate is a createCustomer result.
type EnsureCustomerCreate struct {
	OK           bool
	Customer     any
	ErrorMessage string
}

// EnsureCustomerUpdate is an updateCustomer result.
type EnsureCustomerUpdate struct {
	OK           bool
	ErrorMessage string
}

// EnsureCustomerHost is the I/O surface for RunGeneratedEnsureCustomerLoop.
type EnsureCustomerHost interface {
	ReadCustomerCache(key string) (EnsureCustomerCacheHit, bool)
	GetCustomer(ctx context.Context, byExternalRef, byEmail string) (EnsureCustomerLookup, error)
	CreateCustomer(ctx context.Context, params map[string]any) (EnsureCustomerCreate, error)
	UpdateCustomer(ctx context.Context, customerRef string, patch map[string]any) (EnsureCustomerUpdate, error)
	WriteCustomerCache(key, backendRef string, timestampMs int64)
	NowMs() int64
}

// RunGeneratedEnsureCustomerLoop drives ensure_customer_next until resolved.
func RunGeneratedEnsureCustomerLoop(
	ctx context.Context,
	ensureNext func(state any, event map[string]any) (any, map[string]any, error),
	host EnsureCustomerHost,
	startEvent map[string]any,
) (string, error) {
	state := any(nil)
	event := startEvent
	for {
		nextState, action, err := ensureNext(state, event)
		if err != nil {
			return "", err
		}
		state = nextState
		kind, _ := action["kind"].(string)
		switch kind {
		case "readCustomerCache":
			key, _ := action["key"].(string)
			now := host.NowMs()
			if hit, ok := host.ReadCustomerCache(key); ok && hit.Found {
				event = map[string]any{
					"kind": "customerCacheEntry", "found": true,
					"backendRef": hit.BackendRef, "timestampMs": hit.TimestampMs, "nowMs": now,
				}
			} else {
				event = map[string]any{"kind": "customerCacheEntry", "found": false, "nowMs": now}
			}
		case "getCustomer":
			byRef, _ := action["byExternalRef"].(string)
			byEmail, _ := action["byEmail"].(string)
			lookup, err := host.GetCustomer(ctx, byRef, byEmail)
			if err != nil {
				return "", err
			}
			now := host.NowMs()
			if lookup.Found {
				event = map[string]any{
					"kind": "customerLookupResult", "found": true,
					"customer": lookup.Customer, "nowMs": now,
				}
			} else {
				event = map[string]any{"kind": "customerLookupResult", "found": false, "nowMs": now}
				if lookup.ErrorMessage != "" {
					event["errorMessage"] = lookup.ErrorMessage
				}
			}
		case "createCustomer":
			params := asObject(action["params"])
			created, err := host.CreateCustomer(ctx, params)
			if err != nil {
				return "", err
			}
			now := host.NowMs()
			if created.OK {
				event = map[string]any{
					"kind": "customerCreateResult", "ok": true,
					"customer": created.Customer, "nowMs": now,
				}
			} else {
				event = map[string]any{
					"kind": "customerCreateResult", "ok": false,
					"errorMessage": created.ErrorMessage, "nowMs": now,
				}
			}
		case "updateCustomer":
			ref, _ := action["customerRef"].(string)
			updated, err := host.UpdateCustomer(ctx, ref, asObject(action["patch"]))
			if err != nil {
				return "", err
			}
			now := host.NowMs()
			event = map[string]any{"kind": "customerUpdateResult", "ok": updated.OK, "nowMs": now}
			if !updated.OK {
				event["errorMessage"] = updated.ErrorMessage
			}
		case "resolved":
			backend, _ := action["backendRef"].(string)
			if backend == "" {
				return "", &Error{Code: "internal_error", Message: "ensure_customer_next resolved without backendRef"}
			}
			if cache := asObject(action["cache"]); cache["key"] != nil {
				key, _ := cache["key"].(string)
				cachedBackend, _ := cache["backendRef"].(string)
				if cachedBackend == "" {
					cachedBackend = backend
				}
				host.WriteCustomerCache(key, cachedBackend, int64(asFloat(cache["timestampMs"])))
			}
			return backend, nil
		default:
			return "", &Error{Code: "internal_error", Message: "ensure_customer_next returned unknown action kind"}
		}
	}
}
"#;

pub const RUBY: &str = r#"
module SolvaPay
  module GeneratedEnsureCustomerLoop
    def self.run(ensure_next:, host:, start_event:)
      state = nil
      event = start_event
      loop do
        out = ensure_next.call(state, event)
        unless out.is_a?(Hash) && out["action"].is_a?(Hash)
          raise SolvaPay::SolvaPayError.new("ensure_customer_next returned unexpected value", code: "internal_error")
        end

        state = out["state"]
        action = out["action"]
        case action["kind"]
        when "readCustomerCache"
          cached = host.read_customer_cache(action["key"].to_s)
          now = host.now_ms
          event = if cached.is_a?(Hash)
                    {
                      "kind" => "customerCacheEntry",
                      "found" => true,
                      "backendRef" => cached[:backend_ref] || cached["backendRef"],
                      "timestampMs" => cached[:timestamp_ms] || cached["timestampMs"],
                      "nowMs" => now,
                    }
                  else
                    { "kind" => "customerCacheEntry", "found" => false, "nowMs" => now }
                  end
        when "getCustomer"
          lookup = host.get_customer(action)
          now = host.now_ms
          event = if lookup[:found]
                    {
                      "kind" => "customerLookupResult",
                      "found" => true,
                      "customer" => lookup[:customer],
                      "nowMs" => now,
                    }
                  else
                    event = {
                      "kind" => "customerLookupResult",
                      "found" => false,
                      "nowMs" => now,
                    }
                    event["errorMessage"] = lookup[:error_message] if lookup[:error_message]
                    event
                  end
        when "createCustomer"
          created = host.create_customer(action["params"])
          now = host.now_ms
          event = if created[:ok]
                    {
                      "kind" => "customerCreateResult",
                      "ok" => true,
                      "customer" => created[:customer],
                      "nowMs" => now,
                    }
                  else
                    {
                      "kind" => "customerCreateResult",
                      "ok" => false,
                      "errorMessage" => created[:error_message].to_s,
                      "nowMs" => now,
                    }
                  end
        when "updateCustomer"
          updated = host.update_customer(action["customerRef"], action["patch"])
          now = host.now_ms
          event = {
            "kind" => "customerUpdateResult",
            "ok" => updated[:ok] ? true : false,
            "nowMs" => now,
          }
          event["errorMessage"] = updated[:error_message].to_s unless updated[:ok]
        when "resolved"
          backend = action["backendRef"]
          unless backend.is_a?(String) && !backend.empty?
            raise SolvaPay::SolvaPayError.new(
              "ensure_customer_next resolved without backendRef",
              code: "internal_error",
            )
          end

          cache = action["cache"]
          if cache.is_a?(Hash) && cache["key"].is_a?(String)
            cached_backend = cache["backendRef"]
            cached_backend = backend unless cached_backend.is_a?(String) && !cached_backend.empty?
            host.write_customer_cache(cache["key"], cached_backend, cache["timestampMs"])
          end
          return backend
        else
          raise SolvaPay::SolvaPayError.new("ensure_customer_next unknown action kind", code: "internal_error")
        end
      end
    end
  end
end
"#;

pub const RUST: &str = r#"
pub struct EnsureCacheHit {
    pub backend_ref: String,
    pub timestamp_ms: i64,
}

pub struct EnsureLookupOutcome {
    pub found: bool,
    pub customer: Value,
    pub error_message: Option<String>,
}

pub struct EnsureCreateOutcome {
    pub ok: bool,
    pub customer: Value,
    pub error_message: Option<String>,
}

pub struct EnsureUpdateOutcome {
    pub ok: bool,
    pub error_message: Option<String>,
}

pub trait EnsureCustomerHost {
    fn now_ms(&self) -> i64;
    fn read_customer_cache(&self, key: &str) -> impl Future<Output = Option<EnsureCacheHit>>;
    fn get_customer(
        &self,
        by_external_ref: Option<&str>,
        by_email: Option<&str>,
    ) -> impl Future<Output = EnsureLookupOutcome>;
    fn create_customer(
        &self,
        params: &CreateCustomerParams,
    ) -> impl Future<Output = EnsureCreateOutcome>;
    fn update_customer(
        &self,
        customer_ref: &str,
        patch: &Map<String, Value>,
    ) -> impl Future<Output = EnsureUpdateOutcome>;
    fn write_customer_cache(
        &self,
        key: &str,
        backend_ref: &str,
        timestamp_ms: i64,
    ) -> impl Future<Output = ()>;
}

pub async fn run_generated_ensure_customer_loop<H: EnsureCustomerHost>(
    host: &H,
    start_event: Value,
) -> Result<String, SdkError> {
    use solvapay_core::{ensure_customer_next, EnsureCustomerAction};

    let mut state: Option<Value> = None;
    let mut event = start_event;
    loop {
        let out = ensure_customer_next(state.as_ref(), Some(&event)).map_err(helper_to_sdk)?;
        state = Some(serde_json::to_value(&out.state).map_err(|err| {
            SdkError::transport(format!("ensure_customer_next state: {err}"), false)
        })?);
        match out.action {
            EnsureCustomerAction::ReadCustomerCache { key } => {
                let now = host.now_ms();
                event = match host.read_customer_cache(&key).await {
                    Some(hit) => serde_json::json!({
                        "kind": "customerCacheEntry",
                        "found": true,
                        "backendRef": hit.backend_ref,
                        "timestampMs": hit.timestamp_ms,
                        "nowMs": now,
                    }),
                    None => serde_json::json!({
                        "kind": "customerCacheEntry",
                        "found": false,
                        "nowMs": now,
                    }),
                };
            }
            EnsureCustomerAction::GetCustomer {
                by_external_ref,
                by_email,
            } => {
                let lookup = host
                    .get_customer(by_external_ref.as_deref(), by_email.as_deref())
                    .await;
                let now = host.now_ms();
                event = if lookup.found {
                    serde_json::json!({
                        "kind": "customerLookupResult",
                        "found": true,
                        "customer": lookup.customer,
                        "nowMs": now,
                    })
                } else {
                    let mut miss = serde_json::json!({
                        "kind": "customerLookupResult",
                        "found": false,
                        "nowMs": now,
                    });
                    if let Some(message) = lookup.error_message {
                        miss["errorMessage"] = Value::String(message);
                    }
                    miss
                };
            }
            EnsureCustomerAction::CreateCustomer { params } => {
                let created = host.create_customer(&params).await;
                let now = host.now_ms();
                event = if created.ok {
                    serde_json::json!({
                        "kind": "customerCreateResult",
                        "ok": true,
                        "customer": created.customer,
                        "nowMs": now,
                    })
                } else {
                    serde_json::json!({
                        "kind": "customerCreateResult",
                        "ok": false,
                        "errorMessage": created.error_message.unwrap_or_default(),
                        "nowMs": now,
                    })
                };
            }
            EnsureCustomerAction::UpdateCustomer {
                customer_ref,
                patch,
            } => {
                let updated = host.update_customer(&customer_ref, &patch).await;
                let now = host.now_ms();
                event = if updated.ok {
                    serde_json::json!({
                        "kind": "customerUpdateResult",
                        "ok": true,
                        "nowMs": now,
                    })
                } else {
                    serde_json::json!({
                        "kind": "customerUpdateResult",
                        "ok": false,
                        "errorMessage": updated.error_message.unwrap_or_default(),
                        "nowMs": now,
                    })
                };
            }
            EnsureCustomerAction::Resolved { backend_ref, cache } => {
                if backend_ref.is_empty() {
                    return Err(SdkError::transport(
                        "ensure_customer_next resolved without backendRef",
                        false,
                    ));
                }
                if let Some(write) = cache {
                    host.write_customer_cache(&write.key, &write.backend_ref, write.timestamp_ms)
                        .await;
                }
                return Ok(backend_ref);
            }
        }
    }
}
"#;
