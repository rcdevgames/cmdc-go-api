# CommandCode Vercel Proxy

Stateless CommandCode subscription proxy for Vercel. It forwards requests to CommandCode's `/alpha/generate` endpoint and translates them for OpenAI, Codex CLI, Anthropic, Claude Code, and OpenAI-compatible clients.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/rcdevgames/commandcode-vercel-proxy&env=auth_cc_1,apikey_1,apikey_1_auth_cc,debug&envDescription=CommandCode credential pool and proxy access key configuration&envLink=https://github.com/rcdevgames/commandcode-vercel-proxy%23vercel-environment-variables)

## Fixed model

The proxy exposes exactly one model:

```text
deepseek-v4.1-flash
```

Any model name sent by a client is rewritten to this model. The upstream CommandCode model is `deepseek/deepseek-v4.1-flash`.

## Endpoints

- `GET /health` or `/healthz`
- `GET /v1/models`
- `POST /v1/chat/completions` — OpenAI Chat Completions
- `POST /v1/responses` — OpenAI Responses / Codex CLI
- `POST /v1/messages` — Anthropic Messages / Claude Code
- `POST /message` — Anthropic compatibility alias

The proxy is stateless: no database, filesystem storage, account pool, prompt history, or session persistence is used.

## Vercel deployment

### One-click

1. Click **Deploy with Vercel** above.
2. Sign in to Vercel and select your GitHub account/repository.
3. Set the environment variables below before deploying.
4. Click **Deploy**.
5. Verify `https://YOUR-DOMAIN.vercel.app/health` returns `{"status":"ok"}`.
6. Verify `/v1/models` with the proxy key.

If the button points to a different GitHub repository, change the repository URL in this README after publishing this project under your own account.

### Manual

1. Push this project to GitHub.
2. In Vercel, choose **Add New → Project**.
3. Import the repository.
4. Keep the detected Node.js settings; no build command override is required.
5. Add the environment variables below for **Production** and, if needed, **Preview**.
6. Deploy and run the smoke tests.

## Vercel environment variables

Add these in **Project Settings → Environment Variables**:

| Name | Required | Value |
|---|---:|---|
| `auth_cc_N` | yes | CommandCode subscription credential; add `_2`, `_3`, ... as needed |
| `apikey_N` | yes | Client key; add `_2`, `_3`, ... as needed |
| `apikey_N_auth_cc` | yes | Comma-separated upstream IDs allowed for that client, e.g. `1,2,3` |
| `debug` | yes | `true` or `false`; set it explicitly even when disabled |

Important:

- `auth_cc_N` adalah credential upstream CommandCode; tetap server-side dan jangan pernah dipakai sebagai proxy key client.
- `apikey_N` adalah key client; scope aksesnya ditentukan oleh `apikey_N_auth_cc`.
- Credential upstream dipilih round-robin secara independen untuk setiap `apikey_N`.
- Kalau salah satu credential yang diwajibkan hilang, startup langsung gagal. Ini disengaja supaya deployment tidak hidup dalam keadaan setengah terkonfigurasi.
- `apikey_N` is the only key clients should receive. Use a long random value.
- Do not commit `.env`, `.env.local`, or any real credential.
- Do not put any `auth_cc_N` in `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or client-side code.
- Select the correct Vercel environments: **Production**, **Preview**, or both.
- After changing variables, redeploy; existing deployments do not automatically receive updated values.
- If a credential was pasted into chat, logs, or a public repository, revoke/regenerate it.
- Vercel functions are time-limited. Very long Claude/Codex tool loops can hit the configured function timeout.

## Client setup

Use a proxy `apikey_N`, not an `auth_cc_N`. The client key may access only the upstream credentials listed in its `apikey_N_auth_cc` scope.

### Claude Code

```bash
export ANTHROPIC_BASE_URL=https://YOUR-DOMAIN.vercel.app
export ANTHROPIC_AUTH_TOKEN=YOUR_PROXY_APIKEY
# Some Claude Code versions use this variable instead:
export ANTHROPIC_API_KEY=YOUR_PROXY_APIKEY

claude -p 'Halo, lu siapa dan dari mana?' --model deepseek-v4.1-flash
```

### Codex CLI

Codex uses the Responses API. Configure a provider with `/v1` in the base URL:

```toml
# ~/.codex/config.toml
model_provider = "commandcode"
model = "deepseek-v4.1-flash"

[model_providers.commandcode]
name = "CommandCode Proxy"
base_url = "https://YOUR-DOMAIN.vercel.app/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
```

```bash
export OPENAI_API_KEY=YOUR_PROXY_APIKEY
codex exec 'Halo, lu siapa dan dari mana?'
```

Hosted Codex tools such as `web_search` are not forwarded because CommandCode accepts function tools only. Regular function/tool calls are translated.

### OpenAI-compatible clients

```bash
export OPENAI_BASE_URL=https://YOUR-DOMAIN.vercel.app/v1
export OPENAI_API_KEY=YOUR_PROXY_APIKEY
```

## Local development

```bash
npm install
npm run typecheck
npm test

auth_cc_1='user_...' apikey_1='local-secret' apikey_1_auth_cc='1' debug='false' npm run dev
```

Smoke test:

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS \
  -H 'Authorization: Bearer local-secret' \
  http://127.0.0.1:3000/v1/models
```

## License

See [LICENSE](LICENSE).
