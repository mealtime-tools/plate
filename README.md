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
`nutrients.mjs` is that file vendored: a static page cannot import JSON under
`default-src 'none'`, and there is no bundler to inline it. Update it by pasting
a regenerated `nutrients.json` in, then running the suite. The page still shows
four macro columns; the wider vocabulary is arithmetic and wire format only.

Run the small contract suite with `npm test`. GitHub Pages deploys the five
runtime files directly: `index.html`, `style.css`, `app.mjs`, `recipe.mjs`, and
`nutrients.mjs`.

[nutrients]: https://pypi.org/project/mealtime-nutrients/
