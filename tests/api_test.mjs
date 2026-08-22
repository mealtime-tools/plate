import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import {
  checkHealth,
  fetchProduct,
  fetchRecipe,
  fetchRecipes,
  recipeFromApi,
  recipeToApi,
  saveRecipe,
  searchProducts,
} from "../api.mjs";
import { recipeTotals } from "../recipe.mjs";
import { serve } from "./serve.mjs";

function loadChromium() {
  const roots = ["playwright-core"];
  for (const root of roots) {
    try {
      const require = createRequire(new URL(root, import.meta.url));
      return require("playwright-core").chromium;
    } catch {}
  }
  throw new Error("playwright-core not found; run `npm ci` in this directory");
}

test("recipeFromApi converts valid API recipe and computes no problems", () => {
  const apiData = {
    name: "Test Pizza",
    servings: 2,
    notes: "Hot oven",
    tags: ["dinner"],
    ingredients: [
      {
        name: "Dough",
        source: "coles",
        id: "1",
        grams: 200,
        macros: { kcal: 250, protein: 8, fat: 2, carbs: 50 },
      },
    ],
  };

  const recipe = recipeFromApi(apiData);
  assert.equal(recipe.name, "Test Pizza");
  assert.equal(recipe.servings, 2);
  assert.equal(recipe.notes, "Hot oven");
  assert.deepEqual(recipe.tags, ["dinner"]);
  assert.equal(recipe.ingredients.length, 1);
  assert.deepEqual(recipe.problems, []);

  const totals = recipeTotals(recipe);
  assert.ok(totals);
  assert.equal(totals.grams, 200);
  assert.equal(totals.kcal, 500);
});

test("recipeFromApi identifies missing macros and missing grams as problems", () => {
  const apiData = {
    name: "Broken Recipe",
    ingredients: [
      {
        name: "Mystery Ingredient",
        grams: null,
        macros: { kcal: 100, protein: null, fat: 1, carbs: 10 },
      },
    ],
  };

  const recipe = recipeFromApi(apiData);
  assert.equal(recipe.problems.length, 1);
  assert.match(recipe.problems[0], /Mystery Ingredient is missing/);
  assert.match(recipe.problems[0], /grams/);
  assert.match(recipe.problems[0], /protein/);
  assert.equal(recipeTotals(recipe), null);
});

test("recipeToApi converts internal recipe to API JSON format", () => {
  const internal = {
    name: "Pasta",
    servings: 1,
    notes: "Al dente",
    tags: ["quick"],
    ingredients: [
      {
        name: "Spaghetti",
        source: "coles",
        id: "10",
        grams: 100,
        per100: { kcal: 350, protein: 12, fat: 1.5, carbs: 70 },
        missing: [],
      },
    ],
    problems: [],
  };

  const apiJson = recipeToApi(internal);
  assert.equal(apiJson.name, "Pasta");
  assert.equal(apiJson.servings, 1);
  assert.equal(apiJson.ingredients.length, 1);
  assert.deepEqual(apiJson.ingredients[0].macros, {
    kcal: 350,
    protein: 12,
    fat: 1.5,
    carbs: 70,
  });
});

let site;
let browser;

before(async () => {
  site = await serve(new URL("..", import.meta.url).pathname);
  browser = await loadChromium().launch();
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const cells = (locator) =>
  locator.evaluateAll((nodes) => nodes.map((node) => node.textContent));

test("served mode editor renders and edits update totals live", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];

  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  // Mock the 6 API endpoints
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, recipe_dir: "/mock/recipes" }),
    });
  });

  await page.route("**/api/recipes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          name: "Sourdough Pizza",
          kind: "recipe",
          complete: true,
        },
      ]),
    });
  });

  let savedBody = null;
  await page.route("**/api/recipes/*", async (route) => {
    const method = route.request().method();
    if (method === "PUT") {
      savedBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, name: savedBody.name, written: true }),
      });
    } else if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          name: "Sourdough Pizza",
          servings: 2,
          notes: "Stretch cold.",
          tags: ["dinner"],
          ingredients: [
            {
              name: "Pizza Dough",
              source: "coles",
              id: "1",
              grams: 475,
              macros: { kcal: 268.0, protein: 8.9, fat: 3.1, carbs: 49.2 },
            },
            {
              name: "Passata",
              source: "coles",
              id: "2",
              grams: 100,
              macros: { kcal: 34.0, protein: 1.6, fat: 0.2, carbs: 6.4 },
            },
          ],
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route("**/api/products*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          source: "coles",
          id: "3",
          name: "Mozzarella",
          brand: "Coles",
          macros: { kcal: 280.0, protein: 22.0, fat: 21.0, carbs: 1.5 },
        },
      ]),
    });
  });

  await page.goto(`${site.origin}/`);
  await page.waitForFunction(
    () => !document.getElementById("recipe").hidden,
  );

  assert.deepEqual(errors, []);
  assert.ok(await page.locator("#editor-nav").isVisible());
  assert.ok(await page.locator("#editor-tools").isVisible());
  assert.equal(
    await page.locator("#recipe-name").textContent(),
    "Sourdough Pizza",
  );

  // Initial total: 475g Dough (1273 kcal) + 100g Passata (34 kcal) = 1307.0 kcal
  assert.deepEqual(await cells(page.locator("#ingredient-total td")), [
    "575.0",
    "1307.0",
    "43.9",
    "240.1",
    "14.9",
    "",
  ]);

  // Live edit grams of first ingredient: change 475 to 500
  const firstGramsInput = page.locator(".grams-input").first();
  await firstGramsInput.fill("500");

  // New total: 500g Dough (1340 kcal) + 100g Passata (34 kcal) = 1374.0 kcal
  assert.deepEqual(await cells(page.locator("#ingredient-total td")), [
    "600.0",
    "1374.0",
    "46.1",
    "252.4",
    "15.7",
    "",
  ]);

  // Search product and add Mozzarella. A recipe that has ingredients opens with
  // the editing tools collapsed, so expand them first.
  await page.locator("#editor-tools summary").click();
  await page.locator("#product-search-input").fill("mozzarella");
  await page.locator("#product-search-btn").click();
  await page.locator("#product-search-results li button").first().click();

  // Now 3 ingredients: 500g Dough + 100g Passata + 100g Mozzarella (280 kcal) = 1654.0 kcal
  assert.equal(await page.locator("#ingredient-rows tr").count(), 3);
  assert.deepEqual(await cells(page.locator("#ingredient-total td")), [
    "700.0",
    "1654.0",
    "68.1",
    "253.9",
    "36.7",
    "",
  ]);

  // Remove the second ingredient (Passata)
  await page.locator(".remove-ingredient-btn").nth(1).click();
  assert.equal(await page.locator("#ingredient-rows tr").count(), 2);
  // Total: 500g Dough (1340) + 100g Mozzarella (280) = 1620.0 kcal
  assert.deepEqual(await cells(page.locator("#ingredient-total td")), [
    "600.0",
    "1620.0",
    "66.5",
    "247.5",
    "36.5",
    "",
  ]);

  // Save recipe round-trip
  await page.locator("#save-recipe-btn").click();
  await page.waitForFunction(
    () => document.getElementById("save-status").textContent === "Saved",
  );

  assert.ok(savedBody);
  assert.equal(savedBody.name, "Sourdough Pizza");
  assert.equal(savedBody.ingredients.length, 2);

  await page.close();
});

test("saving invalid recipe surfaces backend errors", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, recipe_dir: "/mock/recipes" }),
    });
  });

  await page.route("**/api/recipes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/recipes/*", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          errors: ["coles:999 was not found in the product database"],
        }),
      });
    }
  });

  await page.goto(`${site.origin}/`);
  await page.waitForFunction(
    () => !document.getElementById("editor-nav").hidden,
  );

  // Add manual ingredient
  await page.locator("#manual-name").fill("Unknown item");
  await page.locator("#manual-grams").fill("100");
  await page.locator("#manual-kcal").fill("100");
  await page.locator("#manual-protein").fill("5");
  await page.locator("#manual-carbs").fill("10");
  await page.locator("#manual-fat").fill("2");
  await page.locator("#manual-add-btn").click();

  // Attempt save
  await page.locator("#save-recipe-btn").click();
  await page.waitForFunction(
    () => !document.getElementById("alert").hidden,
  );

  assert.match(
    await page.locator("#alert-list").textContent(),
    /coles:999 was not found/,
  );

  await page.close();
});

const STORED_INGREDIENTS = {
  rice: {
    name: "Rice",
    grams: 200,
    macros: { kcal: 130, protein: 2.7, fat: 0.3, carbs: 28 },
  },
  peanuts: {
    name: "Peanuts",
    grams: 30,
    macros: { kcal: 567, protein: 25.8, fat: 49.2, carbs: 16.1 },
  },
};

/**
 * A served-mode page backed by stored recipes, keyed by name. The first key is
 * the candidate the editor loads by itself, the way it picks the first name a
 * real backend lists.
 */
async function servedPage(stored) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const json = (body) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  await page.route("**/api/health", (route) =>
    route.fulfill(json({ ok: true, recipe_dir: "/mock/recipes" })),
  );
  await page.route("**/api/recipes", (route) =>
    route.fulfill(json(Object.keys(stored).map((name) => ({ name })))),
  );
  await page.route("**/api/recipes/*", (route) => {
    const name = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").pop(),
    );
    return route.fulfill(json(stored[name]));
  });

  await page.goto(`${site.origin}/`);
  await page.waitForFunction(
    () => !document.getElementById("editor-nav").hidden,
  );
  return page;
}

const storedRecipe = (name, ingredients) => ({
  name,
  servings: 1,
  ingredients,
});

const named = (page, name) =>
  page.waitForFunction(
    (wanted) =>
      document.getElementById("recipe-name").textContent === wanted,
    name,
  );

const toolsOpen = (page) =>
  page.locator("#editor-tools").evaluate((el) => el.open);

/**
 * The only path where collapsing is observable: static mode renders once into
 * a disclosure the markup already left closed, so nothing there can tell the
 * collapse apart from its absence.
 */
test("switching to a stored recipe with ingredients collapses the tools", async () => {
  const page = await servedPage({
    "Empty Draft": storedRecipe("Empty Draft", []),
    Congee: storedRecipe("Congee", [STORED_INGREDIENTS.rice]),
  });

  await named(page, "Empty Draft");
  assert.equal(
    await toolsOpen(page),
    true,
    "a stored recipe with no ingredients has nothing to view, so it opens",
  );
  assert.ok(await page.locator("#manual-name").isVisible());

  await page.selectOption("#recipe-select", "Congee");
  await named(page, "Congee");

  assert.equal(
    await toolsOpen(page),
    false,
    "arriving at a recipe that has something to view must collapse the tools",
  );
  assert.ok(await page.locator("#manual-name").isHidden());

  await page.close();
});

test("an edit that leaves ingredients in place leaves the tools alone", async () => {
  const page = await servedPage({
    Congee: storedRecipe("Congee", [
      STORED_INGREDIENTS.rice,
      STORED_INGREDIENTS.peanuts,
    ]),
  });

  await named(page, "Congee");
  assert.equal(await toolsOpen(page), false);

  await page.locator(".remove-ingredient-btn").first().click();
  await page.waitForFunction(
    () => document.querySelectorAll("#ingredient-rows tr").length === 1,
  );

  assert.equal(
    await toolsOpen(page),
    false,
    "one ingredient still remains: the empty state must not open the tools",
  );
  assert.ok(await page.locator("#manual-name").isHidden());

  await page.close();
});
