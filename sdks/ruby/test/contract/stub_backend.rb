# frozen_string_literal: true

require "json"
require "socket"
require "uri"

module Contract
  class StubBackend
    attr_reader :base_url, :captured

    def initialize(status:, body:)
      @status = status
      @body = body
      @captured = []
    end

    def start
      @server = TCPServer.new("127.0.0.1", 0)
      @base_url = "http://127.0.0.1:#{@server.addr[1]}"
      @thread = Thread.new { serve }
      self
    end

    def stop
      @server&.close
      @thread&.join(2)
      @thread&.kill
    end

    private

    def serve
      socket = @server.accept
      request_line = socket.gets&.strip
      return unless request_line

      method, target, = request_line.split(" ")
      headers = {}
      while (line = socket.gets)
        break if line == "\r\n"

        key, value = line.split(":", 2)
        headers[key.downcase] = value.strip
      end
      raw_body = socket.read(headers.fetch("content-length", "0").to_i)
      parsed_body = raw_body.empty? ? nil : JSON.parse(raw_body)
      uri = URI.parse(target)
      query = URI.decode_www_form(uri.query || "").to_h
      @captured << {
        "method" => method,
        "path" => uri.path,
        "query" => query,
        "headers" => headers,
        "body" => parsed_body,
      }

      response = response_body
      socket.write(
        "HTTP/1.1 #{@status} #{reason}\r\n" \
        "Content-Type: application/json\r\n" \
        "Content-Length: #{response.bytesize}\r\n" \
        "Connection: close\r\n\r\n#{response}",
      )
      socket.close
    rescue IOError, Errno::EBADF
      nil
    ensure
      socket&.close
    end

    def response_body
      case @body
      when Hash, Array, Numeric, TrueClass, FalseClass, NilClass
        JSON.generate(@body)
      else
        @body.to_s
      end
    end

    def reason
      @status.between?(200, 299) ? "OK" : "Error"
    end
  end

  module StubAssertions
    module_function

    def assert_wire(test, actual, expected)
      test.assert_equal expected.fetch("method"), actual.fetch("method"), "wire method"
      test.assert_equal expected.fetch("path"), actual.fetch("path"), "wire path"
      test.assert_equal expected["query"], actual.fetch("query"), "wire query" if expected.key?("query")
      if expected.key?("headers")
        expected.fetch("headers").each do |key, value|
          test.assert_equal value, actual.fetch("headers")[key.downcase], "wire header #{key}"
        end
      end
      test.assert_equal expected["body"], actual["body"], "wire body" if expected.key?("body")
    end
  end
end
