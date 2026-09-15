// Same-origin JSON-RPC proxy for mainnet. The public mainnet RPC refuses
// browser-origin requests (HTTP 403), so the app reads mainnet through here.
// Set MAINNET_RPC_UPSTREAM in the Vercel project to a keyed endpoint and the
// key stays server-side instead of shipping in the JS bundle.
export const config = { runtime: "edge" };

const UPSTREAM = process.env.MAINNET_RPC_UPSTREAM || "https://api.mainnet-beta.solana.com";
const PROGRAM_ID = "Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP";

// Only what the app needs. getProgramAccounts is the expensive one, so it is
// limited to the Uncross program itself.
const ALLOWED = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getBlockTime",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentPerformanceSamples",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
]);

interface RpcCall {
  method?: unknown;
  params?: unknown;
}

function allowed(call: RpcCall): boolean {
  if (!call || typeof call.method !== "string" || !ALLOWED.has(call.method)) return false;
  if (call.method === "getProgramAccounts") {
    return Array.isArray(call.params) && call.params[0] === PROGRAM_ID;
  }
  return true;
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
  if (calls.length === 0 || calls.length > 20 || !calls.every(allowed)) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "method not allowed through this proxy" } }, 403);
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
