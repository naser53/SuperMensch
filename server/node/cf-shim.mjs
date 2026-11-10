// What server/worker.js takes from "cloudflare:workers" on the Linux server.
export class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
