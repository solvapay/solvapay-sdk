/*
 * §7.7 build-info stamp: version matches CARGO_PKG_VERSION and coreSha is present.
 */

#include "../include/solvapay.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
  char *version = solvapay_version();
  if (version == NULL || version[0] == '\0') {
    fprintf(stderr, "FAIL: solvapay_version empty\n");
    return 1;
  }
  char *info = solvapay_build_info();
  if (info == NULL || strstr(info, "\"version\"") == NULL || strstr(info, "\"coreSha\"") == NULL) {
    fprintf(stderr, "FAIL: solvapay_build_info malformed: %s\n", info ? info : "(null)");
    solvapay_free_string(version);
    solvapay_free_string(info);
    return 1;
  }
  if (strstr(info, version) == NULL) {
    fprintf(stderr, "FAIL: build_info version mismatch version=%s info=%s\n", version, info);
    solvapay_free_string(version);
    solvapay_free_string(info);
    return 1;
  }
  printf("ok: version=%s info=%s\n", version, info);
  solvapay_free_string(version);
  solvapay_free_string(info);
  printf("PASS: C ABI version stamp\n");
  return 0;
}
