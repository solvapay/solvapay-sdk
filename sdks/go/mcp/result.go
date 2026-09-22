package mcp

import (
	"encoding/json"
	"fmt"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

type orderedErrorBody struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

func errorToolResult(message string) (*mcpsdk.CallToolResult, error) {
	text, err := json.MarshalIndent(orderedErrorBody{Success: false, Error: message}, "", "  ")
	if err != nil {
		return nil, err
	}
	return &mcpsdk.CallToolResult{
		Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: string(text)}},
		IsError: true,
	}, nil
}

func payloadToCallToolResult(payload json.RawMessage) (*mcpsdk.CallToolResult, error) {
	var decoded struct {
		Content           []json.RawMessage `json:"content"`
		StructuredContent json.RawMessage   `json:"structuredContent"`
		IsError           *bool             `json:"isError"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, fmt.Errorf("decode payable tool result: %w", err)
	}
	content := make([]mcpsdk.Content, 0, len(decoded.Content))
	for i, block := range decoded.Content {
		mapped, err := mapContentBlock(block)
		if err != nil {
			return nil, fmt.Errorf("content[%d]: %w", i, err)
		}
		content = append(content, mapped)
	}
	result := &mcpsdk.CallToolResult{Content: content}
	if len(decoded.StructuredContent) > 0 && string(decoded.StructuredContent) != "null" {
		result.StructuredContent = decoded.StructuredContent
	}
	if decoded.IsError != nil {
		result.IsError = *decoded.IsError
	}
	return result, nil
}

func mapContentBlock(raw json.RawMessage) (mcpsdk.Content, error) {
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, err
	}
	switch head.Type {
	case "text":
		var block struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(raw, &block); err != nil {
			return nil, err
		}
		return &mcpsdk.TextContent{Text: block.Text}, nil
	case "image":
		var block struct {
			Data     []byte `json:"data"`
			MIMEType string `json:"mimeType"`
		}
		if err := json.Unmarshal(raw, &block); err != nil {
			return nil, err
		}
		return &mcpsdk.ImageContent{Data: block.Data, MIMEType: block.MIMEType}, nil
	case "audio":
		var block struct {
			Data     []byte `json:"data"`
			MIMEType string `json:"mimeType"`
		}
		if err := json.Unmarshal(raw, &block); err != nil {
			return nil, err
		}
		return &mcpsdk.AudioContent{Data: block.Data, MIMEType: block.MIMEType}, nil
	case "resource_link":
		var block struct {
			URI         string `json:"uri"`
			Name        string `json:"name"`
			Title       string `json:"title"`
			Description string `json:"description"`
			MIMEType    string `json:"mimeType"`
		}
		if err := json.Unmarshal(raw, &block); err != nil {
			return nil, err
		}
		return &mcpsdk.ResourceLink{
			URI:         block.URI,
			Name:        block.Name,
			Title:       block.Title,
			Description: block.Description,
			MIMEType:    block.MIMEType,
		}, nil
	case "resource":
		var block struct {
			Resource *mcpsdk.ResourceContents `json:"resource"`
		}
		if err := json.Unmarshal(raw, &block); err != nil {
			return nil, err
		}
		return &mcpsdk.EmbeddedResource{Resource: block.Resource}, nil
	default:
		return nil, fmt.Errorf("unrecognized content block type %q", head.Type)
	}
}
