// A stand-in for a browser wallet extension, for the entry-path test only.
//
// The dashboard calls wallet.sendTransaction, which for a Wallet Standard
// wallet means signTransaction then submit. A headless browser has no Phantom,
// so the injected shim proxies signing here, to a throwaway keypair that has
// never existed before. Everything else in the test — the React code, the
// faucet call, the transaction the app builds, the submission — is the real
// thing.
import http from "node:http";
import { Keypair, VersionedTransaction } from "@solana/web3.js";

const kp = Keypair.generate();
const PORT = Number(process.argv[2] ?? 8098);

http
  .createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.url === "/pubkey") {
      res.writeHead(200, { "content-type": "application/json", ...cors });
      return res.end(JSON.stringify({ pubkey: kp.publicKey.toBase58(), secret: Array.from(kp.secretKey) }));
    }
    if (req.url === "/sign" && req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      try {
        const { tx } = JSON.parse(body);
        const vtx = VersionedTransaction.deserialize(Buffer.from(tx, "base64"));
        vtx.sign([kp]);
        res.writeHead(200, { "content-type": "application/json", ...cors });
        return res.end(JSON.stringify({ signed: Buffer.from(vtx.serialize()).toString("base64") }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json", ...cors });
        return res.end(JSON.stringify({ error: String(e) }));
      }
    }
    res.writeHead(404, cors);
    res.end();
  })
  .listen(PORT);

console.log(JSON.stringify({ pubkey: kp.publicKey.toBase58(), port: PORT }));
