/*
 * Step 54 C ABI smoke: create → getMerchant → free → deliberate handle misuse.
 *
 * Expects a mock HTTP server at SOLVAPAY_SMOKE_BASE_URL (set by run.sh).
 */

#include "../include/solvapay.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int fail(const char *msg) {
  fprintf(stderr, "FAIL: %s\n", msg);
  return 1;
}

static int envelope_ok(const char *json) {
  return json != NULL && strstr(json, "\"ok\":true") != NULL;
}

static int envelope_err(const char *json) {
  return json != NULL && strstr(json, "\"ok\":false") != NULL;
}

int main(void) {
  const char *base = getenv("SOLVAPAY_SMOKE_BASE_URL");
  if (base == NULL || base[0] == '\0') {
    return fail("SOLVAPAY_SMOKE_BASE_URL is not set");
  }

  uint32_t abi = solvapay_abi_version();
  if (abi != SOLVAPAY_ABI_VERSION) {
    fprintf(stderr, "FAIL: abi_version=%u header=%d\n", abi, SOLVAPAY_ABI_VERSION);
    return 1;
  }
  printf("ok: abi_version=%u\n", abi);

  char *version = solvapay_version();
  if (version == NULL || version[0] == '\0') {
    return fail("solvapay_version returned empty");
  }
  printf("ok: version=%s\n", version);
  solvapay_free_string(version);

  char config[512];
  int n = snprintf(config, sizeof(config),
                   "{\"apiKey\":\"sk_test_c_smoke\",\"apiBaseUrl\":\"%s\"}", base);
  if (n < 0 || (size_t)n >= sizeof(config)) {
    return fail("config snprintf overflow");
  }

  SolvapayClient *client = NULL;
  SolvapayStatus status = solvapay_client_new(config, &client);
  if (status != SolvapayStatus_Ok || client == NULL) {
    fprintf(stderr, "FAIL: client_new status=%d\n", (int)status);
    return 1;
  }
  printf("ok: client_new\n");

  char *env = solvapay_client_call(client, "getMerchant", "{}");
  if (!envelope_ok(env)) {
    fprintf(stderr, "FAIL: getMerchant envelope: %s\n", env ? env : "(null)");
    solvapay_free_string(env);
    solvapay_client_free(client);
    return 1;
  }
  if (strstr(env, "Acme Payments") == NULL) {
    fprintf(stderr, "FAIL: missing displayName in: %s\n", env);
    solvapay_free_string(env);
    solvapay_client_free(client);
    return 1;
  }
  printf("ok: getMerchant %s\n", env);
  solvapay_free_string(env);

  solvapay_client_free(client);
  printf("ok: client_free\n");

  /* Deliberate use-after-free — must return a parseable error envelope, not crash. */
  char *stale = solvapay_client_call(client, "getMerchant", "{}");
  if (!envelope_err(stale)) {
    fprintf(stderr, "FAIL: stale handle envelope: %s\n", stale ? stale : "(null)");
    solvapay_free_string(stale);
    return 1;
  }
  printf("ok: use-after-free → %s\n", stale);
  solvapay_free_string(stale);

  /* Garbage pointer — checked InvalidHandle path. */
  SolvapayClient *garbage = (SolvapayClient *)(uintptr_t)0xDEADBEEF;
  char *misuse = solvapay_client_call(garbage, "getMerchant", "{}");
  if (!envelope_err(misuse)) {
    fprintf(stderr, "FAIL: garbage handle envelope: %s\n", misuse ? misuse : "(null)");
    solvapay_free_string(misuse);
    return 1;
  }
  printf("ok: garbage handle → %s\n", misuse);
  solvapay_free_string(misuse);

  /* Double-free is a no-op (generation already bumped). */
  solvapay_client_free(client);
  printf("ok: double-free\n");

  /* Null handle call — error envelope, not crash. */
  char *null_call = solvapay_client_call(NULL, "getMerchant", "{}");
  if (!envelope_err(null_call)) {
    fprintf(stderr, "FAIL: null handle envelope: %s\n", null_call ? null_call : "(null)");
    solvapay_free_string(null_call);
    return 1;
  }
  printf("ok: null handle → %s\n", null_call);
  solvapay_free_string(null_call);

  /* Null args to solvapay_client_new. */
  SolvapayClient *unused = NULL;
  if (solvapay_client_new(NULL, &unused) != SolvapayStatus_NullArgument) {
    return fail("null config must be NullArgument");
  }
  if (solvapay_client_new("{\"apiKey\":\"sk\"}", NULL) != SolvapayStatus_NullArgument) {
    return fail("null out must be NullArgument");
  }
  printf("ok: null args to client_new\n");

  char *sync_ok = solvapay_call("validateBusinessDetails", "{\"isBusiness\":false}");
  if (!envelope_ok(sync_ok)) {
    fprintf(stderr, "FAIL: solvapay_call envelope: %s\n", sync_ok ? sync_ok : "(null)");
    solvapay_free_string(sync_ok);
    return 1;
  }
  printf("ok: solvapay_call validateBusinessDetails\n");
  solvapay_free_string(sync_ok);

  char *null_op = solvapay_call(NULL, "{}");
  if (!envelope_err(null_op)) {
    fprintf(stderr, "FAIL: null op envelope: %s\n", null_op ? null_op : "(null)");
    solvapay_free_string(null_op);
    return 1;
  }
  printf("ok: null op → %s\n", null_op);
  solvapay_free_string(null_op);

  char *unknown_op = solvapay_call("noSuchOp", "{}");
  if (!envelope_err(unknown_op)) {
    fprintf(stderr, "FAIL: unknown op envelope: %s\n", unknown_op ? unknown_op : "(null)");
    solvapay_free_string(unknown_op);
    return 1;
  }
  printf("ok: unknown op → %s\n", unknown_op);
  solvapay_free_string(unknown_op);

  char *null_args = solvapay_call("validateBusinessDetails", NULL);
  if (!envelope_err(null_args)) {
    fprintf(stderr, "FAIL: null args envelope: %s\n", null_args ? null_args : "(null)");
    solvapay_free_string(null_args);
    return 1;
  }
  printf("ok: null args → %s\n", null_args);
  solvapay_free_string(null_args);

  printf("PASS: C ABI smoke\n");
  return 0;
}
