// Guards on the vendored vocabulary: a copy of a file this repo does not own, so check it is intact and has not drifted.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { VOCABULARY } from "../nutrients.mjs";
import { CORE_NUTRIENTS, NUTRIENT_KEYS } from "../recipe.mjs";

// The names links in the wild already carry: dropping one strands them, so they are pinned rather than derived.
const WIRE_NAMES = [
  "kcal",
  "protein",
  "fat",
  "carbs",
  "fiber",
  "sodium",
  "sugar",
];

const UPSTREAM = new URL("../../nutrients/nutrients.json", import.meta.url);

test("the vendored document has the shape the generator emits", () => {
  assert.deepEqual(Object.keys(VOCABULARY), [
    "unit",
    "energyUnit",
    "energyNutrient",
    "coreNutrients",
    "nutrients",
    "apiNutrients",
    "apiFields",
  ]);
  assert.equal(VOCABULARY.unit, "g");

  // Energy is kcal everywhere: no kilojoule name reaches the wire format.
  assert.equal(VOCABULARY.energyNutrient, "kcal");
  assert.equal(VOCABULARY.energyUnit, "kcal");
  assert.equal(VOCABULARY.nutrients.includes("kj"), false);
});

test("the vocabulary keeps every name plate depends on", () => {
  for (const name of WIRE_NAMES) {
    assert.equal(NUTRIENT_KEYS.includes(name), true, `${name} is missing`);
  }
  // Pinned: a fifth core nutrient upstream is a layout decision, so it must fail here, not drop a column.
  assert.deepEqual(CORE_NUTRIENTS, ["kcal", "protein", "fat", "carbs"]);

  // The vocabulary's own wire order, taken as given: nothing invented, reordered or lost.
  assert.deepEqual(NUTRIENT_KEYS, VOCABULARY.nutrients);

  // Duplicates would double-count a nutrient in a total; the macros must still lead the wire.
  assert.equal(new Set(NUTRIENT_KEYS).size, NUTRIENT_KEYS.length);
  assert.deepEqual(NUTRIENT_KEYS.slice(0, 4), CORE_NUTRIENTS);
});

test("the vendored copy matches the upstream checkout", (t) => {
  // Plate's CI checks out plate alone, so this can only run beside the source.
  if (!existsSync(UPSTREAM)) {
    t.skip("no ../nutrients checkout: cannot compare against the source");
    return;
  }

  const message = "stale: paste nutrients/nutrients.json into nutrients.mjs";
  assert.deepEqual(VOCABULARY, JSON.parse(readFileSync(UPSTREAM, "utf8")), message);
});
