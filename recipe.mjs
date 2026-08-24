// Share-link codec and recipe arithmetic. No DOM and no network, so `node --test` runs this as the browser does.
//
// Wire format:
//   #r=<base64url(raw_deflate(compact_json))>, `=` padding stripped
//   {"name":..,"servings":..,"notes":..,"tags":[..],"ingredients":[{"name":..,"grams":..,<nutrients>}]}
//   Nutrient keys follow the vocabulary's wire order and describe the whole ingredient, so totals are sums.
//   An unstated nutrient is absent or null, never zero; the two read alike, and re-sharing writes only the stated ones.

import VOCABULARY from "./nutrients.json" with { type: "json" };

export const FRAGMENT_KEY = "r";

/** A payload we refuse to render, with a message meant for a human. */
export class ShareError extends Error {}

/** The payload in a location hash, read as `key=value` pairs so a second key cannot break old links. Null when absent. */
export function readFragment(hash) {
  const body = String(hash ?? "").replace(/^#/, "");
  if (!body) return null;

  const found = new URLSearchParams(body).get(FRAGMENT_KEY);
  return found ? found : null;
}

/** base64url -> bytes. `atob` speaks only standard base64 and rejects a wrong length, so both undone here. */
export function base64urlToBytes(text) {
  const standard = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);

  // Reject before atob, so the failure carries our message and not a browser's InvalidCharacterError.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
    throw new ShareError(
      "The link contains characters that are not valid base64url.",
    );
  }

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Raw-deflate (no zlib header) -> UTF-8 text. */
export async function inflateRaw(bytes) {
  const stream = new DecompressionStream("deflate-raw");

  // Write and close before reading: a few hundred bytes have no back-pressure to manage.
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});

  try {
    return await new Response(stream.readable).text();
  } catch {
    throw new ShareError(
      "The link is truncated or corrupt; it could not be decompressed.",
    );
  }
}

/** Fragment payload -> parsed JSON object. Throws ShareError on any failure. */
export async function decodePayload(encoded) {
  const text = await inflateRaw(base64urlToBytes(encoded));

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ShareError(
      "The link decompressed to something that is not a recipe.",
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ShareError(
      "The link decompressed to something that is not a recipe.",
    );
  }
  return payload;
}

/** Bytes -> unpadded base64url. */
function bytesToBase64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** JSON object -> raw-deflate base64url payload. */
export async function encodePayload(payload) {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const compressed = new Response(stream.readable).arrayBuffer();
  await writer.write(new TextEncoder().encode(JSON.stringify(payload)));
  await writer.close();

  return bytesToBase64url(new Uint8Array(await compressed));
}

// Shared with the Python tools, so both lists come from the vendored copy; neither is a display concern.
export const CORE_NUTRIENTS = VOCABULARY.coreNutrients;

// Canonical wire order since 0.3.0 -- the macros already lead, so nothing to rearrange here.
export const NUTRIENT_KEYS = VOCABULARY.nutrients;

/** A finite number, or null. Strings and nulls are not coerced: see readRecipe. */
function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One entry -> an ingredient plus what it is missing. A missing macro is recorded, never inferred as zero. */
function readIngredient(entry, index) {
  const row = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  const label =
    typeof row.name === "string" && row.name.trim()
      ? row.name.trim()
      : `Ingredient ${index + 1}`;

  const grams = finiteOrNull(row.grams) ?? 100;
  const nutrients = {};
  const missing = [];

  NUTRIENT_KEYS.forEach((key) => {
    const value = finiteOrNull(row[key]);
    if (value === null && CORE_NUTRIENTS.includes(key)) missing.push(key);
    nutrients[key] = value;
  });

  if (grams <= 0) missing.unshift("grams");
  return { name: label, grams, ...nutrients, missing };
}

/** Payload -> a recipe the renderer can walk. Any entry in `problems` means `recipeTotals` returns null. */
export function readRecipe(payload) {
  if (payload.ingredients !== undefined && !Array.isArray(payload.ingredients)) {
    throw new ShareError("The link's ingredient list is malformed.");
  }
  if (payload.tags !== undefined && !Array.isArray(payload.tags)) {
    throw new ShareError("The link's tag list is malformed.");
  }

  const ingredients = (payload.ingredients ?? []).map(readIngredient);
  const problems = ingredients
    .filter((item) => item.missing.length)
    .map((item) => `${item.name} is missing ${item.missing.join(", ")}.`);

  return {
    name: typeof payload.name === "string" ? payload.name : "",
    notes: typeof payload.notes === "string" ? payload.notes : "",
    servings: readServings(payload.servings),
    tags: (payload.tags ?? [])
      .filter((tag) => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean),
    ingredients,
    problems,
  };
}

/** A recipe -> the object a share URL carries. Only stated nutrients are written: absent and null read alike. */
export function recipeToPayload(recipe) {
  return {
    name: recipe.name,
    servings: recipe.servings,
    notes: recipe.notes,
    tags: recipe.tags ?? [],
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      grams: ingredient.grams,
      ...Object.fromEntries(
        NUTRIENT_KEYS.map((key) => [key, finiteOrNull(ingredient[key])]).filter(
          ([, value]) => value !== null,
        ),
      ),
    })),
  };
}

/** Servings must be a positive integer; anything else falls back to 1. */
function readServings(value) {
  const count = finiteOrNull(value);
  if (count === null || count < 1) return 1;
  return Math.floor(count);
}

/** Nutrients for an ingredient's actual weight. */
export function scaleIngredient(ingredient) {
  if (ingredient.missing.length) return null;

  // finiteOrNull: readIngredient nulls it, the editor omits the key entirely.
  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, finiteOrNull(ingredient[key])]),
  );
}

/** Whole-recipe totals, or null: the Recipes contract is that an unresolved ingredient refuses to total. */
export function recipeTotals(recipe) {
  if (recipe.problems.length) return null;

  // All or nothing per nutrient: a partial sum would under-report.
  const scaled = recipe.ingredients.map(scaleIngredient);
  const keys = NUTRIENT_KEYS.filter(
    (key) => !scaled.some((values) => values[key] === null),
  );

  const totals = { grams: 0, ...Object.fromEntries(keys.map((k) => [k, 0])) };
  recipe.ingredients.forEach((ingredient, index) => {
    totals.grams += ingredient.grams;
    for (const key of keys) totals[key] += scaled[index][key];
  });
  return totals;
}

/** One serving's share of a total. */
export function perServing(total, servings) {
  const count = readServings(servings);
  return total / count;
}

/** A total expressed per 100 g of finished recipe. Null when weight is unknown. */
export function per100g(total, grams) {
  if (!grams) return null;
  return (total / grams) * 100;
}

/** Decode a location hash all the way to a recipe. Null means "no link given". */
export async function recipeFromHash(hash) {
  const encoded = readFragment(hash);
  if (!encoded) return null;
  return readRecipe(await decodePayload(encoded));
}
