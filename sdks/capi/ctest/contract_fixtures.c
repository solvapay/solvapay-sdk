/*
 * C ABI golden-fixture census. wantParsed = wantReplayed = 584.
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 584;
  const size_t want_replayed = 584;
  return contract_run_census(want_parsed, want_replayed);
}
