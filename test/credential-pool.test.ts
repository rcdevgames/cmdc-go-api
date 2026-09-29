import { describe, expect, it } from "vitest";

import { CredentialPool } from "../src/credential-pool.js";

describe("CredentialPool", () => {
  it("rotates independently within each proxy scope", () => {
    const pool = new CredentialPool([
      { id: "1", value: "auth-1" },
      { id: "2", value: "auth-2" },
      { id: "3", value: "auth-3" },
    ]);
    const all = { id: "all", value: "key-all", upstreamIds: ["1", "2", "3"] };
    const limited = { id: "limited", value: "key-limited", upstreamIds: ["1", "2"] };

    expect([...Array(4)].map(() => pool.select(all).id)).toEqual(["1", "2", "3", "1"]);
    expect([...Array(3)].map(() => pool.select(limited).id)).toEqual(["1", "2", "1"]);
  });
});
