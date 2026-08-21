// Package dispatch reflects camelCase catalog ops onto *solvapay.Client methods.
//
// Shared by offline fixture conformance and the live-contract binary so both
// keep identical arg-splitting / path-vs-body behaviour.
package dispatch

import (
	"context"
	"errors"
	"reflect"
	"strings"

	solvapay "github.com/solvapay/solvapay-go"
)

// Signature is one catalogued client method: PascalCase name → param names (excluding ctx).
type Signature struct {
	Name   string
	Params []string
}

// Signatures locks the Go facade surface for reflective dispatch (mirrors the
// generated operationSignatures table in signature_parity_generated_test.go).
var Signatures = []Signature{
	{"ActivatePlan", []string{"params"}},
	{"AssignCredits", []string{"params"}},
	{"AttachBusinessDetails", []string{"params"}},
	{"BootstrapMcpProduct", []string{"params"}},
	{"CancelPurchase", []string{"params"}},
	{"CheckLimits", []string{"params"}},
	{"CloneProduct", []string{"productRef", "overrides"}},
	{"ConfigureMcpPlans", []string{"productRef", "params"}},
	{"CreateCheckoutSession", []string{"params"}},
	{"CreateCustomer", []string{"params"}},
	{"CreateCustomerSession", []string{"params"}},
	{"CreatePaymentIntent", []string{"params"}},
	{"CreatePlan", []string{"params"}},
	{"CreateProduct", []string{"params"}},
	{"CreateTopupPaymentIntent", []string{"params"}},
	{"DeletePlan", []string{"productRef", "planRef"}},
	{"DeleteProduct", []string{"productRef"}},
	{"DisableAutoRecharge", []string{"params"}},
	{"GetAutoRecharge", []string{"params"}},
	{"GetCustomer", []string{"params"}},
	{"GetCustomerBalance", []string{"params"}},
	{"GetMerchant", nil},
	{"GetPaymentMethod", []string{"params"}},
	{"GetPlatformConfig", nil},
	{"GetProduct", []string{"productRef"}},
	{"GetUserInfo", []string{"params"}},
	{"ListPlans", []string{"productRef"}},
	{"ListProducts", nil},
	{"ProcessPaymentIntent", []string{"params"}},
	{"ReactivatePurchase", []string{"params"}},
	{"SaveAutoRecharge", []string{"params"}},
	{"TrackUsage", []string{"params"}},
	{"TrackUsageBulk", []string{"params"}},
	{"UpdateCustomer", []string{"customerRef", "params"}},
	{"UpdatePlan", []string{"productRef", "planRef", "params"}},
	{"UpdateProduct", []string{"productRef", "params"}},
}

// Call invokes a camelCase (or PascalCase) client method with JSON-like args.
func Call(client *solvapay.Client, ctx context.Context, fn string, args map[string]any) (any, error) {
	name := ToPascal(fn)
	sig, ok := signatureFor(name)
	if !ok {
		return nil, errors.New("unknown operation " + fn)
	}
	method := reflect.ValueOf(client).MethodByName(name)
	if !method.IsValid() {
		return nil, errors.New("missing method " + name)
	}
	typ := method.Type()
	in := []reflect.Value{reflect.ValueOf(ctx)}

	pathKeys := map[string]bool{}
	for i, pname := range sig.Params {
		pt := typ.In(i + 1)
		switch pt.Kind() {
		case reflect.String:
			raw, exists := args[pname]
			if !exists {
				return nil, errors.New("missing path arg " + pname)
			}
			s, ok := raw.(string)
			if !ok {
				return nil, errors.New("path arg " + pname + " must be string")
			}
			pathKeys[pname] = true
			in = append(in, reflect.ValueOf(s))
		case reflect.Map:
			body := map[string]any{}
			for k, v := range args {
				if pathKeys[k] {
					continue
				}
				// Skip path params that appear later in the signature.
				skip := false
				for _, later := range sig.Params[i+1:] {
					if later == k {
						skip = true
						break
					}
				}
				if skip {
					continue
				}
				body[k] = v
			}
			// For ClientAwait there are no path keys — body is the full args object.
			if len(sig.Params) == 1 && pname == "params" {
				body = args
			}
			if pname == "overrides" && len(body) == 0 {
				in = append(in, reflect.Zero(pt))
			} else {
				in = append(in, reflect.ValueOf(body))
			}
		default:
			return nil, errors.New("unsupported param kind for " + pname)
		}
	}

	out := method.Call(in)
	if len(out) != 2 {
		return nil, errors.New("unexpected return arity")
	}
	if errObj := out[1].Interface(); errObj != nil {
		err, ok := errObj.(error)
		if !ok {
			return nil, errors.New("non-error second return")
		}
		return nil, err
	}
	if out[0].IsNil() {
		return nil, nil
	}
	return out[0].Interface(), nil
}

func signatureFor(name string) (Signature, bool) {
	for _, sig := range Signatures {
		if sig.Name == name {
			return sig, true
		}
	}
	return Signature{}, false
}

// ToPascal uppercases the first rune of a camelCase name.
func ToPascal(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// ToCamel lowercases the first rune of a PascalCase name.
func ToCamel(s string) string {
	if s == "" {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}
