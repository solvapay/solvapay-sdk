// Go backend for the @solvapay/react web checkout proof.
//
// Serves the routes the React components call under /api/ with
// solvapay.NewWebHandler, plus a demo login at POST /auth/demo-login.
// Run: go run . (port 4020).
package main

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

const (
	addr         = "127.0.0.1:4020"
	tokenSeconds = 3600
)

func main() {
	if err := loadDotEnv(".env"); err != nil {
		log.Fatal(err)
	}
	secret := os.Getenv("DEMO_JWT_SECRET")
	if secret == "" {
		log.Fatal("Set DEMO_JWT_SECRET (e.g. `openssl rand -hex 32`) in .env")
	}
	for _, name := range []string{"SOLVAPAY_SECRET_KEY", "SOLVAPAY_API_BASE_URL", "SOLVAPAY_PRODUCT_REF"} {
		if os.Getenv(name) == "" {
			log.Fatalf("Set %s in .env", name)
		}
	}

	client, err := solvapay.NewClient(solvapay.Config{}) // SOLVAPAY_SECRET_KEY, SOLVAPAY_API_BASE_URL
	if err != nil {
		log.Fatal(err)
	}
	routes, err := solvapay.NewWebHandler(solvapay.WebOptions{
		Client: client,
		// The only identity the routes see: the verified bearer token, or nil (401).
		GetUser: func(r *http.Request) (*solvapay.WebUser, error) {
			token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || token == "" {
				return nil, nil
			}
			claims, err := verifyHS256(token, []byte(secret), time.Now())
			if err != nil {
				return nil, nil
			}
			return &solvapay.WebUser{ID: claims.Sub, Email: claims.Email}, nil
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", routes) // BasePath defaults to /api
	mux.HandleFunc("POST /auth/demo-login", demoLogin([]byte(secret)))
	log.Printf("listening on http://%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

// demoLogin is DEMO ONLY: it signs a token for whatever id is posted. A real
// app signs people in with its own auth and GetUser verifies that.
func demoLogin(secret []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			UserID string `json:"userId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body must be JSON"})
			return
		}
		if strings.TrimSpace(body.UserID) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userId is required"})
			return
		}
		now := time.Now().Unix()
		token, err := signHS256(claims{
			Sub: body.UserID, Email: body.UserID + "@example.com", Iat: now, Exp: now + tokenSeconds,
		}, secret)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"token": token, "userId": body.UserID})
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// ---- a minimal HS256 JWT, enough for the demo token --------------------------

type claims struct {
	Sub   string `json:"sub"`
	Email string `json:"email,omitempty"`
	Iat   int64  `json:"iat"`
	Exp   int64  `json:"exp"`
}

var b64 = base64.RawURLEncoding

const jwtHeader = `{"alg":"HS256","typ":"JWT"}`

func signHS256(c claims, secret []byte) (string, error) {
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	signingInput := b64.EncodeToString([]byte(jwtHeader)) + "." + b64.EncodeToString(payload)
	return signingInput + "." + b64.EncodeToString(mac(signingInput, secret)), nil
}

func verifyHS256(token string, secret []byte, now time.Time) (*claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("not a JWT")
	}
	var header struct {
		Alg string `json:"alg"`
	}
	rawHeader, err := b64.DecodeString(parts[0])
	if err != nil || json.Unmarshal(rawHeader, &header) != nil || header.Alg != "HS256" {
		return nil, errors.New("not an HS256 JWT")
	}
	signature, err := b64.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, mac(parts[0]+"."+parts[1], secret)) {
		return nil, errors.New("bad signature")
	}
	rawPayload, err := b64.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	var c claims
	if err := json.Unmarshal(rawPayload, &c); err != nil {
		return nil, err
	}
	if c.Sub == "" || c.Exp == 0 || now.Unix() >= c.Exp {
		return nil, errors.New("missing sub or expired")
	}
	return &c, nil
}

func mac(signingInput string, secret []byte) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(signingInput))
	return h.Sum(nil)
}

// loadDotEnv sets KEY=value lines from path, leaving variables already set alone.
func loadDotEnv(path string) error {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil // the environment may carry everything
	}
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, value)
		}
	}
	return scanner.Err()
}
