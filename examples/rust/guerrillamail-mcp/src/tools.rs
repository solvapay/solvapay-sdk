//! Payable inbox tools.

use std::sync::Arc;

use futures::future::BoxFuture;
use serde_json::{json, Map, Value};
use solvapay_mcp::{PayableError, PayableHandler, PayableTool, ResponseContext};

use crate::clock::UnixNow;
use crate::error::ExampleError;
use crate::format::{decode_html_entities, unwrap_res_php_urls};
use crate::session::{seconds_remaining, seconds_remaining_after_extend, SessionStore};
use crate::sources::{call_with_session, json_i64, json_u64_required, SharedSource};

/// MCP tool name: allocate or re-attach an address.
pub const TOOL_INBOX_OPEN: &str = "inbox_open";
/// MCP tool name: list message summaries.
pub const TOOL_INBOX_LIST: &str = "inbox_list";
/// MCP tool name: read one message body.
pub const TOOL_MESSAGE_READ: &str = "message_read";
/// MCP tool name: delete messages.
pub const TOOL_MESSAGE_DELETE: &str = "message_delete";
/// MCP tool name: add one hour to the inbox lifetime.
pub const TOOL_INBOX_EXTEND: &str = "inbox_extend";

/// Register the five payable inbox tools on an HTTP host.
///
/// # Errors
///
/// When a tool name or product is empty.
pub fn register_tools(
    host: &mut solvapay_mcp::McpHttpServer,
    product: &str,
    source: SharedSource,
    store: Arc<SessionStore>,
    now: UnixNow,
) -> Result<(), PayableError> {
    host.register_payable(
        tool_spec(
            TOOL_INBOX_OPEN,
            product,
            "Open inbox",
            "Allocate or re-attach a Guerrilla Mail disposable address.",
            &[(
                "email_user",
                "Optional local-part to claim with set_email_user.",
            )],
        ),
        inbox_open_handler(source.clone(), store.clone(), now.clone()),
        None,
    )?;
    host.register_payable(
        tool_spec(
            TOOL_INBOX_LIST,
            product,
            "List inbox",
            "List disposable-inbox message summaries (check_email / get_email_list).",
            &[
                ("seq", "Optional check_email sequence cursor."),
                (
                    "offset",
                    "Optional get_email_list offset. When set, get_email_list is used.",
                ),
            ],
        ),
        inbox_list_handler(source.clone(), store.clone()),
        None,
    )?;
    host.register_payable(
        tool_spec(
            TOOL_MESSAGE_READ,
            product,
            "Read message",
            "Fetch one message body and unwrap Guerrilla Mail res.php image URLs.",
            &[("email_id", "Guerrilla Mail mail_id.")],
        ),
        message_read_handler(source.clone(), store.clone()),
        None,
    )?;
    host.register_payable(
        tool_spec(
            TOOL_MESSAGE_DELETE,
            product,
            "Delete messages",
            "Delete one or more messages (comma-separated email_ids).",
            &[
                ("email_id", "Single mail_id to delete."),
                ("email_ids", "Comma-separated mail_ids to delete."),
            ],
        ),
        message_delete_handler(source.clone(), store.clone()),
        None,
    )?;
    host.register_payable(
        tool_spec(
            TOOL_INBOX_EXTEND,
            product,
            "Extend inbox",
            "Add one hour to the disposable address lifetime (capped at two hours).",
            &[],
        ),
        inbox_extend_handler(source, store, now),
        None,
    )?;
    Ok(())
}

/// Build a payable spec with string-typed properties and no `required` array.
fn tool_spec(
    name: &str,
    product: &str,
    title: &str,
    description: &str,
    fields: &[(&str, &str)],
) -> PayableTool {
    let mut properties = Map::new();
    for (field, desc) in fields {
        properties.insert(
            (*field).to_owned(),
            json!({ "type": "string", "description": desc }),
        );
    }
    PayableTool {
        name: name.to_owned(),
        product: product.to_owned(),
        title: Some(title.to_owned()),
        description: Some(description.to_owned()),
        input_schema: if properties.is_empty() {
            None
        } else {
            Some(properties)
        },
        usage_type: Some("requests".to_owned()),
    }
}

/// `get_email_address` / `set_email_user`.
fn inbox_open_handler(
    source: SharedSource,
    store: Arc<SessionStore>,
    now: UnixNow,
) -> PayableHandler {
    Arc::new(move |args, mut ctx: ResponseContext| {
        let source = Arc::clone(&source);
        let store = Arc::clone(&store);
        let now = Arc::clone(&now);
        Box::pin(async move {
            let customer = ctx.customer().customer_ref.clone();
            let email_user = string_arg(&args, "email_user");
            let (function, params) = if let Some(user) = email_user {
                (
                    "set_email_user",
                    vec![
                        ("email_user".to_owned(), user),
                        ("lang".to_owned(), "en".to_owned()),
                    ],
                )
            } else {
                ("get_email_address", Vec::new())
            };
            let response =
                call_with_session(source.as_ref(), &store, &customer, function, params).await?;
            let address = response
                .body
                .get("email_addr")
                .and_then(Value::as_str)
                .ok_or_else(|| ExampleError::new("get_email_address missing email_addr"))?
                .to_owned();
            let ts = json_i64(response.body.get("email_timestamp"))
                .ok_or_else(|| ExampleError::new("get_email_address missing email_timestamp"))?;
            let expires = seconds_remaining(ts, now()?);
            ctx.respond(
                json!({
                    "address": address,
                    "expiresInSeconds": expires,
                    "alias": response.body.get("alias"),
                }),
                None,
            )
        }) as BoxFuture<'static, Result<_, PayableError>>
    })
}

/// `check_email` or `get_email_list` when `offset` is set.
fn inbox_list_handler(source: SharedSource, store: Arc<SessionStore>) -> PayableHandler {
    Arc::new(move |args, mut ctx: ResponseContext| {
        let source = Arc::clone(&source);
        let store = Arc::clone(&store);
        Box::pin(async move {
            let customer = ctx.customer().customer_ref.clone();
            let offset = string_arg(&args, "offset");
            let seq = string_arg(&args, "seq");
            let (function, params) = if let Some(offset) = offset {
                ("get_email_list", vec![("offset".to_owned(), offset)])
            } else {
                (
                    "check_email",
                    vec![("seq".to_owned(), seq.unwrap_or_else(|| "0".to_owned()))],
                )
            };
            let response =
                call_with_session(source.as_ref(), &store, &customer, function, params).await?;
            let raw_list = response
                .body
                .get("list")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut messages = Vec::new();
            for item in raw_list {
                messages.push(json!({
                    "id": item.get("mail_id"),
                    "from": item.get("mail_from"),
                    "subject": decode_opt_text(item.get("mail_subject"))?,
                    "excerpt": decode_opt_text(item.get("mail_excerpt"))?,
                    "timestamp": item.get("mail_timestamp"),
                    "read": item.get("mail_read"),
                    "size": item.get("size"),
                }));
            }
            let count = json_u64_required(response.body.get("count"), "count")?;
            let mut notes = Vec::new();
            if count > 20 {
                notes.push(format!(
                    "Guerrilla Mail returned at most 20 messages; count is {count}. The list is truncated."
                ));
            }
            ctx.respond(
                json!({
                    "address": response.body.get("email"),
                    "count": count,
                    "messages": messages,
                    "notes": notes,
                }),
                None,
            )
        }) as BoxFuture<'static, Result<_, PayableError>>
    })
}

/// `fetch_email` with `res.php` unwrap.
fn message_read_handler(source: SharedSource, store: Arc<SessionStore>) -> PayableHandler {
    Arc::new(move |args, mut ctx: ResponseContext| {
        let source = Arc::clone(&source);
        let store = Arc::clone(&store);
        Box::pin(async move {
            let customer = ctx.customer().customer_ref.clone();
            let email_id = string_arg(&args, "email_id")
                .ok_or_else(|| ExampleError::new("email_id is required"))?;
            let response = call_with_session(
                source.as_ref(),
                &store,
                &customer,
                "fetch_email",
                vec![("email_id".to_owned(), email_id)],
            )
            .await?;
            let body = response
                .body
                .get("mail_body")
                .and_then(Value::as_str)
                .ok_or_else(|| ExampleError::new("fetch_email missing mail_body"))?;
            let unwrapped = unwrap_res_php_urls(body)?;
            ctx.respond(
                json!({
                    "id": response.body.get("mail_id"),
                    "from": response.body.get("mail_from"),
                    "subject": decode_opt_text(response.body.get("mail_subject"))?,
                    "body": unwrapped,
                }),
                None,
            )
        }) as BoxFuture<'static, Result<_, PayableError>>
    })
}

/// `del_email` with repeated `email_ids[]` params.
fn message_delete_handler(source: SharedSource, store: Arc<SessionStore>) -> PayableHandler {
    Arc::new(move |args, mut ctx: ResponseContext| {
        let source = Arc::clone(&source);
        let store = Arc::clone(&store);
        Box::pin(async move {
            let customer = ctx.customer().customer_ref.clone();
            let ids = collect_email_ids(&args)?;
            let params = ids
                .iter()
                .map(|id| ("email_ids[]".to_owned(), id.clone()))
                .collect();
            let response =
                call_with_session(source.as_ref(), &store, &customer, "del_email", params).await?;
            ctx.respond(
                json!({
                    "deletedIds": response.body.get("deleted_ids"),
                }),
                None,
            )
        }) as BoxFuture<'static, Result<_, PayableError>>
    })
}

/// `extend`; `affected:0` is a note, not success.
fn inbox_extend_handler(
    source: SharedSource,
    store: Arc<SessionStore>,
    now: UnixNow,
) -> PayableHandler {
    Arc::new(move |args, mut ctx: ResponseContext| {
        let _ = args;
        let source = Arc::clone(&source);
        let store = Arc::clone(&store);
        let now = Arc::clone(&now);
        Box::pin(async move {
            let customer = ctx.customer().customer_ref.clone();
            let response =
                call_with_session(source.as_ref(), &store, &customer, "extend", Vec::new()).await?;
            let affected = json_u64_required(response.body.get("affected"), "affected")?;
            let session = store.get(&customer)?.ok_or_else(|| {
                ExampleError::new("extend succeeded but no session is stored for this customer")
            })?;
            let ts = session.email_timestamp.ok_or_else(|| {
                ExampleError::new("extend needs a stored email_timestamp from inbox_open")
            })?;
            if affected == 0 {
                return ctx.respond(
                    json!({
                        "affected": 0,
                        "expiresInSeconds": seconds_remaining(ts, now()?),
                        "notes": [
                            "Guerrilla Mail extend returned affected:0. The inbox was not extended."
                        ],
                    }),
                    None,
                );
            }
            ctx.respond(
                json!({
                    "affected": affected,
                    "expiresInSeconds": seconds_remaining_after_extend(ts, now()?),
                    "notes": [],
                }),
                None,
            )
        }) as BoxFuture<'static, Result<_, PayableError>>
    })
}

/// Trimmed non-empty string argument.
fn string_arg(args: &Map<String, Value>, name: &str) -> Option<String> {
    args.get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

/// HTML-decode a string field, or `null` when absent.
fn decode_opt_text(value: Option<&Value>) -> Result<Value, ExampleError> {
    let Some(Value::String(text)) = value else {
        return Ok(Value::Null);
    };
    Ok(Value::String(decode_html_entities(text)?))
}

/// Collect `email_id` plus comma-separated `email_ids`.
fn collect_email_ids(args: &Map<String, Value>) -> Result<Vec<String>, ExampleError> {
    let mut ids = Vec::new();
    if let Some(one) = string_arg(args, "email_id") {
        ids.push(one);
    }
    if let Some(many) = string_arg(args, "email_ids") {
        for part in many.split(',') {
            let trimmed = part.trim();
            if !trimmed.is_empty() {
                ids.push(trimmed.to_owned());
            }
        }
    }
    if ids.is_empty() {
        return Err(ExampleError::new(
            "email_id or email_ids is required for message_delete",
        ));
    }
    Ok(ids)
}
