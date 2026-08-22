// Page wiring. Everything numeric lives in recipe.mjs and everything about QR
// symbols lives in qr.mjs, so this file only reads the fragment/API and writes DOM.
//
// No innerHTML anywhere: a recipe name arrives from a URL or API, and
// textContent is the one assignment that can never turn it into markup.

import {
  checkHealth,
  fetchRecipe,
  fetchRecipes,
  recipeFromApi,
  recipeToApi,
  saveRecipe,
  searchProducts,
} from "./api.mjs";
import { encodeQr, qrPath } from "./qr.mjs";
import {
  decodePayload,
  encodePayload,
  per100g,
  perServing,
  readFragment,
  readRecipe,
  recipeToPayload,
  recipeTotals,
  scaleIngredient,
  ShareError,
} from "./recipe.mjs";
import { exportName, recipeFilename, recipeYaml } from "./yaml.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const MACRO_ROWS = [
  ["Energy (kcal)", "kcal"],
  ["Protein (g)", "protein"],
  ["Carbs (g)", "carbs"],
  ["Fat (g)", "fat"],
];

const dom = (id) => document.getElementById(id);

let currentRecipe = null;
let shareRevision = 0;

function blankRecipe() {
  return {
    name: "New Recipe",
    servings: 1,
    notes: "",
    tags: [],
    ingredients: [],
    problems: [],
  };
}

/**
 * One decimal everywhere: the payload carries one, and more implies precision we
 * lack. Units live in the column and row headers rather than in every cell --
 * six unit-suffixed columns do not fit a 390 px phone without sideways scroll.
 */
function amount(value) {
  if (value === null || value === undefined) return "—";
  return value.toFixed(1);
}

function cell(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function clear(node) {
  node.replaceChildren();
}

/** Keep the fragment and QR aligned with the latest editor state. */
async function syncShareLink() {
  const revision = ++shareRevision;
  if (!currentRecipe) return;

  try {
    const encoded = await encodePayload(recipeToPayload(currentRecipe));
    if (revision !== shareRevision) return;

    const url = new URL(window.location.href);
    url.hash = `r=${encoded}`;
    window.history.replaceState(null, "", url);
    renderQrCode(url.href);
  } catch (reason) {
    if (revision !== shareRevision) return;
    showProblems([
      `The share URL could not be updated: ${String(reason.message ?? reason)}`,
    ]);
  }
}

/**
 * Refuse the whole page.
 *
 * A link we cannot decode gets no table and no numbers at all -- a half-rendered
 * recipe is exactly the failure this page exists to remove.
 */
function showFailure(reason) {
  const alert = dom("alert");
  dom("alert-title").textContent = "This recipe link could not be read";
  clear(dom("alert-list"));
  dom("alert-list").appendChild(cell("li", reason.message));
  dom("alert-note").textContent =
    reason instanceof ShareError
      ? "Ask for the link again; chat apps sometimes cut long links short."
      : "";
  alert.hidden = false;
  dom("recipe").hidden = true;
}

/** Warn about incomplete ingredients. Totals stay withheld while this is shown. */
function showProblems(problems) {
  const alert = dom("alert");
  if (!problems || problems.length === 0) {
    alert.hidden = true;
    return;
  }
  dom("alert-title").textContent =
    problems.length === 1
      ? "One ingredient is incomplete, so no total is shown"
      : `${problems.length} ingredients are incomplete, so no total is shown`;

  const list = dom("alert-list");
  clear(list);
  for (const problem of problems) list.appendChild(cell("li", problem));

  dom("alert-note").textContent =
    "Totalling around a missing value would under-count the recipe, so this page will not do it.";
  alert.hidden = false;
}

function renderIngredients(recipe) {
  const body = dom("ingredient-rows");
  clear(body);

  const headerRow = dom("ingredients-header-row");
  if (headerRow) {
    let actionTh = headerRow.querySelector(".action-col");
    if (!actionTh) {
      actionTh = cell("th", "", "action-col");
      headerRow.appendChild(actionTh);
    }
  }

  for (let idx = 0; idx < recipe.ingredients.length; idx++) {
    const ingredient = recipe.ingredients[idx];
    const scaled = scaleIngredient(ingredient);
    const row = document.createElement("tr");
    if (!scaled) row.className = "incomplete";

    row.appendChild(cell("th", ingredient.name, "name"));

    const gramsTd = document.createElement("td");
    const gramsInput = document.createElement("input");
    gramsInput.type = "number";
    gramsInput.min = "0";
    gramsInput.step = "any";
    gramsInput.className = "grams-input";
    gramsInput.value =
      ingredient.grams !== null && ingredient.grams !== undefined
        ? String(ingredient.grams)
        : "";
    gramsInput.addEventListener("input", () => {
      const val = parseFloat(gramsInput.value);
      ingredient.grams = Number.isFinite(val) && val > 0 ? val : null;
      updateIngredientMissing(ingredient);
      void syncShareLink();
      updateProblemsAndTotals();
    });
    gramsTd.appendChild(gramsInput);
    row.appendChild(gramsTd);

    for (const [, key] of MACRO_ROWS) {
      row.appendChild(cell("td", scaled ? amount(scaled[key]) : "—"));
    }

    const actionTd = cell("td", "", "action-cell");
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-ingredient-btn";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${ingredient.name}`);
    removeBtn.addEventListener("click", () => {
      recipe.ingredients.splice(idx, 1);
      void syncShareLink();
      updateProblemsAndTotals();
      renderIngredients(recipe);
    });
    actionTd.appendChild(removeBtn);
    row.appendChild(actionTd);

    body.appendChild(row);
  }
}

function updateIngredientMissing(ingredient) {
  const missing = [];
  if (ingredient.grams === null || ingredient.grams === undefined) {
    missing.push("grams");
  }
  for (const [, key] of MACRO_ROWS) {
    if (
      !ingredient.per100 ||
      ingredient.per100[key] === null ||
      ingredient.per100[key] === undefined ||
      !Number.isFinite(ingredient.per100[key])
    ) {
      missing.push(key);
    }
  }
  ingredient.missing = missing;
}

/**
 * Render the empty-recipe state and keep the editing tools reachable.
 *
 * This only ever opens the disclosure: nothing to view means nothing to
 * collapse for, and an edit that leaves ingredients in place must not close the
 * panel the user is typing in. Collapsing is renderRecipe's job alone.
 */
function renderEmptyState(recipe) {
  const empty = recipe.ingredients.length === 0;
  dom("no-ingredients").hidden = !empty;
  dom("ingredients-panel").hidden = empty;

  if (empty) dom("editor-tools").open = true;

  return empty;
}

function updateProblemsAndTotals() {
  if (!currentRecipe) return;

  const problems = currentRecipe.ingredients
    .filter((item) => item.missing && item.missing.length)
    .map((item) => `${item.name} is missing ${item.missing.join(", ")}.`);

  currentRecipe.problems = problems;

  const alert = dom("alert");
  if (problems.length) {
    showProblems(problems);
  } else {
    alert.hidden = true;
  }

  const empty = renderEmptyState(currentRecipe);

  const totals = empty ? null : recipeTotals(currentRecipe);
  renderIngredientTotal(totals);
  applyServings(totals, currentRecipe.servings);

  // Update macro numbers in rows without replacing entire inputs
  const rows = dom("ingredient-rows").querySelectorAll("tr");
  for (let idx = 0; idx < currentRecipe.ingredients.length; idx++) {
    const ing = currentRecipe.ingredients[idx];
    const scaled = scaleIngredient(ing);
    const row = rows[idx];
    if (!row) continue;
    row.className = scaled ? "" : "incomplete";
    const tds = row.querySelectorAll("td");
    // tds: [grams (input or text), kcal, P, C, F, (action)?]
    const start = 1;
    MACRO_ROWS.forEach(([, key], offset) => {
      if (tds[start + offset]) {
        tds[start + offset].textContent = scaled ? amount(scaled[key]) : "—";
      }
    });
  }
}

function renderIngredientTotal(totals) {
  const foot = dom("ingredient-total");
  clear(foot);
  const row = document.createElement("tr");

  if (!totals) {
    // colSpan rather than blank cells, so there is no column of zeros to misread.
    const refusal = cell(
      "th",
      "Total withheld: an ingredient is incomplete",
      "refusal",
    );
    refusal.colSpan = 7;
    row.appendChild(refusal);
    foot.appendChild(row);
    return;
  }

  row.appendChild(cell("th", "Total", "name"));
  row.appendChild(cell("td", amount(totals.grams)));
  for (const [, key] of MACRO_ROWS)
    row.appendChild(cell("td", amount(totals[key])));
  row.appendChild(cell("td", ""));
  foot.appendChild(row);
}

function renderSummary(totals, servings) {
  const table = dom("summary");
  const body = dom("summary-rows");
  clear(body);

  if (!totals) {
    table.hidden = true;
    return;
  }

  for (const [label, key] of MACRO_ROWS) {
    const row = document.createElement("tr");
    row.appendChild(cell("th", label, "name"));
    row.appendChild(cell("td", amount(totals[key])));
    row.appendChild(cell("td", amount(perServing(totals[key], servings))));
    row.appendChild(cell("td", amount(per100g(totals[key], totals.grams))));
    body.appendChild(row);
  }
  table.hidden = false;
}

function renderNotes(notes) {
  const section = dom("notes");
  dom("notes-body").textContent = notes;
  section.hidden = false;
}

/**
 * Draw a QR of the current address.
 */
function renderQrCode(url) {
  const section = dom("qr");
  const holder = dom("qr-code");
  clear(holder);

  let symbol;
  try {
    symbol = encodeQr(url);
  } catch {
    section.hidden = true;
    return;
  }

  const span = symbol.size + 8;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${span} ${span}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code that opens this recipe");

  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("width", String(span));
  background.setAttribute("height", String(span));

  const dark = document.createElementNS(SVG_NS, "path");
  dark.setAttribute("d", qrPath(symbol, 4));

  svg.append(background, dark);
  holder.appendChild(svg);
  section.hidden = false;
}

/** The serving count the reader is currently looking at. */
function currentServings(fallback) {
  const requested = Number.parseInt(dom("servings").value, 10);
  return Number.isFinite(requested) && requested >= 1 ? requested : fallback;
}

/**
 * Hand the recipe over as a YAML file the recipes CLI can read.
 */
async function downloadYaml(recipe) {
  const text = recipeYaml(recipe, currentServings(recipe.servings));
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/yaml;charset=utf-8" }),
  );

  const link = document.createElement("a");
  link.href = url;
  link.download = await recipeFilename(exportName(recipe));

  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Re-render everything that depends on the serving count. */
function applyServings(totals, servings) {
  dom("servings-print").textContent = String(servings);
  renderSummary(totals, servings);

  dom("controls").hidden = false;
  dom("servings-line").hidden = !totals;
  dom("export").hidden = !totals;
}

function renderRecipe(recipe) {
  currentRecipe = recipe;
  document.title = recipe.name || "Recipe";
  dom("recipe-name").textContent = recipe.name || "Recipe";

  const nameInput = dom("recipe-name-input");
  nameInput.value = recipe.name || "";
  const tagsInput = dom("tags-input");
  tagsInput.value = (recipe.tags || []).join(", ");
  const notesInput = dom("notes-input");
  notesInput.value = recipe.notes || "";

  if (recipe.problems.length) {
    showProblems(recipe.problems);
  } else {
    dom("alert").hidden = true;
  }

  const empty = renderEmptyState(recipe);

  // Opening a recipe is for viewing, so a recipe that has something to show
  // starts collapsed. This is the only place that collapses, and it runs only
  // when a different recipe arrives, never on an edit.
  if (!empty) dom("editor-tools").open = false;

  const totals = empty ? null : recipeTotals(recipe);
  renderIngredients(recipe);
  renderIngredientTotal(totals);
  renderNotes(recipe.notes);
  if (readFragment(window.location.hash)) {
    renderQrCode(window.location.href);
  } else {
    clear(dom("qr-code"));
    dom("qr").hidden = true;
  }
  dom("recipe").hidden = false;

  const input = dom("servings");
  input.value = String(recipe.servings);
  input.oninput = () => {
    applyServings(totals, currentServings(1));
  };

  dom("download").onclick = async () => {
    try {
      await downloadYaml(currentRecipe || recipe);
    } catch (reason) {
      dom("download-hint").textContent = String(reason.message ?? reason);
    }
  };

  applyServings(totals, recipe.servings);
}

function setupEditorEvents() {
  const nameInput = dom("recipe-name-input");
  nameInput.addEventListener("input", () => {
    if (currentRecipe) {
      currentRecipe.name = nameInput.value;
      dom("recipe-name").textContent = currentRecipe.name || "Recipe";
      document.title = currentRecipe.name || "Recipe";
      void syncShareLink();
    }
  });

  const tagsInput = dom("tags-input");
  tagsInput.addEventListener("input", () => {
    if (currentRecipe) {
      currentRecipe.tags = tagsInput.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      void syncShareLink();
    }
  });

  const notesInput = dom("notes-input");
  notesInput.addEventListener("input", () => {
    if (currentRecipe) {
      currentRecipe.notes = notesInput.value;
      dom("notes-body").textContent = currentRecipe.notes;
      void syncShareLink();
    }
  });

  const servingsInput = dom("servings");
  servingsInput.addEventListener("input", () => {
    if (currentRecipe) {
      currentRecipe.servings = currentServings(1);
      void syncShareLink();
      const totals =
        currentRecipe.ingredients.length === 0
          ? null
          : recipeTotals(currentRecipe);
      applyServings(totals, currentRecipe.servings);
    }
  });

  // Product Search
  const searchInput = dom("product-search-input");
  const searchBtn = dom("product-search-btn");
  const searchRemote = dom("product-search-remote");
  const searchResults = dom("product-search-results");

  async function performSearch() {
    const q = searchInput.value.trim();
    if (!q) {
      clear(searchResults);
      return;
    }
    try {
      const results = await searchProducts(q, searchRemote.checked);
      clear(searchResults);
      if (results.length === 0) {
        searchResults.appendChild(cell("li", `No products match "${q}"`));
        return;
      }
      for (const item of results) {
        const li = document.createElement("li");
        const title = item.brand
          ? `${item.name} (${item.brand})`
          : item.name;
        const macroInfo = item.macros
          ? ` — ${item.macros.kcal} kcal, ${item.macros.protein}g P`
          : "";
        const span = cell("span", `${title}${macroInfo}`);
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.textContent = "Add";
        addBtn.addEventListener("click", () => {
          if (!currentRecipe) return;
          const ing = {
            name: item.name,
            source: item.source || "manual",
            id: String(item.id ?? ""),
            grams: 100,
            per100: {
              kcal: item.macros ? item.macros.kcal : null,
              protein: item.macros ? item.macros.protein : null,
              fat: item.macros ? item.macros.fat : null,
              carbs: item.macros ? item.macros.carbs : null,
            },
            missing: [],
          };
          updateIngredientMissing(ing);
          currentRecipe.ingredients.push(ing);
          void syncShareLink();
          renderIngredients(currentRecipe);
          updateProblemsAndTotals();
        });
        li.append(span, addBtn);
        searchResults.appendChild(li);
      }
    } catch (err) {
      clear(searchResults);
      searchResults.appendChild(cell("li", `Search error: ${err.message}`));
    }
  }

  searchBtn.addEventListener("click", performSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performSearch();
    }
  });

  // Manual Ingredient
  dom("manual-add-btn").addEventListener("click", () => {
    if (!currentRecipe) return;
    const name = dom("manual-name").value.trim() || "Manual Ingredient";
    const grams = parseFloat(dom("manual-grams").value);
    const kcal = parseFloat(dom("manual-kcal").value);
    const protein = parseFloat(dom("manual-protein").value);
    const carbs = parseFloat(dom("manual-carbs").value);
    const fat = parseFloat(dom("manual-fat").value);

    const ing = {
      name,
      source: "manual",
      id: "",
      grams: Number.isFinite(grams) && grams > 0 ? grams : null,
      per100: {
        kcal: Number.isFinite(kcal) ? kcal : null,
        protein: Number.isFinite(protein) ? protein : null,
        fat: Number.isFinite(fat) ? fat : null,
        carbs: Number.isFinite(carbs) ? carbs : null,
      },
      missing: [],
    };
    updateIngredientMissing(ing);
    currentRecipe.ingredients.push(ing);
    void syncShareLink();

    dom("manual-name").value = "";
    dom("manual-grams").value = "";
    dom("manual-kcal").value = "";
    dom("manual-protein").value = "";
    dom("manual-carbs").value = "";
    dom("manual-fat").value = "";

    renderIngredients(currentRecipe);
    updateProblemsAndTotals();
  });

  // Save recipe
  dom("save-recipe-btn").addEventListener("click", async () => {
    if (!currentRecipe) return;
    const statusSpan = dom("save-status");
    statusSpan.textContent = "Saving...";
    try {
      const res = await saveRecipe(
        currentRecipe.name,
        recipeToApi(currentRecipe),
      );
      if (res.ok) {
        statusSpan.textContent = "Saved";
        dom("alert").hidden = true;
        setTimeout(() => {
          if (statusSpan.textContent === "Saved") statusSpan.textContent = "";
        }, 3000);
        await refreshRecipeSelect(currentRecipe.name);
      } else {
        statusSpan.textContent = "Error saving";
        showProblems(res.errors || [res.error?.message || "Save rejected"]);
      }
    } catch (err) {
      statusSpan.textContent = "Error";
      showProblems([err.message]);
    }
  });

  // Recipe select dropdown
  dom("recipe-select").addEventListener("change", async (e) => {
    const name = e.target.value;
    if (!name) return;
    try {
      const data = await fetchRecipe(name);
      renderRecipe(recipeFromApi(data));
      void syncShareLink();
    } catch (err) {
      showFailure(err);
    }
  });
}

async function refreshRecipeSelect(selectedName) {
  const select = dom("recipe-select");
  clear(select);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "(Choose stored recipe)";
  select.appendChild(placeholder);

  try {
    const candidates = await fetchRecipes();
    for (const c of candidates) {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = c.name;
      if (selectedName && c.name === selectedName) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
  } catch {
    // Stored list optional
  }
}

async function loadServed() {
  for (const element of document.querySelectorAll(".server-only")) {
    element.hidden = false;
  }
  dom("editor-nav").hidden = false;
  dom("editor-tools").hidden = false;
  dom("notes-edit").hidden = false;
  setupEditorEvents();

  const encoded = readFragment(window.location.hash);
  if (encoded) {
    try {
      renderRecipe(readRecipe(await decodePayload(encoded)));
      await refreshRecipeSelect();
      return;
    } catch {
      // Fall through to stored recipe
    }
  }

  await refreshRecipeSelect();
  try {
    const candidates = await fetchRecipes();
    if (candidates.length > 0) {
      const data = await fetchRecipe(candidates[0].name);
      renderRecipe(recipeFromApi(data));
      dom("recipe-select").value = candidates[0].name;
    } else {
      renderRecipe(blankRecipe());
    }
  } catch (err) {
    showFailure(err);
  }
}

async function loadStatic() {
  dom("editor-nav").hidden = false;
  dom("editor-tools").hidden = false;
  dom("notes-edit").hidden = false;
  setupEditorEvents();

  const encoded = readFragment(window.location.hash);
  if (!encoded) {
    renderRecipe(blankRecipe());
    return;
  }

  try {
    renderRecipe(readRecipe(await decodePayload(encoded)));
  } catch (reason) {
    showFailure(reason instanceof Error ? reason : new Error(String(reason)));
  }
}

async function init() {
  const health = await checkHealth();
  if (health) {
    await loadServed();
  } else {
    await loadStatic();
  }
}

await init();

// Pasting a different link into the same tab should just work.
window.addEventListener("hashchange", () => window.location.reload());
