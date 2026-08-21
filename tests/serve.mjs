// Static file server for tests and for eyeballing the page locally.
//
// It exists because `python3 -m http.server` serves .mjs as octet-stream on some
// systems, and a module served with the wrong type never loads.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** Serve `root` on an ephemeral port. Returns `{origin, close}`. */
export async function serve(root) {
  const server = createServer(async (request, response) => {
    // Strip the query and refuse traversal before touching the filesystem.
    const path = normalize(
      decodeURIComponent(new URL(request.url, "http://x").pathname),
    );
    if (path.includes("..")) {
      response.writeHead(403).end();
      return;
    }

    const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// `node tests/serve.mjs` runs it directly for a manual look.
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL("..", import.meta.url).pathname;
  const { origin } = await serve(root);
  console.log(`serving ${root} at ${origin}/`);
}
