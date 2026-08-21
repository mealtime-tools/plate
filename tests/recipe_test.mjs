import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  base64urlToBytes,
  decodePayload,
  encodePayload,
  per100g,
  perServing,
  readFragment,
  readRecipe,
  recipeToPayload,
  recipeFromHash,
  recipeTotals,
  ShareError,
  scaleIngredient,
} from "../recipe.mjs";

const PAYLOADS = {
  empty: { v: 1 },
  minimal: {
    v: 1,
    n: "Toast",
    i: [["Sourdough", 60, 258.0, 9.1, 2.1, 47.5]],
  },
  "servings-and-notes": {
    v: 1,
    n: "Sourdough Pizza",
    s: 2,
    t: "Stretch cold, from the edges.\nBake 8 min at max heat.",
    i: [
      ["Pizza Dough", 475, 268.0, 8.9, 3.1, 49.2],
      ["Passata", 100, 34.0, 1.6, 0.2, 6.4],
      ["Mozzarella", 75, 280.0, 22.0, 21.0, 1.5],
    ],
  },
  unicode: {
    v: 1,
    n: "Café Crème Brûlée",
    i: [["Crème fraîche", 120, 292.0, 2.4, 30.0, 2.9]],
  },
};

function encode(payload) {
  return deflateRawSync(Buffer.from(JSON.stringify(payload), "utf8"))
    .toString("base64url");
}

for (const [label, payload] of Object.entries(PAYLOADS)) {
  test(`payload "${label}" survives the wire codec`, async () => {
    assert.deepEqual(await decodePayload(encode(payload)), payload);
  });
}

test("a payload is reachable through a full fragment", async () => {
  const payload = PAYLOADS["servings-and-notes"];
  const recipe = await recipeFromHash(`#r=${encode(payload)}`);

  assert.equal(recipe.name, "Sourdough Pizza");
  assert.equal(recipe.servings, 2);
  assert.equal(recipe.ingredients.length, 3);
  assert.match(recipe.notes, /\n/);
});

test("an edited recipe becomes a conformant share payload", async () => {
  const recipe = readRecipe(PAYLOADS["servings-and-notes"]);
  recipe.tags = ["dinner", "quick"];
  const payload = recipeToPayload(recipe);

  assert.deepEqual(payload, {
    ...PAYLOADS["servings-and-notes"],
    g: ["dinner", "quick"],
  });
  assert.deepEqual(
    readRecipe(await decodePayload(await encodePayload(payload))).tags,
    ["dinner", "quick"],
  );
});

test("no fragment is the empty state, not an error", async () => {
  assert.equal(await recipeFromHash(""), null);
  assert.equal(await recipeFromHash("#"), null);
  assert.equal(await recipeFromHash("#other=1"), null);
  assert.equal(readFragment("#r="), null);
});

test("base64url alphabet and stripped padding both decode", () => {
  // "??>" round-tripped through base64url is "Pz8-", which standard base64
  // would spell "Pz8+"; the trailing "=" is stripped in our links.
  assert.deepEqual([...base64urlToBytes("Pz8-")], [0x3f, 0x3f, 0x3e]);
  assert.deepEqual([...base64urlToBytes("_w")], [0xff]);
});

test("a truncated payload is refused, not partially decoded", async () => {
  const truncated = encode(PAYLOADS["servings-and-notes"]).slice(0, 40);

  await assert.rejects(() => decodePayload(truncated), ShareError);
});

test("garbage in the fragment is refused", async () => {
  await assert.rejects(() => decodePayload("!!!not base64!!!"), ShareError);
  await assert.rejects(() => decodePayload("aaaaaaaaaaaa"), ShareError);
});

test("a payload that is not an object is refused", async () => {
  // raw-deflate of "[1,2,3]".
  const encoded = "izbUMdIxjgUA";
  await assert.rejects(() => decodePayload(encoded), ShareError);
});

test("an unknown share version is refused", () => {
  assert.throws(() => readRecipe({ v: 2, i: [] }), ShareError);
  assert.throws(() => readRecipe({}), ShareError);
});

test("a malformed ingredient list is refused", () => {
  assert.throws(() => readRecipe({ v: 1, i: "Sourdough" }), ShareError);
});

test("a malformed tag list is refused", () => {
  assert.throws(() => readRecipe({ v: 1, g: "dinner" }), ShareError);
});

test("an empty recipe reads cleanly and totals to zero", () => {
  const recipe = readRecipe({ v: 1 });

  assert.deepEqual(recipe.problems, []);
  assert.equal(recipe.ingredients.length, 0);
  assert.deepEqual(recipeTotals(recipe), {
    grams: 0,
    kcal: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
  });
});

test("macros are per 100 g and scale by weight", () => {
  const recipe = readRecipe({
    v: 1,
    i: [["Sourdough", 60, 258.0, 9.1, 2.1, 47.5]],
  });
  const scaled = scaleIngredient(recipe.ingredients[0]);

  assert.equal(round(scaled.kcal), 154.8);
  assert.equal(round(scaled.protein), 5.5);
  assert.equal(round(scaled.fat), 1.3);
  assert.equal(round(scaled.carbs), 28.5);
});

test("a missing macro refuses to total instead of counting a zero", () => {
  const recipe = readRecipe({
    v: 1,
    i: [
      ["Pizza Dough", 300, 268.0, 8.9, 3.1, 49.2],
      ["Mystery Cheese", 150, null, 22.0, 21.0, 1.5],
    ],
  });

  assert.equal(recipe.problems.length, 1);
  assert.match(recipe.problems[0], /Mystery Cheese is missing kcal/);
  assert.equal(recipeTotals(recipe), null);
  assert.equal(scaleIngredient(recipe.ingredients[1]), null);
});

test("a missing weight is a problem too", () => {
  const recipe = readRecipe({
    v: 1,
    i: [["Passata", null, 34.0, 1.6, 0.2, 6.4]],
  });

  assert.match(recipe.problems[0], /missing grams/);
  assert.equal(recipeTotals(recipe), null);
});

test("a stringified number is a problem, never coerced", () => {
  // Coercion is how "0" or "" would become a silent zero.
  const recipe = readRecipe({
    v: 1,
    i: [["Passata", "100", 34.0, 1.6, 0.2, 6.4]],
  });

  assert.match(recipe.problems[0], /missing grams/);
});

test("an ingredient with no name still reports its position", () => {
  const recipe = readRecipe({ v: 1, i: [["", 100, 1, 1, 1, null]] });

  assert.match(recipe.problems[0], /^Ingredient 1 is missing carbs/);
});

test("totals split evenly across servings", () => {
  const recipe = readRecipe({
    v: 1,
    s: 2,
    i: [
      ["Pizza Dough", 475, 268.0, 8.9, 3.1, 49.2],
      ["Passata", 100, 34.0, 1.6, 0.2, 6.4],
      ["Mozzarella", 75, 280.0, 22.0, 21.0, 1.5],
    ],
  });
  const totals = recipeTotals(recipe);

  assert.equal(totals.grams, 650);
  assert.equal(round(totals.kcal), 1517);
  assert.equal(round(perServing(totals.kcal, 2)), 758.5);
  assert.equal(round(perServing(totals.kcal, 4)), 379.3);
  assert.equal(round(per100g(totals.kcal, totals.grams)), 233.4);
});

test("servings falls back to 1 rather than dividing by zero", () => {
  assert.equal(readRecipe({ v: 1, s: 0 }).servings, 1);
  assert.equal(readRecipe({ v: 1, s: -3 }).servings, 1);
  assert.equal(readRecipe({ v: 1, s: 2.7 }).servings, 2);
  assert.equal(perServing(100, 0), 100);
  assert.equal(per100g(10, 0), null);
});

function round(value) {
  return Math.round(value * 10) / 10;
}
