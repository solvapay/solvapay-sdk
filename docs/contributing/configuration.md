# Facade configuration contract

Every language facade constructs a client the same way. Core never reads the
environment — facades read, core decides.

## Precedence

**Explicit constructor option > environment variable > default (base URL only).**

| Field      | Option                        | Environment             | Default                                |
| ---------- | ----------------------------- | ----------------------- | -------------------------------------- |
| Secret key | `apiKey` / `api_key`          | `SOLVAPAY_SECRET_KEY`   | none — required                        |
| API origin | `apiBaseUrl` / `api_base_url` | `SOLVAPAY_API_BASE_URL` | transport `DEFAULT_BASE_URL`           |
| Debug logs | `debug`                       | `SOLVAPAY_DEBUG`        | off unless the value is exactly `true` |

Merge is **per field**. Passing `{ apiKey }` must still pick up
`SOLVAPAY_API_BASE_URL`. An all-or-nothing env read when the options object is
absent is a bug.

## Missing required key

A missing or blank secret fails at facade construction with code
`missing_api_key`. Do not defer the failure to the first HTTP call. Do not
enter stub mode.

## Environment is never inferred from the key prefix

`sk_test_` / `sk_live_` do not select sandbox vs production. The only default
origin is the transport shell's `DEFAULT_BASE_URL`.

## Debug

`SOLVAPAY_DEBUG=true` turns debug logging on. Any other value, including unset
and `"false"`, leaves it off.

## Route helpers

HTTP route helpers (`getMerchantCore`, and the same pattern for product/plans)
may return `{ error, status }` instead of throwing — that is correct for a
route handler. Classification still goes through `mapRouteError` so status and
message come from one place.
