/*
 * Panic-probe FFI containment. Compiled only against a panic-probe build.
 * The symbol is declared here (not in the public header) so release headers
 * stay free of the debug export.
 */

#include "../include/solvapay.h"

#include <stdio.h>

enum SolvapayStatus solvapay_panic_probe(void);

int main(void) {
  enum SolvapayStatus status = solvapay_panic_probe();
  if (status != SolvapayStatus_Panic) {
    fprintf(stderr, "FAIL: panic_probe status=%d want Panic\n", (int)status);
    return 1;
  }
  printf("PASS: C ABI panic probe → Panic\n");
  return 0;
}
