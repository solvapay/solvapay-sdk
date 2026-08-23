/*
 * C ABI golden-fixture census. wantParsed = wantReplayed = 550.
 */

#include "contract/harness.h"

int main(void) {
  const size_t want_parsed = 550;
  const size_t want_replayed = 550;
  return contract_run_census(want_parsed, want_replayed);
}
