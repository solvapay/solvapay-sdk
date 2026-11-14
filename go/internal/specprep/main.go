// Command specprep prepares the committed SDK spec for oapi-codegen, the same
// way python/scripts/generate_client.py prepares it for the Python client:
//
//   - inline 2xx response schemas are lifted into components named
//     <Operation>Response, so every response has a type;
//   - a discriminated oneOf with inline members gets each member lifted into a
//     component named after its discriminator value, with the mapping filled in;
//   - email, uri, url, date and date-time formats are dropped, so the client
//     keeps the strings the API sent instead of reparsing them.
//
// Usage: go run ./internal/specprep <in.json> <out.json>
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

var stringFormats = map[string]bool{"email": true, "uri": true, "url": true, "date": true, "date-time": true}

func main() {
	if len(os.Args) != 3 {
		fail("usage: specprep <in.json> <out.json>")
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		fail(err.Error())
	}
	var spec map[string]any
	if err := json.Unmarshal(raw, &spec); err != nil {
		fail(err.Error())
	}
	schemas := spec["components"].(map[string]any)["schemas"].(map[string]any)
	liftResponses(spec, schemas)
	names := make([]string, 0, len(schemas))
	for name := range schemas {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		nameDiscriminatedMembers(name, schemas[name].(map[string]any), schemas)
	}
	out, err := json.MarshalIndent(stripFormats(spec), "", "  ")
	if err != nil {
		fail(err.Error())
	}
	if err := os.WriteFile(os.Args[2], out, 0o644); err != nil {
		fail(err.Error())
	}
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, "specprep:", message)
	os.Exit(1)
}

var controllerPrefix = regexp.MustCompile(`^[A-Za-z]+Controller_`)

func pascal(operationID string) string {
	short := controllerPrefix.ReplaceAllString(operationID, "")
	return strings.ToUpper(short[:1]) + short[1:]
}

func liftResponses(spec map[string]any, schemas map[string]any) {
	paths := spec["paths"].(map[string]any)
	pathNames := make([]string, 0, len(paths))
	for p := range paths {
		pathNames = append(pathNames, p)
	}
	sort.Strings(pathNames)
	for _, p := range pathNames {
		for _, op := range paths[p].(map[string]any) {
			operation, ok := op.(map[string]any)
			if !ok {
				continue
			}
			responses, _ := operation["responses"].(map[string]any)
			for status, r := range responses {
				if !strings.HasPrefix(status, "2") {
					continue
				}
				media, _ := r.(map[string]any)["content"].(map[string]any)["application/json"].(map[string]any)
				if media == nil {
					continue
				}
				schema, _ := media["schema"].(map[string]any)
				if schema == nil || schema["$ref"] != nil {
					continue
				}
				name := pascal(operation["operationId"].(string)) + "Response"
				if _, taken := schemas[name]; taken {
					fail("lifted schema name " + name + " collides with a spec schema")
				}
				schemas[name] = schema
				media["schema"] = map[string]any{"$ref": "#/components/schemas/" + name}
			}
		}
	}
}

func nameDiscriminatedMembers(parent string, schema map[string]any, schemas map[string]any) {
	discriminator, _ := schema["discriminator"].(map[string]any)
	members, _ := schema["oneOf"].([]any)
	if discriminator == nil || members == nil {
		return
	}
	property := discriminator["propertyName"].(string)
	mapping := map[string]any{}
	for i, m := range members {
		member := m.(map[string]any)
		if ref, ok := member["$ref"].(string); ok {
			continue
		} else {
			_ = ref
		}
		values, _ := member["properties"].(map[string]any)[property].(map[string]any)["enum"].([]any)
		if len(values) != 1 {
			fail(fmt.Sprintf("%s.oneOf[%d]: %s needs exactly one enum value to be named", parent, i, property))
		}
		value := values[0].(string)
		name := parent + strings.ToUpper(value[:1]) + value[1:]
		if _, taken := schemas[name]; taken {
			fail("named member " + name + " collides with a spec schema")
		}
		schemas[name] = member
		ref := "#/components/schemas/" + name
		members[i] = map[string]any{"$ref": ref}
		mapping[value] = ref
	}
	if len(mapping) > 0 {
		discriminator["mapping"] = mapping
	}
}

func stripFormats(node any) any {
	switch value := node.(type) {
	case []any:
		for i, item := range value {
			value[i] = stripFormats(item)
		}
		return value
	case map[string]any:
		if format, ok := value["format"].(string); ok && stringFormats[format] && value["type"] == "string" {
			delete(value, "format")
		}
		for key, item := range value {
			value[key] = stripFormats(item)
		}
		return value
	default:
		return node
	}
}
