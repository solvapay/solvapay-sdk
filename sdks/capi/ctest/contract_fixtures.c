/*
 * C ABI golden-fixture census. wantParsed = wantReplayed = 651.
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 651;
  const size_t want_replayed = 651;
  return contract_run_census(want_parsed, want_replayed);
}
