// The index page: fetch the collection, group it, build the rows.
//
// DOM only. Every figure and every href comes from catalogue.mjs, which gets
// them from the viewer's own codec, so nothing here computes anything about a
// recipe. Built with createElement rather than innerHTML: a recipe name is
// user data, and the CSP cannot help with markup this page assembles itself.

import { groupByCategory } from "./catalogue.mjs";

const API = "/api/recipes";

/** One element, with text and a class already set. */
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The servings-and-figures line, or the reason there is none. */
function meta(entry) {
  const servings = `${entry.servings} serving${entry.servings === 1 ? "" : "s"}`;
  const node = element("span", "meta", `${servings} · `);

  if (entry.kcal === null) {
    node.append(element("span", "pending", "unresolved"));
    return node;
  }

  // One decimal, the precision the viewer's own summary prints, so a row and
  // the page it links to cannot show the same recipe two ways.
  const figures = [
    `${Math.round(entry.kcal)} kcal`,
    `P ${entry.protein.toFixed(1)}`,
    `F ${entry.fat.toFixed(1)}`,
    `C ${entry.carbs.toFixed(1)}`,
  ];
  node.append(element("span", "macros", figures.join(" · ")));
  return node;
}

/** One recipe row. Only a resolved recipe gets a link. */
function row(entry) {
  const item = document.createElement("li");

  if (entry.url) {
    const link = element("a", "name", entry.name);
    link.href = entry.url;
    // A new tab, because the index is a browse view: cooking from one recipe
    // should not cost the list you found it in.
    link.target = "_blank";
    item.append(link);
  } else {
    item.append(element("span", "name", entry.name));
  }

  item.append(meta(entry));
  return item;
}

/** One category: a heading with its count, and the rows under it. */
function group(item) {
  const outer = document.createElement("li");
  const heading = element("h2", null, item.label);
  heading.append(element("span", "count", String(item.entries.length)));

  const list = document.createElement("ul");
  for (const entry of item.entries) list.append(row(entry));

  outer.append(heading, list);
  return outer;
}

/** Say what went wrong, in the place the viewer says it. */
function refuse(message) {
  const alert = document.getElementById("alert");
  document.getElementById("alert-body").textContent = message;
  alert.hidden = false;
}

async function main() {
  let payload;
  try {
    const response = await fetch(API);
    payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? response.statusText);
  } catch (error) {
    refuse(String(error.message ?? error));
    return;
  }

  const groups = await groupByCategory(payload.recipes, payload.viewer);
  const total = groups.reduce((count, item) => count + item.entries.length, 0);

  document.getElementById("total").textContent = String(total);
  document.getElementById("empty").hidden = total > 0;

  const root = document.getElementById("categories");
  for (const item of groups) root.append(group(item));
}

main();
