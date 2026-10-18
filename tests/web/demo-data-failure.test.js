// A demo recording that cannot be used is reported, and the app stays usable.
//
// The recording is fetched on the first start. A missing file, a network
// failure, or a file of the wrong shape must not leave the stage blank or a
// loop running: the stage goes back to rest, a plain Turkish sentence says
// what happened (and is announced), and the next start asks for the file
// again. A recording the app cannot trust is refused whole, so a wrong shape
// never reaches the overlay or the model.
//
// The network is the boundary faked here; the file's shape is the published
// contract, schema asl-demo-letters-v1: the word, A to Y without J or Z, and
// one 21-point right hand per letter, in order. A letter model that cannot
// load (ONNX Runtime, faked) is reported the same plain way, while the hand
// plays on, as a camera without its models still shows.

import assert from "node:assert/strict";
import { test } from "node:test";

import { jsonResponse } from "./helpers/fake-ort.mjs";
import { demoApp, demoRecording } from "./helpers/demo-app.mjs";

/** A copy of the good recording with `change` applied. */
function recordingWith(change) {
  const recording = structuredClone(demoRecording("FLY"));
  change(recording);
  return recording;
}

const BAD = {
  "a missing file (404)": () => jsonResponse({ error: "not found" }, 404),
  "a network failure": () => Promise.reject(new TypeError("Failed to fetch")),
  "a body that is not JSON": () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }),
  "another schema": () => jsonResponse(recordingWith((r) => { r.schema = "asl-demo-letters-v2"; })),
  "a word with J": () => jsonResponse(recordingWith((r) => { r.word = "FJY"; r.letters[1].letter = "J"; })),
  "fewer letters than the word": () => jsonResponse(recordingWith((r) => { r.letters.pop(); })),
  "letters out of order": () => jsonResponse(recordingWith((r) => { r.letters.reverse(); })),
  "a hand of 20 points": () => jsonResponse(recordingWith((r) => { r.letters[0].landmarks.pop(); })),
  "a point that is not a number": () => jsonResponse(recordingWith((r) => { r.letters[2].landmarks[5][1] = "0.4"; })),
  "a left hand": () => jsonResponse(recordingWith((r) => { r.letters[0].handedness = "Left"; })),
  "no letters at all": () => jsonResponse(recordingWith((r) => { delete r.letters; })),
};

for (const [name, respond] of Object.entries(BAD)) {
  test(`${name}: the stage goes back to rest and says so in plain Turkish`, async () => {
    const demo = await demoApp({ respond });
    const rest = demo.byId("confidenceMessage").textContent;
    await demo.start();
    await demo.play(500);

    assert.equal(demo.byId("demoPanel").hidden, true, "no demo panel is left on the stage");
    assert.equal(demo.byId("cameraEmpty").hidden, false, "the first-visit stage is back");
    assert.equal(demo.publishedHand(), null, "nothing reaches the overlay or the model");
    assert.equal(demo.pendingTimers(), 0, "no frame loop is running");

    const message = demo.byId("confidenceMessage").textContent.trim();
    assert.notEqual(message, "", "the message line explains");
    assert.notEqual(message, rest.trim(), "with a message of its own");
    assert.equal(demo.byId("announcer").textContent.trim(), message, "and the same sentence is announced");
    assert.doesNotMatch(message, /json|http|fixture|landmark|schema|undefined|error/i, "in words a visitor knows");
  });
}

test("after a failed load the next start asks again, and plays", async () => {
  let fail = true;
  const demo = await demoApp({
    respond: () => (fail ? jsonResponse({}, 404) : jsonResponse(demoRecording("FLY"))),
  });
  await demo.start();
  assert.equal(demo.byId("demoPanel").hidden, true, "precondition: the first start failed");

  fail = false;
  await demo.start();
  await demo.play(600);
  assert.equal(demo.demoRequests.length, 2, "the failure is not remembered");
  assert.equal(demo.publishedLetter(), "F");
  assert.equal(demo.plate(), "F");
});

test("after a failed load the camera still starts", async () => {
  const demo = await demoApp({ respond: () => jsonResponse({}, 404) });
  await demo.start();
  // Not awaited: the start waits on the MediaPipe download, which the test
  // never answers; the camera is on before that wait.
  demo.app.get("toggleCamera")();
  await demo.play(50);
  assert.equal(demo.camera.requests, 1);
  assert.equal(demo.app.evaluate("els.cameraStage.dataset.camera"), "on");
});

test("a letter model that cannot load leaves the hand playing, and says so in plain Turkish", async () => {
  const demo = await demoApp();
  demo.app.evaluate("__ort.fail = true");
  await demo.start();
  await demo.play(600);

  assert.equal(demo.publishedLetter(), "F", "the recorded hand still plays, as a camera without its models still shows");
  assert.equal(demo.byId("demoPanel").hidden, false);
  const message = demo.byId("confidenceMessage").textContent.trim();
  assert.equal(demo.byId("announcer").textContent.trim(), message, "the failure is announced");
  assert.doesNotMatch(message, /onnx|model|wasm|http|undefined|error/i, "in words a visitor knows");
  assert.equal(demo.plate(), "?", "nothing is read");
  demo.press(" ");
  assert.equal(demo.transcript(), "", "and nothing can be added");
});
