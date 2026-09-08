/*
 * C ABI golden-fixture census. parsed=741; C skips driveGate/drivePayable (no facade).
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 741;
  const size_t want_replayed = 736;
  return contract_run_census(want_parsed, want_replayed);
}
