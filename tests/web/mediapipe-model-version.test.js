// The MediaPipe models are fetched at a fixed version.
//
// The tasks bundle is pinned, and a model from a moving "latest" address could
// change under it with no edit here: hand tracking would shift for every
// visitor at once, and the letter model was trained on one version's output.
// The model address is read where the app hands it to MediaPipe.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

test("every MediaPipe model the word camera loads names a numbered version", async () => {
  const camera = appWithFakeCamera({ mode: "word" });
  const requested = [];
  for (const task of ["HandLandmarker", "PoseLandmarker", "FaceLandmarker"]) {
    const create = camera.vision[task].createFromOptions;
    camera.vision[task].createFromOptions = (...args) => {
      requested.push(args.at(-1).baseOptions.modelAssetPath);
      return create(...args);
    };
  }

  await camera.app.get("toggleCamera")();
  await flush();

  assert.equal(requested.length, 3, `precondition: hand, pose and face were loaded, got ${requested}`);
  for (const address of requested) {
    const folders = new URL(address).pathname.split("/").slice(0, -1);
    assert.match(folders.at(-1), /^\d+$/, `${address} does not name a numbered version`);
    assert.ok(!folders.includes("latest"), `${address} follows the latest release`);
  }
});
