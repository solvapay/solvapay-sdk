/*
 * C ABI golden-fixture census. parsed=696; C skips driveGate/drivePayable (no facade).
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 696;
  const size_t want_replayed = 691;
  return contract_run_census(want_parsed, want_replayed);
}
