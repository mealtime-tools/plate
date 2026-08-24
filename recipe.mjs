// Share-link codec and recipe arithmetic. No DOM, no network, no globals beyond
// the platform's own `DecompressionStream`, so this file runs under `node --test`
// exactly as it runs in the browser.
//
// Wire format (README.md, "Share URL wire format"):
//   #r=<base64url(raw_deflate(compact_json))>, `=` padding stripped
//   {"name":...,"servings":...,"ingredients":[{"name":...,"grams":...,"kcal":...,...}]}
// Nutrients describe each whole ingredient. Totals are therefore simple sums.
// A nutrient an ingredient does not state is absent or null, never zero; the
// two are read alike, and re-sharing writes only the stated ones.

export const FRAGMENT_KEY = "r";

/** A payload we refuse to render, with a message meant for a human. */
export class ShareError extends Error {}

/**
 * Pull the payload out of a location hash.
 *
 * The hash is parsed as `key=value` pairs so a future second key cannot break
 * existing links, and returns null (not an error) when absent: no fragment is
 * the empty state, not a failure.
 */
export function readFragment(hash) {
  const body = String(hash ?? "").replace(/^#/, "");
  if (!body) return null;

  const found = new URLSearchParams(body).get(FRAGMENT_KEY);
  return found ? found : null;
}

/**
 * base64url -> bytes.
 *
 * `atob` only speaks standard base64 and rejects a wrong-length string, so the
 * two substitutions and the stripped padding both have to be undone here.
 */
export function base64urlToBytes(text) {
  const standard = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);

  // Reject before atob so the failure carries our message rather than a
  // browser-specific InvalidCharacterError.
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

  // Write and close before reading: the payload is a few hundred bytes, so
  // there is no back-pressure to manage and no reason to interleave.
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

const MACRO_KEYS = ["kcal", "protein", "fat", "carbs"];
export const NUTRIENT_KEYS = [...MACRO_KEYS, "fiber", "sodium", "sugar"];

/** A finite number, or null. Strings and nulls are not coerced: see readRecipe. */
function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Validate one `i` entry into an ingredient plus the list of fields it is
 * missing. A missing macro is recorded, never defaulted to zero -- an inferred
 * zero is what silently under-counted a 450 g recipe in the old page.
 */
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
    if (value === null && MACRO_KEYS.includes(key)) missing.push(key);
    nutrients[key] = value;
  });

  if (grams <= 0) missing.unshift("grams");
  return { name: label, grams, ...nutrients, missing };
}

/**
 * Payload -> a recipe the renderer can walk, plus `problems`.
 *
 * `problems` is the refusal channel: any entry in it means the recipe is
 * incomplete and `recipeTotals` will return null. Structuring it this way makes
 * the rule mechanical -- a renderer cannot get a total for a broken recipe even
 * by accident.
 */
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

/**
 * An editor recipe -> the compact, versioned object carried by a share URL.
 *
 * Only the nutrients an ingredient states are written. An absent key and a null
 * one already mean the same thing to readIngredient, so omitting is lossless,
 * and a null per unstated name would grow every link by the whole vocabulary.
 */
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

/**
 * Whole-recipe totals, or null when the recipe is incomplete.
 *
 * The Recipes completeness contract: an unresolved ingredient refuses to total.
 * null rather than a partial sum is what enforces it.
 */
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
