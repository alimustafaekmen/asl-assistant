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
//   the header row on a laptop), an option named in the wrong language, the
//   wrong option marked as pressed, or a switch that fails to save the
//   choice and say so;
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
  const location = new URL(`https://asl-assistant.pages.dev/${hash}`);
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

/** The switch's options as [text, name, lang, pressed] rows. */
function options(app) {
  return Array.from(byId(app, "languageSwitch").querySelectorAll("button")).map((option) => [
    option.textContent.trim(),
    option.getAttribute("aria-label"),
    option.getAttribute("lang"),
    option.getAttribute("aria-pressed"),
  ]);
}

const option = (app, language) => byId(app, "languageSwitch").querySelector(`[data-language="${language}"]`);

test("the switch offers TR and EN in the header menu, each named in its own language", async () => {
  const app = await bootedApp();
  const group = byId(app, "languageSwitch");

  assert.ok(group, "the page has a language switch");
  assert.equal(group.closest("[popover]")?.id, "moreMenu", "it is in the menu the phone's Diğer button opens");
  assert.ok(group.closest(".topbar"), "and in the header row a laptop shows");
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(group.getAttribute("aria-label"), "Dil");
  assert.deepEqual(options(app), [
    ["TR", "Türkçe", "tr", "true"],
    ["EN", "English", "en", "false"],
  ]);

  press(app, option(app, "en"));
  assert.equal(lang(app), "en");
  assert.equal(group.getAttribute("aria-label"), "Language");
  assert.deepEqual(options(app), [
    ["TR", "Türkçe", "tr", "false"],
    ["EN", "English", "en", "true"],
  ]);
});

test("pressing an option saves the choice, announces it, and the other switches back", async () => {
  const app = await bootedApp();

  press(app, option(app, "en"));
  assert.equal(app.evaluate('localStorage.getItem("asl-lang")'), "en");
  assert.equal(app.evaluate("els.announcer.textContent").trim(), "The page is now in English.");
  assert.equal(byId(app, "skipLink").textContent, "Skip to content");

  press(app, option(app, "tr"));
  assert.equal(lang(app), "tr");
  assert.equal(app.evaluate('localStorage.getItem("asl-lang")'), "tr");
  assert.equal(app.evaluate("els.announcer.textContent").trim(), "Sayfa artık Türkçe.");
  assert.equal(byId(app, "skipLink").textContent, "İçeriğe geç");
});

test("pressing the language already shown keeps it, saves it and announces nothing", async () => {
  const app = await bootedApp();
  const announced = app.evaluate("els.announcer.textContent");

  press(app, option(app, "tr"));
  assert.equal(lang(app), "tr");
  assert.equal(app.evaluate('localStorage.getItem("asl-lang")'), "tr");
  assert.equal(app.evaluate("els.announcer.textContent"), announced);
  assert.equal(option(app, "tr").getAttribute("aria-pressed"), "true");
});

test("a saved choice opens the next visit in that language", async () => {
  const app = await bootedApp("#letter", { savedLanguage: "en" });

  assert.equal(lang(app), "en");
  assert.equal(option(app, "en").getAttribute("aria-pressed"), "true");
  assert.equal(option(app, "tr").getAttribute("aria-pressed"), "false");
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
    "Browsers allow the camera only on secure (https) addresses. Open the site at https://asl-assistant.pages.dev.",
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
