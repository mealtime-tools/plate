// YAML export, hand-written.
//
// The page has no build step and no dependencies, and gaining one to serialize
// five keys would be the largest thing in the directory. So this file emits the
// exact shape `recipes/src/recipes/store.py` writes -- key order included --
// which is what lets a downloaded file be dropped into `~/.config/recipes/` and
// read by the CLI without an edit.
//
// The whole risk of hand-writing YAML is quoting, so every scalar goes through
// `yamlScalar` and nothing interpolates a string into the document directly.

import { recipeTotals } from "./recipe.mjs";

const MACRO_KEYS = ["kcal", "protein", "fat", "carbs"];

// A share link carries `[name, grams, kcal, protein, fat, carbs]` and no
// `(source, id)`, so the reference keys cannot be filled in. They are left out
// and the absence is stated in the file: a fabricated reference would be worse
// than none, because `recipes resolve --force` would then read the wrong
// product over a snapshot that was right.
const HEADER = [
  "# Exported from a recipe share link.",
  "#",
  "# A share link carries resolved names and per-100 g macros, not product",
  "# references, so `source` and `id` are absent here. The macros below are",
  "# the frozen snapshot that was shared, which `recipes resolve` leaves",
  "# alone; add a source and id by hand if you want it to re-read them.",
];

/**
 * Plain words PyYAML's resolver reads as something other than a string.
 *
 * A recipe named "No" written plain comes back as `False`, and one named "null"
 * comes back as `None` -- a renamed or nameless recipe, silently. Quoting them
 * keeps them strings.
 */
const RESERVED_WORDS = new Set([
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "true",
  "True",
  "TRUE",
  "false",
  "False",
  "FALSE",
  "on",
  "On",
  "ON",
  "off",
  "Off",
  "OFF",
  "null",
  "Null",
  "NULL",
  "~",
]);

// A letter in the leading position, so no scalar can start with a YAML
// indicator or be resolved as a number or a date; `:` `#` `"` `\` and `[]{}`
// absent throughout, which is what keeps a plain scalar from turning into a
// mapping, a comment, an escape or a collection.
const PLAIN = /^\p{L}[\p{L}\p{N} .,()&%+/'_-]*$/u;

/**
 * Whether a code point is one a YAML scalar cannot carry literally.
 *
 * Tab and newline are not in the set: a block scalar carries both, and they are
 * spelled out as escapes when it cannot.
 */
function isControl(code) {
  if (code === 0x09 || code === 0x0a) return false;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0xfeff;
}

const hasControl = (text) =>
  [...text].some((char) => isControl(char.codePointAt(0)));

/** A scalar YAML reads back as the exact string given. */
export function yamlScalar(value, indent) {
  if (value.includes("\n")) return multiline(value, indent);

  const plain =
    PLAIN.test(value) && !value.endsWith(" ") && !RESERVED_WORDS.has(value);
  if (plain) return value;

  // Single quotes have exactly one escape (a doubled quote), so nothing inside
  // can be reinterpreted -- unlike double quotes, where a stray backslash in an
  // ingredient name would become an escape sequence.
  if (hasControl(value)) return doubleQuoted(value);
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Multi-line text as a literal block where possible.
 *
 * Notes are method text: `"line one\nline two"` on one escaped line is
 * unreadable and undiffable, which is why the store writes a block too.
 */
function multiline(value, indent) {
  if (!blockSafe(value)) return doubleQuoted(value);

  // Chomping: `-` strips the final newline, nothing keeps one, `+` keeps them
  // all. The document's own line break supplies the first one.
  const trailing = value.match(/\n+$/)?.[0].length ?? 0;
  const chomp = trailing === 0 ? "-" : trailing === 1 ? "" : "+";

  const pad = " ".repeat(indent + 2);
  const body = value
    .replace(/\n+$/, "")
    .split("\n")
    // A blank line stays empty: padding it would be trailing whitespace, the
    // one thing a literal block does not preserve.
    .map((line) => (line ? pad + line : ""))
    .join("\n");

  return `|${chomp}\n${body}${"\n".repeat(Math.max(0, trailing - 1))}`;
}

/**
 * Whether a literal block round-trips this text.
 *
 * A block strips trailing whitespace from every line and reads a leading space
 * on the first line as indentation, so text carrying either is quoted instead of
 * being silently rewritten.
 */
function blockSafe(value) {
  const lines = value.replace(/\n+$/, "").split("\n");
  if (!lines[0] || /^[ \t]/.test(lines[0])) return false;

  return lines.every((line) => !/[ \t]$/.test(line) && !hasControl(line));
}

// The escapes PyYAML reads back, spelled out so nothing else is guessed at.
const ESCAPES = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
};

/** The fallback that can hold anything, at the cost of readability. */
function doubleQuoted(value) {
  return `"${[...value].map(escapeChar).join("")}"`;
}

function escapeChar(char) {
  const known = ESCAPES[char];
  if (known) return known;

  const code = char.codePointAt(0);
  return isControl(code) ? `\\u${code.toString(16).padStart(4, "0")}` : char;
}

/** A weight, without a trailing `.0`: what `macros.compact_number` writes. */
function yamlAmount(value) {
  return String(value);
}

/** A macro, as the float it is: a stored snapshot always comes from a float. */
function yamlMacro(value) {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** The name a nameless recipe is stored under: the one the page displays. */
export function exportName(recipe) {
  return recipe.name || "Recipe";
}

/**
 * One recipe as a YAML document, or a refusal.
 *
 * Refusing an incomplete recipe here rather than only in the page is
 * deliberate: a file with a missing macro gets saved and reused, so the refusal
 * belongs where the bytes are made, beside the rule that withholds the total.
 */
export function recipeYaml(recipe, servings) {
  if (recipe.problems.length) {
    throw new Error(
      `This recipe is incomplete, so exporting it would save a gap: ${recipe.problems.join(" ")}`,
    );
  }

  if (!recipeTotals(recipe) || !recipe.ingredients.length) {
    throw new Error("This link carries nothing to export.");
  }

  const lines = [
    ...HEADER,
    `name: ${yamlScalar(exportName(recipe), 0)}`,
    `servings: ${Math.max(1, Math.floor(servings) || 1)}`,
  ];

  // Key order follows `store.mapping_of`, and an absent optional key is omitted
  // rather than written empty, so a saved file and an exported one diff cleanly.
  if (recipe.notes) lines.push(`notes: ${yamlScalar(recipe.notes, 0)}`);

  lines.push("ingredients:");
  for (const item of recipe.ingredients) lines.push(...ingredientLines(item));

  return `${lines.join("\n")}\n`;
}

/** One block sequence entry, indented the way PyYAML's block style indents. */
function ingredientLines(item) {
  return [
    `- grams: ${yamlAmount(item.grams)}`,
    `  name: ${yamlScalar(item.name, 2)}`,
    "  macros:",
    ...MACRO_KEYS.map((key) => `    ${key}: ${yamlMacro(item.per100[key])}`),
  ];
}

/** `store.recipe_key`: the identity of a recipe, trimmed and case-folded. */
function recipeKey(name) {
  return name.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The filename `store.filename_for` would give this recipe.
 *
 * The CLI looks a recipe up by the `name:` field inside the file, so this is
 * cosmetic -- but matching keeps a downloaded directory looking like one the CLI
 * wrote, and the digest keeps two names that slug alike off one filename.
 */
export async function recipeFilename(name) {
  const key = recipeKey(name);
  const slug = key
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  // `crypto.subtle` needs a secure context. Served over plain http there is no
  // digest to be had, and the slug alone is a fine filename: nothing resolves a
  // recipe through it.
  if (!globalThis.crypto?.subtle) return `${slug || "recipe"}.yaml`;

  const digest = await sha256Hex(key);
  return `${slug || "recipe"}-${digest.slice(0, 8)}.yaml`;
}
