# frozen_string_literal: true

module SolvaPay
  module Mcp
    MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"
    dir = __dir__
    raise "ruby-mcp widget path is missing" if dir.nil?

    MCP_APP_HTML_PATH = File.expand_path("data/mcp-app.html", dir)

    def self.default_mcp_app_html
      File.read(MCP_APP_HTML_PATH, encoding: "UTF-8")
    end

    def self.widget_html_rpc(rpc, resource_uri, public_base_url, product_ref, views = nil)
      envelope = Layer2.mcp_widget_resource(rpc, resource_uri, public_base_url, product_ref, views)
      return nil if envelope.nil?

      unless envelope.is_a?(Hash)
        raise SolvaPay::SolvaPayError.new("mcpWidgetResource returned a non-object envelope", code: "invalid_widget")
      end

      contents = envelope.dig("result", "contents")
      first = contents.is_a?(Array) ? contents[0] : nil
      unless first.is_a?(Hash)
        raise SolvaPay::SolvaPayError.new("mcpWidgetResource omitted contents[0]", code: "invalid_widget")
      end

      first["text"] = default_mcp_app_html
      envelope
    end
  end
end
