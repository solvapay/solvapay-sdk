package agents

// A merchant's MCP server or API as an OAuth 2.1 protected resource (RFC
// 9728): the document that tells a host where to sign the owner in, and the
// 401 challenge that sends it there. SolvaPay's agent issuer is the
// authorization server; the access token it issues is an ordinary agent token
// whose aud is this resource.

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

// AgentScope is the one scope an agent token carries.
const AgentScope = "usage"

const metadataPrefix = "/.well-known/oauth-protected-resource"

// ProtectedResource turns OAuth sign-in on for hosts such as Claude and ChatGPT.
type ProtectedResource struct {
	// Resource is the MCP or API URL, with its path. Becomes resource and the expected aud.
	Resource string
	// AuthorizationServer is SolvaPay's agent issuer; the MCP route defaults it to its issuer.
	AuthorizationServer string
	// Documentation is shown to hosts in the metadata document.
	Documentation string
	// MetadataPath is where the metadata is served. Default:
	// /.well-known/oauth-protected-resource + the resource path.
	MetadataPath string
}

// parsedResource is a resource URL read as browsers read it, for the parts
// this file needs: scheme and host lowercased, default port dropped, dot
// segments removed. Go's url.Parse alone keeps the host's case and the dots.
type parsedResource struct {
	scheme, host, path, query string
}

var defaultPorts = map[string]string{"http": "80", "https": "443", "ws": "80", "wss": "443", "ftp": "21"}

func parseResource(resource string) (parsedResource, error) {
	u, err := url.Parse(resource)
	if err != nil || u.Scheme == "" || u.Host == "" || u.Opaque != "" {
		return parsedResource{}, &solvapay.Error{Code: "invalid_resource", Message: resource + " is not an absolute URL"}
	}
	if u.Fragment != "" || u.RawFragment != "" || (u.User != nil && (u.User.Username() != "" || hasPassword(u.User))) {
		return parsedResource{}, &solvapay.Error{Code: "invalid_resource", Message: resource + " cannot be an OAuth resource: no fragment or credentials"}
	}
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port := u.Port(); port != "" && port != defaultPorts[scheme] {
		host += ":" + port
	}
	path := u.EscapedPath()
	if path == "" {
		path = "/"
	}
	return parsedResource{scheme: scheme, host: host, path: removeDotSegments(path), query: u.RawQuery}, nil
}

func hasPassword(user *url.Userinfo) bool {
	password, set := user.Password()
	return set && password != ""
}

// removeDotSegments is RFC 3986 section 5.2.4 as the URL standard applies it:
// /a/../b/./c is /b/c, and empty segments stay.
func removeDotSegments(path string) string {
	segments := strings.Split(path, "/")
	var out []string
	for i, segment := range segments {
		last := i == len(segments)-1
		switch segment {
		case ".":
			if last {
				out = append(out, "")
			}
		case "..":
			if len(out) > 1 {
				out = out[:len(out)-1]
			}
			if last {
				out = append(out, "")
			}
		default:
			out = append(out, segment)
		}
	}
	return strings.Join(out, "/")
}

// CanonicalResource is the form SolvaPay compares resources in: scheme and
// host lowercased, default port dropped, no trailing slash, query kept. A
// fragment or credentials make it unusable as a resource: an error with code
// invalid_resource.
func CanonicalResource(resource string) (string, error) {
	p, err := parseResource(resource)
	if err != nil {
		return "", err
	}
	query := ""
	if p.query != "" {
		query = "?" + p.query
	}
	return p.scheme + "://" + p.host + strings.TrimRight(p.path, "/") + query, nil
}

// MetadataPathFor is where the metadata is served: MetadataPath, else the RFC
// 9728 path-suffixed form hosts try first, /.well-known/oauth-protected-resource/mcp.
func (r ProtectedResource) MetadataPathFor() (string, error) {
	if r.MetadataPath != "" {
		return r.MetadataPath, nil
	}
	canonical, err := CanonicalResource(r.Resource)
	if err != nil {
		return "", err
	}
	p, err := parseResource(canonical)
	if err != nil {
		return "", err
	}
	if p.path == "/" {
		return metadataPrefix, nil
	}
	return metadataPrefix + p.path, nil
}

// MetadataURL is the absolute URL a challenge points hosts at.
func (r ProtectedResource) MetadataURL() (string, error) {
	path, err := r.MetadataPathFor()
	if err != nil {
		return "", err
	}
	base, err := parseResource(r.Resource)
	if err != nil {
		return "", err
	}
	baseURL := &url.URL{Scheme: base.scheme, Host: base.host}
	baseURL.Path, _ = url.PathUnescape(base.path)
	baseURL.RawPath = base.path
	ref, err := url.Parse(path)
	if err != nil {
		return "", &solvapay.Error{Code: "invalid_resource", Message: path + " is not a metadata path"}
	}
	return baseURL.ResolveReference(ref).String(), nil
}

// Metadata is the RFC 9728 document: resource is the URL with its path, not
// the bare origin, and authorization_servers names SolvaPay's issuer.
func (r ProtectedResource) Metadata(serverName string) (map[string]any, error) {
	canonical, err := CanonicalResource(r.Resource)
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"resource":                 canonical,
		"authorization_servers":    []string{r.AuthorizationServer},
		"scopes_supported":         []string{AgentScope},
		"bearer_methods_supported": []string{"header"},
	}
	if serverName != "" {
		out["resource_name"] = serverName
	}
	if r.Documentation != "" {
		out["resource_documentation"] = r.Documentation
	}
	return out, nil
}

func quoted(value string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value)
}

// ChallengeHeaders is the WWW-Authenticate challenge hosts look for, with
// error and error_description both present (ChatGPT requires both) and the
// one scope, so hosts ask for nothing broader.
func (r ProtectedResource) ChallengeHeaders(description string) (http.Header, error) {
	metadataURL, err := r.MetadataURL()
	if err != nil {
		return nil, err
	}
	header := http.Header{}
	header.Set("WWW-Authenticate", `Bearer error="invalid_token", error_description="`+quoted(description)+
		`", resource_metadata="`+metadataURL+`", scope="`+AgentScope+`"`)
	header.Set("Access-Control-Expose-Headers", "WWW-Authenticate")
	return header, nil
}

// WriteAuthChallenge answers 401 with a JSON-RPC error and the challenge: the
// host signs the owner in, or refreshes, and retries. jsonRPCID is the
// request's id, nil for none.
func (r ProtectedResource) WriteAuthChallenge(w http.ResponseWriter, description string, jsonRPCID any) error {
	header, err := r.ChallengeHeaders(description)
	if err != nil {
		return err
	}
	for name, values := range header {
		w.Header()[name] = values
	}
	writeJSON(w, http.StatusUnauthorized, jsonRPCError(jsonRPCID, -32001, description))
	return nil
}

// ServeMetadata answers a GET or HEAD for the metadata document at its path
// (public, cacheable, any origin), for an API or a server that is not on the
// MCP route. It reports false, writing nothing, for any other request.
func (r ProtectedResource) ServeMetadata(w http.ResponseWriter, req *http.Request, serverName string, extraPaths ...string) (bool, error) {
	if req.Method != http.MethodGet && req.Method != http.MethodHead {
		return false, nil
	}
	path, err := r.MetadataPathFor()
	if err != nil {
		return false, err
	}
	if req.URL.EscapedPath() != path && !contains(extraPaths, req.URL.EscapedPath()) {
		return false, nil
	}
	document, err := r.Metadata(serverName)
	if err != nil {
		return false, err
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	writeJSON(w, http.StatusOK, document)
	return true, nil
}

func contains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

func jsonRPCError(id any, code int, message string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	encoded, err := json.Marshal(body)
	if err != nil {
		panic("agents: encoding a JSON answer: " + err.Error())
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}
