# frozen_string_literal: true

require "json"
require "solvapay"

module SolvaPay
  module Mcp
    # Rack adapter: OAuth via mcp_oauth_request, /mcp via mcp_dispatch.
    class Engine
      def initialize(client:, product_ref:, public_base_url:, resource_uri: "ui://widget.html", mcp_path: "/mcp",
                     views: nil, oauth_paths: nil, hs256_secret: nil, jwks_json: nil)
        raise ArgumentError, "client is required" if client.nil?
        raise ArgumentError, "product_ref is required" if product_ref.nil? || product_ref.empty?
        raise ArgumentError, "public_base_url is required" if public_base_url.nil? || public_base_url.empty?

        @client = client
        @facade = SolvaPay::Facade.new(api_client: client)
        @product_ref = product_ref
        @public_base_url = public_base_url
        @resource_uri = resource_uri.nil? || resource_uri.empty? ? "ui://widget.html" : resource_uri
        @mcp_path = mcp_path.nil? || mcp_path.empty? ? "/mcp" : mcp_path
        @views = views
        @oauth_paths = oauth_paths
        @hs256_secret = hs256_secret
        @jwks_json = jwks_json
        @payables = {} #: Hash[String, untyped]
        @mutex = Mutex.new
      end

      def register_payable(name, product:, handler:, get_customer_ref: nil, usage_type: "requests",
                           title: nil, description: nil, input_schema: nil, annotations: nil)
        raise ArgumentError, "tool name is required" if name.nil? || name.empty?
        raise ArgumentError, "product is required" if product.nil? || product.empty?
        raise ArgumentError, "handler is required" if handler.nil?

        @mutex.synchronize do
          @payables[name] = {
            product: product,
            handler: handler,
            get_customer_ref: get_customer_ref,
            usage_type: usage_type.nil? || usage_type.empty? ? "requests" : usage_type,
            title: title,
            description: description,
            input_schema: input_schema,
            annotations: annotations,
          }
        end
        self
      end

      def call(env)
        path = env["PATH_INFO"].to_s
        query = env["QUERY_STRING"].to_s
        full_path = query.empty? ? path : "#{path}?#{query}"
        method = env["REQUEST_METHOD"].to_s
        return handle_oauth(env, method, full_path) unless path == @mcp_path
        return [405, { "allow" => "POST, OPTIONS" }, []] unless method == "POST"

        handle_mcp(env)
      end

      private

      def handle_oauth(env, method, path)
        envelope = @client.mcp_oauth_request(
          params: {
            "method" => method,
            "path" => path,
            "headers" => rack_headers(env),
            "body" => read_body(env),
            "config" => oauth_config,
          },
        )
        oauth_response(envelope)
      end

      def handle_mcp(env)
        rpc = nil
        begin
          rpc = JSON.parse(read_body(env))
          html = SolvaPay::Mcp.widget_html_rpc(rpc, @resource_uri, @public_base_url, @product_ref, @views)
          return json_response(200, html) unless html.nil?

          payable_tools = @mutex.synchronize { payable_tool_specs }
          params = {
            "rpc" => rpc,
            "config" => {
              "productRef" => @product_ref,
              "publicBaseUrl" => @public_base_url,
              "resourceUri" => @resource_uri,
              "payableTools" => payable_tools,
              "mcpPath" => @mcp_path,
              "views" => @views,
              "userAgent" => env["HTTP_USER_AGENT"],
            },
          }
          params["config"]["hs256Secret"] = @hs256_secret unless @hs256_secret.nil? || @hs256_secret.empty?
          params["config"]["jwksJson"] = @jwks_json unless @jwks_json.nil?
          auth = env["HTTP_AUTHORIZATION"]
          params["authHeader"] = auth unless auth.nil? || auth.empty?
          proto = env["HTTP_MCP_PROTOCOL_VERSION"]
          params["mcpProtocolVersionHeader"] = proto unless proto.nil? || proto.empty?
          envelope = stringify(@client.mcp_dispatch(params: params))
          case envelope["kind"]
          when "rpc"
            status = envelope["status"]
            json_response(status.is_a?(Integer) ? status : 200, envelope["rpc"])
          when "challenge"
            headers = stringify_headers(envelope["headers"])
            merge_native_cors(env, headers)
            [Integer(envelope["status"] || 401), headers, [encode_body(envelope["body"])]]
          when "invokeHandler"
            resume_payable(envelope)
          else
            raise SolvaPay::SolvaPayError.new("unexpected mcpDispatch kind: #{envelope['kind'].inspect}",
                                              code: "invalid_dispatch",)
          end
        rescue JSON::ParserError
          json_rpc_error(400, nil, -32_700, "Parse error")
        rescue StandardError => e
          warn e.full_message
          id = rpc.is_a?(Hash) ? rpc["id"] : nil
          json_rpc_error(200, id, -32_603, e.message)
        end
      end

      def resume_payable(envelope)
        tool = envelope["tool"].to_s
        spec = @mutex.synchronize { @payables[tool] }
        raise SolvaPay::SolvaPayError.new("unknown payable tool: #{tool}", code: "unknown_tool") if spec.nil?

        empty_args = {} #: Hash[untyped, untyped]
        args = envelope["args"].is_a?(Hash) ? stringify(envelope["args"]) : empty_args
        args = symbolize(args)
        unless args.key?(:customer_ref)
          ref = envelope["customerRef"]
          args[:customer_ref] = ref if ref.is_a?(String) && !ref.empty?
        end
        result = SolvaPay::Mcp.invoke_payable(
          solvapay: @facade,
          product: spec[:product],
          handler: spec[:handler],
          get_customer_ref: spec[:get_customer_ref],
          usage_type: spec[:usage_type],
          args: args,
        )
        resumed = stringify(
          SolvaPay::Mcp::Core.call(
            "mcpResume",
            { "token" => envelope["token"], "handlerEnvelope" => result },
          ),
        )
        json_response(200, resumed["rpc"] || resumed)
      end

      def payable_tool_specs
        @payables.keys.sort.map do |name|
          spec = @payables.fetch(name)
          entry = { "name" => name }
          entry["title"] = spec[:title] unless spec[:title].nil?
          entry["description"] = spec[:description] unless spec[:description].nil?
          entry["inputSchema"] = spec[:input_schema] unless spec[:input_schema].nil?
          entry["annotations"] = spec[:annotations] unless spec[:annotations].nil?
          entry
        end
      end

      def oauth_config
        config = {
          "publicBaseUrl" => @public_base_url,
          "mcpPath" => @mcp_path,
          "productRef" => @product_ref,
        }
        config["oauthPaths"] = @oauth_paths unless @oauth_paths.nil?
        config
      end

      def oauth_response(envelope)
        envelope = stringify(envelope)
        status = Integer(envelope["status"] || 500)
        headers = stringify_headers(envelope["headers"])
        [status, headers, [encode_body(envelope["body"])]]
      end

      def json_rpc_error(status, id, code, message)
        json_response(status, { "jsonrpc" => "2.0", "id" => id, "error" => { "code" => code, "message" => message } })
      end

      def json_response(status, body)
        [
          status,
          { "content-type" => "application/json" },
          [encode_body(body)],
        ]
      end

      def encode_body(body)
        return "" if body.nil?
        return body if body.is_a?(String)

        JSON.generate(body)
      end

      def merge_native_cors(env, headers)
        origin = env["HTTP_ORIGIN"]
        result = stringify(SolvaPay::Mcp::Core.call("mcpNativeCors", { "origin" => origin }))
        cors = result["headers"]
        return unless cors.is_a?(Hash)

        cors.each do |key, value|
          headers[key.to_s.downcase] = value.to_s if value.is_a?(String)
        end
      end

      def stringify_headers(headers)
        out = {} #: Hash[String, String]
        return out unless headers.is_a?(Hash)

        headers.each do |key, value|
          out[key.to_s.downcase] = value.to_s if value.is_a?(String)
        end
        out
      end

      def rack_headers(env)
        headers = {} #: Hash[String, String]
        env.each do |key, value|
          next unless key.start_with?("HTTP_") && value.is_a?(String)

          name = key.delete_prefix("HTTP_").downcase.tr("_", "-")
          headers[name] = value
        end
        headers["content-type"] = env["CONTENT_TYPE"] if env["CONTENT_TYPE"].is_a?(String)
        headers
      end

      def read_body(env)
        input = env["rack.input"]
        return "" if input.nil?

        input.rewind if input.respond_to?(:rewind)
        input.read.to_s
      end

      def stringify(value)
        JSON.parse(JSON.generate(value))
      end

      def symbolize(hash)
        acc = {} #: Hash[Symbol, untyped]
        hash.each do |key, value|
          acc[key.to_sym] = value
        end
        acc
      end
    end
  end
end
