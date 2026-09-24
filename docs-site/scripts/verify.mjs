// Checks the built site the way a reader meets it. Run after `npm run build`:
//
//   node scripts/verify.mjs [--shots <dir>] [--page /mechanism/clearing-rule/]
//
// 1. Every internal link and #anchor in dist/ resolves to a built page and id.
// 2. No page scrolls sideways at 1440 or 390 px, in either theme.
// 3. Search returns the expected page for a real query.
// 4. Screenshots of one page at 1440 and 390, light and dark, plus the mobile
//    menu and the search results, into --shots.
//
// Uses Playwright's chrome-headless-shell: plain headless Chrome ignores
// --window-size and lays out at 500 px, which fakes a narrow-screen overflow.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DIST = new URL('../dist/', import.meta.url).pathname;
const SHOTS = opt('--shots', null);
const PAGE = opt('--page', '/mechanism/clearing-rule/');
const QUERY = opt('--query', 'midpoint');

const shell = (() => {
	const base = join(homedir(), 'Library/Caches/ms-playwright');
	const dirs = readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
	for (const d of dirs) {
		for (const sub of readdirSync(join(base, d))) {
			const p = join(base, d, sub, 'chrome-headless-shell');
			if (existsSync(p)) return p;
		}
	}
	throw new Error('chrome-headless-shell not found; run `npx playwright install chromium-headless-shell`');
})();

// ---------------------------------------------------------------- 1. links
const htmlFiles = [];
(function walk(dir) {
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) walk(p);
		else if (f.endsWith('.html')) htmlFiles.push(p);
	}
})(DIST);

const route = (file) => '/' + relative(DIST, file).replace(/index\.html$/, '').replace(/\\/g, '/');
const idsOf = new Map(htmlFiles.map((f) => [route(f), new Set([...readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
const resolves = (path) => {
	const clean = decodeURIComponent(path);
	if (idsOf.has(clean)) return clean;
	if (idsOf.has(clean + '/')) return clean + '/';
	return existsSync(join(DIST, clean)) && statSync(join(DIST, clean)).isFile() ? clean : null;
};

const broken = [];
let linkCount = 0;
for (const f of htmlFiles) {
	const html = readFileSync(f, 'utf8');
	for (const [, href] of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
		if (/^(https?:|mailto:|tel:|\/\/)/.test(href)) continue;
		linkCount++;
		const here = route(f);
		const [pathPart, hash] = href.split('#');
		const target = pathPart === '' ? here : resolves(new URL(pathPart, 'http://x' + here).pathname);
		if (!target) broken.push(`${here} → ${href} (no such page)`);
		else if (hash && idsOf.has(target) && !idsOf.get(target).has(decodeURIComponent(hash))) broken.push(`${here} → ${href} (no #${hash})`);
	}
}
console.log(`links: ${linkCount} internal links across ${htmlFiles.length} pages, ${broken.length} broken`);
for (const b of broken) console.log('  BROKEN ' + b);

// ---------------------------------------------------------------- server
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.xml': 'application/xml' };
const server = createServer((req, res) => {
	let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	let file = join(DIST, p);
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
	if (!existsSync(file)) {
		res.writeHead(404, { 'content-type': 'text/html' });
		return res.end(readFileSync(join(DIST, '404.html')));
	}
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const ORIGIN = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ executablePath: shell });
const pageAt = async (width, theme) => {
	const ctx = await browser.newContext({ viewport: { width, height: width > 800 ? 900 : 844 }, deviceScaleFactor: width > 800 ? 1 : 2 });
	await ctx.addInitScript((t) => localStorage.setItem('starlight-theme', t), theme);
	return ctx.newPage();
};

// ---------------------------------------------------------------- 2. overflow
const overflow = [];
const routes = [...idsOf.keys()].filter((r) => !r.endsWith('.html'));
for (const width of [1440, 390]) {
	for (const theme of ['light', 'dark']) {
		const page = await pageAt(width, theme);
		for (const r of routes) {
			await page.goto(ORIGIN + r, { waitUntil: 'load' });
			const m = await page.evaluate(() => ({
				sw: document.documentElement.scrollWidth,
				iw: window.innerWidth,
				theme: document.documentElement.dataset.theme,
				// A table that scrolls inside itself keeps the page from overflowing
				// but hides columns; report those too.
				clipped: [...document.querySelectorAll('.sl-markdown-content table')].filter((t) => t.scrollWidth > t.clientWidth + 1).length,
			}));
			if (m.theme !== theme) overflow.push(`${r} @${width}: theme is ${m.theme}, expected ${theme}`);
			if (m.sw > m.iw) overflow.push(`${r} @${width} ${theme}: scrollWidth ${m.sw} > innerWidth ${m.iw}`);
			if (m.clipped) overflow.push(`${r} @${width} ${theme}: ${m.clipped} table(s) wider than their box`);
		}
		await page.context().close();
	}
}
console.log(`overflow: ${routes.length} pages × 2 widths × 2 themes, ${overflow.length} problems`);
for (const o of overflow) console.log('  ' + o);

// A first visit, with nothing stored, must be light whatever the OS prefers.
{
	const ctx = await browser.newContext({ colorScheme: 'dark' });
	const page = await ctx.newPage();
	await page.goto(ORIGIN + PAGE);
	const t = await page.evaluate(() => document.documentElement.dataset.theme);
	console.log(`first visit with OS set to dark: theme=${t} ${t === 'light' ? 'ok' : 'FAIL'}`);
	await page.click('uncross-theme-toggle button');
	const after = await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('starlight-theme')]);
	console.log(`toggle click: theme=${after[0]} stored=${after[1]} ${after[0] === 'dark' && after[1] === 'dark' ? 'ok' : 'FAIL'}`);
	await ctx.close();
}

// ---------------------------------------------------------------- 3. search
let searchOk = false;
{
	const page = await pageAt(1440, 'light');
	await page.goto(ORIGIN + '/');
	await page.click('button[data-open-modal]');
	await page.fill('dialog[open] input', QUERY);
	await page.waitForSelector('dialog[open] .pagefind-ui__result-link', { timeout: 10_000 });
	const hits = await page.$$eval('dialog[open] .pagefind-ui__result-link', (as) => as.map((a) => a.getAttribute('href')));
	searchOk = hits.some((h) => h.startsWith(PAGE));
	console.log(`search "${QUERY}": ${hits.length} results, first ${hits.slice(0, 3).join(', ')} — ${searchOk ? 'ok' : 'FAIL: ' + PAGE + ' not found'}`);
	if (SHOTS) {
		mkdirSync(SHOTS, { recursive: true });
		await page.screenshot({ path: join(SHOTS, 'search-1440-light.png') });
	}
	await page.context().close();
}

// ---------------------------------------------------------------- 4. shots
if (SHOTS) {
	for (const width of [1440, 390]) {
		for (const theme of ['light', 'dark']) {
			const page = await pageAt(width, theme);
			await page.goto(ORIGIN + PAGE, { waitUntil: 'networkidle' });
			const name = `${PAGE.replace(/\//g, '_').replace(/^_|_$/g, '')}-${width}-${theme}`;
			await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
			if (width === 390) {
				await page.click('button.sl-menu-button');
				await page.waitForTimeout(300);
				await page.screenshot({ path: join(SHOTS, `menu-390-${theme}.png`) });
			}
			await page.context().close();
		}
	}
	console.log(`screenshots written to ${SHOTS}`);
}

await browser.close();
server.close();
const failed = broken.length + overflow.length + (searchOk ? 0 : 1);
console.log(failed ? `FAILED: ${failed} problem(s)` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
