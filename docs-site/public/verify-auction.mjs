// Recompute an Uncross auction's clearing price from chain, with no
// dependencies. Node 18 or later:
//
//   node verify-auction.mjs <auction address> [rpc url]
//
// It reads the auction account from devnet, decodes the order summaries the
// program stores inline, replays the clearing rule the program uses
// (find_clearing_price in programs/uncross/src/clearing.rs), and compares the
// result with the price and volume the program recorded.

const [addr, rpc = 'https://api.devnet.solana.com'] = process.argv.slice(2);
if (!addr) {
	console.error('usage: node verify-auction.mjs <auction address> [rpc url]');
	process.exit(2);
}

const res = await fetch(rpc, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [addr, { encoding: 'base64' }] }),
});
const value = (await res.json()).result?.value;
if (!value) {
	console.log('No such account. A closed auction returns nothing; see "Rebuild a closed auction" in the docs.');
	process.exit(1);
}
if (value.owner !== 'Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP') throw new Error(`not an Uncross account (owner ${value.owner})`);
const b = Buffer.from(value.data[0], 'base64');
if (b.length !== 2880) throw new Error(`unexpected size ${b.length}; an Auction account is 2,880 bytes`);

// Byte offsets include the 8-byte account discriminator.
const u64 = (o) => b.readBigUInt64LE(o);
const GATE = ['not recorded', 'passed', 'no feed configured', 'wrong owner', 'not a price update', 'not fully verified', 'wrong feed', 'bad price', 'stale', 'confidence too wide', 'multiplier unreadable'];
const a = {
	closeSlot: u64(16),
	freezeSlots: u64(24),
	clearingPrice: u64(40),
	executableVolume: u64(48),
	referencePrice: u64(56),
	orderCount: b.readUInt16LE(306),
	status: ['open', 'cleared', 'settled'][b[312]],
	referencePriceSet: b[313] === 1,
	gate: b[316],
	publishTime: b.readBigInt64LE(2872),
};
const orders = [];
for (let i = 0; i < a.orderCount; i++) {
	const o = 320 + 40 * i;
	orders.push({ i, limit: u64(o), qty: u64(o + 8), filled: u64(o + 16), quote: u64(o + 24), active: b[o + 32] === 1, cancelled: b[o + 33] === 1, side: b[o + 34] === 0 ? 'buy' : 'sell' });
}

// Prices are quote atomic units (6 dp) per whole raw token (10^8 raw units).
const usd = (p) => (Number(p) / 1e6).toFixed(6).replace(/0{1,4}$/, '');
const tok = (q) => (Number(q) / 1e8).toString();

console.log(`auction ${addr}: ${a.status}, ${a.orderCount} orders`);
for (const o of orders) console.log(`  #${o.i} ${o.side.padEnd(4)} ${tok(o.qty).padStart(8)} @ ${usd(o.limit).padStart(12)}${o.cancelled ? '  (cancelled)' : ''}   filled ${tok(o.filled)}`);

// The rule, as the program runs it.
const live = orders.filter((o) => o.active && !o.cancelled);
const demand = (p) => live.filter((o) => o.side === 'buy' && o.limit >= p).reduce((s, o) => s + o.qty, 0n);
const supply = (p) => live.filter((o) => o.side === 'sell' && o.limit <= p).reduce((s, o) => s + o.qty, 0n);
const min = (x, y) => (x < y ? x : y);
const gap = (p) => (demand(p) > supply(p) ? demand(p) - supply(p) : supply(p) - demand(p));
const candidates = [...new Set(live.map((o) => o.limit))].sort((x, y) => (x < y ? -1 : 1));

console.log('\n  candidate      demand     supply     volume    |D-S|');
for (const p of candidates) console.log(`  ${usd(p).padStart(12)} ${tok(demand(p)).padStart(10)} ${tok(supply(p)).padStart(10)} ${tok(min(demand(p), supply(p))).padStart(10)} ${tok(gap(p)).padStart(8)}`);

let price = 0n, rule = 'empty book';
if (candidates.length) {
	const vol = (p) => min(demand(p), supply(p));
	const best = candidates.reduce((m, p) => (vol(p) > m ? vol(p) : m), 0n);
	if (best === 0n) [price, rule] = [candidates[0], 'no cross (nothing trades)'];
	else {
		let tied = candidates.filter((p) => vol(p) === best);
		if (tied.length === 1) [price, rule] = [tied[0], 'most volume'];
		else {
			const g = tied.reduce((m, p) => (gap(p) < m ? gap(p) : m), gap(tied[0]));
			tied = tied.filter((p) => gap(p) === g);
			if (tied.length === 1) [price, rule] = [tied[0], 'smallest imbalance'];
			else if (a.referencePriceSet) {
				const d = (p) => (p > a.referencePrice ? p - a.referencePrice : a.referencePrice - p);
				price = tied.reduce((m, p) => (d(p) < d(m) ? p : m), tied[0]);
				rule = 'nearest the oracle price';
			} else [price, rule] = [tied[0] + (tied[tied.length - 1] - tied[0]) / 2n, 'midpoint'];
		}
	}
}
const volume = min(demand(price), supply(price));

console.log(`\nPyth check recorded at the cross: ${GATE[a.gate] ?? a.gate}${a.publishTime ? `, price published ${new Date(Number(a.publishTime) * 1000).toISOString()}` : ''}`);
console.log(`replayed: $${usd(price)} x ${tok(volume)} tokens, set by ${rule}`);
console.log(`recorded: $${usd(a.clearingPrice)} x ${tok(a.executableVolume)} tokens`);
const ok = a.status !== 'open' && price === a.clearingPrice && volume === a.executableVolume;
console.log(a.status === 'open' ? 'not crossed yet: nothing to compare' : ok ? 'MATCH' : 'MISMATCH');
process.exit(a.status === 'open' || ok ? 0 : 1);
