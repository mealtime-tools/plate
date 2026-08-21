import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const WORKFLOW = new URL("../.github/workflows/pages.yml", import.meta.url);
const PUBLISHED = [
  "index.html",
  "style.css",
  "app.mjs",
  "api.mjs",
  "recipe.mjs",
  "qr.mjs",
  "yaml.mjs",
];

test("Pages publishes only the static application", async () => {
  const workflow = await readFile(WORKFLOW, "utf8");
  const copy = workflow.match(/cp ([^\n]+) _site\//);

  assert.ok(copy, "the artifact must be built from an explicit whitelist");
  assert.deepEqual(copy[1].trim().split(/\s+/), PUBLISHED);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /actions\/deploy-pages@v5/);

  for (const excluded of ["node_modules", "tests", "src", "pyproject.toml"]) {
    assert.doesNotMatch(copy[1], new RegExp(excluded));
  }
});
