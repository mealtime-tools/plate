// The self-hosted index: an API over a directory of recipe files, and the
// handful of static files the page needs.
//
// The directory is read on every request, not at startup, because the point of
// the page is that a recipe saved a moment ago is already on it. Tens of small
// files make that scan free, which is the bet the Python tools make too.
//
// Read-only by construction: nothing here writes, so a deployment can mount the
// collection read-only and a browser cannot damage private data.

import { join } from "node:path";

import { CollectionError, readCollection } from "./collection.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

// An allowlist, for the same reason `pages.yml` copies a file list rather than
// the tree: the document root is a git checkout, and this way a stray file --
// or `.git` -- is never one path away from being served.
const FILES = new Map([
  ["/", "hub/index.html"],
  ["/view", "index.html"],
  ["/index.html", "index.html"],
  ["/style.css", "style.css"],
  ["/app.mjs", "app.mjs"],
  ["/recipe.mjs", "recipe.mjs"],
  ["/nutrients.json", "nutrients.json"],
  ["/hub/hub.css", "hub/hub.css"],
  ["/hub/app.mjs", "hub/app.mjs"],
  ["/hub/catalogue.mjs", "hub/catalogue.mjs"],
]);

const API = "/api/recipes";

// Where a recipe can be read by someone who is not on this network. The
// fragment is the whole recipe, so a public link is this deployment's link
// under another origin; only the origin has to be configured.
const PUBLIC_VIEWER = "https://mealtime-tools.github.io/plate/";

/** Private data on a LAN address: never let a proxy hold a copy. */
const NO_STORE = { "Cache-Control": "no-store" };

function json(body, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The collection as the page wants it, or the refusal that stopped it. */
async function listing(directory, bases) {
  try {
    return json({ ...bases, recipes: await readCollection(directory) });
  } catch (error) {
    // One unreadable file refuses the whole directory rather than quietly
    // serving a short list, so the refusal is what the page shows.
    if (!(error instanceof CollectionError)) throw error;

    console.error(`unreadable collection dir=${directory}: ${error.message}`);
    return json({ error: error.message }, 500);
  }
}

/** The server, bound but for the caller to stop. `port: 0` picks one. */
export function serve({
  directory,
  viewer = "/view",
  publicViewer = PUBLIC_VIEWER,
  port = 8080,
  hostname = "0.0.0.0",
}) {
  return Bun.serve({
    port,
    hostname,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === API) return listing(directory, { viewer, publicViewer });

      const file = FILES.get(pathname);
      if (!file) return new Response("not found\n", { status: 404 });

      return new Response(Bun.file(join(ROOT, file)), { headers: NO_STORE });
    },
  });
}

if (import.meta.main) {
  const directory =
    process.env.RECIPES_DIR ?? join(process.env.HOME ?? "", ".config/recipes");

  // Said once at startup: a missing mount otherwise reads as "no recipes".
  const { readdir } = await import("node:fs/promises");
  await readdir(directory).catch(() =>
    console.warn(`recipe directory absent: ${directory}`),
  );

  const server = serve({
    directory,
    viewer: process.env.VIEWER_URL || "/view",
    publicViewer: process.env.PUBLIC_VIEWER_URL || PUBLIC_VIEWER,
    port: Number(process.env.PORT ?? 8080),
    hostname: process.env.HOST ?? "0.0.0.0",
  });
  console.log(`serving ${directory} on ${server.url}`);
}
