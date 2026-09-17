// Same-origin, read-only window onto Solana mainnet for exactly one thing: the
// tickers' Pyth price accounts shown as reference prices. Auctions run on
// devnet; nothing else goes to mainnet. The public mainnet RPC refuses
// browser-origin requests (HTTP 403), which is why this proxy exists.
export const runtime = "edge";

const UPSTREAM = process.env.MAINNET_RPC_UPSTREAM || "https://api.mainnet-beta.solana.com";
import registry from "@/lib/uncross/tickers.json";

/** The tickers' live Pyth accounts on mainnet: the only accounts readable through this proxy. */
const ALLOWED = new Set(registry.tickers.map((t) => t.pythAccount).filter((a): a is string => !!a));

interface RpcCall {
  method?: unknown;
  params?: unknown;
}

function allowed(call: RpcCall): boolean {
  if (!call || !Array.isArray(call.params)) return false;
  const [target] = call.params;
  if (call.method === "getAccountInfo") return typeof target === "string" && ALLOWED.has(target);
  if (call.method === "getMultipleAccounts") {
    return Array.isArray(target) && target.length > 0 && target.length <= ALLOWED.size && target.every((k) => ALLOWED.has(k));
  }
  return false;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  }
  const calls = (Array.isArray(body) ? body : [body]) as RpcCall[];
  if (calls.length === 0 || calls.length > 5 || !calls.every(allowed)) {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32601, message: "only the tickers' Pyth accounts can be read through this proxy" } },
      403,
    );
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

export function GET(): Response {
  return json({ error: "POST only" }, 405);
}
