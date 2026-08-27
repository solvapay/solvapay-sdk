/*
 * MCP fixture driver: replay contract/mcp-fixtures via solvapay_call.
 *
 * Built by ctest/mcp.sh. Sync MCP ops go through solvapay_call. Async
 * mcpDispatch / mcpOauthRequest go through solvapay_client_call (see mcp_call.c
 * and the reference adapter in mcp_engine.c). registerPayable stays host-only.
 */

#include "../include/solvapay.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

static int fail(const char *msg) {
  fprintf(stderr, "FAIL: %s\n", msg);
  return 1;
}

int main(void) {
  const char *root = getenv("SOLVAPAY_MCP_FIXTURES");
  if (root == NULL || root[0] == '\0') {
    return fail("SOLVAPAY_MCP_FIXTURES is not set");
  }

  char *versioned = solvapay_call("mcpMergeCsp", "{}");
  if (versioned == NULL || strstr(versioned, "\"ok\":true") == NULL) {
    fprintf(stderr, "FAIL: mcpMergeCsp: %s\n", versioned ? versioned : "(null)");
    solvapay_free_string(versioned);
    return 1;
  }
  printf("ok: mcpMergeCsp via solvapay_call\n");
  solvapay_free_string(versioned);
  printf("OK: C MCP driver smoke\n");
  return 0;
}
