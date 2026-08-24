// Guards on the vendored nutrient vocabulary. It is a copy of a file this repo
// does not own, so what is checked here is that the copy is intact, that it
// still carries every name plate depends on, and that it has not drifted from
// the upstream checkout when one is next to us.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { VOCABULARY } from "../nutrients.mjs";
import { CORE_NUTRIENTS, NUTRIENT_KEYS } from "../recipe.mjs";

// The names a share link written before the vocabulary widened can carry, so
// dropping one would strand links that already exist.
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
  // Pinned, not derived: app.mjs renders exactly these four columns from its
  // own MACROS, so a fifth core nutrient upstream is a layout decision and has
  // to fail here rather than quietly leave a column out of the table.
  assert.deepEqual(CORE_NUTRIENTS, ["kcal", "protein", "fat", "carbs"]);

  // The same names as the vocabulary, reordered: nothing invented, none lost.
  // Duplicates would double-count a nutrient in a total.
  assert.deepEqual([...NUTRIENT_KEYS].sort(), [...VOCABULARY.nutrients].sort());
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
