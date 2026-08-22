import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { deflateRawSync } from "node:zlib";

import { serve } from "./serve.mjs";

const PAYLOADS = {
  empty: { v: 1 },
  minimal: {
    v: 1,
    n: "Toast",
    i: [["Sourdough", 60, 258.0, 9.1, 2.1, 47.5]],
  },
  "servings-and-notes": {
    v: 1,
    n: "Sourdough Pizza",
    s: 2,
    t: "Stretch cold, from the edges.\nBake 8 min at max heat.",
    i: [
      ["Pizza Dough", 475, 268.0, 8.9, 3.1, 49.2],
      ["Passata", 100, 34.0, 1.6, 0.2, 6.4],
      ["Mozzarella", 75, 280.0, 22.0, 21.0, 1.5],
    ],
  },
  unicode: {
    v: 1,
    n: "Café Crème Brûlée",
    i: [["Crème fraîche", 120, 292.0, 2.4, 30.0, 2.9]],
  },
};

const encoded = (label) => fragment(PAYLOADS[label]);

/**
 * playwright-core is a devDependency and nothing more: the page has no
 * dependencies and no build step, and none of this reaches it.
 *
 * Resolved from this directory's own node_modules, and only there: `npm ci` is
 * the way in. It used to fall back to sibling checkouts, which broke the moment
 * those were archived. A dependency on a neighbour is not a dependency.
 */
function loadChromium() {
  const roots = ["playwright-core"];
  for (const root of roots) {
    try {
      const require = createRequire(new URL(root, import.meta.url));
      return require("playwright-core").chromium;
    } catch {
      // Try the next location.
    }
  }
  // Thrown, never skipped: these are the only tests that exercise the page in
  // a real browser, and a green run that silently skipped them would be a
  // worse outcome than a red one.
  throw new Error(
    "playwright-core not found; run `npm ci` in this directory",
  );
}

/** Build a share fragment the way the Python `recipes share` command does. */
function fragment(payload) {
  const json = JSON.stringify(payload);
  return deflateRawSync(Buffer.from(json, "utf8"), { level: 9 })
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let site;
let browser;

before(async () => {
  site = await serve(new URL("..", import.meta.url).pathname);
  browser = await loadChromium().launch();
});

after(async () => {
  await browser?.close();
  await site?.close();
});

/**
 * Open the page and collect everything that would make it fail silently:
 * uncaught errors, console errors, and any request that leaves this origin.
 */
async function open(hash) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const offsite = [];

  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    const loc = message.location();
    const url = (loc && loc.url) || "";
    if (
      message.type() === "error" &&
      !url.includes("/api/health") &&
      !message.text().includes("/api/health")
    ) {
      errors.push(message.text());
    }
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(site.origin)) offsite.push(request.url());
  });

  await page.goto(`${site.origin}/${hash}`);
  await page.waitForFunction(
    () =>
      !document.getElementById("alert").hidden ||
      !document.getElementById("recipe").hidden,
  );

  return { page, errors, offsite };
}

const cells = (locator) =>
  locator.evaluateAll((nodes) => nodes.map((node) => node.textContent));

test("a share payload renders its recipe, ingredients and totals", async () => {
  const { page, errors, offsite } = await open(
    `#r=${encoded("servings-and-notes")}`,
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(
    offsite,
    [],
    "the page must not talk to anything but its own origin",
  );

  assert.equal(await page.title(), "Sourdough Pizza");
  assert.equal(
    await page.locator("#recipe-name").textContent(),
    "Sourdough Pizza",
  );
  assert.equal(await page.locator("#ingredient-rows tr").count(), 3);
  assert.ok(
    await page.locator("#alert").isHidden(),
    "a complete recipe raises no alert",
  );

  // 475 g at 268 kcal/100 g + 100 g at 34 + 75 g at 280 = 1517.0 kcal.
  assert.deepEqual(await cells(page.locator("#ingredient-total td")), [
    "650.0",
    "1517.0",
    "60.4",
    "241.2",
    "30.7",
    "",
  ]);

  // Notes keep their line breaks.
  assert.equal(
    await page.locator("#notes-body").textContent(),
    "Stretch cold, from the edges.\nBake 8 min at max heat.",
  );

  await page.close();
});

test("the static page composes and shares a recipe without an API", async () => {
  const { page, errors, offsite } = await open("");

  assert.deepEqual(errors, []);
  assert.deepEqual(offsite, []);
  assert.ok(await page.locator("#recipe").isVisible());
  assert.ok(await page.locator("#alert").isHidden());
  assert.ok(await page.locator("#editor-nav").isVisible());
  assert.ok(await page.locator("#editor-tools").isVisible());
  assert.ok(await page.locator(".manual-ingredient-panel").isVisible());
  assert.ok(await page.locator(".product-search-panel").isHidden());
  assert.ok(await page.locator("#recipe-select").isHidden());
  assert.ok(await page.locator("#save-recipe-btn").isHidden());
  assert.equal(await page.locator("#new-recipe-btn").count(), 0);
  assert.equal(await page.locator("#create-share-link").count(), 0);
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    "the editor must not overflow a 390 px viewport",
  );

  await page.locator("#recipe-name-input").fill("Toast");
  await page.locator("#tags-input").fill("breakfast, quick");
  await page.locator("#manual-name").fill("Sourdough");
  await page.locator("#manual-grams").fill("60");
  await page.locator("#manual-kcal").fill("258");
  await page.locator("#manual-protein").fill("9.1");
  await page.locator("#manual-carbs").fill("47.5");
  await page.locator("#manual-fat").fill("2.1");
  const hashBeforeIngredient = new URL(page.url()).hash;
  await page.locator("#manual-add-btn").click();
  await page.waitForFunction(
    (previous) => window.location.hash !== previous,
    hashBeforeIngredient,
  );

  assert.deepEqual(await cells(page.locator("#ingredient-total td")), [
    "60.0",
    "154.8",
    "5.5",
    "28.5",
    "1.3",
    "",
  ]);
  assert.ok(await page.locator("#export").isVisible());

  const sharedUrl = page.url();
  await page.goto(sharedUrl);
  await page.waitForFunction(
    () => !document.getElementById("recipe").hidden,
  );
  assert.equal(await page.locator("#recipe-name-input").inputValue(), "Toast");
  assert.equal(
    await page.locator("#tags-input").inputValue(),
    "breakfast, quick",
  );
  assert.equal(await page.locator("#ingredient-rows tr").count(), 1);

  // Several pending compressions must settle on the latest editor state.
  await page.evaluate(() => {
    const change = (id, values) => {
      const input = document.getElementById(id);
      for (const value of values) {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };
    change("recipe-name-input", ["T", "To", "Toast Supreme"]);
    change("tags-input", ["breakfast", "breakfast, quick, favourite"]);
  });
  await page.waitForFunction(async () => {
    const { recipeFromHash } = await import("./recipe.mjs");
    const recipe = await recipeFromHash(window.location.hash);
    return (
      recipe?.name === "Toast Supreme" &&
      recipe.tags.join(",") === "breakfast,quick,favourite"
    );
  });

  await page.close();
});

test("opening a recipe with ingredients keeps the editing tools collapsed", async () => {
  const { page, errors } = await open(`#r=${encoded("minimal")}`);

  assert.deepEqual(errors, []);
  assert.ok(
    await page.locator("#editor-tools").isVisible(),
    "the disclosure itself stays on the page",
  );
  assert.ok(
    await page.locator("#manual-name").isHidden(),
    "opening a recipe is for viewing: the data-entry grid starts closed",
  );

  await page.locator("#editor-tools summary").click();
  assert.ok(await page.locator("#manual-name").isVisible());

  await page.close();
});

test("a recipe with nothing to view opens the editing tools", async () => {
  for (const hash of [`#r=${encoded("empty")}`, ""]) {
    const { page, errors } = await open(hash);

    assert.deepEqual(errors, []);
    assert.ok(
      await page.locator("#manual-name").isVisible(),
      `an empty recipe must not be a dead end (${hash || "no hash"})`,
    );

    await page.close();
  }
});

test("the editing tools stay open while an ingredient is added", async () => {
  const { page, errors } = await open(`#r=${encoded("minimal")}`);

  await page.locator("#editor-tools summary").click();
  await page.locator("#manual-name").fill("Butter");
  await page.locator("#manual-grams").fill("10");
  await page.locator("#manual-kcal").fill("717");
  await page.locator("#manual-protein").fill("0.9");
  await page.locator("#manual-carbs").fill("0.1");
  await page.locator("#manual-fat").fill("81.1");
  const hashBeforeIngredient = new URL(page.url()).hash;
  await page.locator("#manual-add-btn").click();
  await page.waitForFunction(
    (previous) => window.location.hash !== previous,
    hashBeforeIngredient,
  );

  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#ingredient-rows tr").count(), 2);
  assert.ok(
    await page.locator("#manual-name").isVisible(),
    "adding an ingredient must not collapse the panel mid-edit",
  );

  await page.close();
});

test("the editing tools disclosure is operable by keyboard", async () => {
  const { page } = await open(`#r=${encoded("minimal")}`);

  const summary = page.locator("#editor-tools summary");
  await summary.focus();
  assert.ok(
    await page.evaluate(
      () =>
        document.activeElement ===
        document.querySelector("#editor-tools summary"),
    ),
    "the summary must be reachable by keyboard focus",
  );

  await page.keyboard.press("Enter");
  assert.ok(await page.locator("#manual-name").isVisible());
  await page.keyboard.press("Enter");
  assert.ok(await page.locator("#manual-name").isHidden());

  await page.close();
});

test("removing the last ingredient opens the editing tools", async () => {
  const { page, errors } = await open(`#r=${encoded("minimal")}`);

  assert.ok(
    await page.locator("#manual-name").isHidden(),
    "a recipe with an ingredient starts collapsed",
  );

  await page.locator(".remove-ingredient-btn").first().click();
  await page.waitForFunction(
    () => !document.getElementById("no-ingredients").hidden,
  );

  assert.deepEqual(errors, []);
  assert.ok(
    await page.locator("#manual-name").isVisible(),
    "emptying a recipe must not leave a collapsed panel and a dead end",
  );

  await page.close();
});

test("the two editing panels keep the gap between them", async () => {
  const { page } = await open(`#r=${encoded("minimal")}`);

  // Collapsed, the disclosure is its summary and nothing else: a flex gap
  // stranded under the closed control reads as unexplained dead space.
  const closed = await page.evaluate(() => {
    const tools = document.getElementById("editor-tools");
    return {
      tools: tools.getBoundingClientRect().height,
      summary: tools.querySelector("summary").getBoundingClientRect().height,
    };
  });
  assert.ok(
    Math.abs(closed.tools - closed.summary) < 1,
    `collapsed tools ${closed.tools}px should match summary ${closed.summary}px`,
  );

  // Both panels only ever show together in served mode, which is the only
  // place the gap between them is visible.
  const gap = await page.evaluate(() => {
    document.querySelector(".product-search-panel").hidden = false;
    document.getElementById("editor-tools").open = true;
    const search = document
      .querySelector(".product-search-panel")
      .getBoundingClientRect();
    const manual = document
      .querySelector(".manual-ingredient-panel")
      .getBoundingClientRect();
    return manual.top - search.bottom;
  });
  assert.ok(
    Math.abs(gap - 20) < 1,
    `the panels should stay 1.25rem apart, measured ${gap}px`,
  );

  await page.close();
});

test("a truncated fragment shows the error state and no total", async () => {
  const value = encoded("servings-and-notes");
  const { page, errors } = await open(`#r=${value.slice(0, 60)}`);

  assert.deepEqual(errors, [], "a bad link must not throw");
  assert.ok(await page.locator("#alert").isVisible());
  assert.ok(await page.locator("#recipe").isHidden());
  assert.equal(await page.locator("#ingredient-total td").count(), 0);
  assert.equal(await page.locator("#summary-rows tr").count(), 0);
  assert.match(
    await page.locator("#alert").innerText(),
    /truncated or corrupt/,
  );

  await page.close();
});

test("a garbage fragment shows the error state and no total", async () => {
  const { page, errors } = await open("#r=!!!!!!!!");

  assert.deepEqual(errors, []);
  assert.ok(await page.locator("#alert").isVisible());
  assert.ok(await page.locator("#recipe").isHidden());
  assert.equal(await page.locator("#summary-rows tr").count(), 0);

  await page.close();
});

test("an ingredient with a missing macro refuses to total", async () => {
  // The old page reported no error and silently left
  // 300 g of a 450 g recipe out of a confident-looking total.
  const encoded = fragment({
    v: 1,
    n: "Half A Recipe",
    i: [
      ["Pizza Dough", 300, 268.0, 8.9, 3.1, 49.2],
      ["Mystery Cheese", 150, null, 22.0, 21.0, 1.5],
    ],
  });
  const { page, errors } = await open(`#r=${encoded}`);

  assert.deepEqual(errors, []);
  assert.ok(
    await page.locator("#alert").isVisible(),
    "the refusal must be visible",
  );
  assert.match(
    await page.locator("#alert").innerText(),
    /Mystery Cheese is missing kcal/,
  );

  // The ingredients still render, so the reader can see what is there.
  assert.equal(await page.locator("#ingredient-rows tr").count(), 2);
  assert.equal(
    await page
      .locator("#ingredient-rows tr.incomplete .grams-input")
      .inputValue(),
    "150",
  );
  assert.deepEqual(
    await cells(
      page.locator(
        "#ingredient-rows tr.incomplete td:not(:first-of-type):not(:last-of-type)",
      ),
    ),
    ["—", "—", "—", "—"],
  );

  // No total, anywhere, in any form -- and specifically not a zero.
  assert.ok(await page.locator("#summary").isHidden());
  assert.equal(await page.locator("#summary-rows tr").count(), 0);
  const footer = await page.locator("#ingredient-total").innerText();
  assert.match(footer, /withheld/);
  assert.doesNotMatch(footer, /\d/);

  // The editor keeps servings available, but still refuses to show a total.
  assert.ok(await page.locator("#controls").isVisible());

  await page.close();
});

test("changing servings rescales the per-serving column and leaves the recipe total alone", async () => {
  const { page, errors } = await open(
    `#r=${encoded("servings-and-notes")}`,
  );

  const perServing = () =>
    cells(page.locator("#summary-rows tr td:nth-child(3)"));
  const wholeRecipe = () =>
    cells(page.locator("#summary-rows tr td:nth-child(2)"));

  assert.equal(await page.locator("#servings").inputValue(), "2");
  assert.deepEqual(await perServing(), ["758.5", "30.2", "120.6", "15.3"]);
  const before = await wholeRecipe();

  const originalHash = new URL(page.url()).hash;
  await page.locator("#servings").fill("4");
  await page.waitForFunction(
    (previous) => window.location.hash !== previous,
    originalHash,
  );
  assert.match(new URL(page.url()).hash, /^#r=./);
  assert.deepEqual(await perServing(), ["379.3", "15.1", "60.3", "7.7"]);

  await page.locator("#servings").fill("1");
  assert.deepEqual(await perServing(), ["1517.0", "60.4", "241.2", "30.7"]);

  // The whole-recipe column is a fact about the recipe, not about the reader.
  assert.deepEqual(await wholeRecipe(), before);
  assert.deepEqual(await cells(page.locator("#ingredient-total td")), [
    "650.0",
    "1517.0",
    "60.4",
    "241.2",
    "30.7",
    "",
  ]);

  assert.deepEqual(errors, []);
  await page.close();
});

test("a recipe with no name and no ingredients still renders", async () => {
  const { page, errors } = await open(`#r=${encoded("empty")}`);

  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#recipe-name").textContent(), "Recipe");
  assert.equal(await page.locator("#ingredient-rows tr").count(), 0);
  assert.ok(await page.locator("#notes").isVisible());
  assert.ok(await page.locator("#notes-edit").isVisible());

  // Nothing to total, so nothing is totalled -- not a table of zeros.
  assert.ok(await page.locator("#no-ingredients").isVisible());
  assert.ok(await page.locator("#ingredients-panel").isHidden());
  assert.ok(await page.locator("#summary").isHidden());

  await page.close();
});

test("unicode names survive the round trip", async () => {
  const { page, errors } = await open(`#r=${encoded("unicode")}`);

  assert.deepEqual(errors, []);
  assert.equal(
    await page.locator("#recipe-name").textContent(),
    "Café Crème Brûlée",
  );
  assert.equal(
    await page.locator("#ingredient-rows th.name").textContent(),
    "Crème fraîche",
  );

  await page.close();
});

test("a recipe name cannot inject markup", async () => {
  const encoded = fragment({
    v: 1,
    n: "<img src=x onerror=alert(1)>Toast",
    i: [],
  });
  const { page, errors } = await open(`#r=${encoded}`);

  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#recipe-name img").count(), 0);
  assert.equal(
    await page.locator("#recipe-name").textContent(),
    "<img src=x onerror=alert(1)>Toast",
  );

  await page.close();
});

test("the QR code is drawn locally and encodes the page address", async () => {
  const { page, offsite } = await open(`#r=${encoded("minimal")}`);

  assert.deepEqual(offsite, [], "a QR service would show up here");
  const viewBox = await page.locator("#qr svg").getAttribute("viewBox");

  // Modules plus the four-module quiet zone on each side; sizes are 4v+17.
  const [, , span] = viewBox.split(" ").map(Number);
  assert.equal((span - 8 - 17) % 4, 0);
  assert.ok(await page.locator("#qr path").getAttribute("d"));

  await page.close();
});

/** Click the download button and return the file the browser received. */
async function download(page) {
  const [received] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download").click(),
  ]);
  const path = await received.path();

  return {
    filename: received.suggestedFilename(),
    text: await readFile(path, "utf8"),
  };
}

test("the download hands over YAML and asks nobody for it", async () => {
  const { page, errors, offsite } = await open(
    `#r=${encoded("servings-and-notes")}`,
  );

  assert.ok(await page.locator("#export").isVisible());

  // The browser reports every CSP refusal here, so a policy that blocked the
  // blob would fail this test rather than showing up as a dead button.
  await page.evaluate(() => {
    window.violations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.violations.push(event.violatedDirective),
    );
  });

  const file = await download(page);
  assert.deepEqual(await page.evaluate(() => window.violations), []);

  // A Blob and an object URL: no request leaves the origin, and a CSP refusal
  // would land in `errors` as a console message.
  assert.deepEqual(offsite, []);
  assert.deepEqual(errors, []);

  assert.equal(file.filename, "sourdough-pizza-9e571e76.yaml");
  assert.match(file.text, /^# Exported from a recipe share link\./);
  // Exact substrings rather than patterns: the indentation is the contract.
  for (const expected of [
    "\nname: Sourdough Pizza\nservings: 2\n",
    "\nnotes: |-\n  Stretch cold, from the edges.\n  Bake 8 min at max heat.\n",
    "\n- grams: 475\n  name: Pizza Dough\n  macros:\n    kcal: 268.0\n",
  ]) {
    assert.ok(file.text.includes(expected), expected);
  }
  assert.doesNotMatch(file.text, /source:|id:/);

  await page.close();
});

test("the download carries the servings currently on screen", async () => {
  const { page } = await open(`#r=${encoded("servings-and-notes")}`);

  await page.locator("#servings").fill("6");
  const file = await download(page);

  assert.match(file.text, /\nservings: 6\n/);
  await page.close();
});

test("an incomplete recipe offers no export", async () => {
  const encoded = fragment({
    v: 1,
    n: "Half A Recipe",
    i: [
      ["Pizza Dough", 300, 268.0, 8.9, 3.1, 49.2],
      ["Mystery Cheese", 150, null, 22.0, 21.0, 1.5],
    ],
  });
  const { page, errors } = await open(`#r=${encoded}`);

  // A file with a silently missing macro would be saved and reused, so the page
  // withholds the file exactly as it withholds the total.
  assert.ok(await page.locator("#export").isHidden());
  assert.ok(await page.locator("#download").isHidden());
  assert.deepEqual(errors, []);

  await page.close();
});

test("a recipe with no ingredients offers no export", async () => {
  const { page } = await open(`#r=${encoded("empty")}`);

  assert.ok(await page.locator("#export").isHidden());
  await page.close();
});

test("the print stylesheet hides the controls and shows the serving count as text", async () => {
  const { page } = await open(`#r=${encoded("servings-and-notes")}`);

  await page.emulateMedia({ media: "print" });
  assert.ok(await page.locator("#controls").isHidden());
  // A button on paper is furniture, so the export goes with the controls.
  assert.ok(await page.locator("#export").isHidden());
  assert.equal(await page.locator("#servings-print").textContent(), "2");
  assert.ok(await page.locator("#summary").isVisible());
  assert.ok(await page.locator("#qr svg").isVisible());

  await page.close();
});

test("the content security policy forbids everything the old page allowed", async () => {
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const policy = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)[1];

  assert.match(policy, /default-src 'none'/);
  for (const host of [
    "unpkg",
    "gstatic",
    "jsdelivr",
    "qrserver",
    "usda",
    "http:",
    "https:",
  ]) {
    assert.doesNotMatch(
      policy,
      new RegExp(host),
      `${host} must not be reachable`,
    );
  }
  for (const unsafe of ["unsafe-inline", "unsafe-eval"]) {
    assert.doesNotMatch(policy, new RegExp(unsafe));
  }
});
