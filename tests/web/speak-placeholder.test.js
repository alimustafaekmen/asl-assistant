// The speak button reads the transcript, or the letter on the plate when the
// transcript is empty. "?" is the plate's "nothing detected" sign, and a
// speech engine reads it aloud as "question mark".
//
// Speech is faked at its boundary; the button is the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

function fakeSpeech() {
  const spoken = [];
  const speechSynthesis = {
    speak(utterance) {
      spoken.push(utterance.text);
    },
    cancel() {},
  };
  class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  return { spoken, globals: { speechSynthesis, SpeechSynthesisUtterance } };
}

for (const languages of [["tr-TR", "tr"], ["en-US", "en"]]) {
  test(`${languages[1]}: an empty transcript with no letter speaks nothing and says so`, async () => {
    const speech = fakeSpeech();
    const app = loadWebApp({ boot: true, globals: speech.globals, languages });
    await app.ready;
    assert.equal(app.evaluate("state.prediction"), "?", "precondition: nothing detected");
    assert.equal(app.evaluate("state.transcript"), "");

    app.evaluate("els.speakText").click();

    assert.deepEqual(speech.spoken, []);
    assert.equal(app.evaluate("els.toast.hidden"), false, "a toast answers the press");
    assert.equal(app.evaluate("els.toastText.textContent"), app.evaluate('t("letter.transcript.nothingToSpeak")'));
  });
}

test("an empty transcript speaks the letter on the plate", async () => {
  const speech = fakeSpeech();
  const app = loadWebApp({ boot: true, globals: speech.globals });
  await app.ready;
  app.evaluate('updatePrediction({ label: "L", confidence: 0.97, alternatives: [{ label: "L", confidence: 0.97 }] })');

  app.evaluate("els.speakText").click();

  assert.deepEqual(speech.spoken, ["L"]);
});

test("the transcript is spoken before the plate", async () => {
  const speech = fakeSpeech();
  const app = loadWebApp({ boot: true, globals: speech.globals });
  await app.ready;
  app.evaluate('state.transcript = "HI "');
  app.evaluate('updatePrediction({ label: "L", confidence: 0.97, alternatives: [{ label: "L", confidence: 0.97 }] })');

  app.evaluate("els.speakText").click();

  assert.deepEqual(speech.spoken, ["HI"]);
});
