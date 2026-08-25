// A directory of recipe files -> the share payloads the page renders.
//
// This is the only module that touches a filesystem, and the only one that
// needs bun: `Bun.YAML` is what keeps the index dependency-free. Everything
// downstream is the same payload shape a share link carries, so the page and
// the tests never see YAML at all.
//
// The refusals here are deliberate rather than defensive. The Python tool that
// owns these files rejects a malformed one instead of rendering it, and an
// index that quietly skipped a recipe -- or showed one of two files claiming a
// name -- would answer a question about food with the wrong file.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { NUTRIENT_KEYS } from "../recipe.mjs";

const SUFFIX = ".yaml";

/** A file that cannot be read, or a name two files claim. */
export class CollectionError extends Error {
  name = "CollectionError";
}

/** A recipe's identity: its name, trimmed and case-folded, as the tools key it. */
function recipeKey(name) {
  return name.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

/** One ingredient -> the payload's flat shape. Unstated nutrients are omitted. */
function ingredientOf(raw, file) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CollectionError(`${file}: an ingredient is not a mapping`);
  }

  const grams = Number(raw.grams);
  if (!Number.isFinite(grams)) {
    throw new CollectionError(`${file}: ${raw.name ?? raw.id}: unreadable grams`);
  }

  const stated = {};
  for (const key of NUTRIENT_KEYS) {
    // An absent key and an explicit null read alike, which is the wire rule.
    if (raw[key] === null || raw[key] === undefined) continue;

    const value = Number(raw[key]);
    if (!Number.isFinite(value)) {
      throw new CollectionError(`${file}: ${raw.name ?? raw.id}: ${key} is not finite`);
    }
    stated[key] = value;
  }

  // A reference with no snapshot is how an unresolved ingredient looks; it is
  // valid input, and readRecipe is what reports the recipe as unresolved.
  return { name: raw.name ? String(raw.name) : "", grams, ...stated };
}

/** One file's text -> a share payload. */
export function payloadOf(text, file) {
  let raw;
  try {
    raw = Bun.YAML.parse(text);
  } catch (error) {
    throw new CollectionError(`${file}: ${error.message}`);
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CollectionError(`${file}: a recipe file must contain a mapping`);
  }

  const name = String(raw.name ?? "").trim();
  if (!name) {
    throw new CollectionError(`${file}: a recipe file must carry a name`);
  }

  const servings = Number(raw.servings ?? 1);
  return {
    name,
    servings: Number.isFinite(servings) && servings >= 1 ? Math.floor(servings) : 1,
    notes: String(raw.notes ?? ""),
    tags: (raw.tags ?? []).map(String),
    ingredients: (raw.ingredients ?? []).map((item) => ingredientOf(item, file)),
  };
}

/** Every recipe in `directory`, ordered by name. An absent directory is empty. */
export async function readCollection(directory) {
  let names;
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(SUFFIX));
  } catch {
    // Nothing to serve reads the same as an empty collection; serve.mjs says
    // once at startup whether the directory is there at all.
    return [];
  }

  const claimed = new Map();
  const payloads = [];
  for (const file of names.sort()) {
    const payload = payloadOf(
      await readFile(join(directory, file), "utf8"),
      file,
    );

    const key = recipeKey(payload.name);
    if (claimed.has(key)) {
      throw new CollectionError(
        `${payload.name}: more than one file claims this name: ` +
          `${claimed.get(key)}, ${file}`,
      );
    }
    claimed.set(key, file);
    payloads.push(payload);
  }

  return payloads.sort((a, b) => a.name.localeCompare(b.name));
}
