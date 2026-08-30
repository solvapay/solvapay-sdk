/*
 * C ABI golden-fixture census. wantParsed = wantReplayed = 655.
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 655;
  const size_t want_replayed = 655;
  return contract_run_census(want_parsed, want_replayed);
}
