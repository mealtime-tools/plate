import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

import {
  decodePayload,
  readRecipe,
  recipeFromHash,
  recipeTotals,
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
