import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { encodeQr, qrPath } from "../qr.mjs";

// Golden matrices come from Nayuki's qrcodegen, the reference implementation.
// Comparing whole symbols is the only cheap way to know an encoder is right: a
// wrong mask or a single mis-placed codeword still renders as a plausible QR.
//
// segno was tried first and rejected as the oracle: its write_padding_bits does
// `[0] * (8 - length % 8)`, which appends a spurious all-zero codeword whenever
// the stream is already byte-aligned -- and in byte mode it always is. The
// symbols still scan, but they are not what ISO/IEC 18004 7.4.10 describes.
const GOLDEN = JSON.parse(
  await readFile(new URL("./qr-golden.json", import.meta.url), "utf8"),
);

function rows(symbol) {
  const out = [];
  for (let row = 0; row < symbol.size; row++) {
    out.push(
      [
        ...symbol.modules.subarray(row * symbol.size, (row + 1) * symbol.size),
      ].join(""),
    );
  }
  return out;
}

for (const [label, expected] of Object.entries(GOLDEN.auto)) {
  test(`"${label}" matches the reference encoder including the auto-chosen mask`, () => {
    const symbol = encodeQr(expected.data);

    assert.equal(symbol.version, expected.version);
    assert.equal(symbol.mask, expected.mask);
    assert.deepEqual(rows(symbol), expected.matrix);
  });
}

for (const [mask, expected] of Object.entries(GOLDEN.masks.byMask)) {
  test(`mask ${mask} is applied exactly as the reference encoder applies it`, () => {
    const symbol = encodeQr(GOLDEN.masks.data, { mask: Number(mask) });

    assert.equal(symbol.version, expected.version);
    assert.deepEqual(rows(symbol), expected.matrix);
  });
}

test("a share-length URL still fits a scannable version", () => {
  // README.md records an 11-ingredient recipe at 652 base64url characters and
  // claims version 18; this pins that claim to the encoder.
  const symbol = encodeQr(`https://recipes.example.org/#r=${"A".repeat(652)}`);

  assert.equal(symbol.version, 18);
  assert.equal(symbol.size, 89);
});

test("the SVG path carries one square per dark module, offset by the quiet zone", () => {
  const symbol = encodeQr("HELLO");
  const path = qrPath(symbol, 4);
  const dark = symbol.modules.reduce((sum, value) => sum + value, 0);

  assert.equal(path.match(/M/g).length, dark);
  // The top-left finder module sits at module (0,0), so at 4,4 in path space.
  assert.ok(path.startsWith("M4 4h1v1h-1z"));
});

test("text too long for any version is refused, not truncated", () => {
  assert.throws(() => encodeQr("x".repeat(3000)), /will not fit/);
});
