#!/usr/bin/env tsx
import { writeSupportMatrixJson } from './lib/support-matrix.js'
import { REPO_ROOT } from '../shared/paths.js'

const dest = writeSupportMatrixJson(REPO_ROOT)
console.log(`wrote ${dest}`)
