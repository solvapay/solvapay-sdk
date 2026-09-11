#ifndef SOLVAPAY_MCP_JSON_H
#define SOLVAPAY_MCP_JSON_H

char *mcp_read_stdin(void);
char *mcp_dup_str(const char *s);
const char *mcp_find_key(const char *json, const char *key);
char *mcp_json_get_raw(const char *json, const char *key);
char *mcp_json_get_string(const char *json, const char *key);
char *mcp_json_unquote(const char *raw);
char *mcp_json_quote(const char *s);
int mcp_envelope_ok(const char *env);
char *mcp_unwrap_value(const char *env);
char *mcp_path_only(const char *path);
char *mcp_inject_customer_ref(const char *args_raw, const char *customer_ref);
int mcp_write_http(int status, const char *headers_json, const char *body_json);
int mcp_fail(const char *msg);

#endif
