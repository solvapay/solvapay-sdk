package solvapay

// The built-in account and activate_plan tools, the slash-command prompts,
// the docs://solvapay/overview.md resource, solvapay://bootstrap.json and the
// widget resource, ported from @solvapay/mcp-core's descriptors.ts.
//
// account opens the SolvaPay widget on MCP Apps hosts: the tool lists
// _meta.ui.resourceUri and its result carries it, except in mode "text".
// Text-only hosts read the same narration either way.

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// OverviewURI is the agent-facing "start here" resource.
const OverviewURI = "docs://solvapay/overview.md"

// OverviewMarkdown is what docs://solvapay/overview.md reads.
const OverviewMarkdown = "# SolvaPay MCP server — overview\n" +
	"\n" +
	"This MCP server connects a SolvaPay-protected product to your host so users can\n" +
	"manage their plan, usage, and billing **without leaving the chat**. It is\n" +
	"dual-audience: every tool returns a UI bootstrap for hosts that render MCP UI\n" +
	"resources (`basic-host`, Claude Desktop, ChatGPT, etc.) and a markdown summary\n" +
	"with clickable URLs for text-only hosts.\n" +
	"\n" +
	"## What the user can do\n" +
	"\n" +
	"- **Account** — one read-only viewer for every billing surface. Pass `view`:\n" +
	"  `checkout` (upgrade / change plan / buy / subscribe), `account` (current\n" +
	"  plan, cancel, billing), or `topup` (add credits). Omit `view` and the\n" +
	"  server picks (no plan → checkout, out of credits → topup, else account).\n" +
	"  Slash commands `/upgrade`, `/manage_account`, and `/topup` remap onto\n" +
	"  this tool. `account`.\n" +
	"- **Activate plan** — activate a specific plan by `planRef`. Free plans\n" +
	"  activate immediately, usage-based plans activate when balance covers the\n" +
	"  configured usage, paid plans return checkout. Requires `planRef` — to list\n" +
	"  plans, call `account` with `view: \"checkout\"`. `/activate_plan`.\n" +
	"\n" +
	"## How it fits together\n" +
	"\n" +
	"The viewer returns a full `BootstrapPayload` (merchant + product + plans\n" +
	"+ customer snapshot) so the embedded UI never fires per-view read calls. When\n" +
	"a paywalled data tool hits the usage limit, its response is plain text: the\n" +
	"`content[0].text` narration names the recovery tool (`account`, or\n" +
	"`activate_plan` when a specific planRef is known) and inlines\n" +
	"`gate.checkoutUrl` for terminal-first hosts. The structured gate rides on\n" +
	"`structuredContent` for programmatic consumers. No widget iframe opens for a\n" +
	"gate — the LLM reads the narration and, if the user agrees, calls the named\n" +
	"tool which mounts the checkout / topup / account surface.\n" +
	"\n" +
	"Auth is handled by the SolvaPay OAuth bridge (see `createMcpOAuthBridge`). The\n" +
	"bridge injects `customer_ref` onto every authenticated request; tools that\n" +
	"need an authenticated caller return `Unauthorized` when it is missing.\n" +
	"\n" +
	"## Also see\n" +
	"\n" +
	"- `docs://solvapay/overview.md` (this resource) — agent-facing narration.\n" +
	"- `ui://<app>/mcp-app.html` — the embedded UI shell.\n" +
	"- `tools/list` + `prompts/list` — programmatic discovery of the intent tools\n" +
	"  and their slash-command shortcuts.\n"

const (
	viewParamDescription = `Landing surface. checkout: user says "upgrade", "change plan", "buy", or "subscribe". ` +
		`account: user says "my account", "current plan", "cancel", or "billing". ` +
		`topup: user says "top up", "add credits", or "buy credits". ` +
		"Omit to let the server pick (no plan → checkout, out of credits → topup, else account)."
	viewerDescription = `Call when the user says "upgrade", "change plan", "buy", "subscribe", "my account", ` +
		`"current plan", "cancel", "billing", "top up", "add credits", or "buy credits". ` +
		"Opens the SolvaPay billing surface. Pass `view` to pick the landing screen; omit it to " +
		"let the server pick (no plan → checkout, out of credits → topup, else account). " +
		"Read-only snapshot — charges happen after the customer confirms. Always include the " +
		"Manage and Checkout markdown links from the tool result in your reply to the user. " +
		"To change something, call this tool again with `view`: `account` (manage or cancel), " +
		"`topup` (add credits), or `checkout` (change plan)."
	modeParamDescription = "Default `mode: 'auto'` returns a self-sufficient text summary (plan, price, https " +
		"checkout URL) and still opens the iframe on UI hosts. Pass `mode: 'text'` to strip " +
		"the iframe, or `mode: 'ui'` for a one-line placeholder that still includes the " +
		"checkout URL."
	activatePlanDescription = `Call when the user says "activate" and a specific ` + "`planRef`" + ` is known. Free plans ` +
		"activate immediately; usage-based plans activate when the balance covers usage; paid " +
		"plans open checkout. Requires `planRef` — to list or pick a plan, call `account` with " +
		`view: "checkout".`
	unauthorizedDetails = "customer_ref missing from MCP auth context"
)

func stringsAsAny(values []string) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}

// widgetSessionID is a random id ChatGPT keys the widget's state on.
func widgetSessionID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func narratedResult(narrated *NarratedResult, meta mcp.Meta) *mcp.CallToolResult {
	content := make([]mcp.Content, len(narrated.Content))
	for i, block := range narrated.Content {
		if block.Type == "resource_link" {
			content[i] = &mcp.ResourceLink{URI: block.URI, Name: block.Name}
		} else {
			content[i] = &mcp.TextContent{Text: block.Text}
		}
	}
	return &mcp.CallToolResult{Content: content, StructuredContent: narrated.StructuredContent, Meta: meta}
}

func (s *MCPServer) registerIntentTools(publicBaseURL string) error {
	payload := func(ctx context.Context, view, customerRef string) (map[string]any, error) {
		return BuildBootstrapPayload(ctx, s.client, BootstrapRequest{View: view, ProductRef: s.productRef, PublicBaseURL: publicBaseURL, CustomerRef: customerRef}, s.logger)
	}

	if len(s.views) > 0 {
		advertised := []string{}
		for _, view := range AdvertisedViews {
			if containsString(s.views, view) {
				advertised = append(advertised, view)
			}
		}
		err := s.addTool(toolSpec{
			name:        viewerToolName,
			title:       "Account",
			description: viewerDescription,
			annotations: ToolAnnotations{ReadOnlyHint: Hint(true), IdempotentHint: Hint(true), OpenWorldHint: Hint(true)},
			meta:        toolUIMeta(s.resourceURI),
			inputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"view": map[string]any{"type": "string", "enum": stringsAsAny(advertised), "description": viewParamDescription},
					"mode": map[string]any{"type": "string", "enum": []any{"ui", "text", "auto"}, "description": modeParamDescription},
				},
			},
			// An old transcript's "auto-recharge" still reads, as account.
			normalise: func(args map[string]any) {
				if args["view"] == "auto-recharge" {
					args["view"] = ViewAccount
				}
			},
			handler: func(ctx context.Context, req *mcp.CallToolRequest, args map[string]any) (*mcp.CallToolResult, error) {
				requested, hasView := args["view"].(string)
				if hasView && !containsString(s.views, requested) {
					return toolErrorResult(fmt.Sprintf("view '%s' is not enabled on this server", requested), 400,
						fmt.Sprintf("Enabled views: %s. Pass one of those, or omit view to let the server pick.", strings.Join(advertised, ", "))), nil
				}
				mode := ParseToolMode(args["mode"])
				customerRef, err := s.customerRef(ctx, req, nil)
				if err != nil {
					return nil, err
				}
				var data map[string]any
				if hasView {
					data, err = payload(ctx, requested, customerRef)
				} else {
					// Built as account: the view only steers the checkout purpose.
					if data, err = payload(ctx, ViewAccount, customerRef); err == nil {
						data["view"], err = DeriveDefaultView(data, s.views)
					}
				}
				if err != nil {
					return apiErrorResult(err)
				}
				meta := mcp.Meta{"openai/widgetSessionId": widgetSessionID()}
				if mode != ToolModeText {
					meta["ui"] = map[string]any{"resourceUri": s.resourceURI}
				}
				narrated, err := NarrateAccount(data["view"].(string), data, mode, time.Now())
				if err != nil {
					return nil, err
				}
				return narratedResult(narrated, meta), nil
			},
		})
		if err != nil {
			return err
		}
	}

	err := s.addTool(toolSpec{
		name:        activatePlanToolName,
		title:       "Activate plan",
		description: activatePlanDescription,
		annotations: ToolAnnotations{ReadOnlyHint: Hint(false), DestructiveHint: Hint(false), IdempotentHint: Hint(true), OpenWorldHint: Hint(true)},
		meta:        mcp.Meta{"openai/widgetAccessible": true},
		inputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"planRef":    map[string]any{"type": "string", "description": "Plan to activate. Required."},
				"productRef": map[string]any{"type": "string"},
			},
			"required": []any{"planRef"},
		},
		handler: func(ctx context.Context, req *mcp.CallToolRequest, args map[string]any) (*mcp.CallToolResult, error) {
			product := textArg(args, "productRef")
			if product == "" {
				product = s.productRef
			}
			planRef := trimmedText(args, "planRef")
			if planRef == "" {
				return toolErrorResult("activate_plan requires a planRef", 400,
					"Pass `planRef` to activate a specific plan. To list plans, call `account` with view: \"checkout\"."), nil
			}
			customerRef, err := s.customerRef(ctx, req, nil)
			if err != nil {
				return nil, err
			}
			if customerRef == "" {
				return toolErrorResult("Unauthorized", 401, unauthorizedDetails), nil
			}
			result, err := s.client.ActivatePlan(ctx, map[string]any{"customerRef": customerRef, "productRef": product, "planRef": planRef})
			if err != nil {
				return apiErrorResult(err)
			}
			s.paywall.InvalidateLimits(customerRef, product)

			checkoutURL, _ := result["checkoutUrl"].(string)
			if result["status"] == "payment_required" && checkoutURL == "" {
				// Without a session the narration says to call account instead.
				if session, err := s.client.CreateCheckoutSession(ctx, map[string]any{"productRef": product, "customerRef": customerRef, "planRef": planRef}); err == nil {
					checkoutURL, _ = session["checkoutUrl"].(string)
				} else {
					s.logger.Warn("activate_plan: no checkout session for the payment_required answer", "error", err)
				}
			}
			planName := ""
			if listed, err := s.client.ListPlans(ctx, product); err == nil {
				plans, _ := listed["plans"].([]any)
				for _, plan := range plans {
					if jsGet(plan, "reference") == planRef {
						planName, _ = jsGet(plan, "name").(string)
						break
					}
				}
			} else {
				// The name only labels the narration.
				s.logger.Warn("activate_plan: listing plans for the narration failed", "error", err)
			}

			var activation ActivationResult
			if err := recodeJSON(result, &activation); err != nil {
				return nil, err
			}
			activation.CheckoutURL = checkoutURL
			activation.PlanName = planName
			text, err := NarrateActivatePlan(activation)
			if err != nil {
				return nil, err
			}
			structured := copyJSON(result)
			if checkoutURL != "" {
				structured["checkoutUrl"] = checkoutURL
			}
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}, StructuredContent: structured}, nil
		},
	})
	if err != nil {
		return err
	}

	s.registerPrompts()
	s.server.AddResource(&mcp.Resource{
		URI:         OverviewURI,
		Name:        "SolvaPay MCP — overview",
		Title:       "SolvaPay overview",
		Description: `Agent-facing "start here" doc — explains the two intent tools, dual-audience fallback, and auth model before any tool is called.`,
		MIMEType:    "text/markdown",
	}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: OverviewURI, MIMEType: "text/markdown", Text: OverviewMarkdown}}}, nil
	})
	return nil
}

func recodeJSON(from, to any) error {
	raw, err := marshalJS(from)
	if err != nil {
		return &Error{Code: "invalid_response", Message: err.Error()}
	}
	if err := json.Unmarshal(raw, to); err != nil {
		return &Error{Code: "invalid_response", Message: "The SolvaPay API answered with something this SDK cannot read: " + err.Error()}
	}
	return nil
}

// registerPrompts adds the slash commands: one user message each, naming the tool to call.
func (s *MCPServer) registerPrompts() {
	viewer := "Call the `" + viewerToolName + "` tool with view:"
	prompt := func(name, title, description string, argument string, text func(arg string) string) {
		p := &mcp.Prompt{Name: name, Title: title, Description: description}
		if argument != "" {
			p.Arguments = []*mcp.PromptArgument{{Name: argument}}
		}
		s.server.AddPrompt(p, func(_ context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
			value := ""
			if argument != "" && req.Params != nil {
				value = req.Params.Arguments[argument]
			}
			return &mcp.GetPromptResult{Messages: []*mcp.PromptMessage{{Role: "user", Content: &mcp.TextContent{Text: text(value)}}}}, nil
		})
	}
	if containsString(s.views, ViewCheckout) {
		prompt("upgrade", "Upgrade plan", "Start or change a paid plan for the current customer.", "planRef", func(planRef string) string {
			if planRef != "" {
				return viewer + ` "checkout", then activate plan ` + planRef + "."
			}
			return viewer + ` "checkout" to show upgrade options.`
		})
	}
	if containsString(s.views, ViewAccount) {
		prompt("manage_account", "Manage account", "Show the current plan, balance, payment method, and cancel/reactivate controls for the current customer.", "", func(string) string {
			return viewer + ` "account" to show my SolvaPay account.`
		})
	}
	if containsString(s.views, ViewTopup) {
		prompt("topup", "Top up credits", "Add SolvaPay credits to the current customer.", "amount", func(amount string) string {
			if amount != "" {
				return viewer + ` "topup" and top up my credits by ` + amount + "."
			}
			return viewer + ` "topup" to add SolvaPay credits.`
		})
	}
	prompt("activate_plan", "Activate plan", "Activate a specific plan by ref, or list plans to pick from.", "planRef", func(planRef string) string {
		if planRef != "" {
			return "Call the `" + activatePlanToolName + "` tool with planRef " + planRef + "."
		}
		return viewer + ` "checkout" to list plans I can activate.`
	})
}

// registerAppResources adds the widget (ui://…) and solvapay://bootstrap.json,
// the snapshot account answers when no view is asked for, read for the caller.
func (s *MCPServer) registerAppResources(csp map[string][]string, publicBaseURL string) {
	cspMeta := map[string]any{}
	for key, domains := range csp {
		cspMeta[key] = stringsAsAny(domains)
	}
	// The host owns the outer frame; the widget paints none.
	meta := mcp.Meta{"ui": map[string]any{"csp": cspMeta, "prefersBorder": true}}
	s.server.AddResource(&mcp.Resource{URI: s.resourceURI, Name: s.resourceURI, MIMEType: MCPAppMIMEType, Meta: meta},
		func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: s.resourceURI, MIMEType: MCPAppMIMEType, Text: widgetHTML, Meta: meta}}}, nil
		})
	s.server.AddResource(&mcp.Resource{
		URI:         BootstrapURI,
		Name:        "SolvaPay bootstrap",
		Title:       "SolvaPay bootstrap",
		Description: "Current merchant/product/plans/customer snapshot for the embedded UI. Widgets read this idempotently when the host scrubs structuredContent from tool results.",
		MIMEType:    bootstrapMIMEType,
	}, func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		customerRef, err := s.customerRef(ctx, req, nil)
		if err != nil {
			return nil, err
		}
		data, err := BuildBootstrapPayload(ctx, s.client, BootstrapRequest{View: ViewAccount, ProductRef: s.productRef, PublicBaseURL: publicBaseURL, CustomerRef: customerRef}, s.logger)
		if err != nil {
			return nil, err
		}
		if data["view"], err = DeriveDefaultView(data, s.views); err != nil {
			return nil, err
		}
		text, err := jsonText(data)
		if err != nil {
			return nil, err
		}
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: BootstrapURI, MIMEType: bootstrapMIMEType, Text: text}}}, nil
	})
}
