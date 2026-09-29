import type { ProxyCredential, UpstreamCredential } from "./config.js";

export class CredentialPool {
  private readonly positions = new Map<string, number>();

  constructor(private readonly upstream: readonly UpstreamCredential[]) {}

  select(proxy: ProxyCredential): UpstreamCredential {
    const allowed = proxy.upstreamIds
      .map((id) => this.upstream.find((item) => item.id === id))
      .filter((item): item is UpstreamCredential => item !== undefined);
    if (allowed.length === 0) throw new Error(`No upstream credentials available for ${proxy.id}`);
    const position = this.positions.get(proxy.id) ?? 0;
    this.positions.set(proxy.id, (position + 1) % allowed.length);
    return allowed[position];
  }
}
