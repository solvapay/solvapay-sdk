# frozen_string_literal: true
#
# Minimal SolvaPay Ruby SDK example: fetch the merchant profile.
#
#   cp .env.example .env
#   ruby main.rb

require "solvapay"
require_relative "get_merchant"

def load_dotenv(path = ".env")
  return unless File.exist?(path)

  File.foreach(path) do |line|
    line = line.strip
    next if line.empty? || line.start_with?("#") || !line.include?("=")

    key, value = line.split("=", 2)
    key = key.strip
    value = value.strip
    ENV[key] = value unless ENV.key?(key)
  end
end

load_dotenv

api_key = ENV["SOLVAPAY_SECRET_KEY"]
if api_key.nil? || api_key.empty?
  warn "SOLVAPAY_SECRET_KEY is missing — copy .env.example to .env"
  exit 1
end

client = SolvaPay::Client.new(api_key: api_key, api_base_url: ENV["SOLVAPAY_API_BASE_URL"])
merchant = GetMerchant.run(client)
puts "merchant displayName=#{merchant["displayName"]} defaultCurrency=#{merchant["defaultCurrency"]}"
