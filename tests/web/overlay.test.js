// Landmark overlay geometry.
//
// The camera video is rendered with `object-fit: cover`, so normalized
// MediaPipe coordinates must be mapped through the cropped rectangle rather
// than the raw canvas box. Getting this wrong misplaces every landmark.

import test from "node:test";
import assert from "node:assert/strict";

let getVideoCoverRect;
test.before(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  getVideoCoverRect = loadWebApp().get("_getVideoCoverRect");
});

test("a wide video in a square box is cropped horizontally", () => {
  const rect = getVideoCoverRect({ videoWidth: 1280, videoHeight: 720 }, 400, 400);

  // Height fills the box; width overflows evenly on both sides.
  assert.equal(Math.round(rect.height), 400);
  assert.ok(rect.width > 400);
  assert.equal(rect.y, 0);
  assert.ok(rect.x < 0);
  assert.equal(Math.round(rect.x * 2 + rect.width), 400);
});

test("a tall video in a square box is cropped vertically", () => {
  const rect = getVideoCoverRect({ videoWidth: 480, videoHeight: 640 }, 400, 400);

  assert.equal(Math.round(rect.width), 400);
  assert.ok(rect.height > 400);
  assert.equal(rect.x, 0);
  assert.ok(rect.y < 0);
  assert.equal(Math.round(rect.y * 2 + rect.height), 400);
});

test("a video with matching aspect ratio is not cropped", () => {
  const rect = getVideoCoverRect({ videoWidth: 640, videoHeight: 480 }, 320, 240);

  assert.deepEqual(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    { x: 0, y: 0, width: 320, height: 240 },
  );
});

test("unmeasured video or canvas falls back to the full box", () => {
  const box = { x: 0, y: 0, width: 400, height: 300 };
  const asPlain = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });

  assert.deepEqual(asPlain(getVideoCoverRect(null, 400, 300)), box);
  assert.deepEqual(asPlain(getVideoCoverRect({}, 400, 300)), box);
  assert.deepEqual(
    asPlain(getVideoCoverRect({ videoWidth: 1280, videoHeight: 0 }, 400, 300)),
    box,
  );
  assert.deepEqual(
    asPlain(getVideoCoverRect({ videoWidth: 1280, videoHeight: 720 }, 0, 0)),
    { x: 0, y: 0, width: 0, height: 0 },
  );
});
