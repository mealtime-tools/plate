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

// The conventional "opens elsewhere" mark, and it is three strokes: a box with
// its top-right corner missing, and an arrow leaving through the gap. The
// arrowhead's two barbs run parallel to the box edges the gap removed, so the
// head reads as the corner that is not there.
// Left and bottom edges run the box's full 6; top and right stop at 4.5, three
// quarters of them, which is what opens the corner wide enough to read. The
// shaft bisects that gap, and the head's barbs are parallel to the two edges
// the gap removed, so the head reads as the corner that is not there.
const EXTERNAL = [
  "M9.5 8v4.5a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1H7",
  "M7.5 7.5 12.5 2.5",
  "M9.5 2.5h3v3",
];

/** The link glyph, as an inline SVG that inherits the text colour. */
function externalIcon() {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  // currentColor, so one glyph follows the row's colour in both schemes.
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  // Hidden from assistive technology: the link's own label is its name.
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
