#!/usr/bin/env tsx
import { REPO_ROOT } from '../shared/paths.js'
import { collectTemplatePinDrift, formatTemplatePinDrift } from './lib/template-pins.js'

const drift = collectTemplatePinDrift(REPO_ROOT)
if (drift.length > 0) {
  console.error(formatTemplatePinDrift(drift))
  process.exit(1)
}
console.log(formatTemplatePinDrift(drift))
