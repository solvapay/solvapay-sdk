/*
 * Reference C MCP adapter (layer-3 shape):
 *   OAuth paths → solvapay_client_call("mcpOauthRequest")
 *   POST /mcp  → solvapay_client_call("mcpDispatch")
 *     rpc            → 200 + rpc body
 *     challenge      → status + WWW-Authenticate
 *     invokeHandler  → demo echo handler + solvapay_call("mcpResume")
 *
 * Stdin is either a JSON-RPC body (POST /mcp, default config) or an HTTP
 * envelope: {method, path, headers, body, config}.
 * Stdout is {status, headers, body}.
 */

#include "../include/solvapay.h"
#include "mcp_json.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

static const char *kDefaultConfig =
    "{\"productRef\":\"prd_demo\","
    "\"publicBaseUrl\":\"https://app.example.com\","
    "\"resourceUri\":\"ui://widget.html\","
    "\"mcpPath\":\"/mcp\","
    "\"payableTools\":[\"echo\"]}";

static int handle_oauth(SolvapayClient *client, const char *method, const char *path,
                        const char *headers_raw, const char *body, const char *config_raw) {
  char *method_q = mcp_json_quote(method);
  char *path_q = mcp_json_quote(path);
  char *body_q = mcp_json_quote(body != NULL ? body : "");
  const char *headers = headers_raw != NULL ? headers_raw : "{}";
  const char *config = config_raw != NULL ? config_raw : "{}";
  if (method_q == NULL || path_q == NULL || body_q == NULL) {
    free(method_q);
    free(path_q);
    free(body_q);
    return mcp_fail("oauth quote");
  }
  size_t cap = strlen(method_q) + strlen(path_q) + strlen(headers) + strlen(body_q) +
               strlen(config) + 80;
  char *args = malloc(cap);
  if (args == NULL) {
    free(method_q);
    free(path_q);
    free(body_q);
    return mcp_fail("oauth args oom");
  }
  snprintf(args, cap,
           "{\"method\":%s,\"path\":%s,\"headers\":%s,\"body\":%s,\"config\":%s}", method_q,
           path_q, headers, body_q, config);
  free(method_q);
  free(path_q);
  free(body_q);
  char *env = solvapay_client_call(client, "mcpOauthRequest", args);
  free(args);
  if (!mcp_envelope_ok(env)) {
    fprintf(stderr, "FAIL: mcpOauthRequest %s\n", env ? env : "(null)");
    solvapay_free_string(env);
    return 1;
  }
  char *value = mcp_unwrap_value(env);
  solvapay_free_string(env);
  if (value == NULL) {
    return mcp_fail("oauth missing value");
  }
  char *status_s = mcp_json_get_string(value, "status");
  char *headers_out = mcp_json_get_raw(value, "headers");
  char *body_out = mcp_json_get_raw(value, "body");
  int status = status_s != NULL ? atoi(status_s) : 500;
  int rc = mcp_write_http(status, headers_out, body_out);
  free(status_s);
  free(headers_out);
  free(body_out);
  free(value);
  return rc;
}

static int resume_echo(const char *value) {
  char *token_raw = mcp_json_get_raw(value, "token");
  char *args_raw = mcp_json_get_raw(value, "args");
  char *customer = mcp_json_get_string(value, "customerRef");
  if (token_raw == NULL) {
    free(args_raw);
    free(customer);
    return mcp_fail("invokeHandler missing token");
  }
  char *args = mcp_inject_customer_ref(args_raw, customer);
  free(args_raw);
  free(customer);
  if (args == NULL) {
    free(token_raw);
    return mcp_fail("invokeHandler args");
  }
  char *text_q = mcp_json_quote(args);
  size_t cap = strlen(token_raw) + strlen(args) * 2 + (text_q ? strlen(text_q) : 0) + 160;
  char *resume = malloc(cap);
  if (text_q == NULL || resume == NULL) {
    free(token_raw);
    free(args);
    free(text_q);
    free(resume);
    return mcp_fail("resume oom");
  }
  snprintf(resume, cap,
           "{\"token\":%s,\"handlerEnvelope\":{\"content\":[{\"type\":\"text\",\"text\":%s}],"
           "\"structuredContent\":{\"echo\":%s}}}",
           token_raw, text_q, args);
  free(token_raw);
  free(args);
  free(text_q);
  char *env = solvapay_call("mcpResume", resume);
  free(resume);
  if (!mcp_envelope_ok(env)) {
    fprintf(stderr, "FAIL: mcpResume %s\n", env ? env : "(null)");
    solvapay_free_string(env);
    return 1;
  }
  char *resumed = mcp_unwrap_value(env);
  solvapay_free_string(env);
  if (resumed == NULL) {
    return mcp_fail("mcpResume missing value");
  }
  char *rpc = mcp_json_get_raw(resumed, "rpc");
  int rc = mcp_write_http(200, "{\"content-type\":\"application/json\"}",
                          rpc != NULL ? rpc : resumed);
  free(rpc);
  free(resumed);
  return rc;
}

static int handle_mcp(SolvapayClient *client, const char *rpc_raw, const char *config_raw,
                      const char *auth) {
  const char *config = config_raw != NULL ? config_raw : kDefaultConfig;
  char *auth_q = auth != NULL && auth[0] != '\0' ? mcp_json_quote(auth) : NULL;
  size_t cap = strlen(rpc_raw) + strlen(config) + (auth_q ? strlen(auth_q) : 0) + 64;
  char *args = malloc(cap);
  if (args == NULL) {
    free(auth_q);
    return mcp_fail("dispatch args oom");
  }
  if (auth_q != NULL) {
    snprintf(args, cap, "{\"rpc\":%s,\"config\":%s,\"authHeader\":%s}", rpc_raw, config, auth_q);
    free(auth_q);
  } else {
    snprintf(args, cap, "{\"rpc\":%s,\"config\":%s}", rpc_raw, config);
  }
  char *env = solvapay_client_call(client, "mcpDispatch", args);
  free(args);
  if (!mcp_envelope_ok(env)) {
    fprintf(stderr, "FAIL: mcpDispatch %s\n", env ? env : "(null)");
    solvapay_free_string(env);
    return 1;
  }
  char *value = mcp_unwrap_value(env);
  solvapay_free_string(env);
  if (value == NULL) {
    return mcp_fail("dispatch missing value");
  }
  char *kind = mcp_json_get_string(value, "kind");
  int rc = 1;
  if (kind != NULL && strcmp(kind, "rpc") == 0) {
    char *rpc = mcp_json_get_raw(value, "rpc");
    rc = mcp_write_http(200, "{\"content-type\":\"application/json\"}", rpc);
    free(rpc);
  } else if (kind != NULL && strcmp(kind, "challenge") == 0) {
    char *status_s = mcp_json_get_string(value, "status");
    char *headers = mcp_json_get_raw(value, "headers");
    char *body = mcp_json_get_raw(value, "body");
    rc = mcp_write_http(status_s != NULL ? atoi(status_s) : 401, headers, body);
    free(status_s);
    free(headers);
    free(body);
  } else if (kind != NULL && strcmp(kind, "invokeHandler") == 0) {
    rc = resume_echo(value);
  } else {
    fprintf(stderr, "FAIL: unexpected mcpDispatch kind: %s\n", kind ? kind : "(null)");
  }
  free(kind);
  free(value);
  return rc;
}

static SolvapayClient *new_client(const char *api_base) {
  const char *base = api_base;
  if (base == NULL || base[0] == '\0') {
    base = getenv("SOLVAPAY_API_BASE_URL");
  }
  if (base == NULL || base[0] == '\0') {
    base = "http://127.0.0.1:1";
  }
  char config[1024];
  int n = snprintf(config, sizeof(config),
                   "{\"apiKey\":\"sk_test_c_mcp\",\"apiBaseUrl\":\"%s\"}", base);
  if (n < 0 || (size_t)n >= sizeof(config)) {
    return NULL;
  }
  SolvapayClient *client = NULL;
  if (solvapay_client_new(config, &client) != SolvapayStatus_Ok) {
    return NULL;
  }
  return client;
}

int main(void) {
  char *input = mcp_read_stdin();
  if (input == NULL || input[0] == '\0') {
    free(input);
    return mcp_fail("empty stdin");
  }

  int is_http = mcp_find_key(input, "path") != NULL;
  char *method = is_http ? mcp_json_get_string(input, "method") : NULL;
  char *path = is_http ? mcp_json_get_string(input, "path") : NULL;
  char *headers = is_http ? mcp_json_get_raw(input, "headers") : NULL;
  char *body_raw = is_http ? mcp_json_get_raw(input, "body") : NULL;
  char *config = is_http ? mcp_json_get_raw(input, "config") : NULL;
  char *api_base = config != NULL ? mcp_json_get_string(config, "apiBaseUrl") : NULL;
  char *mcp_path_s = config != NULL ? mcp_json_get_string(config, "mcpPath") : NULL;
  const char *mcp_path = mcp_path_s != NULL && mcp_path_s[0] != '\0' ? mcp_path_s : "/mcp";

  char *body = NULL;
  if (body_raw != NULL && body_raw[0] == '"') {
    body = mcp_json_unquote(body_raw);
  } else if (body_raw != NULL) {
    body = body_raw;
    body_raw = NULL;
  }

  SolvapayClient *client = new_client(api_base);
  if (client == NULL) {
    free(input);
    free(method);
    free(path);
    free(headers);
    free(body_raw);
    free(body);
    free(config);
    free(api_base);
    free(mcp_path_s);
    return mcp_fail("solvapay_client_new");
  }

  int rc;
  if (!is_http) {
    rc = handle_mcp(client, input, kDefaultConfig, NULL);
  } else {
    char *only = mcp_path_only(path);
    if (only == NULL) {
      solvapay_client_free(client);
      return mcp_fail("path");
    }
    if (strcmp(only, mcp_path) != 0) {
      rc = handle_oauth(client, method != NULL ? method : "GET", path != NULL ? path : "/",
                        headers, body, config);
    } else if (method == NULL || strcasecmp(method, "POST") != 0) {
      rc = mcp_write_http(405, "{\"allow\":\"POST\"}", "null");
    } else {
      char *auth = headers != NULL ? mcp_json_get_string(headers, "authorization") : NULL;
      const char *rpc = body != NULL && body[0] != '\0' ? body : "{}";
      rc = handle_mcp(client, rpc, config, auth);
      free(auth);
    }
    free(only);
  }

  solvapay_client_free(client);
  free(input);
  free(method);
  free(path);
  free(headers);
  free(body_raw);
  free(body);
  free(config);
  free(api_base);
  free(mcp_path_s);
  return rc;
}
