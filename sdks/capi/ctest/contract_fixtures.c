/*
 * C ABI golden-fixture census. Constants must match
 * contract/fixtures/census.generated.json parsed / (parsed - delegated);
 * sdks/capi/src/fixture_host.rs asserts that file.
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 787;
  const size_t want_replayed = 782;
  return contract_run_census(want_parsed, want_replayed);
}
