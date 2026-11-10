#!/usr/bin/env node
/**
 * Forge Agent Hub MCP server — stdio by default, Streamable HTTP with --http.
 * Wraps the public x402 APIs (gateway and forge-tools hosts). No secrets are shipped in this repository.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import { readFileSync } from "node:fs";

const API_BASE = (process.env.API_BASE || "https://x402-gateway.forge-x402.workers.dev").replace(/\/+$/, "");
const TOOLS_DATA = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
const TOOLS = TOOLS_DATA.map((t) => {
  const fields = {};
  for (const f of t.fields || []) {
    let schema = z.string().describe(f.desc || f.name);
    if (f.type === "number" || f.type === "integer") schema = z.coerce.number().describe(f.desc || f.name);
    else if (f.type === "boolean") schema = z.coerce.boolean().describe(f.desc || f.name);
    fields[f.name] = f.required ? schema : schema.optional();
  }
  return { ...t, fields };
});

const UA = "forge-agent-mcp/1.1.0";

async function callApi(path, args, { pay, host } = { pay: false }) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args || {})) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  const url = `${(host || API_BASE).replace(/\/+$/, "")}${path}?${qs}`;
  if (pay && process.env.EVM_PRIVATE_KEY) {
    try {
      const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
      const { ExactEvmScheme } = await import("@x402/evm");
      const { privateKeyToAccount } = await import("viem/accounts");
      const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
      const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
      });
      const res = await fetchWithPayment(url, { headers: { accept: "application/json", "user-agent": UA } });
      const text = await res.text();
      return { status: res.status, text };
    } catch (err) {
      return { status: 0, text: JSON.stringify({ error: "payment_failed", detail: String(err && err.message ? err.message : err).slice(0, 400) }) };
    }
  }
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA } });
  const text = await res.text();
  return { status: res.status, text };
}

function textResult(obj, isError = false) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }], isError };
}

function buildServer() {
  const server = new McpServer({ name: "forge-agent-api", version: "1.1.0" });
  server.tool(
    "list_endpoints",
    "Free: list paid tools, prices (USDC on Base, x402) and the equivalent HTTP endpoints.",
    {},
    async () =>
      textResult({
        apiBases: [...new Set(TOOLS.map((t) => t.host || API_BASE))],
        network: "eip155:8453",
        asset: "USDC",
        note: "Paid tools return a 402 challenge unless EVM_PRIVATE_KEY is set in this process. The hosted MCP at " + API_BASE + "/mcp covers the original gateway tools; this stdio/HTTP server lists the full catalog.",
        tools: TOOLS.map((t) => ({
          name: t.name,
          path: t.path,
          url: (t.host || API_BASE) + t.path,
          price_usdc: t.price,
          description: t.desc,
        })),
      }),
  );
  for (const t of TOOLS) {
    server.tool(
      t.name,
      `${t.desc} Costs ${t.price} USDC on Base per successful call (x402). Without a payment key this tool returns the 402 challenge.`,
      t.fields,
      async (args) => {
        const r = await callApi(t.path, args, { pay: true, host: t.host || API_BASE });
        if (r.status === 402) {
          let challenge = r.text;
          try { challenge = JSON.parse(r.text); } catch {}
          return textResult({
            payment_required: true,
            status: 402,
            price_usdc: t.price,
            http: (t.host || API_BASE) + t.path,
            challenge,
            hint: "Retry with an x402 client, set EVM_PRIVATE_KEY when running this server, or use the hosted MCP at " + API_BASE + "/mcp.",
          });
        }
        if (r.status >= 200 && r.status < 300) {
          try { return textResult(JSON.parse(r.text)); } catch { return textResult(r.text); }
        }
        return textResult({ error: "upstream_error", status: r.status, body: r.text.slice(0, 2000) }, true);
      },
    );
  }
  return server;
}

async function serveStdio() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function serveHttp() {
  const port = Number(process.env.PORT || 8787);
  const httpServer = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, mcp-session-id, payment-signature, x-payment",
      });
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname.replace(/\/+$/, "") !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found; POST /mcp" }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST", "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST (Streamable HTTP)." }, id: null }));
      return;
    }
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
      }
      console.error(String(err && err.message ? err.message : err).slice(0, 300));
    }
  });
  httpServer.listen(port, "127.0.0.1", () => {
    console.error(`forge-agent-mcp Streamable HTTP on http://127.0.0.1:${port}/mcp`);
  });
}

const httpMode = process.argv.includes("--http");
if (httpMode) await serveHttp();
else await serveStdio();
