// Node module hook: `import ... from "cloudflare:workers"` (server/worker.js) gets cf-shim.mjs.
export async function resolve(spec, ctx, next) {
  if (spec === "cloudflare:workers") return { url: new URL("./cf-shim.mjs", import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
