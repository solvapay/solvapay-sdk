/*
 * C ABI golden-fixture census. wantParsed = wantReplayed = 672.
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 672;
  const size_t want_replayed = 672;
  return contract_run_census(want_parsed, want_replayed);
}
