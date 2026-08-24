import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

import {
  decodePayload,
  encodePayload,
  readRecipe,
  recipeFromHash,
  recipeTotals,
  recipeToPayload,
  scaleIngredient,
} from "../recipe.mjs";
import { serve } from "./serve.mjs";

const GOLDEN =
  "PY5LDsIwDETvMuuoAkT55BqwQ124TQgR-SAnYVP17rgSsBu_Nxp5RqJooXHNVCoUiuW3T65AbxVSrlYShFda2W1QEMvWeJvqCubfwCU3Nrm5h5QdUxR52Cg8JwrQu_6k8GKZ8wn63Mn2narwNU3Eo7T3x64X7EfL0KmFIM9k41v8X83RVy3D8gE";

test("the current Recipes share vector decodes", async () => {
  assert.deepEqual(await decodePayload(GOLDEN), {
    name: "Toast",
    servings: 1,
    notes: "",
    tags: [],
    ingredients: [{
      name: "Sourdough",
      grams: 60,
      kcal: 258,
      protein: 9.1,
      fat: 2.1,
      carbs: 47.5,
      fiber: null,
      sodium: null,
      sugar: null,
    }],
  });
});

test("re-sharing writes the stated nutrients and omits the rest", async () => {
  const recipe = readRecipe(await decodePayload(GOLDEN));
  const [item] = recipeToPayload(recipe).ingredients;

  // An unstated nutrient is omitted, not written as null: a null per name would grow every link.
  assert.deepEqual(Object.keys(item), [
    "name",
    "grams",
    "kcal",
    "protein",
    "fat",
    "carbs",
  ]);

  // An explicit zero is a reading, so it survives the round trip.
  const zeroed = recipeToPayload(
    readRecipe({ ingredients: [{ name: "Water", grams: 100, kcal: 0, protein: 0, fat: 0, carbs: 0, sodium: 0 }] }),
  );
  assert.equal(zeroed.ingredients[0].sodium, 0);
});

test("a re-shared link decodes to the recipe it came from", async () => {
  const recipe = readRecipe(await decodePayload(GOLDEN));
  const again = readRecipe(
    await decodePayload(await encodePayload(recipeToPayload(recipe))),
  );

  assert.deepEqual(again, recipe);
});

test("missing nutrients are null while explicit zero totals as zero", () => {
  const item = (carbs) => ({
    ingredients: [{
      name: "Water",
      grams: 100,
      kcal: 0,
      protein: 0,
      fat: 0,
      carbs,
    }],
  });
  const missing = readRecipe(item(null));
  const zero = readRecipe(item(0));

  assert.equal(missing.ingredients[0].carbs, null);
  assert.equal(recipeTotals(missing), null);
  assert.equal(recipeTotals(zero).kcal, 0);
  assert.equal(recipeTotals(readRecipe({
    ingredients: [{
      name: "Bar",
      grams: 50,
      kcal: 200,
      protein: 20,
      fat: 5,
      carbs: 15,
    }],
  })).kcal, 200);
});

test("optional nutrients total only when every ingredient states them", () => {
  const oats = {
    name: "Oats",
    grams: 100,
    kcal: 389,
    protein: 13.2,
    fat: 6.5,
    carbs: 67.7,
    fiber: 10.6,
    sodium: 6,
    sugar: 0.9,
  };
  const milk = {
    name: "Milk",
    grams: 200,
    kcal: 84,
    protein: 6.8,
    fat: 0.4,
    carbs: 12,
    sodium: 88,
    sugar: 12,
  };

  const stated = recipeTotals(readRecipe({ ingredients: [oats] }));
  assert.equal(stated.fiber, 10.6);
  assert.equal(stated.sodium, 6);
  assert.equal(stated.sugar, 0.9);
  assert.equal(scaleIngredient(readRecipe({ ingredients: [oats] })
    .ingredients[0]).fiber, 10.6);

  // Milk states no fibre, so a fibre total would under-report: omit the key.
  const mixed = recipeTotals(readRecipe({ ingredients: [oats, milk] }));
  assert.equal("fiber" in mixed, false);
  assert.equal(mixed.sodium, 94);
  assert.equal(mixed.sugar, 12.9);
  assert.equal(mixed.kcal, 473);
});

test("a nutrient beyond the macros round-trips and totals all or nothing", async () => {
  const tofu = {
    name: "Tofu",
    grams: 200,
    kcal: 288,
    protein: 34,
    fat: 18,
    carbs: 6,
    calcium: 0.7,
    saturated_fat: 2.6,
  };
  const oil = {
    name: "Oil",
    grams: 10,
    kcal: 88,
    protein: 0,
    fat: 10,
    carbs: 0,
    saturated_fat: 1.4,
  };

  const payload = recipeToPayload(readRecipe({ ingredients: [tofu, oil] }));
  assert.deepEqual(payload.ingredients[0], tofu);
  assert.deepEqual(payload.ingredients[1], oil);

  // Oil states no calcium, so omit the key: the macros' rule, over the whole vocabulary.
  const totals = recipeTotals(
    readRecipe(await decodePayload(await encodePayload(payload))),
  );
  assert.equal("calcium" in totals, false);
  assert.equal(totals.saturated_fat, 4);
  assert.equal(totals.kcal, 376);
});

test("the deploy copies every module the page imports", async () => {
  const read = (name) =>
    readFile(new URL(`../${name}`, import.meta.url), "utf8");
  const workflow = await read(".github/workflows/pages.yml");
  const sources = await Promise.all([read("app.mjs"), read("recipe.mjs")]);

  // A module missing from the artifact is a blank page on Pages; the browser test serves the whole checkout and cannot see it.
  for (const source of sources) {
    for (const [, file] of source.matchAll(/from "\.\/([\w.-]+)"/g)) {
      assert.equal(workflow.includes(file), true, `${file} is not deployed`);
    }
  }
});

let site;
let browser;

before(async () => {
  site = await serve(new URL("..", import.meta.url).pathname);
  const require = createRequire(import.meta.url);
  browser = await require("playwright-core").chromium.launch();
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test("the static page renders and edits its share URL", async () => {
  const page = await browser.newPage();
  const errors = [];
  const offsite = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => {
    if (!request.url().startsWith(site.origin)) offsite.push(request.url());
  });

  await page.goto(`${site.origin}/#r=${GOLDEN}`);
  await page.waitForSelector("#recipe:not([hidden])");
  assert.equal(await page.title(), "Toast");
  assert.equal(await page.locator("#ingredient-rows tr").count(), 1);

  const initialHash = new URL(page.url()).hash;
  await page.locator("#recipe-name-input").fill("Edited Toast");
  await page.waitForFunction((hash) => location.hash !== hash, initialHash);
  const hash = new URL(page.url()).hash;
  const edited = await recipeFromHash(hash);

  assert.equal(edited.name, "Edited Toast");
  assert.deepEqual(errors, []);
  assert.deepEqual(offsite, []);
  await page.close();
});

test("the editor reports missing nutrients in the vocabulary's own order", async () => {
  const encoded = await encodePayload({
    name: "Half a loaf",
    servings: 1,
    ingredients: [{ name: "Sourdough", grams: 60, kcal: 258, protein: 9.1 }],
  });

  const page = await browser.newPage();
  await page.goto(`${site.origin}/#r=${encoded}`);
  await page.waitForSelector("#alert:not([hidden])");

  // Core order, not column order: completeness is the vocabulary's rule, not the table's.
  assert.equal(
    await page.locator("#alert-list li").first().textContent(),
    "Sourdough is missing fat, carbs.",
  );
  await page.close();
});

test("a grams edit rescales every nutrient in the share URL", async () => {
  const encoded = await encodePayload(recipeToPayload({
    name: "Oats",
    servings: 1,
    notes: "",
    tags: [],
    ingredients: [{
      name: "Oats",
      grams: 100,
      kcal: 389,
      protein: 13.2,
      fat: 6.5,
      carbs: 67.7,
      fiber: 10.6,
      sodium: null,
      sugar: 0.9,
    }],
  }));

  const page = await browser.newPage();
  await page.goto(`${site.origin}/#r=${encoded}`);
  await page.waitForSelector("#recipe:not([hidden])");

  const before = new URL(page.url()).hash;
  await page.locator(".grams-input").fill("200");
  await page.waitForFunction((hash) => location.hash !== hash, before);

  const [item] = (await recipeFromHash(new URL(page.url()).hash)).ingredients;
  assert.equal(item.grams, 200);
  assert.equal(item.kcal, 778);
  assert.equal(item.fiber, 21.2);
  assert.equal(item.sugar, 1.8);
  assert.equal(item.sodium, null);
  await page.close();
});
