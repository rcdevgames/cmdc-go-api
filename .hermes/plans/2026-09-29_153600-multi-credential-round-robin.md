# Multi-Credential Round-Robin Proxy Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Support multiple `auth_cc` upstream credentials and multiple proxy `apikey` credentials, with per-proxy-key access scopes and round-robin upstream selection.

**Architecture:** Keep credentials in environment variables for the first implementation; parse numbered variables into an in-memory credential pool at startup. Each proxy API key maps to an ordered list of allowed upstream credential IDs. A small stateful round-robin selector chooses the next allowed upstream key per request. The selected upstream key is passed only to the CommandCode client and never exposed in logs or responses.

**Tech Stack:** Existing TypeScript, Fastify, Vitest, Node.js environment variables. No database and no new dependency.

---

## Proposed environment format

Use explicit numbered variables so deployment platforms can configure them without JSON parsing:

```env
auth_cc_1=user_...
auth_cc_2=user_...
auth_cc_3=user_...
auth_cc_4=user_...

apikey_1=client-key-all
apikey_1_auth_cc=1,2,3,4
apikey_2=client-key-limited
apikey_2_auth_cc=1,2

debug=false
```

Rules:

- `auth_cc_N` must be non-empty and unique; numbering may be sparse but invalid entries fail startup.
- `apikey_N` must be non-empty and unique.
- `apikey_N_auth_cc` is required and contains only existing upstream IDs.
- Do not use a generic `apikey` or `auth_cc` in the new format, except for a short backwards-compatible migration period if explicitly desired.
- The proxy key is the client credential; the upstream key is selected internally.

Recommended compatibility decision: retain legacy `auth_cc` + `apikey` as a one-key/one-key fallback, but reject a mixed ambiguous configuration such as `auth_cc` plus `auth_cc_1` unless migration behavior is explicitly defined.

## Scaling beyond four upstream credentials

There is no hardcoded limit of four. The parser should discover every variable matching `^auth_cc_(\\d+)$`, sort by numeric ID, and build the pool dynamically:

```env
auth_cc_1=...
auth_cc_2=...
...
auth_cc_37=...

apikey_1=client-key
apikey_1_auth_cc=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37
```

The number `4` in examples is only illustrative. The implementation must use `Object.entries(env)` plus a regex, not a loop that checks only `_1` through `_4`. Sparse IDs are fine as long as every ID referenced by an API key exists.

For a very large pool, use JSON environment variables instead of hundreds of individual variables. This keeps deployment configuration manageable while still avoiding a database:

```env
AUTH_CC_POOL='[{"id":"cc-1","value":"user_..."},{"id":"cc-2","value":"user_..."}]'
PROXY_KEY_ACCESS='[{"key":"client-key-all","upstreamIds":["cc-1","cc-2"]},{"key":"client-key-limited","upstreamIds":["cc-1"]}]'
```

Recommended v1: implement numbered variables with dynamic discovery first; add the JSON format only when the deployment platform's environment-variable count or operator workflow becomes painful. The pool data structure itself should use string IDs so switching input format later does not change rotation or routing logic.


- `apikey_1` sees `auth_cc_1,2,3,4,1,2,3,4...`
- `apikey_2` independently sees `auth_cc_1,2,1,2...`

This gives each client its own fair sequence and prevents traffic from one client changing another client's rotation position.

## Failure policy

Initial implementation should use deterministic rotation without hidden retries across different credentials. If the selected upstream returns a retryable transport/gateway failure, the existing client retry behavior remains unchanged for that same credential.

Do not silently switch credentials after a CommandCode 4xx response: 401/403/400 can indicate a bad credential or plan restriction and rotation would hide the real configuration problem. Add cross-credential failover only as a separate follow-up after observing real upstream behavior.

## Implementation tasks

### Task 1: Define credential pool types and configuration parsing

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts` (create if absent)

Add types equivalent to:

```ts
type UpstreamCredential = { id: string; value: string };
type ProxyCredential = { value: string; upstreamIds: string[] };
```

Extend `ProxyConfig` with `upstreamCredentials` and `proxyCredentials`. Parse numbered environment variables in ascending numeric order. Validate duplicates, malformed IDs, missing references, and empty values with actionable startup errors that name the variable but never print the secret.

Preserve the existing single-key environment behavior only if the compatibility decision is accepted; test both paths.

### Task 2: Add a per-proxy-key round-robin selector

**Files:**
- Create: `src/credential-pool.ts`
- Test: `test/credential-pool.test.ts`

Implement the minimum selector API:

```ts
select(proxyCredential: ProxyCredential): UpstreamCredential
```

Use a `Map` keyed by the proxy credential value or stable proxy-key ID. Advance the index atomically within the synchronous selection call. Verify:

- sequence wraps correctly;
- two proxy keys have independent positions;
- restricted access never selects an unauthorized upstream ID;
- one allowed upstream remains stable;
- concurrent request scheduling cannot produce an out-of-scope selection (selection itself is synchronous).

Do not add persistence; restart resets rotation, which is acceptable for round robin.

### Task 3: Replace route-level single-key resolution

**Files:**
- Modify: `src/auth.ts`
- Modify: `src/routes/chat-completions.ts`
- Modify: `src/routes/responses.ts`
- Modify: `src/routes/anthropic.ts`
- Modify: `src/server.ts` or route dependency types as needed
- Tests: `test/security.test.ts` and affected route tests

Change credential resolution from returning one upstream string to returning a request credential context, for example:

```ts
type ResolvedCredential = {
  proxyKey: string;
  upstreamKey: string;
};
```

Resolve the client key against configured proxy credentials, then select the upstream key through the shared selector. Pass `upstreamKey` to the existing client call and use `proxyKey` only for safe log redaction. Ensure every route uses the same resolver so Chat, Responses, and Anthropic cannot drift.

Keep all existing 401 behavior and header extraction behavior.

### Task 4: Wire the selector into server startup

**Files:**
- Modify: `src/index.ts`
- Modify: `src/server.ts`
- Modify: route dependency types if required

Create one selector per server process and inject it into all routes. Do not create one selector per request or per route. Confirm the client still receives the selected upstream credential through its existing `apiKey` input.

### Task 5: Update deployment documentation and example environment

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

Document the numbered variables, access-scope mapping, independent round robin behavior, secret handling, and the compatibility/migration decision. Remove wording that implies only one `auth_cc` or one `apikey` exists.

Include a concrete example matching:

```env
auth_cc_1=...
auth_cc_2=...
auth_cc_3=...
auth_cc_4=...
apikey_1=...
apikey_1_auth_cc=1,2,3,4
apikey_2=...
apikey_2_auth_cc=1,2
```

Do not document real credentials.

### Task 6: Full verification

Run:

```bash
npm run typecheck
npm test
npm run build
```

Add or run an integration-style assertion that 8 requests from `apikey_1` select `auth_cc_1,2,3,4,1,2,3,4`, while 4 requests from `apikey_2` select `auth_cc_1,2,1,2`. Verify the selected upstream value is only visible to the mocked CommandCode fetch and never appears in captured logs or HTTP responses.

## Files likely to change

- `src/config.ts`
- `src/auth.ts`
- `src/credential-pool.ts` (new)
- `src/index.ts`
- `src/server.ts`
- `src/routes/chat-completions.ts`
- `src/routes/responses.ts`
- `src/routes/anthropic.ts`
- `.env.example`
- `README.md`
- `test/config.test.ts` (new)
- `test/credential-pool.test.ts` (new)
- `test/security.test.ts`
- existing route/client tests as needed

## Risks and tradeoffs

- **Environment-variable limits:** Many deployment platforms limit variable count/size. This design is simple and secret-safe, but a future admin/database-backed pool may be needed for dozens of keys.
- **Process-local rotation:** Multiple Vercel instances each maintain their own round-robin index, so global distribution is approximate rather than exact. Exact cross-instance rotation requires shared state and is intentionally out of scope.
- **Credential health:** No cross-key failover is included initially; this avoids masking invalid credentials and keeps the first diff small.
- **Secret exposure:** Error messages and logs must redact every configured credential, not only the currently selected one.

## Open decisions before implementation

1. Keep legacy `auth_cc`/`apikey` fallback, or require numbered variables immediately?
2. Should sparse IDs such as `auth_cc_1` and `auth_cc_4` be accepted? Recommended: yes, if all referenced IDs exist; otherwise reject only missing references.
3. Should a bad selected credential trigger cross-key failover? Recommended: no for v1; add after metrics/real failure evidence.
4. Is process-local rotation sufficient for the deployment target? Recommended: yes for Vercel/stateless deployment; exact global fairness would require shared state.
