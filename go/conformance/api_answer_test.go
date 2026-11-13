package conformance

import "encoding/json"

// apiAnswer is one scripted API answer's body and content type: body is sent as
// JSON; rawBody (an answer that is not JSON, such as a proxy's page) is sent as
// text/plain, byte for byte.
func apiAnswer(exchange map[string]any) (string, []byte, error) {
	if raw, ok := exchange["rawBody"].(string); ok {
		return "text/plain", []byte(raw), nil
	}
	body, err := json.Marshal(exchange["body"])
	return "application/json", body, err
}
