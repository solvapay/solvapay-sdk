# frozen_string_literal: true

module Contract
  module Names
    module_function

    def camel_to_snake(value)
      return value if value == value.upcase && value.match?(/[A-Z]/)

      value.gsub(/([a-z0-9])([A-Z])/, '\1_\2').downcase
    end

    def camel_to_kebab(value)
      camel_to_snake(value).tr("_", "-")
    end

    def success_case?(name)
      name.start_with?("success", "by-") ||
        %w[succeeded-recurring succeeded-one-time succeeded-bare processing timeout failed cancelled].include?(name)
    end

    def error_case?(name)
      name.start_with?("error") || %w[no-match missing-params].include?(name)
    end
  end
end
