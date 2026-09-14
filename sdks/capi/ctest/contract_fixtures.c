/*
 * C ABI golden-fixture census. parsed=769; C skips driveGate/drivePayable (no facade).
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 769;
  const size_t want_replayed = 764;
  return contract_run_census(want_parsed, want_replayed);
}
