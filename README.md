# Plate

A static recipe editor and viewer for recipes carried inside their own URL. It
has no build step or runtime dependency. Static mode can manually compose,
total, export, and share a recipe without making off-origin requests. When
served with the optional same-origin API, the same files also expose stored
recipes, persistence, and product search.

Plate is independently publishable and imports no other project. Its small
Python package only lets a backend locate the static assets and the exported
YAML fixture. A consumer may depend on Plate; Plate never depends on one.

## Share URL wire format

The canonical link is:

```
https://<host>/#r=<payload>
```

The payload lives in the fragment, never the query, so it does not reach the
host, appear in Pages logs or referrers, or inherit query-length limits. It is:

```
base64url(raw_deflate(compact_json))
```

Base64 padding (`=`) is stripped. Compact JSON uses this versioned shape:

```json
{"v":1,"n":"Recipe name","s":2,"t":"notes","g":["dinner"],"i":[["Ingredient",150,317.9,7.8,10.6,45.2]]}
```

- `v` is always 1.
- `n` and `t` are omitted when empty; `s` is omitted when 1.
- `g` carries tags and is omitted when empty. Existing Plate v1 readers ignore it.
- Each `i` row is `[name, grams, kcal, protein, fat, carbs]` in that order.
- The four macros are per 100 g. The renderer scales by `grams / 100`.
- Ingredient names and macros are resolved values, not database references, so
  static rendering needs no database or network.
- An absent or invalid `s` means 1. Fractions floor and values below 1 clamp to
  1. Servings divides per-serving output; it never scales the recipe batch.

Any valid raw-deflate stream is conformant. Encoders must not require byte
identity with another deflater. Golden encoded strings are decode-direction
tests: each must decode to the exact payload it names.

The static editor writes this format directly in the browser. Every edit updates
the address fragment and locally generated QR code, so the current address is
always the current recipe.

Measured, an 11-ingredient recipe with a 200-character note produces 652
base64url characters and a QR version 18 at error-correction level L.

Legacy `?name=&i=source:id:grams&servings=` links are not emitted or supported
by the static page. They are reconstructible and should be regenerated.

## API contract

Static Pages has no API: the initial same-origin health probe returns 404, so
stored-recipe selection, persistence, and product search stay hidden. Manual
editing, totals, YAML export, and share links remain available. A local or LAN
backend can implement these six endpoints:

```
GET  /api/health                    -> {ok, recipe_dir}
GET  /api/products?q=...&remote=    -> [{source, id, name, brand, macros}]
GET  /api/products/<source>/<id>    -> one product
GET  /api/recipes                   -> candidate records
GET  /api/recipes/<name>            -> one recipe
PUT  /api/recipes/<name>            -> {ok} | {errors: [per-ingredient]}
```

`macros` are always per 100 g. A backend never sends scaled values. Plate owns
the whole front end, including database search; a backend ships no JavaScript.
Provider parsing remains server-side. Manual and searched ingredients converge
on `{name, grams, macros}` and use the same validation and totals.

An incomplete ingredient is displayed but not totalled or exported. The
canonical completeness rule belongs to
[Recipes](https://github.com/owahltinez/recipes#yaml-store-contract).

## Contract fixture

`fixtures/exported-example.yaml` is the YAML document Plate emits today. The
Node suite pins its bytes. A consuming package can load it through
`plate.contract_fixture()` and test its own interpretation from the depending
side. The fixture ships in the Python wheel but is not part of the web site.

## Deploy to GitHub Pages

The workflow constructs a whitelist artifact containing exactly:

```
index.html
style.css
app.mjs
api.mjs
recipe.mjs
qr.mjs
yaml.mjs
```

Therefore `node_modules`, `tests`, `src`, `pyproject.toml`, fixtures, package
metadata, and repository files cannot enter the site artifact.

Publishing is intentionally a user action. From this repository, create and
push it in one command, enable workflow-based Pages, and deploy:

```sh
gh repo create plate --public --source=. --remote=origin --push
gh api --method POST 'repos/{owner}/{repo}/pages' -f build_type=workflow
gh workflow run pages.yml
gh run watch
viewer_url="$(gh api 'repos/{owner}/{repo}/pages' --jq .html_url)"
export RECIPES_VIEWER_URL="$viewer_url"
```

To persist the viewer address, run this from the Recipes repository (its
`.env` is ignored):

```sh
printf 'RECIPES_VIEWER_URL=%s\n' "$viewer_url" > .env
```

## Local use and tests

Modules need HTTP rather than `file://`:

```sh
node tests/serve.mjs
npm ci
node --test "tests/*_test.mjs"
```

Playwright resolves only from this repository's `node_modules`. YAML tests use
`python3` with PyYAML as an independent parser; they do not import a sibling
package.

The CSP remains:

```
default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data:; base-uri 'none'; form-action 'none'
```

No CDN, font host, QR service, unsafe script, or external API is allowed. QR is
generated locally at error level L. Downloads use a Blob and object URL;
printing uses the browser's print stylesheet.
