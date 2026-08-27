/*
 * solvapay_call / solvapay_client_call helper used by replay_fixtures.py.
 * Usage: mcp_call <op> <args-json-file-or-->
 *   `-` reads args JSON from stdin.
 *
 * Sync MCP ops go through solvapay_call. mcpDispatch / mcpOauthRequest need
 * a client handle (solvapay_client_call). Optional SOLVAPAY_API_BASE_URL
 * defaults to an unreachable origin so oauth-proxy 502 fixtures stay local.
 */

#include "../include/solvapay.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int is_client_op(const char *op) {
  return strcmp(op, "mcpDispatch") == 0 || strcmp(op, "mcpOauthRequest") == 0 ||
         strcmp(op, "mcpBootstrap") == 0 || strcmp(op, "mcpCallBuiltinTool") == 0;
}

static char *read_all(FILE *in) {
  size_t cap = 4096;
  size_t len = 0;
  char *buf = malloc(cap);
  if (buf == NULL) {
    return NULL;
  }
  int c;
  while ((c = fgetc(in)) != EOF) {
    if (len + 1 >= cap) {
      cap *= 2;
      char *grown = realloc(buf, cap);
      if (grown == NULL) {
        free(buf);
        return NULL;
      }
      buf = grown;
    }
    buf[len++] = (char)c;
  }
  buf[len] = '\0';
  return buf;
}

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: mcp_call <op> <args.json|- >\n");
    return 2;
  }
  const char *op = argv[1];
  char *args = NULL;
  if (strcmp(argv[2], "-") == 0) {
    args = read_all(stdin);
  } else {
    FILE *f = fopen(argv[2], "rb");
    if (f == NULL) {
      fprintf(stderr, "cannot open %s\n", argv[2]);
      return 1;
    }
    args = read_all(f);
    fclose(f);
  }
  if (args == NULL) {
    fprintf(stderr, "failed to read args\n");
    return 1;
  }

  char *env = NULL;
  SolvapayClient *client = NULL;
  if (is_client_op(op)) {
    const char *base = getenv("SOLVAPAY_API_BASE_URL");
    if (base == NULL || base[0] == '\0') {
      base = "http://127.0.0.1:1";
    }
    char config[1024];
    int n = snprintf(config, sizeof(config),
                     "{\"apiKey\":\"sk_test_c_mcp\",\"apiBaseUrl\":\"%s\"}", base);
    if (n < 0 || (size_t)n >= sizeof(config)) {
      fprintf(stderr, "config overflow\n");
      free(args);
      return 1;
    }
    if (solvapay_client_new(config, &client) != SolvapayStatus_Ok || client == NULL) {
      fprintf(stderr, "solvapay_client_new failed\n");
      free(args);
      return 1;
    }
    env = solvapay_client_call(client, op, args);
    solvapay_client_free(client);
  } else {
    env = solvapay_call(op, args);
  }
  free(args);
  if (env == NULL) {
    fprintf(stderr, "dispatch returned null\n");
    return 1;
  }
  fputs(env, stdout);
  fputc('\n', stdout);
  int ok = strstr(env, "\"ok\":true") != NULL;
  solvapay_free_string(env);
  return ok ? 0 : 1;
}
