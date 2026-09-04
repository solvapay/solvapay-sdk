/*
 * C ABI golden-fixture census. parsed=698; C skips driveGate/drivePayable (no facade).
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 698;
  const size_t want_replayed = 693;
  return contract_run_census(want_parsed, want_replayed);
}
