# frozen_string_literal: true

require "json"
require "solvapay"

module SolvaPay
  module Mcp
    # Rack adapter: OAuth via mcp_oauth_request, /mcp via mcp_dispatch.
    class Engine
      def initialize(client:, product_ref:, public_base_url:, resource_uri: "ui://widget.html", mcp_path: "/mcp",
                     views: nil, oauth_paths: nil)
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
        @payables = {}
        @mutex = Mutex.new
      end

      def register_payable(name, product:, handler:, get_customer_ref: nil, usage_type: "requests")
        raise ArgumentError, "tool name is required" if name.nil? || name.empty?
        raise ArgumentError, "product is required" if product.nil? || product.empty?
        raise ArgumentError, "handler is required" if handler.nil?

        @mutex.synchronize do
          @payables[name] = {
            product: product,
            handler: handler,
            get_customer_ref: get_customer_ref,
            usage_type: usage_type.nil? || usage_type.empty? ? "requests" : usage_type,
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
        return [405, { "allow" => "POST" }, []] unless method == "POST"

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
        rpc = JSON.parse(read_body(env))
        names = @mutex.synchronize { @payables.keys.sort }
        params = {
          "rpc" => rpc,
          "config" => {
            "productRef" => @product_ref,
            "publicBaseUrl" => @public_base_url,
            "resourceUri" => @resource_uri,
            "payableTools" => names,
            "mcpPath" => @mcp_path,
            "views" => @views,
            "userAgent" => env["HTTP_USER_AGENT"],
          },
        }
        auth = env["HTTP_AUTHORIZATION"]
        params["authHeader"] = auth unless auth.nil? || auth.empty?
        envelope = stringify(@client.mcp_dispatch(params: params))
        case envelope["kind"]
        when "rpc"
          json_response(200, envelope["rpc"])
        when "challenge"
          headers = stringify_headers(envelope["headers"])
          [Integer(envelope["status"] || 401), headers, [encode_body(envelope["body"])]]
        when "invokeHandler"
          resume_payable(envelope)
        else
          raise SolvaPay::SolvaPayError.new("unexpected mcpDispatch kind: #{envelope['kind'].inspect}",
                                            code: "invalid_dispatch",)
        end
      end

      def resume_payable(envelope)
        tool = envelope["tool"].to_s
        spec = @mutex.synchronize { @payables[tool] }
        raise SolvaPay::SolvaPayError.new("unknown payable tool: #{tool}", code: "unknown_tool") if spec.nil?

        args = envelope["args"].is_a?(Hash) ? stringify(envelope["args"]) : {}
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

      def stringify_headers(headers)
        out = {}
        return out unless headers.is_a?(Hash)

        headers.each do |key, value|
          out[key.to_s.downcase] = value.to_s if value.is_a?(String)
        end
        out
      end

      def rack_headers(env)
        headers = {}
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
        hash.each_with_object({}) do |(key, value), acc|
          acc[key.to_sym] = value
        end
      end
    end
  end
end
