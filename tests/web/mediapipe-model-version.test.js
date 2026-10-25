// The MediaPipe models are fetched at a fixed version.
//
// The tasks bundle is pinned, and a model from a moving "latest" address could
// change under it with no edit here: hand tracking would shift for every
// visitor at once, and the letter model was trained on one version's output.
// The address is read from the downloads, whoever makes them.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

test("every MediaPipe model file the word camera downloads names a numbered version", async () => {
  const camera = appWithFakeCamera({ mode: "word" });

  await camera.app.get("toggleCamera")();
  await flush();

  const files = camera.downloads.map((download) => new URL(download.url).pathname.split("/").at(-1));
  for (const file of ["hand_landmarker.task", "pose_landmarker_lite.task", "face_landmarker.task"]) {
    assert.ok(files.includes(file), `precondition: ${file} was downloaded, got ${files}`);
  }
  for (const { url } of camera.downloads) {
    const folders = new URL(url).pathname.split("/").slice(0, -1);
    assert.match(folders.at(-1), /^\d+$/, `${url} does not name a numbered version`);
    assert.ok(!folders.includes("latest"), `${url} follows the latest release`);
  }
});
