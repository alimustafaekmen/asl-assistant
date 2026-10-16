// A camera that cannot be opened, and the stage that explains it.
//
// The fault these tests kill: a refused or failed camera leaves the
// first-visit stage on screen (its headline, "Kamerayı aç" and the fact
// list) with the error as one more line under it, so the visitor is told to
// open a camera that just failed, and is not told how to let it open. Each
// failure the browser can report must replace that stage with its own
// problem: a title and an explanation for that cause, a retry, a way to try
// the app without a camera, and the steps to allow the camera in the browser
// in use. A retry that works, and leaving for an information screen, clear
// it; switching between the camera modes keeps it, as the camera is the same.
//
// The camera is faked at its boundary (getUserMedia rejects with the error a
// browser gives, a DOMException-shaped {name, message}); the MediaPipe import
// and ONNX Runtime are faked by helpers/fake-camera.mjs. The rest is the app.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

/** A browser media error as getUserMedia rejects with it. */
const mediaError = (name, message = "") => Object.assign(new Error(message || name), { name });

/**
 * The app on a camera that first refuses with each of `refusals`, in turn,
 * and then grants. `navigator` adds or replaces fields of the fake navigator
 * (the user agent, a missing mediaDevices).
 */
function cameraRefusing(refusals, { navigator = {}, globals = {}, mode } = {}) {
  const camera = appWithFakeCamera({ mode });
  const { app } = camera;
  const nav = app.get("navigator");
  const grant = nav.mediaDevices.getUserMedia;
  const queue = [...refusals];
  let asked = 0;
  nav.mediaDevices.getUserMedia = async (constraints) => {
    asked += 1;
    if (queue.length) throw queue.shift();
    return grant(constraints);
  };
  Object.assign(nav, navigator);
  for (const [name, value] of Object.entries(globals)) app.evaluate(`globalThis.${name} = ${JSON.stringify(value)}`);
  // The page's own bindings, as init() makes them, so a click on a button
  // reaches what the page would run.
  app.get("bindEvents")();
  return { ...camera, asked: () => asked };
}

/** Everything the stage says about the camera, read from the page. */
function stageOf(app) {
  return app.evaluate(`(() => {
    const byId = (id) => document.getElementById(id);
    return {
      camera: els.cameraStage.dataset.camera ?? null,
      restingStage: !els.cameraEmpty.hidden,
      intro: byId("cameraIntro") ? !byId("cameraIntro").hidden : null,
      problem: byId("cameraProblem") ? !byId("cameraProblem").hidden : false,
      title: byId("cameraProblemTitle")?.textContent.trim() ?? null,
      text: byId("cameraProblemText")?.textContent.trim() ?? null,
      announced: els.announcer.textContent.trim(),
      on: state.cameraOn,
    };
  })()`);
}

/** Click the first-visit "Kamerayı aç" the way the page binds it. */
async function pressStart(app, detail = 1) {
  const start = app.evaluate('document.querySelector("[data-trigger=camera]")');
  const handled = Promise.all(
    (start._listeners?.get("click") ?? []).map((listener) => listener.call(start, { type: "click", detail, target: start })),
  );
  await handled;
  await flush();
}

test("a refused camera replaces the first-visit stage with the problem", async () => {
  const camera = cameraRefusing([mediaError("NotAllowedError", "Permission denied")]);
  const { app } = camera;

  await app.get("toggleCamera")();
  await flush();

  const stage = stageOf(app);
  assert.equal(stage.camera, "denied", "the stage names the problem");
  assert.equal(stage.problem, true, "the problem block is shown");
  assert.equal(stage.intro, false, "the first-visit headline, start button and facts are hidden");
  assert.equal(stage.restingStage, true, "the camera stays at rest: no video is shown");
  assert.equal(stage.title, "Kamera izni verilmedi");
  assert.match(stage.text, /site ayarlarından/);
  assert.match(stage.announced, /^Kamera izni verilmedi/, "the problem is announced");
  assert.equal(stage.on, false);
  assert.equal(camera.onnx.sessions, 0, "a refused camera downloads no model");
  assert.equal(camera.imports.length, 0, "nor hand tracking");
});

const CAUSES = [
  [mediaError("NotAllowedError", "Permission denied"), "denied", "Kamera izni verilmedi"],
  [mediaError("PermissionDeniedError"), "denied", "Kamera izni verilmedi"],
  [mediaError("NotAllowedError", "Permission denied by system"), "system", "Kamera sistem ayarlarında kapalı"],
  [mediaError("NotFoundError"), "notfound", "Kamera bulunamadı"],
  [mediaError("DevicesNotFoundError"), "notfound", "Kamera bulunamadı"],
  [mediaError("NotReadableError", "Could not start video source"), "busy", "Kamera başka bir uygulamada açık"],
  [mediaError("TrackStartError"), "busy", "Kamera başka bir uygulamada açık"],
  [mediaError("OverconstrainedError"), "failed", "Kamera açılamadı"],
  [mediaError("SecurityError"), "insecure", "Bu adreste kamera açılamıyor"],
  [mediaError("AbortError"), "failed", "Kamera açılamadı"],
];

for (const [error, kind, title] of CAUSES) {
  test(`${error.name} (${error.message}) shows the ${kind} problem`, async () => {
    const { app } = cameraRefusing([error]);

    await app.get("toggleCamera")();
    await flush();

    const stage = stageOf(app);
    assert.equal(stage.camera, kind);
    assert.equal(stage.title, title);
    assert.ok(stage.text.length > 0, "every problem explains itself");
    assert.equal(stage.problem, true);
    assert.equal(stage.intro, false);
  });
}

test("a page that is not a secure context shows the address problem without asking", async () => {
  const camera = cameraRefusing([], { navigator: { mediaDevices: undefined }, globals: { isSecureContext: false } });
  const { app } = camera;

  await app.get("toggleCamera")();
  await flush();

  const stage = stageOf(app);
  assert.equal(stage.camera, "insecure");
  assert.equal(stage.title, "Bu adreste kamera açılamıyor");
  assert.equal(camera.asked(), 0);
});

test("a secure page whose browser has no camera API says the browser cannot", async () => {
  const { app } = cameraRefusing([], { navigator: { mediaDevices: undefined }, globals: { isSecureContext: true } });

  await app.get("toggleCamera")();
  await flush();

  const stage = stageOf(app);
  assert.equal(stage.camera, "unsupported");
  assert.equal(stage.title, "Bu tarayıcı kameraya erişemiyor");
});

test("the retry asks again, and a camera that opens clears the problem", async () => {
  const camera = cameraRefusing([mediaError("NotAllowedError")]);
  const { app } = camera;
  await app.get("toggleCamera")();
  await flush();
  assert.equal(stageOf(app).camera, "denied", "precondition");

  app.evaluate('document.getElementById("cameraRetry")').dispatchEvent({ type: "click", detail: 1 });
  await flush();

  assert.equal(camera.asked(), 2, "the retry asks for the camera again");
  const stage = stageOf(app);
  assert.equal(stage.on, true);
  assert.equal(stage.camera, "on");
  assert.equal(stage.problem, false);
  assert.equal(stage.intro, true, "the first-visit stage is whole again for the next stop");
});

test("a retry that fails for another reason shows the newer problem", async () => {
  const { app } = cameraRefusing([mediaError("NotAllowedError"), mediaError("NotReadableError")]);
  await app.get("toggleCamera")();
  await flush();

  app.evaluate('document.getElementById("cameraRetry")').dispatchEvent({ type: "click", detail: 1 });
  await flush();

  assert.equal(stageOf(app).camera, "busy");
  assert.equal(stageOf(app).title, "Kamera başka bir uygulamada açık");
});

test("leaving for an information screen clears the problem; another camera mode keeps it", async () => {
  const { app } = cameraRefusing([mediaError("NotAllowedError")]);
  await app.get("toggleCamera")();
  await flush();

  app.get("setMode")("coach");
  assert.equal(stageOf(app).camera, "denied", "letter, coach and word share the camera");
  assert.equal(stageOf(app).problem, true);

  app.get("setMode")("test");
  app.get("setMode")("letter");
  const stage = stageOf(app);
  assert.equal(stage.problem, false);
  assert.equal(stage.intro, true);
  assert.equal(stage.camera, "off");
});

test("the way to try without a camera opens Model Test", async () => {
  const { app } = cameraRefusing([mediaError("NotFoundError")]);
  await app.get("toggleCamera")();
  await flush();

  const without = app.evaluate('document.querySelector("#cameraProblem [data-go-mode]")');
  assert.ok(without, "the problem offers a way on without a camera");
  assert.equal(without.dataset.goMode, "test");
});

test("a camera the browser takes away shows the lost-camera problem, and the retry reopens it", async () => {
  const camera = cameraRefusing([]);
  const { app } = camera;
  await app.get("toggleCamera")();
  await flush();
  assert.equal(stageOf(app).camera, "on", "precondition");

  camera.streams[0].tracks[0].end();
  await flush();
  let stage = stageOf(app);
  assert.equal(stage.camera, "ended");
  assert.equal(stage.title, "Kamera bağlantısı kesildi");
  assert.equal(stage.problem, true);
  assert.equal(stage.on, false);

  app.evaluate('document.getElementById("cameraRetry")').dispatchEvent({ type: "click", detail: 1 });
  await flush();
  stage = stageOf(app);
  assert.equal(stage.on, true);
  assert.equal(stage.problem, false);
});

test("after a keyboard start fails, focus goes to the problem's main action", async () => {
  for (const [error, target] of [
    [mediaError("NotAllowedError"), "cameraRetry"],
    [mediaError("NotFoundError"), "cameraNoCamera"],
  ]) {
    const { app } = cameraRefusing([error]);
    app.get("bindEvents")();
    const focused = [];
    for (const id of ["cameraRetry", "cameraNoCamera"]) {
      const element = app.evaluate(`document.getElementById("${id}")`);
      assert.ok(element, `#${id} exists`);
      element.focus = () => focused.push(id);
    }

    await pressStart(app, 0);
    assert.deepEqual(focused, [target], `${error.name}: focus lands on #${target}`);
  }
});

test("after a pointer start fails, focus is left where the pointer put it", async () => {
  const { app } = cameraRefusing([mediaError("NotAllowedError")]);
  app.get("bindEvents")();
  const focused = [];
  app.evaluate('document.getElementById("cameraRetry")').focus = () => focused.push("cameraRetry");

  await pressStart(app, 1);

  assert.equal(stageOf(app).camera, "denied", "precondition");
  assert.deepEqual(focused, []);
});

const BROWSERS = ["ios-safari", "ios-chrome", "android-chrome", "desktop-chrome", "firefox", "mac-safari"];
const AGENTS = {
  "ios-safari":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  "ios-chrome":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1",
  "android-chrome":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  "desktop-chrome":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0",
  "mac-safari":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
};

for (const [browser, userAgent] of Object.entries(AGENTS)) {
  test(`the help puts the ${browser} steps first, and keeps every browser's`, async () => {
    const { app } = cameraRefusing([mediaError("NotAllowedError")], { navigator: { userAgent } });
    await app.get("toggleCamera")();
    await flush();

    const steps = app.evaluate(
      'Array.from(document.getElementById("cameraHelpSteps").children, (item) => item.dataset.browser)',
    );
    assert.equal(steps[0], browser);
    assert.deepEqual([...steps].sort(), [...BROWSERS].sort(), "every browser's steps stay reachable");
    const help = app.evaluate('document.getElementById("cameraHelp")');
    assert.ok(help.querySelector("summary"), "the help opens from a visible control");
  });
}
