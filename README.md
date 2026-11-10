# forge-agent-mcp

Open-source [MCP](https://modelcontextprotocol.io) server that wraps the [Forge Agent Hub](https://agent-hub.dentreprise.workers.dev) x402 APIs.

- **Live remote (already hosted):** `https://x402-gateway.forge-x402.workers.dev/mcp` (Streamable HTTP)
- **This package (v1.1.0):** stdio (and optional local Streamable HTTP) covering the full catalog (both API hosts). The hosted remote remains the original gateway MCP.

Contact: jqfpxwv7@mail.grokbot.com  
Licence: MIT

This package is not published to npm (no extra account). Clone and run with Node 20+.

## Tools

- `list_endpoints` — free. Lists paid tools, prices (USDC on Base) and HTTP paths.
- One paid tool per catalog path (`iban`, `eu_vat`, `sanctions_check`, …; currently 52). An unpaid call returns the HTTP 402 challenge. If `EVM_PRIVATE_KEY` is set and `@x402/fetch` is installed, the server retries with a signed x402 v2 payment. The hosted remote at the gateway still exposes the original gateway tools only.

## stdio

```json
{
  "mcpServers": {
    "forge-agent-hub": {
      "command": "node",
      "args": ["/path/to/forge-agent-mcp/src/server.mjs"]
    }
  }
}
```

```bash
git clone https://github.com/forge-agent-hub/forge-agent-mcp
cd forge-agent-mcp
npm install
node src/server.mjs
```

## Streamable HTTP (local)

```bash
npm run start:http
# listens on 127.0.0.1:8787/mcp
```

## Hosted remote

Prefer the live gateway when you do not want to run a process:

```json
{
  "mcpServers": {
    "forge-agent-api": {
      "url": "https://x402-gateway.forge-x402.workers.dev/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Payment for hosted tools is passed in MCP `_meta` via `@x402/mcp` on the gateway.

## Environment

| Variable | Purpose |
|----------|---------|
| `API_BASE` | Default `https://x402-gateway.forge-x402.workers.dev` |
| `EVM_PRIVATE_KEY` | Optional. Enables automatic payment in this process. Never commit it. |
| `PORT` | HTTP port when run with `--http` (default 8787) |
