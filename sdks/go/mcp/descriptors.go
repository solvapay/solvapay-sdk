package mcp

import (
	"context"
	"encoding/json"
	"fmt"
)

// DescriptorsInput is the host-facing shape for the Rust mcpDescriptors op.
type DescriptorsInput struct {
	ResourceURI   string
	PublicBaseURL string
	ProductRef    string
	Views         []string
	CSP           *CSP
	APIBaseURL    string
	Branding      *Branding
}

// CSP is the SolvaPay MCP content-security-policy triple.
type CSP struct {
	ResourceDomains []string `json:"resourceDomains,omitempty"`
	ConnectDomains  []string `json:"connectDomains,omitempty"`
	FrameDomains    []string `json:"frameDomains,omitempty"`
}

// Branding is optional merchant branding folded into descriptors.
type Branding struct {
	BrandName string `json:"brandName,omitempty"`
	IconURL   string `json:"iconUrl,omitempty"`
	LogoURL   string `json:"logoUrl,omitempty"`
}

// DescriptorTool is one builtin tool from mcpDescriptors.
// Meta / Annotations / InputSchema are copied byte-for-byte from the core —
// the adapter must not author them.
type DescriptorTool struct {
	Name        string          `json:"name"`
	Title       string          `json:"title,omitempty"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
	Annotations json.RawMessage `json:"annotations"`
	Meta        json.RawMessage `json:"meta"`
	Icons       json.RawMessage `json:"icons,omitempty"`
}

// DescriptorResource is the widget resource descriptor.
type DescriptorResource struct {
	URI      string `json:"uri"`
	MIMEType string `json:"mimeType"`
	CSP      CSP    `json:"csp"`
}

// DescriptorNamedURI is docs or bootstrap resource metadata from the core.
type DescriptorNamedURI struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	MIMEType    string `json:"mimeType"`
}

// DescriptorPrompt is one prompt from mcpDescriptors.
type DescriptorPrompt struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// DescriptorsBundle is the typed mcpDescriptors result.
type DescriptorsBundle struct {
	Tools     []DescriptorTool   `json:"tools"`
	Prompts   []DescriptorPrompt `json:"prompts"`
	CSP       CSP                `json:"csp"`
	Docs      DescriptorNamedURI `json:"docs"`
	Bootstrap DescriptorNamedURI `json:"bootstrap"`
	Resource  DescriptorResource `json:"resource"`
}

// Descriptors fetches the frozen SolvaPay MCP descriptor bundle from the
// Rust core. Descriptions, _meta and annotations are authored in the core —
// never here.
func Descriptors(ctx context.Context, in DescriptorsInput) (DescriptorsBundle, error) {
	if in.ResourceURI == "" {
		return DescriptorsBundle{}, fmt.Errorf("ResourceURI is required")
	}
	if in.PublicBaseURL == "" {
		return DescriptorsBundle{}, fmt.Errorf("PublicBaseURL is required")
	}
	if in.ProductRef == "" {
		return DescriptorsBundle{}, fmt.Errorf("ProductRef is required")
	}
	args := map[string]any{
		"resourceUri":   in.ResourceURI,
		"publicBaseUrl": in.PublicBaseURL,
		"productRef":    in.ProductRef,
	}
	if len(in.Views) > 0 {
		args["views"] = in.Views
	}
	if in.CSP != nil {
		args["csp"] = in.CSP
	}
	if in.APIBaseURL != "" {
		args["apiBaseUrl"] = in.APIBaseURL
	}
	if in.Branding != nil {
		args["branding"] = in.Branding
	}
	raw, err := CallSync(ctx, "mcpDescriptors", args)
	if err != nil {
		return DescriptorsBundle{}, err
	}
	var out DescriptorsBundle
	if err := json.Unmarshal(raw, &out); err != nil {
		return DescriptorsBundle{}, fmt.Errorf("decode mcpDescriptors: %w", err)
	}
	return out, nil
}
