// The index's own logic: which heading a recipe belongs under, and what one
// row says. No DOM and no filesystem, so `node --test` runs it as the browser
// does -- the same split app.mjs and recipe.mjs already keep.
//
// Every figure and every link here comes from recipe.mjs, the module the viewer
// itself uses. That is the point of the index living in this repository: a row
// cannot disagree with the page it links to, because one codec writes the link
// and one arithmetic produces the numbers.

import {
  encodePayload,
  perServing,
  readRecipe,
  recipeTotals,
  recipeToPayload,
} from "../recipe.mjs";

const CATEGORY_PREFIX = "category:";

export const OTHER = "Other";

// Authored order: how the collection reads, not how it sorts. A category not
// named here still renders, appended after these, so adding one is a tag on a
// recipe rather than a change to this file.
export const LABELS = {
  "ice-cream": "Ice Cream",
  doughs: "Doughs",
  bakes: "Bakes",
  "no-bake": "No-Bake Treats",
  savoury: "Savoury",
};

/** The recipe's category, or "" when it names none. */
export function categoryOf(payload) {
  const tag = (payload.tags ?? []).find((value) =>
    String(value).startsWith(CATEGORY_PREFIX),
  );
  return tag ? tag.slice(CATEGORY_PREFIX.length).trim() : "";
}

/** The heading for a category, falling back to a readable form of the tag. */
export function labelFor(category) {
  if (!category) return OTHER;

  return (
    LABELS[category] ??
    category
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

/** The one link that carries this recipe, written by the viewer's own codec. */
export async function shareUrl(payload, viewer) {
  const encoded = await encodePayload(recipeToPayload(readRecipe(payload)));
  return `${viewer}#r=${encoded}`;
}

/** One recipe as a row: per-serving figures, and a link when it has one. */
export async function entryOf(payload, viewer) {
  const recipe = readRecipe(payload);
  const totals = recipeTotals(recipe);

  // No totals means an ingredient is unresolved. Inventing a figure or a link
  // for one would report a gap as data, so both are withheld together.
  // Unrounded: how many decimals a row shows is the page's business, and
  // rounding here once cost a figure that disagreed with the viewer's own.
  const figure = (key) =>
    totals && totals[key] !== undefined
      ? perServing(totals[key], recipe.servings)
      : null;

  return {
    name: recipe.name,
    servings: recipe.servings,
    url: totals ? await shareUrl(payload, viewer) : "",
    kcal: figure("kcal"),
    protein: figure("protein"),
    fat: figure("fat"),
    carbs: figure("carbs"),
  };
}

/** Every recipe under its category heading, authored order first. */
export async function groupByCategory(payloads, viewer = "") {
  const buckets = new Map();
  for (const payload of payloads) {
    const key = categoryOf(payload);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(payload);
  }

  const known = Object.keys(LABELS).filter((key) => buckets.has(key));
  const rest = [...buckets.keys()].filter((key) => key && !(key in LABELS)).sort();
  const order = [...known, ...rest, ...(buckets.has("") ? [""] : [])];

  return Promise.all(
    order.map(async (key) => ({
      label: labelFor(key),
      entries: await Promise.all(
        buckets
          .get(key)
          .slice()
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map((payload) => entryOf(payload, viewer)),
      ),
    })),
  );
}
