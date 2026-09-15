// Same-origin, read-only window onto Solana mainnet for exactly one thing: the
// Pyth AAPL/USD price account shown as the reference price. Auctions run on
// devnet; nothing else goes to mainnet. The public mainnet RPC refuses
// browser-origin requests (HTTP 403), which is why this proxy exists.
export const config = { runtime: "edge" };

const UPSTREAM = process.env.MAINNET_RPC_UPSTREAM || "https://api.mainnet-beta.solana.com";
const PYTH_AAPL = "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW";

interface RpcCall {
  method?: unknown;
  params?: unknown;
}

function allowed(call: RpcCall): boolean {
  if (!call || !Array.isArray(call.params)) return false;
  const [target] = call.params;
  if (call.method === "getAccountInfo") return target === PYTH_AAPL;
  if (call.method === "getMultipleAccounts") {
    return Array.isArray(target) && target.length > 0 && target.every((k) => k === PYTH_AAPL);
  }
  return false;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  }
  const calls = (Array.isArray(body) ? body : [body]) as RpcCall[];
  if (calls.length === 0 || calls.length > 5 || !calls.every(allowed)) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "only the Pyth AAPL account can be read through this proxy" } }, 403);
  }
  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
