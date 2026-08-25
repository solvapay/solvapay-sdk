/*
 * C ABI golden-fixture census. wantParsed = wantReplayed = 578.
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 578;
  const size_t want_replayed = 578;
  return contract_run_census(want_parsed, want_replayed);
}
