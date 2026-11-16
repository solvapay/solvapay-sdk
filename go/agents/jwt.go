package agents

// ES256 JWT verification, by the rules TypeScript's jose applies (jwtVerify
// with a local or remote JWKS): which key may verify a token, the signature,
// then the claims and times. Written on crypto/ecdsa rather than a JWT
// library, because the key selection and claim checks have to match jose's
// exactly and no Go library selects keys the same way.

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// JWKS is a JSON Web Key Set. Members stay as decoded JSON: a member's fields
// may be of any type, and one that is not what jose expects just doesn't match.
type JWKS struct {
	Keys []map[string]any `json:"keys"`
}

// KeySource supplies SolvaPay's public keys. refresh asks for a fresh copy,
// as after a key rotation.
type KeySource interface {
	JWKS(ctx context.Context, refresh bool) (JWKS, error)
}

// StaticKeys is a fixed key set.
type StaticKeys JWKS

// JWKS returns the set.
func (s StaticKeys) JWKS(context.Context, bool) (JWKS, error) { return JWKS(s), nil }

// RemoteKeys fetches a JWKS URL and caches it for ten minutes; a token whose
// key is not in the cached set fetches it again, at most every 30 seconds
// (jose's createRemoteJWKSet defaults).
type RemoteKeys struct {
	URL        string
	HTTPClient *http.Client
	Now        func() time.Time

	mu      sync.Mutex
	keys    *JWKS
	fetched time.Time
}

const (
	jwksCacheMaxAge = 10 * time.Minute
	jwksCooldown    = 30 * time.Second
)

// JWKS returns the cached set, fetching it when absent, stale, or refresh is
// asked for and the last fetch is older than the cooldown.
func (r *RemoteKeys) JWKS(ctx context.Context, refresh bool) (JWKS, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	if r.Now != nil {
		now = r.Now()
	}
	age := now.Sub(r.fetched)
	if r.keys != nil && age < jwksCacheMaxAge && (!refresh || age < jwksCooldown) {
		return *r.keys, nil
	}
	client := r.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, r.URL, nil)
	if err != nil {
		return JWKS{}, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return JWKS{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return JWKS{}, fmt.Errorf("fetching %s answered %d", r.URL, response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return JWKS{}, err
	}
	var keys JWKS
	if err := json.Unmarshal(body, &keys); err != nil || keys.Keys == nil {
		return JWKS{}, fmt.Errorf("%s is not a JSON Web Key Set", r.URL)
	}
	r.keys, r.fetched = &keys, now
	return keys, nil
}

// errExpired is the one token error that is not "invalid".
var errExpired = errors.New(`"exp" claim timestamp check failed`)

type jwtOptions struct {
	issuer         string
	audiences      []string
	requiredClaims []string
	tolerance      float64
	now            time.Time
}

// verifyES256 checks a compact JWS and its claims as jose's jwtVerify does,
// and returns the claims. Every failure is a plain error but an expired
// token's, which is errExpired.
func verifyES256(ctx context.Context, token string, keys KeySource, options jwtOptions) (map[string]any, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("Invalid Compact JWS")
	}
	headerBytes, err := base64urlDecode(parts[0])
	if err != nil {
		return nil, errors.New("Invalid Compact JWS")
	}
	header, ok := decodeObject(headerBytes)
	if !ok {
		return nil, errors.New("JWS Protected Header is invalid")
	}
	if err := checkCrit(header); err != nil {
		return nil, err
	}
	alg, _ := header["alg"].(string)
	if alg == "" {
		return nil, errors.New(`JWS "alg" (Algorithm) Header Parameter missing or invalid`)
	}
	if alg != "ES256" {
		return nil, errors.New(`"alg" (Algorithm) Header Parameter value not allowed`)
	}
	key, err := selectKey(ctx, keys, header)
	if err != nil {
		return nil, err
	}
	signature, err := base64urlDecode(parts[2])
	if err != nil {
		return nil, errors.New("Failed to base64url decode the signature")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if len(signature) != 64 || !ecdsa.Verify(key, digest[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])) {
		return nil, errors.New("signature verification failed")
	}
	payloadBytes, err := base64urlDecode(parts[1])
	if err != nil {
		return nil, errors.New("Failed to base64url decode the payload")
	}
	claims, ok := decodeObject(payloadBytes)
	if !ok {
		return nil, errors.New("JWT Claims Set must be a top-level JSON object")
	}
	return claims, checkClaims(claims, options)
}

// checkCrit validates "crit" as jose does. The one extension jose knows is
// b64; this verifier accepts it only as true (a base64url payload), where jose
// would also verify an unencoded one.
func checkCrit(header map[string]any) error {
	crit, present := header["crit"]
	if !present {
		return nil
	}
	list, ok := crit.([]any)
	if !ok || len(list) == 0 {
		return errors.New(`"crit" Header Parameter must be an array of non-empty strings`)
	}
	for _, item := range list {
		name, ok := item.(string)
		if !ok || name == "" {
			return errors.New(`"crit" Header Parameter must be an array of non-empty strings`)
		}
		if name != "b64" {
			return fmt.Errorf("Extension Header Parameter %q is not recognized", name)
		}
		if _, ok := header[name]; !ok {
			return fmt.Errorf("Extension Header Parameter %q is missing", name)
		}
		if b, ok := header["b64"].(bool); !ok || !b {
			return errors.New("unsupported b64 Header Parameter")
		}
	}
	return nil
}

// selectKey picks the one JWKS member that may verify an ES256 token with this
// header, as jose's local JWKS does: an EC key, the token's kid when it has
// one, alg (if any) ES256, use (if any) sig, key_ops (if any) with verify,
// curve P-256. None matching fetches the set once more; more than one is
// ambiguous.
func selectKey(ctx context.Context, keys KeySource, header map[string]any) (*ecdsa.PublicKey, error) {
	kid, hasKid := header["kid"].(string)
	for _, refresh := range []bool{false, true} {
		set, err := keys.JWKS(ctx, refresh)
		if err != nil {
			return nil, err
		}
		var candidates []map[string]any
		for _, jwk := range set.Keys {
			if keyMatches(jwk, kid, hasKid) {
				candidates = append(candidates, jwk)
			}
		}
		if len(candidates) > 1 {
			return nil, errors.New("multiple matching keys found in the JSON Web Key Set")
		}
		if len(candidates) == 1 {
			return importP256(candidates[0])
		}
	}
	return nil, errors.New("no applicable key found in the JSON Web Key Set")
}

func keyMatches(jwk map[string]any, kid string, hasKid bool) bool {
	if jwk["kty"] != "EC" {
		return false
	}
	if hasKid && jwk["kid"] != kid {
		return false
	}
	if alg, ok := jwk["alg"].(string); ok && alg != "ES256" {
		return false
	}
	if use, ok := jwk["use"].(string); ok && use != "sig" {
		return false
	}
	if ops, ok := jwk["key_ops"].([]any); ok && !containsValue(ops, "verify") {
		return false
	}
	return jwk["crv"] == "P-256"
}

func containsValue(list []any, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

// importP256 reads a public P-256 JWK, refusing a private one (jose verifies
// only with a public key) and a point off the curve.
func importP256(jwk map[string]any) (*ecdsa.PublicKey, error) {
	if _, private := jwk["d"]; private {
		return nil, errors.New("a private key cannot verify")
	}
	x, xErr := coordinate(jwk["x"])
	y, yErr := coordinate(jwk["y"])
	if xErr != nil || yErr != nil {
		return nil, errors.New("invalid EC JWK coordinates")
	}
	point := append(append([]byte{4}, x...), y...)
	if _, err := ecdh.P256().NewPublicKey(point); err != nil {
		return nil, errors.New("invalid EC public key")
	}
	key := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
	return key, nil
}

func coordinate(value any) ([]byte, error) {
	text, ok := value.(string)
	if !ok {
		return nil, errors.New("not a string")
	}
	decoded, err := base64urlDecode(text)
	if err != nil || len(decoded) != 32 {
		return nil, errors.New("not a P-256 coordinate")
	}
	return decoded, nil
}

// checkClaims is jose's validateClaimsSet for the options this SDK uses:
// required claims present, issuer, audience, then iat, nbf and exp with
// tolerance against the clock read in whole seconds.
func checkClaims(claims map[string]any, options jwtOptions) error {
	required := append([]string{"iss", "aud"}, options.requiredClaims...)
	for _, claim := range required {
		if _, present := claims[claim]; !present {
			return fmt.Errorf("missing required %q claim", claim)
		}
	}
	if claims["iss"] != options.issuer {
		return errors.New(`unexpected "iss" claim value`)
	}
	if !audiencePresent(claims["aud"], options.audiences) {
		return errors.New(`unexpected "aud" claim value`)
	}
	now := math.Floor(float64(options.now.UnixMilli()) / 1000)
	if iat, present := claims["iat"]; present {
		if _, ok := iat.(float64); !ok {
			return errors.New(`"iat" claim must be a number`)
		}
	}
	if raw, present := claims["nbf"]; present {
		nbf, ok := raw.(float64)
		if !ok {
			return errors.New(`"nbf" claim must be a number`)
		}
		if nbf > now+options.tolerance {
			return errors.New(`"nbf" claim timestamp check failed`)
		}
	}
	if raw, present := claims["exp"]; present {
		exp, ok := raw.(float64)
		if !ok {
			return errors.New(`"exp" claim must be a number`)
		}
		if exp <= now-options.tolerance {
			return errExpired
		}
	}
	return nil
}

// audiencePresent is jose's checkAudiencePresence: a string audience must be
// one of ours, a list must share one with ours, anything else fails.
func audiencePresent(aud any, ours []string) bool {
	switch v := aud.(type) {
	case string:
		for _, a := range ours {
			if a == v {
				return true
			}
		}
	case []any:
		for _, item := range v {
			for _, a := range ours {
				if item == a {
					return true
				}
			}
		}
	}
	return false
}

// base64urlDecode reads base64url as JavaScript's forgiving decoder does:
// padding optional, ASCII whitespace ignored.
func base64urlDecode(text string) ([]byte, error) {
	text = strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\n' || r == '\f' || r == '\r' {
			return -1
		}
		return r
	}, text)
	if len(text)%4 == 0 {
		text = strings.TrimSuffix(strings.TrimSuffix(text, "="), "=")
	}
	return base64.RawURLEncoding.DecodeString(text)
}

func decodeObject(data []byte) (map[string]any, bool) {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&value); err != nil || decoder.More() {
		return nil, false
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, false
	}
	m, ok := value.(map[string]any)
	return m, ok
}

// decodeJWTClaims reads a token's claims without verifying it, as jose's
// decodeJwt does, only to route a request.
func decodeJWTClaims(token string) (map[string]any, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[1] == "" {
		return nil, false
	}
	payload, err := base64urlDecode(parts[1])
	if err != nil {
		return nil, false
	}
	return decodeObject(payload)
}
