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

  printf("PASS: C ABI smoke\n");
  return 0;
}
