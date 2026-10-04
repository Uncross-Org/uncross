# Uncross docs

The documentation site, built with Astro Starlight.

```sh
npm install
npm run build        # static site in dist/, search index built by Pagefind
npm run verify       # links and anchors, sideways scroll at 1440/390 in both themes, search
node scripts/verify.mjs --shots <dir>   # the same, plus screenshots
```

Every claim on a page comes from the program source or a committed file in `docs/`;
each page ends with the sources it rests on.

## Where docs work happens, and how it is published

Docs work happens on `main`, in this folder. There is no separate docs branch
or worktree any more; the old `docs-site` branch was merged and deleted on
4 Oct 2026.

The site is published from this folder with the Vercel CLI, to the existing
`uncross-docs` project, which serves https://docs.uncross.0xo.in. Vercel is not
connected to GitHub, so pushing does not publish anything.

```sh
npm run build && npm run verify                        # must pass before publishing
vercel deploy --yes                                    # a preview, from this folder
vercel promote <preview url> --yes                     # to production
node scripts/verify.mjs --origin https://docs.uncross.0xo.in   # then check production
```

The folder is linked to the project by `.vercel/project.json`, which git
ignores. On a fresh clone, link it once with `vercel link --project uncross-docs`.
Leave the project's root directory as `.`, because the CLI uploads this folder
as the root.
