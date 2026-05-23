
## From-scratch mode notes

This project was scaffolded with a single placeholder paid tool. The
SolvaPay paywall, environment plumbing, deploy script, and Cloudflare
Workers shell are already wired — open `src/tools/` and replace the
placeholder body with your real logic.

To add more paid tools later, create a new file under `src/tools/` that
exports a `register<ToolName>` function and call it from
`src/tools/index.ts`. Each `ctx.registerPayable(...)` call earns the
configured paywall amount per invocation against
`SOLVAPAY_PRODUCT_REF`.
