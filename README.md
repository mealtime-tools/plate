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

Run the small contract suite with `bun test`. The page tests under `tests/` are
written against `node:test` and `node:assert`, not a runner's own API, so they
run unchanged under `node --test "tests/*_test.mjs"` too. GitHub Pages deploys
the five runtime files directly: `index.html`, `style.css`, `app.mjs`,
`recipe.mjs`, and `nutrients.json`.

## The self-hosted index

A share link carries one recipe, so a collection of them is a folder of links
nobody can browse. `hub/` is an index over a directory of [Recipes][recipes]
YAML files: every recipe grouped under a heading, each row linking to this
viewer. It is not part of the Pages deployment — `pages.yml` copies a file list,
so nothing here is published — and it is the one part of this repository that
needs a server, because a browser cannot read a directory.

```console
RECIPES_DIR=~/.config/recipes bun hub/serve.mjs
```

Then the index is at `/` and the viewer it links to is at `/view`. The
directory is read on every request, so a recipe saved a moment ago is already
listed, and nothing here writes: mount the collection read-only.

Rows are built by `hub/catalogue.mjs` out of `recipe.mjs` — the viewer's own
codec writes the links and the viewer's own arithmetic produces the figures. A
row therefore cannot disagree with the page it points at, which is the reason
the index lives here rather than in its own repository. Figures print to one
decimal for the same reason: it is what the viewer's summary prints.

Recipes already carry free-form tags, so the grouping axis has its own prefix.
A recipe belongs to the category named by its `category:<name>` tag, and one
with no such tag is listed under "Other" rather than dropped. `LABELS` in
`hub/catalogue.mjs` fixes the reading order and headings of the categories in
use; a category missing from it still renders, appended after them, so adding
one is a tag on a recipe and not a code change.

`hub/collection.mjs` is the only module that touches a filesystem, and the only
one that needs bun rather than node: `Bun.YAML` is what keeps the index free of
dependencies. It refuses a malformed file, or two files claiming one name,
instead of quietly serving a short list.

`hub/Dockerfile` builds it for a private deployment:

```console
docker build -f hub/Dockerfile -t recipes-index .
docker run -p 8080:8080 -v ~/.config/recipes:/recipes:ro recipes-index
```

[nutrients]: https://pypi.org/project/mealtime-nutrients/
[recipes]: https://pypi.org/project/mealtime-recipes/
