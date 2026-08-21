// The YAML export, checked as a document rather than against a consumer.
//
// These tests prove the emitted text is valid YAML that parses back to the
// values that went in: quoting, escaping, block scalars, unicode. PyYAML does
// the parsing, shelled out to, because there is no JS YAML parser here and the
// page is not gaining a dependency to get one -- but it is a general parser,
// not this project.
//
// Whether the document satisfies the `recipes` CLI is deliberately NOT tested
// here. Plate knows nothing about recipes; recipes depends on plate. That check
// lives on the depending side, against `fixtures/exported-example.yaml`, which
// the last test in this file keeps honest.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { readRecipe } from "../recipe.mjs";
import { recipeFilename, recipeYaml } from "../yaml.mjs";

/** Run a Python snippet. Null when python3 or PyYAML is unavailable. */
function python(script, input) {
  try {
    return execFileSync("python3", ["-c", script], {
      input,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

const PYTHON_READY = python("import yaml", "") !== null;

/** Skip rather than pass silently: a green run that checked nothing is worse. */
function needPython(t) {
  if (PYTHON_READY) return true;
  t.skip("python3 with PyYAML is required");
  return false;
}

/** Parse with PyYAML, exactly as `store.load_recipe` does. */
function parseYaml(text) {
  const out = python(
    "import json,sys,yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))",
    text,
  );
  assert.ok(out, "PyYAML refused the generated document");
  return JSON.parse(out);
}




const PIZZA = {
  v: 1,
  n: "Sourdough Pizza",
  s: 2,
  t: "Stretch cold, from the edges.\nBake 8 min at max heat.",
  i: [
    ["Pizza Dough", 475, 268.0, 8.9, 3.1, 49.2],
    ["Passata", 100, 34.0, 1.6, 0.2, 6.4],
    ["Mozzarella", 75, 280.0, 22.0, 21.0, 1.5],
  ],
};

/** Strip the provenance header, which is a comment and carries no data. */
const body = (text) =>
  text
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");

/**
 * Drop the two reference keys `mapping_of` always writes.
 *
 * They are the one documented difference: a share link carries no `(source,
 * id)`, so the export leaves them out rather than inventing a pair.
 */
const withoutRefs = (text) =>
  text
    .split("\n")
    .filter((line) => !/^ *(- )?(source|id):/.test(line))
    .join("\n")
    .replace(/^ {2}grams:/gm, "- grams:");

const yamlFor = (payload, servings) =>
  recipeYaml(readRecipe(payload), servings ?? payload.s ?? 1);


test("the generated YAML parses back to the same values", (t) => {
  if (!needPython(t)) return;
  const parsed = parseYaml(yamlFor(PIZZA));

  assert.equal(parsed.name, "Sourdough Pizza");
  assert.equal(parsed.servings, 2);
  assert.equal(parsed.notes, PIZZA.t);
  assert.deepEqual(parsed.ingredients[0], {
    grams: 475,
    name: "Pizza Dough",
    macros: { kcal: 268.0, protein: 8.9, fat: 3.1, carbs: 49.2 },
  });
  assert.deepEqual(
    parsed.ingredients.map((item) => item.grams),
    [475, 100, 75],
  );
});


test("the export says out loud that it carries no product references", () => {
  const text = yamlFor(PIZZA);

  assert.match(text, /^#/, "the provenance marker comes first");
  assert.match(text, /resolve/, "it has to name the command it cannot serve");
  assert.doesNotMatch(text, /^ *source:/m, "an invented source would be worse");
  assert.doesNotMatch(text, /^ *id:/m);
});

test("a name with a colon, a double quote and a leading space survives", (t) => {
  if (!needPython(t)) return;
  const name = ' Nigella: 10" pan';
  const parsed = parseYaml(yamlFor({ ...PIZZA, n: name }));

  assert.equal(parsed.name, name);
});

test("names YAML would otherwise read as something else survive", (t) => {
  if (!needPython(t)) return;

  // Every one of these is a scalar a naive emitter loses: a bool word, a
  // number, a comment, an alias, a quote, a trailing space.
  for (const name of [
    "No",
    "off",
    "100",
    "1.5",
    "# not a comment",
    "*alias",
    "it's a pie",
    "don''t",
    'say "hi"',
    "trailing space ",
    "-- dashes --",
    "{}",
    "null",
  ]) {
    const parsed = parseYaml(yamlFor({ ...PIZZA, n: name }));
    assert.equal(parsed.name, name, `name ${JSON.stringify(name)}`);
  }
});

test("multi-line notes survive", (t) => {
  if (!needPython(t)) return;
  const notes = "Stretch cold.\n\nBake 8 min.\nRest 5 min.\n";
  const text = yamlFor({ ...PIZZA, t: notes });

  // A block scalar, because escaped newlines on one line are unreadable and
  // undiffable -- the reason the store writes notes this way too.
  assert.match(text, /^notes: \|/m);
  assert.equal(parseYaml(text).notes, notes);
});

test("notes a block scalar cannot hold still survive", (t) => {
  if (!needPython(t)) return;

  // Trailing spaces and an indented first line are exactly what a literal block
  // silently rewrites, so these fall back to a quoted scalar.
  for (const notes of [
    "trailing space  \nsecond line",
    "  indented first line\nsecond line",
    "tab\there\nand\tthere",
    "windows\r\nnewlines",
    "\nleading blank line",
    "trailing newlines\n\n\n",
  ]) {
    assert.equal(
      parseYaml(yamlFor({ ...PIZZA, t: notes })).notes,
      notes,
      `notes ${JSON.stringify(notes)}`,
    );
  }
});

test("unicode survives", (t) => {
  if (!needPython(t)) return;
  const payload = {
    v: 1,
    n: "Café Crème Brûlée 🍮",
    s: 1,
    t: "Zucker karamellisieren — 中文 — «guillemets»",
    i: [["Crème fraîche", 60, 178.0, 2.4, 17.5, 3.0]],
  };
  const parsed = parseYaml(yamlFor(payload));

  assert.equal(parsed.name, payload.n);
  assert.equal(parsed.notes, payload.t);
  assert.equal(parsed.ingredients[0].name, "Crème fraîche");
});

test("empty notes are omitted rather than written empty", (t) => {
  if (!needPython(t)) return;
  const text = yamlFor({ ...PIZZA, t: "" });

  assert.doesNotMatch(text, /notes/);
  assert.equal(parseYaml(text).notes ?? "", "");
});

test("the servings on screen are the servings exported", (t) => {
  if (!needPython(t)) return;

  assert.equal(parseYaml(yamlFor(PIZZA, 4)).servings, 4);
  assert.equal(parseYaml(yamlFor(PIZZA, 1)).servings, 1);
});

test("an incomplete recipe is refused, not exported with a gap", () => {
  const incomplete = readRecipe({
    v: 1,
    n: "Half A Recipe",
    i: [
      ["Pizza Dough", 300, 268.0, 8.9, 3.1, 49.2],
      ["Mystery Cheese", 150, null, 22.0, 21.0, 1.5],
    ],
  });

  assert.throws(() => recipeYaml(incomplete, 1), /incomplete/);
});

test("a recipe with nothing in it is refused", () => {
  assert.throws(() => recipeYaml(readRecipe({ v: 1, n: "Air" }), 1), /nothing/);
});

test("a nameless recipe exports under the name on screen", (t) => {
  if (!needPython(t)) return;
  const text = yamlFor({ v: 1, i: [["Toast", 40, 265.0, 9.0, 3.2, 49.0]] });

  // A consumer refuses a nameless recipe, so the displayed title is written
  // rather than a document that would be rejected on sight.
  assert.equal(parseYaml(text).name, "Recipe");
});


test("a name with nothing filesystem-safe in it still gets a filename", async () => {
  assert.match(await recipeFilename("!!!"), /^recipe-[0-9a-f]{8}\.yaml$/);
});


test("the committed contract fixture is what this page emits today", async (t) => {
  // `recipes` depends on plate, not the reverse, so whether this document
  // satisfies that CLI is checked over there -- against this exact file.
  // Regenerating it here is what stops the two sides drifting silently: change
  // the emitter and this fails until the fixture is refreshed, at which point
  // the recipes-side test sees the new bytes.
  const { readFile, writeFile } = await import("node:fs/promises");
  const path = new URL("../fixtures/exported-example.yaml", import.meta.url);
  const emitted = recipeYaml(readRecipe(PIZZA), PIZZA.s);

  if (process.env.UPDATE_FIXTURES) {
    await writeFile(path, emitted, "utf8");
    t.diagnostic("fixture rewritten");
    return;
  }

  assert.equal(
    emitted,
    await readFile(path, "utf8"),
    "run with UPDATE_FIXTURES=1 to refresh, then re-run the recipes suite",
  );
});
