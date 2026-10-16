// A stop during MediaPipe's own start-up.
//
// Once the camera is on, MediaPipe still has to import its bundle, load its
// WASM fileset and download a model per task, each an await of its own and
// seconds long on a phone. A Stop or Home in that window must win: when the
// download finishes, the task it produced is closed, nothing is detecting and
// no frame is scheduled. Stop followed by Start in the same window must leave
// exactly one task of each kind and one detection loop, which is the
// lifecycle invariant in another order.
//
// The camera, the MediaPipe import and its tasks, and the frame clock are
// faked at their boundaries (helpers/fake-camera.mjs); the start and stop
// paths are the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

/** Which await of the start is still open when the user stops. */
const stages = {
  "the bundle import": { hold: { import: true }, release: (camera) => camera.imports[0].resolve(camera.vision) },
  "the WASM fileset": { hold: { wasm: true }, release: (camera) => camera.wasmLoads[0].resolve({}) },
  "the hand model": { hold: { hand: true }, release: (camera) => camera.created("hand")[0].resolve() },
};

for (const [stage, { hold, release }] of Object.entries(stages)) {
  test(`a stop during ${stage} leaves nothing running when it finishes`, async () => {
    const camera = appWithFakeCamera({ hold });
    const { app } = camera;

    const starting = app.get("toggleCamera")();
    await flush();
    assert.equal(app.evaluate("state.cameraOn"), true, "precondition: the camera is on");
    assert.equal(app.evaluate("mpRunning"), false, `precondition: MediaPipe is still at ${stage}`);

    app.get("toggleCamera")();
    // The WASM fileset and each task model are downloads of their own.
    const downloads = () => camera.wasmLoads.length + camera.creations.length;
    const downloadsAtStop = downloads();
    release(camera);
    await starting;
    await flush();

    assert.equal(downloads(), downloadsAtStop, "nothing may be downloaded after the stop");
    assert.equal(app.evaluate("mpRunning"), false, "nothing may be detecting");
    assert.equal(camera.frames.pending.size, 0, "no detection frame may be scheduled");
    assert.equal(app.evaluate("handLandmarker"), null, "no hand task may be kept");
    for (const kind of ["hand", "pose", "face"]) {
      assert.equal(camera.alive(kind), 0, `every ${kind} task created must be closed`);
    }
  });
}

test("stop and start during the hand download leave one task and one loop", async () => {
  const camera = appWithFakeCamera({ hold: { hand: true } });
  const { app } = camera;
  const toggleCamera = app.get("toggleCamera");

  const first = toggleCamera();
  await flush();
  toggleCamera();
  const second = toggleCamera();
  await flush();
  assert.equal(camera.created("hand").length, 2, "precondition: the restart asked for its own task");

  camera.created("hand")[0].resolve();
  camera.created("hand")[1].resolve();
  await first;
  await second;
  await flush();

  assert.equal(app.evaluate("mpRunning"), true);
  assert.equal(camera.alive("hand"), 1, "one hand task may stay open, the other must be closed");
  assert.equal(camera.frames.pending.size, 1, "one detection loop, one pending frame");
  const before = camera.detections("hand");
  camera.runFrame();
  assert.equal(camera.detections("hand") - before, 1, "one detection per frame");

  toggleCamera();
  assert.equal(camera.alive("hand"), 0, "the final stop closes the task that was kept");
  assert.equal(camera.frames.pending.size, 0);
});

// Pose and face load one after the other in the background, so a stop can
// land in either download.
for (const kind of ["pose", "face"]) {
  test(`a stop during the ${kind} download closes the ${kind} task when it arrives`, async () => {
    const camera = appWithFakeCamera({ mode: "word", hold: { [kind]: true } });
    const { app } = camera;

    await app.get("toggleCamera")();
    await flush();
    assert.equal(camera.created(kind).length, 1, `precondition: ${kind} is loading`);

    app.get("toggleCamera")();
    camera.created(kind)[0].resolve();
    await flush();

    assert.equal(app.evaluate("poseLandmarker"), null);
    assert.equal(app.evaluate("faceLandmarker"), null);
    for (const each of ["hand", "pose", "face"]) {
      assert.equal(camera.alive(each), 0, `every ${each} task created must be closed`);
    }
    assert.equal(camera.frames.pending.size, 0);
  });

  test(`stop and start during the ${kind} download leave one pose and one face task`, async () => {
    const camera = appWithFakeCamera({ mode: "word", hold: { [kind]: true } });
    const { app } = camera;
    const toggleCamera = app.get("toggleCamera");

    await toggleCamera();
    await flush();
    toggleCamera();
    await toggleCamera();
    await flush();
    assert.equal(camera.created(kind).length, 2, `precondition: the restart loads its own ${kind} task`);

    camera.created(kind)[0].resolve();
    camera.created(kind)[1].resolve();
    await flush();

    assert.equal(camera.alive("hand"), 1);
    assert.equal(camera.alive("pose"), 1, "a second pose task must not be kept beside the first");
    assert.equal(camera.alive("face"), 1, "a second face task must not be kept beside the first");
    const before = { pose: camera.detections("pose"), face: camera.detections("face") };
    camera.runFrame();
    assert.equal(camera.detections("pose") - before.pose, 1, "one pose detection per frame");
    assert.equal(camera.detections("face") - before.face, 1, "one face detection per frame");

    toggleCamera();
    for (const each of ["hand", "pose", "face"]) {
      assert.equal(camera.alive(each), 0, `the final stop closes every ${each} task`);
    }
  });
}

// A failed start must not lock MediaPipe: the next start has to try again.
const failures = {
  "the WASM fileset": { hold: { wasm: true }, fail: (camera) => camera.wasmLoads[0].reject(new Error("offline")) },
  "the hand model": {
    hold: { hand: true },
    // The GPU attempt fails, then the CPU fallback does.
    fail: async (camera) => {
      camera.created("hand")[0].reject(new Error("no GPU"));
      await flush();
      camera.created("hand")[1].reject(new Error("offline"));
    },
  },
};

for (const [stage, { hold, fail }] of Object.entries(failures)) {
  test(`a start that failed at ${stage} does not block the next start`, async () => {
    const camera = appWithFakeCamera({ hold });
    const { app } = camera;
    const startMediaPipe = app.get("startMediaPipe");
    const video = app.evaluate("els.video");

    const first = startMediaPipe(video);
    await flush();
    await fail(camera);
    await assert.rejects(first);

    const handsBefore = camera.created("hand").length;
    const second = startMediaPipe(video);
    await flush();
    // The second start holds the same boundary; let it through this time.
    if (hold.wasm) camera.wasmLoads[1]?.resolve({});
    await flush();
    for (const creation of camera.created("hand").slice(handsBefore)) creation.resolve();
    await second;

    assert.ok(camera.created("hand").length > handsBefore, "the next start must try again");
    assert.equal(app.evaluate("mpRunning"), true);
    assert.equal(camera.frames.pending.size, 1);
  });
}
