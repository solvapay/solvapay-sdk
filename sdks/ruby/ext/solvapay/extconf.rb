# frozen_string_literal: true

require "mkmf"
require "rb_sys/mkmf"

create_rust_makefile("solvapay") do |r|
  # Bake `--features $(RB_SYS_CARGO_FEATURES)` into the Makefile so a later
  # `RB_SYS_CARGO_FEATURES=panic-probe rake compile` can enable the probe.
  # Without at least one feature at extconf time, rb-sys omits the flag.
  r.features = ENV.fetch("RB_SYS_CARGO_FEATURES", "default").split(",").map(&:strip).reject(&:empty?)
end
