/*
 * Tiny JSON helpers for the C MCP adapter. The C ABI is stringly typed;
 * this is not MCP logic.
 */

#include "mcp_json.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *mcp_dup_str(const char *s) {
  if (s == NULL) {
    return NULL;
  }
  size_t n = strlen(s);
  char *out = malloc(n + 1);
  if (out == NULL) {
    return NULL;
  }
  memcpy(out, s, n + 1);
  return out;
}

char *mcp_read_stdin(void) {
  size_t cap = 4096;
  size_t len = 0;
  char *buf = malloc(cap);
  if (buf == NULL) {
    return NULL;
  }
  int c;
  while ((c = fgetc(stdin)) != EOF) {
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

int mcp_fail(const char *msg) {
  fprintf(stderr, "FAIL: %s\n", msg);
  return 1;
}

static const char *skip_ws(const char *s) {
  while (s != NULL && (*s == ' ' || *s == '\n' || *s == '\r' || *s == '\t')) {
    s++;
  }
  return s;
}

static const char *end_of_string(const char *p) {
  p++;
  while (*p != '\0') {
    if (*p == '\\' && p[1] != '\0') {
      p += 2;
      continue;
    }
    if (*p == '"') {
      return p + 1;
    }
    p++;
  }
  return p;
}

static const char *end_of_value(const char *p) {
  p = skip_ws(p);
  if (*p == '"') {
    return end_of_string(p);
  }
  if (*p == '{' || *p == '[') {
    int depth = 0;
    int in_str = 0;
    for (; *p != '\0'; p++) {
      if (in_str != 0) {
        if (*p == '\\' && p[1] != '\0') {
          p++;
          continue;
        }
        if (*p == '"') {
          in_str = 0;
        }
        continue;
      }
      if (*p == '"') {
        in_str = 1;
        continue;
      }
      if (*p == '{' || *p == '[') {
        depth++;
      } else if (*p == '}' || *p == ']') {
        depth--;
        if (depth == 0) {
          return p + 1;
        }
      }
    }
    return p;
  }
  while (*p != '\0' && *p != ',' && *p != '}' && *p != ']' && !isspace((unsigned char)*p)) {
    p++;
  }
  return p;
}

static char *dup_range(const char *start, const char *end) {
  size_t n = (size_t)(end - start);
  char *out = malloc(n + 1);
  if (out == NULL) {
    return NULL;
  }
  memcpy(out, start, n);
  out[n] = '\0';
  return out;
}

const char *mcp_find_key(const char *json, const char *key) {
  char needle[128];
  int n = snprintf(needle, sizeof(needle), "\"%s\"", key);
  if (n < 0 || (size_t)n >= sizeof(needle) || json == NULL) {
    return NULL;
  }
  const char *p = json;
  while ((p = strstr(p, needle)) != NULL) {
    const char *after = skip_ws(p + (size_t)n);
    if (*after == ':') {
      return skip_ws(after + 1);
    }
    p++;
  }
  return NULL;
}

char *mcp_json_get_raw(const char *json, const char *key) {
  const char *v = mcp_find_key(json, key);
  if (v == NULL) {
    return NULL;
  }
  return dup_range(v, end_of_value(v));
}

char *mcp_json_unquote(const char *raw) {
  if (raw == NULL) {
    return NULL;
  }
  if (raw[0] != '"') {
    return mcp_dup_str(raw);
  }
  size_t cap = strlen(raw);
  char *out = malloc(cap);
  if (out == NULL) {
    return NULL;
  }
  size_t j = 0;
  for (const char *p = raw + 1; *p != '\0' && *p != '"';) {
    if (*p == '\\' && p[1] != '\0') {
      out[j++] = p[1];
      p += 2;
      continue;
    }
    out[j++] = *p++;
  }
  out[j] = '\0';
  return out;
}

char *mcp_json_get_string(const char *json, const char *key) {
  char *raw = mcp_json_get_raw(json, key);
  if (raw == NULL) {
    return NULL;
  }
  char *s = mcp_json_unquote(raw);
  free(raw);
  return s;
}

char *mcp_json_quote(const char *s) {
  if (s == NULL) {
    s = "";
  }
  size_t extra = 2;
  for (const char *p = s; *p != '\0'; p++) {
    if (*p == '\\' || *p == '"') {
      extra++;
    }
  }
  size_t n = strlen(s);
  char *out = malloc(n + extra + 1);
  if (out == NULL) {
    return NULL;
  }
  size_t j = 0;
  out[j++] = '"';
  for (size_t i = 0; i < n; i++) {
    if (s[i] == '\\' || s[i] == '"') {
      out[j++] = '\\';
    }
    out[j++] = s[i];
  }
  out[j++] = '"';
  out[j] = '\0';
  return out;
}

int mcp_envelope_ok(const char *env) {
  return env != NULL && strstr(env, "\"ok\":true") != NULL;
}

char *mcp_unwrap_value(const char *env) {
  return mcp_json_get_raw(env, "value");
}

char *mcp_path_only(const char *path) {
  if (path == NULL) {
    return mcp_dup_str("/");
  }
  const char *q = strchr(path, '?');
  if (q == NULL) {
    return mcp_dup_str(path);
  }
  return dup_range(path, q);
}

char *mcp_inject_customer_ref(const char *args_raw, const char *customer_ref) {
  if (args_raw == NULL) {
    args_raw = "{}";
  }
  if (customer_ref == NULL || strstr(args_raw, "\"customer_ref\"") != NULL) {
    return mcp_dup_str(args_raw);
  }
  char *quoted = mcp_json_quote(customer_ref);
  if (quoted == NULL) {
    return NULL;
  }
  size_t n = strlen(args_raw);
  const char *end = args_raw + n;
  while (end > args_raw && end[-1] != '}') {
    end--;
  }
  if (end == args_raw) {
    free(quoted);
    return NULL;
  }
  end--;
  int empty = skip_ws(args_raw + 1)[0] == '}';
  char *out = malloc(n + strlen(quoted) + 24);
  if (out == NULL) {
    free(quoted);
    return NULL;
  }
  size_t prefix = (size_t)(end - args_raw);
  memcpy(out, args_raw, prefix);
  int w = snprintf(out + prefix, n + strlen(quoted) + 24 - prefix, "%s\"customer_ref\":%s}",
                   empty ? "" : ",", quoted);
  free(quoted);
  if (w < 0) {
    free(out);
    return NULL;
  }
  return out;
}

int mcp_write_http(int status, const char *headers_json, const char *body_json) {
  const char *headers = headers_json != NULL ? headers_json : "{}";
  const char *body = body_json != NULL ? body_json : "null";
  printf("{\"status\":%d,\"headers\":%s,\"body\":%s}\n", status, headers, body);
  return 0;
}
