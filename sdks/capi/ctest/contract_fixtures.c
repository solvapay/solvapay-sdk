/*
 * C ABI golden-fixture census. parsed=740; C skips driveGate/drivePayable (no facade).
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 740;
  const size_t want_replayed = 735;
  return contract_run_census(want_parsed, want_replayed);
}
