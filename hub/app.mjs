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

const SVG = "http://www.w3.org/2000/svg";

// The conventional "opens elsewhere" mark: a pane with an arrow leaving its
// top-right corner, which is what these links do -- another origin, another
// tab. Drawn here rather than fetched, because `default-src 'none'` blocks an
// icon file and because vendoring someone's artwork would put an attribution
// requirement on a repository that ships no third-party runtime assets.
// Stroked in `currentColor`, so one glyph follows the row's colour in both
// schemes, and hidden from assistive technology, which reads the link's own
// label instead.
const EXTERNAL = [
  "M9 3H4.6A1.6 1.6 0 0 0 3 4.6v6.8A1.6 1.6 0 0 0 4.6 13h6.8A1.6 1.6 0 0 0 13 11.4V7",
  "M10 3h3v3",
  "M13 3 8.4 7.6",
];

/** The link glyph, as an inline SVG that inherits the text colour. */
function externalIcon() {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");

  for (const d of EXTERNAL) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
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

  // An anchor, not a copy button: right-click copies it, a phone's long-press
  // offers to share it, and the browser needs no help from us to do either.
  // Last in the row and fixed width, so a long name cannot shunt it out of line.
  if (entry.publicUrl) {
    const share = element("a", "share");
    share.append(externalIcon());
    share.href = entry.publicUrl;
    share.target = "_blank";
    share.title = "Public link";
    share.setAttribute("aria-label", `Public link to ${entry.name}`);
    item.append(share);
  }

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

  const groups = await groupByCategory(payload.recipes, {
    viewer: payload.viewer,
    publicViewer: payload.publicViewer,
  });
  const total = groups.reduce((count, item) => count + item.entries.length, 0);

  document.getElementById("total").textContent = String(total);
  document.getElementById("empty").hidden = total > 0;

  const root = document.getElementById("categories");
  for (const item of groups) root.append(group(item));
}

main();
