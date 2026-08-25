import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, test } from "bun:test";

import { recipeFromHash } from "../recipe.mjs";
import { serve } from "./serve.mjs";

const DOUGH = `name: Cookie Dough
servings: 2
tags:
- category:doughs
ingredients:
- source: coles
  id: '1'
  grams: 100
  name: Something
  kcal: 100
  protein: 5
  fat: 2
  carbs: 10
`;

const DRAFT = `name: Draft Bake
servings: 1
tags:
- category:bakes
ingredients:
- source: coles
  id: '2'
  grams: 50
`;

let directory;
let server;
let origin;
let browser;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "hub-serve-"));
  server = serve({ directory, port: 0, hostname: "127.0.0.1" });
  origin = `http://127.0.0.1:${server.port}`;
  browser = await createRequire(import.meta.url)("playwright-core").chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  await rm(directory, { recursive: true, force: true });
});

test("the API reports recipes written after startup", async () => {
  const empty = await (await fetch(`${origin}/api/recipes`)).json();
  assert.deepEqual(empty.recipes, []);

  await writeFile(join(directory, "dough.yaml"), DOUGH);

  const body = await (await fetch(`${origin}/api/recipes`)).json();
  assert.equal(body.recipes.length, 1);
  assert.equal(body.recipes[0].name, "Cookie Dough");
  assert.equal(body.viewer, "/view");
});

test("an unreadable collection is a 500 naming the file", async () => {
  const broken = join(directory, "broken.yaml");
  await writeFile(broken, "name: Broken\nservings: [\n");

  const response = await fetch(`${origin}/api/recipes`);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /broken\.yaml/);

  await rm(broken);
});

test("only the allowlisted files are served", async () => {
  for (const path of ["/", "/view", "/style.css", "/recipe.mjs", "/hub/app.mjs"]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 200, path);
  }

  // Paths are Map keys, never joined onto a root, so traversal has nothing to
  // traverse; the encoded form is here because a client normalises `/../` away
  // before it is ever sent, and only the encoded one reaches the server.
  const refused = [
    "/package.json",
    "/hub/serve.mjs",
    "/hub/collection.mjs",
    "/%2e%2e/package.json",
  ];
  for (const path of refused) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
});

test("the page renders its groups and links a recipe to the viewer", async () => {
  await writeFile(join(directory, "draft.yaml"), DRAFT);

  const page = await browser.newPage();
  const errors = [];
  const offsite = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) offsite.push(request.url());
  });

  await page.goto(origin);
  await page.waitForSelector(".categories li a.name");

  // Label then count, which is a child span; the CSS uppercases the label for
  // display only, so the raw text is what the assertion reads.
  assert.deepEqual(await page.locator(".categories > li > h2").allTextContents(), [
    "Doughs1",
    "Bakes1",
  ]);
  assert.equal(await page.locator("#total").textContent(), "2");

  // The unresolved recipe is named but neither linked nor given figures.
  assert.equal(await page.locator("span.name").innerText(), "Draft Bake");
  assert.equal(await page.locator(".pending").innerText(), "unresolved");

  const href = await page.locator("a.name").getAttribute("href");
  const decoded = await recipeFromHash(new URL(href, origin).hash);
  assert.equal(decoded.name, "Cookie Dough");
  assert.equal(decoded.ingredients[0].kcal, 100);

  assert.deepEqual(errors, []);
  assert.deepEqual(offsite, []);
  await page.close();
});

test("the linked viewer renders the recipe the index pointed at", async () => {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.waitForSelector("a.name");
  await page.locator("a.name").click();

  await page.waitForSelector("#recipe:not([hidden])");
  assert.equal(await page.title(), "Cookie Dough");
  assert.equal(await page.locator("#ingredient-rows tr").count(), 1);
  await page.close();
});
