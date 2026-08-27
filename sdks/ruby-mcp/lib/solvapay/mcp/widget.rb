# frozen_string_literal: true

module SolvaPay
  module Mcp
    MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"
    dir = __dir__
    raise "ruby-mcp widget path is missing" if dir.nil?

    MCP_APP_HTML_PATH = File.expand_path("data/mcp-app.html", dir)

    def self.default_mcp_app_html
      File.read(MCP_APP_HTML_PATH)
    end
  end
end
