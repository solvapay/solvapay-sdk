# frozen_string_literal: true

# Fetch the merchant profile via the public client (Examples deliverable).
# Module-scoped so the name does not collide with Minitest::Test#run.
module GetMerchant
  module_function

  def run(client)
    merchant = client.get_merchant
    raise "get_merchant returned #{merchant.class}, want Hash" unless merchant.is_a?(Hash)

    merchant
  end
end
