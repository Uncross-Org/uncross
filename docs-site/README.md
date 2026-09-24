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
