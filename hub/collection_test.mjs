import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";

import { CollectionError, readCollection } from "./collection.mjs";

const RECIPE = `name: Cookie Dough
servings: 2
tags:
- category:doughs
notes: |-
  Chill it first.
ingredients:
- source: coles
  id: '1'
  grams: 100
  name: Something
  kcal: 100
  protein: 5
  fat: 2
  carbs: 10
  fiber: null
`;

async function directory(files) {
  const path = await mkdtemp(join(tmpdir(), "hub-"));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(path, name), body);
  }
  return path;
}

test("a recipe file becomes a share payload", async () => {
  const found = await readCollection(await directory({ "a.yaml": RECIPE }));

  assert.equal(found.length, 1);
  assert.deepEqual(found[0], {
    name: "Cookie Dough",
    servings: 2,
    notes: "Chill it first.",
    tags: ["category:doughs"],
    ingredients: [
      { name: "Something", grams: 100, kcal: 100, protein: 5, fat: 2, carbs: 10 },
    ],
  });
});

test("an unstated nutrient is dropped rather than zeroed", async () => {
  const found = await readCollection(await directory({ "a.yaml": RECIPE }));

  assert.equal("fiber" in found[0].ingredients[0], false);
});

test("recipes come back ordered by name", async () => {
  const path = await directory({
    "z.yaml": "name: Zebra\nservings: 1\ningredients: []\n",
    "a.yaml": "name: Apple\nservings: 1\ningredients: []\n",
  });

  const names = (await readCollection(path)).map((recipe) => recipe.name);
  assert.deepEqual(names, ["Apple", "Zebra"]);
});

test("a directory with no recipes is empty, not an error", async () => {
  assert.deepEqual(await readCollection(await directory({})), []);
});

test("a missing directory is empty, not an error", async () => {
  assert.deepEqual(await readCollection("/definitely/not/here"), []);
});

test("an unreadable file is refused by name", async () => {
  const path = await directory({ "bad.yaml": "name: Bad\nservings: {\n" });

  await assert.rejects(() => readCollection(path), {
    name: "CollectionError",
    message: /bad\.yaml/,
  });
});

test("a file carrying no name is refused", async () => {
  const path = await directory({ "nameless.yaml": "servings: 1\n" });

  await assert.rejects(() => readCollection(path), CollectionError);
});

test("two files claiming one name are refused, naming both", async () => {
  const path = await directory({
    "one.yaml": "name: Toast\nservings: 1\ningredients: []\n",
    "two.yaml": "name: toast\nservings: 1\ningredients: []\n",
  });

  await assert.rejects(() => readCollection(path), {
    message: /one\.yaml.*two\.yaml|two\.yaml.*one\.yaml/,
  });
});
