/*
 * C ABI golden-fixture census. wantParsed = wantReplayed = 587.
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 587;
  const size_t want_replayed = 587;
  return contract_run_census(want_parsed, want_replayed);
}
