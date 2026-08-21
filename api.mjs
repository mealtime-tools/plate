// Plate API client and editor helpers.
// No build step, vanilla JS, talks only to /api/ on origin.

/** Probe GET /api/health once on load. Returns { ok, recipe_dir } or null. */
export async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch {
    return null;
  }
}

/** GET /api/recipes -> list of candidates. */
export async function fetchRecipes() {
  const res = await fetch("/api/recipes");
  if (!res.ok) throw new Error(`Failed to fetch recipes: ${res.status}`);
  return await res.json();
}

/** GET /api/recipes/<name> -> one recipe. */
export async function fetchRecipe(name) {
  const res = await fetch(`/api/recipes/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Recipe not found: ${name}`);
  return await res.json();
}

/** PUT /api/recipes/<name> -> { ok } | { ok: false, errors: [...] } */
export async function saveRecipe(name, recipeData) {
  const res = await fetch(`/api/recipes/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(recipeData),
  });
  const data = await res.json();
  return { ok: res.ok && data.ok !== false, ...data };
}

/** GET /api/products?q=...&remote=... -> [{ source, id, name, brand, macros }] */
export async function searchProducts(query, remote = false) {
  const params = new URLSearchParams({ q: query });
  if (remote) params.set("remote", "1");
  const res = await fetch(`/api/products?${params.toString()}`);
  if (!res.ok) throw new Error(`Product search failed: ${res.status}`);
  return await res.json();
}

/** GET /api/products/<source>/<id> -> one product. */
export async function fetchProduct(source, id) {
  const res = await fetch(
    `/api/products/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
  );
  if (!res.ok) throw new Error(`Product not found: ${source}:${id}`);
  return await res.json();
}

/**
 * Convert an API recipe object (or candidate detail) to the recipe.mjs internal format.
 */
export function recipeFromApi(data) {
  const ingredients = (data.ingredients || []).map((item, idx) => {
    const grams =
      typeof item.grams === "number" && Number.isFinite(item.grams)
        ? item.grams
        : null;

    const per100 = {};
    const missing = [];
    const macros = item.macros || {};

    for (const key of ["kcal", "protein", "fat", "carbs"]) {
      const val =
        typeof macros[key] === "number" && Number.isFinite(macros[key])
          ? macros[key]
          : null;
      if (val === null) missing.push(key);
      per100[key] = val;
    }

    if (grams === null) missing.unshift("grams");

    return {
      name:
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : `Ingredient ${idx + 1}`,
      source: item.source || "manual",
      id: String(item.id ?? ""),
      grams,
      per100,
      missing,
    };
  });

  const problems = ingredients
    .filter((item) => item.missing.length)
    .map((item) => `${item.name} is missing ${item.missing.join(", ")}.`);

  return {
    name: typeof data.name === "string" ? data.name : "",
    notes: typeof data.notes === "string" ? data.notes : "",
    servings:
      typeof data.servings === "number" && data.servings >= 1
        ? Math.floor(data.servings)
        : 1,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    ingredients,
    problems,
  };
}

/**
 * Convert an internal recipe object to the JSON shape expected by PUT /api/recipes/<name>.
 */
export function recipeToApi(recipe) {
  return {
    name: recipe.name,
    servings: recipe.servings,
    notes: recipe.notes || "",
    tags: recipe.tags || [],
    ingredients: recipe.ingredients.map((item) => ({
      source: item.source || "manual",
      id: item.id || "",
      name: item.name,
      grams: item.grams,
      macros: item.missing.length
        ? undefined
        : {
            kcal: item.per100.kcal,
            protein: item.per100.protein,
            fat: item.per100.fat,
            carbs: item.per100.carbs,
          },
    })),
  };
}
