// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://uncross.0xo.in',
	integrations: [
		starlight({
			title: 'Uncross Docs',
			description:
				'A periodic call auction for tokenized stocks on Solana: how it clears, what it guarantees, and how to check it yourself.',
			logo: {
				light: './src/assets/mark-light.svg',
				dark: './src/assets/mark-dark.svg',
				alt: 'Uncross',
			},
			favicon: '/favicon.svg',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Uncross-Org/uncross' }],
			customCss: [
				'@fontsource/geist-sans/400.css',
				'@fontsource/geist-sans/500.css',
				'@fontsource/geist-sans/600.css',
				'@fontsource/geist-mono/400.css',
				'@fontsource/archivo/600.css',
				'./src/styles/theme.css',
			],
			components: {
				ThemeProvider: './src/components/ThemeProvider.astro',
				ThemeSelect: './src/components/ThemeSelect.astro',
			},
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'What Uncross is', slug: 'index' },
						{ label: 'Quickstart: your first order', slug: 'start/quickstart' },
						{ label: 'Glossary', slug: 'start/glossary' },
					],
				},
				{
					label: 'The mechanism',
					items: [
						{ label: 'Why a call auction', slug: 'mechanism/why-call-auctions' },
						{ label: 'The clearing rule', slug: 'mechanism/clearing-rule' },
						{ label: 'Auction lifecycle', slug: 'mechanism/lifecycle' },
						{ label: 'Order statuses', slug: 'mechanism/order-statuses' },
						{ label: 'Costs and rent', slug: 'mechanism/costs' },
					],
				},
				{
					label: 'Using the app',
					items: [
						{ label: 'Connect a wallet', slug: 'app/wallet' },
						{ label: 'Get test tokens', slug: 'app/test-tokens' },
						{ label: 'Place an order', slug: 'app/placing-an-order' },
						{ label: 'Read a ticker page', slug: 'app/ticker-page' },
						{ label: 'Your receipt', slug: 'app/receipt' },
						{ label: 'Orders page', slug: 'app/orders' },
						{ label: 'Portfolio page', slug: 'app/portfolio' },
						{ label: 'Open an auction, run the cross', slug: 'app/open-and-crank' },
					],
				},
				{
					label: 'Pyth reference price',
					items: [
						{ label: 'What Pyth is used for', slug: 'pyth/role' },
						{ label: 'The on-chain gate', slug: 'pyth/gate' },
						{ label: 'After the close: a retraction', slug: 'pyth/after-hours' },
					],
				},
				{
					label: 'Tokens',
					items: [
						{ label: 'xStocks and Token-2022', slug: 'tokens/xstocks-token-2022' },
						{ label: 'Raw amounts and splits', slug: 'tokens/raw-amounts' },
						{ label: 'Tokens we cannot support', slug: 'tokens/unsupported' },
					],
				},
				{
					label: 'Devnet',
					items: [
						{ label: 'Why devnet', slug: 'devnet/why-devnet' },
						{ label: 'Test: pause mid-auction', slug: 'devnet/pause-test' },
						{ label: 'Test: split mid-auction', slug: 'devnet/split-test' },
						{ label: 'Test: 42-wallet settlement', slug: 'devnet/settlement-at-scale' },
					],
				},
				{
					label: 'Trust and verification',
					items: [
						{ label: 'Verify a clearing price', slug: 'trust/verify' },
						{ label: 'What the program guarantees', slug: 'trust/guarantees' },
						{ label: 'Honest limitations', slug: 'trust/limitations' },
						{ label: 'Transaction index', slug: 'trust/transactions' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Program instructions', slug: 'reference/instructions' },
						{ label: 'Accounts and layout', slug: 'reference/accounts' },
						{ label: 'Error codes', slug: 'reference/errors' },
						{ label: 'Addresses', slug: 'reference/addresses' },
						{ label: 'Units and decimals', slug: 'reference/units' },
						{ label: 'FAQ', slug: 'reference/faq' },
						{ label: 'Sources', slug: 'reference/sources' },
					],
				},
			],
		}),
	],
});
