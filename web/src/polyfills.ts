import { Buffer } from "buffer";

// Must be imported before anything from @solana/* or @coral-xyz/anchor.
const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env: Record<string, string> } };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.process) g.process = { env: {} };
