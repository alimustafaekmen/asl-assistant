// The "no Turkish left" helper the translation tests rely on
// (helpers/turkish-left.mjs).
//
// A helper that misses Turkish lets every translation test pass on an
// untranslated screen, so it is tested on its own. The faults these tests
// kill: Turkish letters or common Turkish words missed in text or in the
// attributes a screen reader or a tooltip shows; text marked lang="tr" or
// allowed by the test reported anyway; hidden subtrees walked by default;
// English text, ASL glosses or letters reported as Turkish.

import assert from "node:assert/strict";
import { test } from "node:test";

import { turkishLeft } from "./helpers/turkish-left.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

/** A detached element holding `markup`, in a fresh harness document. */
function fragment(markup) {
  const app = loadWebApp();
  const root = app.evaluate('document.createElement("div")');
  root.innerHTML = markup;
  return root;
}

const texts = (findings) => findings.map((finding) => `${finding.where}: ${finding.text}`);

test("Turkish letters and common Turkish words are found, in text and in spoken attributes", () => {
  const root = fragment(`
    <p>Kamerayı aç</p>
    <p>Harf</p>
    <p>Kelime ve metin</p>
    <button aria-label="Diğer"></button>
    <span title="Sil"></span>
    <input placeholder="Kelime ara" />
    <img alt="Referans görseli" />
  `);

  assert.deepEqual(texts(turkishLeft(root)), [
    "text: Kamerayı aç",
    "text: Harf",
    "text: Kelime ve metin",
    "aria-label: Diğer",
    "title: Sil",
    "placeholder: Kelime ara",
    "alt: Referans görseli",
  ]);
});

test("English text, ASL glosses and letters are not Turkish", () => {
  const root = fragment(`
    <p>Show an ASL letter to the camera.</p>
    <p lang="en">thankyou</p><strong>A</strong><span>Y</span>
    <button aria-label="Copy the text" title="Read aloud">Delete</button>
    <p>Debug panel · 20 fps · TensorFlow</p>
  `);

  assert.deepEqual(turkishLeft(root), []);
});

test("text marked lang=tr, hidden subtrees and scripts are skipped; includeHidden walks the hidden", () => {
  const root = fragment(`
    <button lang="tr" aria-label="Türkçeye geç"><span>Türkçe</span></button>
    <div hidden><p>Gizli metin</p></div>
    <template><p>Şablon</p></template>
  `);

  assert.deepEqual(turkishLeft(root), []);
  assert.deepEqual(texts(turkishLeft(root, { includeHidden: true })), ["text: Gizli metin"]);
});

test("allowed text is exempt by its exact text or a pattern", () => {
  const root = fragment("<p>TİD</p><p>Türk İşaret Dili (TİD)</p><p>Öğrenme</p>");

  assert.deepEqual(texts(turkishLeft(root, { allow: ["TİD", /\(TİD\)$/] })), ["text: Öğrenme"]);
});

test("each finding names the element it is in", () => {
  const root = fragment('<div id="card" class="panel note"><p class="lead">Bekleniyor</p></div>');

  assert.deepEqual(turkishLeft(root), [{ text: "Bekleniyor", where: "text", element: "p.lead" }]);
});
