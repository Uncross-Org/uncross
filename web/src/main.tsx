import "./polyfills";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CLUSTER } from "./config";
import "./styles.css";

const cluster = CLUSTER;

// Wallet Standard auto-detection: Phantom, Solflare, Backpack etc. register
// themselves, so no per-wallet adapters are needed.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConnectionProvider endpoint={cluster.rpc} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <App cluster={cluster} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </StrictMode>,
);
