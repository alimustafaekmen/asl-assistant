// The demo writes nothing on its own: each letter waits for the user.
//
// Consent is the app's rule for the transcript, and the demo keeps it. The
// recorded hand holds a letter for as long as it takes; only Space or the
// Ekle button adds it, and the add is the letter the plate shows. Then the
// hand leaves the frame for a moment, as a signer's does, so the smoother
// starts the next letter from nothing, and the next letter comes up. Skip
// moves on without adding. After the last letter the stage says the demo is
// over and offers the camera, and that action starts the real camera.
//
// The faults these kill: a demo that appends the letter itself, one that
// moves on while the user has not added anything, one that skips the gap
// (the next letter would be read through the last one's smoothing), one that
// counts a stale or misread letter as the one on the stage, an end that
// leaves the last letter addable, and an end action that does not open the
// camera.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_LABELS } from "./helpers/fake-ort.mjs";
import { demoApp } from "./helpers/demo-app.mjs";

test("a letter waits for the user: nothing is added, and the hand stays on it", async () => {
  const demo = await demoApp();
  await demo.start();
  await demo.play(5000);

  assert.equal(demo.transcript(), "", "five seconds of the demo add nothing by themselves");
  assert.equal(demo.publishedLetter(), "F", "the first letter is still on the stage");
  assert.equal(demo.plate(), "F");
});

test("Space adds the letter on the plate, and the next letter comes up after the hand leaves", async () => {
  const demo = await demoApp();
  await demo.start();
  await demo.play(600);
  assert.equal(demo.plate(), "F", "precondition: the plate reads F");

  assert.equal(demo.press(" "), true, "Space is the page's add key here");
  assert.equal(demo.transcript(), "F");

  await demo.play(100);
  assert.equal(demo.publishedHand(), null, "the hand leaves the frame after an add");
  await demo.play(500);
  assert.equal(demo.publishedLetter(), "L", "then the next letter comes up");
  await demo.play(600);
  assert.equal(demo.plate(), "L", "and the plate reads it");
  assert.equal(demo.transcript(), "F", "still nothing the user did not add");
});

test("the Ekle button adds the letter as Space does", async () => {
  const demo = await demoApp();
  await demo.start();
  await demo.play(600);

  demo.click(demo.byId("manualAddLetter"));
  assert.equal(demo.transcript(), "F");
  await demo.play(600);
  assert.equal(demo.publishedLetter(), "L");
});

test("skip moves to the next letter without adding anything", async () => {
  const demo = await demoApp();
  await demo.start();
  await demo.play(600);

  const skip = demo.byId("demoSkip");
  assert.ok(skip, "the demo offers a skip");
  assert.equal(skip.hidden, false, "while a letter is on the stage");
  demo.click(skip);
  await demo.play(600);
  assert.equal(demo.publishedLetter(), "L");
  assert.equal(demo.transcript(), "");
});

test("after the last letter the stage offers the camera, and that action starts it", async () => {
  const demo = await demoApp();
  await demo.start();
  const panel = demo.byId("demoPanel");
  const text = () => demo.byId("demoText").textContent.trim();
  const playing = text();
  assert.equal(panel.hidden, false, "the demo shows its panel");
  assert.notEqual(playing, "", "with an instruction");
  const startCamera = demo.byId("demoCamera");
  assert.equal(startCamera.hidden, true, "the camera action waits for the end");

  for (const letter of ["F", "L", "Y"]) {
    await demo.play(600);
    assert.equal(demo.plate(), letter, `the plate reads ${letter}`);
    demo.press(" ");
  }
  await demo.play(600);

  assert.equal(demo.transcript(), "FLY", "each letter was added once, by the user");
  assert.equal(demo.publishedHand(), null, "no hand after the end");
  assert.equal(startCamera.hidden, false, "the end offers the camera");
  assert.equal(demo.byId("demoSkip").hidden, true, "and nothing is left to skip");
  assert.notEqual(text(), "", "the end says so");
  assert.notEqual(text(), playing, "in words of its own");

  demo.click(startCamera);
  await demo.play(100);
  assert.equal(demo.camera.requests, 1, "the end action asks for the camera");
  assert.equal(panel.hidden, true, "and the demo is over");
  assert.equal(demo.app.evaluate("els.cameraStage.dataset.camera"), "on");
});

test("an add during the gap does not skip a letter", async () => {
  const demo = await demoApp();
  await demo.start();
  await demo.play(600);
  demo.press(" ");
  await demo.play(300);
  // A second press while the hand is away repeats the letter on the plate,
  // as in live signing, but the demo moves on once per letter.
  demo.press(" ");
  await demo.play(600);
  assert.equal(demo.publishedLetter(), "L", "the second letter is not skipped");
});

test("adding a letter the stage is not showing does not move the demo on", async () => {
  const demo = await demoApp();
  await demo.start();
  // The model reads every pose as F: what the plate shows after the next
  // letter comes up, until the model has read it, and what a misread shows.
  demo.app.evaluate(`__ort.answer = () => ${JSON.stringify(LETTER_LABELS)}.indexOf("F")`);
  await demo.play(600);
  demo.press(" ");
  assert.equal(demo.transcript(), "F", "precondition: F, the letter on the stage, was added");
  await demo.play(1000);
  assert.equal(demo.publishedLetter(), "L", "precondition: L is on the stage");
  assert.equal(demo.plate(), "F", "precondition: the plate shows F");

  demo.press(" ");
  assert.equal(demo.transcript(), "FF", "the user's add is the user's: the F is written");
  await demo.play(1000);
  assert.equal(demo.publishedLetter(), "L", "but L stays on the stage until it is added or skipped");

  demo.click(demo.byId("demoSkip"));
  await demo.play(1000);
  assert.equal(demo.publishedLetter(), "Y", "a skip still moves on");
});

test("after the end the plate is cleared, so Space adds nothing more", async () => {
  const demo = await demoApp();
  await demo.start();
  for (const letter of ["F", "L", "Y"]) {
    await demo.play(600);
    assert.equal(demo.plate(), letter);
    demo.press(" ");
  }
  await demo.play(600);
  assert.equal(demo.byId("demoCamera").hidden, false, "precondition: the demo is over");

  assert.equal(demo.plate(), "?", "no letter is left on the plate");
  demo.press(" ");
  await demo.play(600);
  assert.equal(demo.transcript(), "FLY", "and the last one is not added again");
});
