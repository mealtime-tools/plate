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
} from "./recipe.mjs";

const MACROS = [
  ["Energy (kcal)", "kcal"],
  ["Protein (g)", "protein"],
  ["Carbs (g)", "carbs"],
  ["Fat (g)", "fat"],
];

const dom = (id) => document.getElementById(id);
const clear = (node) => node.replaceChildren();
let recipe;
let revision = 0;

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

function textCell(tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function display(value) {
  return value === null || value === undefined ? "—" : value.toFixed(1);
}

function updateMissing(ingredient) {
  const missing = [];
  if (!Number.isFinite(ingredient.grams) || ingredient.grams <= 0) {
    missing.push("grams");
  }
  for (const [, key] of MACROS) {
    if (!Number.isFinite(ingredient[key])) missing.push(key);
  }
  ingredient.missing = missing;
}

function updateProblems() {
  for (const ingredient of recipe.ingredients) updateMissing(ingredient);
  recipe.problems = recipe.ingredients
    .filter((ingredient) => ingredient.missing.length)
    .map(
      (ingredient) =>
        `${ingredient.name} is missing ${ingredient.missing.join(", ")}.`,
    );
}

async function updateShareLink() {
  const current = ++revision;
  try {
    const encoded = await encodePayload(recipeToPayload(recipe));
    if (current !== revision) return;
    const url = new URL(window.location.href);
    url.hash = `r=${encoded}`;
    window.history.replaceState(null, "", url);
  } catch (error) {
    showAlert([`Could not update the share link: ${error.message}`]);
  }
}

function showAlert(problems) {
  const alert = dom("alert");
  if (!problems.length) {
    alert.hidden = true;
    return;
  }

  dom("alert-title").textContent = "This recipe is incomplete";
  clear(dom("alert-list"));
  for (const problem of problems) {
    dom("alert-list").appendChild(textCell("li", problem));
  }
  dom("alert-note").textContent = "No total is shown for missing data.";
  alert.hidden = false;
}

function renderRows() {
  const body = dom("ingredient-rows");
  clear(body);

  recipe.ingredients.forEach((ingredient, index) => {
    const row = document.createElement("tr");
    const scaled = scaleIngredient(ingredient);
    if (!scaled) row.className = "incomplete";
    row.appendChild(textCell("th", ingredient.name, "name"));

    const gramsCell = document.createElement("td");
    const grams = document.createElement("input");
    grams.type = "number";
    grams.min = "0";
    grams.step = "any";
    grams.className = "grams-input";
    grams.value = ingredient.grams ?? "";
    grams.addEventListener("input", () => {
      const value = Number(grams.value);
      const previous = ingredient.grams;
      if (previous > 0 && value > 0) {
        for (const [, key] of MACROS) {
          ingredient[key] *= value / previous;
        }
      }
      ingredient.grams = grams.value && Number.isFinite(value) ? value : null;
      refresh();
      void updateShareLink();
    });
    gramsCell.appendChild(grams);
    row.appendChild(gramsCell);

    for (const [, key] of MACROS) {
      row.appendChild(textCell("td", display(scaled?.[key])));
    }

    const action = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-ingredient-btn";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${ingredient.name}`);
    remove.addEventListener("click", () => {
      recipe.ingredients.splice(index, 1);
      refresh();
      void updateShareLink();
    });
    action.className = "action-cell";
    action.appendChild(remove);
    row.appendChild(action);
    body.appendChild(row);
  });
}

function renderTotals() {
  const totals = recipe.ingredients.length ? recipeTotals(recipe) : null;
  const foot = dom("ingredient-total");
  clear(foot);
  const row = document.createElement("tr");

  if (totals) {
    row.appendChild(textCell("th", "Total", "name"));
    row.appendChild(textCell("td", display(totals.grams)));
    for (const [, key] of MACROS) {
      row.appendChild(textCell("td", display(totals[key])));
    }
    row.appendChild(textCell("td", ""));
  } else {
    const label = textCell(
      "th",
      recipe.ingredients.length ? "Total unavailable" : "No ingredients",
      "refusal",
    );
    label.colSpan = 7;
    row.appendChild(label);
  }
  foot.appendChild(row);

  const summary = dom("summary");
  const body = dom("summary-rows");
  clear(body);
  summary.hidden = !totals;
  if (!totals) return;

  for (const [label, key] of MACROS) {
    const macroRow = document.createElement("tr");
    macroRow.appendChild(textCell("th", label, "name"));
    macroRow.appendChild(textCell("td", display(totals[key])));
    macroRow.appendChild(
      textCell("td", display(perServing(totals[key], recipe.servings))),
    );
    macroRow.appendChild(
      textCell("td", display(per100g(totals[key], totals.grams))),
    );
    body.appendChild(macroRow);
  }
}

function refresh() {
  updateProblems();
  showAlert(recipe.problems);
  dom("no-ingredients").hidden = recipe.ingredients.length !== 0;
  dom("ingredients-panel").hidden = recipe.ingredients.length === 0;
  renderRows();
  renderTotals();
}

function render() {
  document.title = recipe.name || "Recipe";
  dom("recipe-name").textContent = recipe.name || "Recipe";
  dom("recipe-name-input").value = recipe.name;
  dom("tags-input").value = recipe.tags.join(", ");
  dom("servings").value = recipe.servings;
  dom("servings-print").textContent = recipe.servings;
  dom("notes-input").value = recipe.notes;
  dom("notes-body").textContent = recipe.notes;
  dom("editor-nav").hidden = false;
  dom("editor-tools").hidden = false;
  dom("notes-edit").hidden = false;
  dom("recipe").hidden = false;
  refresh();
}

function bindEditor() {
  dom("recipe-name-input").addEventListener("input", (event) => {
    recipe.name = event.target.value;
    dom("recipe-name").textContent = recipe.name || "Recipe";
    document.title = recipe.name || "Recipe";
    void updateShareLink();
  });
  dom("tags-input").addEventListener("input", (event) => {
    recipe.tags = event.target.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    void updateShareLink();
  });
  dom("notes-input").addEventListener("input", (event) => {
    recipe.notes = event.target.value;
    dom("notes-body").textContent = recipe.notes;
    void updateShareLink();
  });
  dom("servings").addEventListener("input", (event) => {
    const value = Number.parseInt(event.target.value, 10);
    recipe.servings = Number.isFinite(value) && value > 0 ? value : 1;
    dom("servings-print").textContent = recipe.servings;
    renderTotals();
    void updateShareLink();
  });
  dom("manual-add-btn").addEventListener("click", () => {
    const number = (id) => {
      const input = dom(id);
      const value = Number(input.value);
      return input.value && Number.isFinite(value) ? value : null;
    };
    recipe.ingredients.push({
      name: dom("manual-name").value.trim() || "Ingredient",
      grams: number("manual-grams") ?? 100,
      kcal: number("manual-kcal"),
      protein: number("manual-protein"),
      carbs: number("manual-carbs"),
      fat: number("manual-fat"),
      missing: [],
    });
    for (const id of [
      "manual-name",
      "manual-grams",
      "manual-kcal",
      "manual-protein",
      "manual-carbs",
      "manual-fat",
    ]) {
      dom(id).value = "";
    }
    refresh();
    void updateShareLink();
  });
}

async function load() {
  bindEditor();
  const encoded = readFragment(window.location.hash);
  if (!encoded) {
    recipe = blankRecipe();
    render();
    return;
  }

  try {
    recipe = readRecipe(await decodePayload(encoded));
    render();
  } catch (error) {
    recipe = blankRecipe();
    render();
    showAlert([error.message]);
  }
}

await load();
