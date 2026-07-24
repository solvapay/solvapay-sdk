// Wrangler's `{ type: 'Text' }` rule in wrangler.jsonc turns
// `.html` imports into inlined string contents. This declaration
// gives TypeScript the matching type so `worker.ts` can pull in
// the built widget HTML without a red underline.
declare module '*.html' {
  const content: string
  export default content
}
