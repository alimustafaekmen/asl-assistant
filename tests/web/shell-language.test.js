// The shell in English, and the switch between Turkish and English.
//
// The faults these tests kill:
// - an English visitor's header, navigation, menu and landmarks left in
//   Turkish, in text or in the names a screen reader speaks;
// - a document title that stays in the language the page opened in, on any
//   route, after a switch;
// - a camera problem, a status badge or the camera indicator that keep the
//   old language after a switch, and a switch that rewrites a badge another
//   script has since written;
// - the switch missing from the header menu (the "Diğer" popover on a phone,
//   the header row on a laptop), named in the wrong language, or failing to
//   save the choice and say so;
// - a switch that restarts the camera or loses the transcript.
//
// The browser's languages, storage, the camera and ONNX Runtime are faked at
// their boundaries; the markup and the scripts are the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";
import { turkishLeft } from "./helpers/turkish-left.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };
const ENGLISH = ["en-US", "en"];
const ROUTES = ["letter", "coach", "word", "test", "project", "qr"];
const TITLES = {
  en: {
    letter: "Letter recognition · ASL Assistant",
    coach: "Coach · ASL Assistant",
    word: "Word (experimental) · ASL Assistant",
    test: "Try the model without a camera · ASL Assistant",
    project: "How it works · ASL Assistant",
    qr: "Open on your phone · ASL Assistant",
  },
  tr: {
    letter: "Harf tanıma · ASL Assistant",
    coach: "Koç · ASL Assistant",
    word: "Kelime (deneysel) · ASL Assistant",
    test: "Modeli kamerasız deneyin · ASL Assistant",
    project: "Nasıl çalışır · ASL Assistant",
    qr: "Telefonda açın · ASL Assistant",
  },
};

/** The app booted on `hash`; `options` are loadWebApp()'s. */
async function bootedApp(hash = "#letter", options = {}) {
  const location = new URL(`https://asl-assistant.netlify.app/${hash}`);
  const app = loadWebApp({
    boot: true,
    ...options,
    globals: { console: quietConsole, location, kjua: () => ({}), ...options.globals },
  });
  await app.ready;
  return app;
}

/** Click an element as a keyboard does (detail 0), through its own listeners. */
function press(app, element) {
  for (const listener of element._listeners?.get("click") ?? []) {
    listener.call(element, { type: "click", detail: 0, target: element });
  }
}

const byId = (app, id) => app.evaluate(`document.getElementById(${JSON.stringify(id)})`);
const lang = (app) => app.evaluate('document.documentElement.getAttribute("lang")');

/** The shell parts outside any screen: the skip link, the header and the landmarks' names. */
function shellParts(app) {
  const document = app.evaluate("document");
  return [document.getElementById("skipLink"), document.querySelector(".topbar")];
}

test("an English visitor gets the shell in English, spoken names included", async () => {
  const app = await bootedApp("#letter", { languages: ENGLISH });

  assert.equal(lang(app), "en");
  for (const part of shellParts(app)) assert.deepEqual(turkishLeft(part), [], "Turkish left in the shell");
  const tabs = [...app.evaluate('document.querySelectorAll(".topbar__modes [data-mode]")')].map((tab) => tab.textContent.trim());
  assert.deepEqual(tabs, ["Letter", "Coach", "Word experimental"]);
  assert.equal(app.evaluate('document.querySelector("[popovertarget]").getAttribute("aria-label")'), "More");
  assert.equal(app.evaluate('document.querySelector(".camera-column").getAttribute("aria-label")'), "Camera");
  assert.equal(app.evaluate('document.querySelector(".side-panel").getAttribute("aria-label")'), "Details");
  assert.equal(app.evaluate("els.modeBadge.textContent"), "Letter mode");
  assert.equal(app.evaluate("els.resultKind.textContent"), "Letter");
  assert.equal(app.evaluate("els.latencyBadge.textContent"), "Ready", "the stage's status chip");
  assert.equal(app.evaluate('document.querySelector("meta[name=description]").getAttribute("content")').startsWith("ASL Assistant recognizes"), true);
});

test("a Turkish visitor's shell is the authored Turkish markup", async () => {
  const app = await bootedApp();

  assert.equal(lang(app), "tr");
  assert.equal(byId(app, "skipLink").textContent, "İçeriğe geç");
  assert.equal(app.evaluate('document.querySelector("[popovertarget]").getAttribute("aria-label")'), "Diğer");
  assert.equal(app.evaluate("document.title"), TITLES.tr.letter);
});

for (const route of ROUTES) {
  test(`#${route}: the document title is in the page's language, before and after a switch`, async () => {
    const english = await bootedApp(`#${route}`, { languages: ENGLISH });
    assert.equal(english.evaluate("document.title"), TITLES.en[route]);
    english.get("setLanguage")("tr");
    assert.equal(english.evaluate("document.title"), TITLES.tr[route]);

    const turkish = await bootedApp(`#${route}`);
    turkish.get("setLanguage")("en");
    assert.equal(turkish.evaluate("document.title"), TITLES.en[route]);
  });
}

test("a route opened after a switch takes its title in the new language", async () => {
  const app = await bootedApp();
  app.get("setLanguage")("en");
  app.get("setMode")("word");

  assert.equal(app.evaluate("document.title"), TITLES.en.word);
  assert.equal(app.evaluate("els.modeBadge.textContent"), "Word mode");
  assert.equal(app.evaluate("els.resultKind.textContent"), "Word");
});

test("the switch is in the header menu, named in the language it switches to", async () => {
  const app = await bootedApp();
  const toggle = byId(app, "languageToggle");

  assert.ok(toggle, "the page has a language switch");
  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.closest("[popover]")?.id, "moreMenu", "it is in the menu the phone's Diğer button opens");
  assert.ok(toggle.closest(".topbar"), "and in the header row a laptop shows");
  assert.equal(toggle.getAttribute("aria-label"), "Switch to English");
  assert.equal(toggle.getAttribute("lang"), "en");
  assert.equal(toggle.textContent.trim(), "English");
  assert.ok(toggle.getAttribute("aria-label").includes(toggle.textContent.trim()), "the visible label is in the name");

  press(app, toggle);
  assert.equal(lang(app), "en");
  assert.equal(toggle.getAttribute("aria-label"), "Türkçeye geç");
  assert.equal(toggle.getAttribute("lang"), "tr");
  assert.equal(toggle.textContent.trim(), "Türkçe");
  assert.ok(toggle.getAttribute("aria-label").includes(toggle.textContent.trim()));
});

test("pressing the switch saves the choice, announces it, and switches back", async () => {
  const app = await bootedApp();
  const toggle = byId(app, "languageToggle");

  press(app, toggle);
  assert.equal(app.evaluate('localStorage.getItem("asl-lang")'), "en");
  assert.equal(app.evaluate("els.announcer.textContent").trim(), "The page is now in English.");
  assert.equal(byId(app, "skipLink").textContent, "Skip to content");

  press(app, toggle);
  assert.equal(lang(app), "tr");
  assert.equal(app.evaluate('localStorage.getItem("asl-lang")'), "tr");
  assert.equal(app.evaluate("els.announcer.textContent").trim(), "Sayfa artık Türkçe.");
  assert.equal(byId(app, "skipLink").textContent, "İçeriğe geç");
});

test("a saved choice opens the next visit in that language", async () => {
  const app = await bootedApp("#letter", { savedLanguage: "en" });

  assert.equal(lang(app), "en");
  assert.equal(byId(app, "languageToggle").textContent.trim(), "Türkçe");
});

/** The camera faked at every boundary, with the page's own bindings. */
function camera() {
  const fake = appWithFakeCamera();
  fake.app.get("bindEvents")();
  return fake;
}

test("a camera problem on screen is rewritten in the new language", async () => {
  const { app } = camera();
  app.evaluate('globalThis.isSecureContext = false; navigator.mediaDevices = undefined;');
  await app.get("toggleCamera")();

  assert.equal(byId(app, "cameraProblemTitle").textContent, "Bu adreste kamera açılamıyor");
  app.get("setLanguage")("en");
  assert.equal(byId(app, "cameraProblemTitle").textContent, "The camera cannot open at this address");
  assert.equal(
    byId(app, "cameraProblemText").textContent,
    "Browsers allow the camera only on secure (https) addresses. Open the site at https://asl-assistant.netlify.app.",
  );
  assert.equal(app.evaluate("els.latencyBadge.textContent"), "HTTPS required");
});

test("a switch keeps the camera running and the transcript, and redraws the status", async () => {
  const fake = camera();
  const { app } = fake;
  app.evaluate('state.transcript = "HELLO "');
  await app.get("toggleCamera")();
  await flush();
  assert.equal(app.evaluate("state.cameraOn"), true, "precondition: the camera is on");
  const stream = app.evaluate("state.stream");

  app.get("setLanguage")("en");
  await flush();

  assert.equal(fake.streams.length, 1, "no second camera was asked for");
  assert.equal(fake.streams[0].tracks[0].stops, 0, "the camera was not stopped");
  assert.equal(app.evaluate("state.stream"), stream);
  assert.equal(fake.alive("hand"), 1, "one hand tracker, as before");
  assert.equal(app.evaluate("state.transcript"), "HELLO ");
  assert.equal(app.evaluate("els.cameraStatus.lastChild.textContent"), "Camera on");
});

test("a badge another script wrote since is left to that script", async () => {
  const { app } = camera();
  await app.get("toggleCamera")();
  await flush();
  app.evaluate('els.latencyBadge.textContent = "Hazırlanıyor (1/3)"');

  app.get("setLanguage")("en");
  assert.equal(app.evaluate("els.latencyBadge.textContent"), "Hazırlanıyor (1/3)");
});

test("the idle badges follow the language once the camera stops", async () => {
  const { app } = camera();
  await app.get("toggleCamera")();
  await flush();
  app.get("stopCamera")();
  app.get("setLanguage")("en");

  assert.equal(app.evaluate("els.latencyBadge.textContent"), "Ready");
  assert.equal(app.evaluate("els.cameraStatus.lastChild.textContent"), "Ready");
});
