/**
 * Tiny templating helper: replaces `{name}` tokens in `template` with values
 * from `vars`. Missing keys are left as-is so integrators can spot typos.
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key]
    if (value === undefined || value === null) return match
    return String(value)
  })
}
