/**
 * Dotenv parser that mirrors wrangler's inline-comment semantics so
 * `wrangler dev` and `example-deploy` see the same values.
 *
 * @param {string} contents
 * @returns {Record<string, string>}
 */
export function parseDotEnv(contents) {
  const env = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
    if (!match) continue
    let [, key, value] = match
    value = value.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      const commentIdx = value.search(/\s+#/)
      if (commentIdx >= 0) value = value.slice(0, commentIdx).trim()
    }
    env[key] = value
  }
  return env
}
