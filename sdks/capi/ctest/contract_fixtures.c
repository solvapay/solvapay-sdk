/*
 * C ABI golden-fixture census. parsed=762; C skips driveGate/drivePayable (no facade).
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 762;
  const size_t want_replayed = 757;
  return contract_run_census(want_parsed, want_replayed);
}
