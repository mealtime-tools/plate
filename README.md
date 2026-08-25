# Plate

A static recipe editor and viewer. A recipe is carried inside its own URL:

```text
https://mealtime-tools.github.io/plate/#r=<payload>
```

The fragment is `base64url(raw_deflate(json))`. The JSON uses readable recipe
fields and flat food items, matching Recipes. It never reaches the
server. The page has no API, build step, runtime dependency, tracking, or
off-origin request. Opening a link shows its ingredients and totals. Editing
the name, servings, notes, tags, weights, or ingredients updates the current
URL so it can be copied directly.

Missing values remain `null` and suppress totals. Explicit zero values remain
zero. Each ingredient carries optional `grams` and nutrients for that whole
amount; absent `grams` means 100 g and totals are simple sums. An absent
nutrient and a `null` one read alike, so re-sharing writes only the nutrients an
ingredient states.

Nutrient names come from the [`mealtime-nutrients`][nutrients] package, which
the Python tools import and which commits a `nutrients.json` for this one.
That file is vendored here byte for byte and imported as a JSON module, which
is why the CSP names `connect-src 'self'`: a JSON import is fetched, and
`default-src 'none'` blocks it. The request is same-origin, so the page still
makes none off-origin. Update it by copying a regenerated `nutrients.json`
over this one and running the suite. The page still shows four macro columns;
the wider vocabulary is arithmetic and wire format only.

Run the small contract suite with `bun test`. The tests are written against
`node:test` and `node:assert`, not a runner's own API, so they run unchanged
under `node --test "tests/*_test.mjs"` too. GitHub Pages deploys the five
runtime files directly: `index.html`, `style.css`, `app.mjs`, `recipe.mjs`, and
`nutrients.json`.

[nutrients]: https://pypi.org/project/mealtime-nutrients/
