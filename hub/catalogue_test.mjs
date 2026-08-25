import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  OTHER,
  categoryOf,
  entryOf,
  groupByCategory,
  labelFor,
  shareUrl,
} from "./catalogue.mjs";

/** A share payload, as `/api/recipes` serves one. */
function payload(name, { tags = [], resolved = true, servings = 2 } = {}) {
  const nutrients = resolved
    ? { kcal: 100, protein: 5, fat: 2, carbs: 10 }
    : {};
  return {
    name,
    servings,
    notes: "",
    tags,
    ingredients: [{ name: "Something", grams: 100, ...nutrients }],
  };
}

test("a category comes from the prefixed tag, not the first tag", () => {
  assert.equal(categoryOf(payload("x", { tags: ["dinner", "category:soup"] })), "soup");
  assert.equal(categoryOf(payload("x", { tags: ["dinner"] })), "");
});

test("known categories are labelled, unknown ones are made readable", () => {
  assert.equal(labelFor("ice-cream"), "Ice Cream");
  assert.equal(labelFor("no-bake"), "No-Bake Treats");
  assert.equal(labelFor("zebra-food"), "Zebra Food");
  assert.equal(labelFor(""), OTHER);
});

test("groups keep the authored order, then unknown, then uncategorised", async () => {
  const groups = await groupByCategory([
    payload("Zeta", { tags: ["category:zebra"] }),
    payload("Mystery"),
    payload("Soup", { tags: ["category:savoury"] }),
    payload("Cone", { tags: ["category:ice-cream"] }),
  ]);

  assert.deepEqual(
    groups.map((group) => group.label),
    ["Ice Cream", "Savoury", "Zebra", OTHER],
  );
});

test("recipes sort by name inside a category", async () => {
  const groups = await groupByCategory([
    payload("Pistachio", { tags: ["category:ice-cream"] }),
    payload("Apple Pie", { tags: ["category:ice-cream"] }),
  ]);

  assert.deepEqual(
    groups[0].entries.map((entry) => entry.name),
    ["Apple Pie", "Pistachio"],
  );
});

test("an entry carries per-serving figures", async () => {
  const entry = await entryOf(payload("Cone", { servings: 2 }), { viewer: "/view" });

  assert.equal(entry.name, "Cone");
  assert.equal(entry.servings, 2);
  assert.equal(entry.kcal, 50);
  assert.equal(entry.protein, 2.5);
});

test("a share link round-trips through the viewer's own codec", async () => {
  const original = payload("Cone", { tags: ["category:ice-cream"] });
  const url = await shareUrl(original, "/view");

  assert.equal(url.startsWith("/view#r="), true);

  const { recipeFromHash } = await import("../recipe.mjs");
  const decoded = await recipeFromHash(new URL(url, "http://x").hash);
  assert.equal(decoded.name, "Cone");
  assert.equal(decoded.ingredients[0].kcal, 100);
});

test("a row carries a public link alongside the local one", async () => {
  const entry = await entryOf(payload("Cone"), {
    viewer: "/view",
    publicViewer: "https://example.test/plate/",
  });

  assert.equal(entry.url.startsWith("/view#r="), true);
  assert.equal(entry.publicUrl.startsWith("https://example.test/plate/#r="), true);

  // One payload, so both links must carry the same recipe.
  assert.equal(entry.url.split("#r=")[1], entry.publicUrl.split("#r=")[1]);
});

test("an unresolved recipe gets no figures and neither link", async () => {
  const entry = await entryOf(payload("Draft", { resolved: false }), {
    viewer: "/view",
    publicViewer: "https://example.test/plate/",
  });

  assert.equal(entry.kcal, null);
  assert.equal(entry.url, "");
  assert.equal(entry.publicUrl, "");
});

test("a missing public viewer leaves the public link out", async () => {
  const entry = await entryOf(payload("Cone"), { viewer: "/view" });

  assert.equal(entry.url.startsWith("/view#r="), true);
  assert.equal(entry.publicUrl, "");
});
