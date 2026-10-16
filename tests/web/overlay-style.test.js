// How the landmark skeleton is painted.
//
// Single-colour strokes vanished on light skin, white walls and plants (under
// 3:1). Every bone and joint is now drawn twice, a dark halo under a light
// core, in the colours of the design tokens, and the core turns to the lock
// colour when the stage is locked. The canvas context is faked at its API;
// the drawing code is the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const TOKENS = {
  "--stage-text": "#f5f4f0",
  "--stage-text-2": "#b8babf",
  "--stage-lock": "#f2b705",
  "--stage-halo": "rgba(0, 0, 0, 0.55)",
};

function fakeContext() {
  const ops = [];
  const ctx = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    stroke() { ops.push({ op: "stroke", color: ctx.strokeStyle, width: ctx.lineWidth }); },
    fill() { ops.push({ op: "fill", color: ctx.fillStyle }); },
  };
  return { ctx, ops };
}

const hand = Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + i * 0.01, y: 0.4 + i * 0.01 }));

function draw(stageState) {
  const app = loadWebApp({
    globals: {
      getComputedStyle: () => ({ getPropertyValue: (name) => TOKENS[name] ?? "" }),
    },
  });
  app.evaluate(`state.mode = "letter"; els.cameraStage.dataset.state = ${JSON.stringify(stageState)};`);
  const { ctx, ops } = fakeContext();
  app.get("drawLandmarks")(ctx, { rightHandLandmarks: [hand], leftHandLandmarks: [hand] }, 640, 480);
  return ops;
}

test("every bone is a dark halo under a light, thinner core", () => {
  const strokes = draw("maybe").filter((o) => o.op === "stroke");
  const halos = strokes.filter((o) => o.color === TOKENS["--stage-halo"]);
  const cores = strokes.filter((o) => o.color === TOKENS["--stage-text"]);

  // Two hands, 23 bones each.
  assert.equal(halos.length, 46);
  assert.equal(cores.length, 46);
  assert.ok(Math.min(...halos.map((o) => o.width)) > Math.max(...cores.map((o) => o.width)));
  // Every halo is drawn before any core, so where the hands overlap no halo
  // covers a core.
  const colours = strokes.map((o) => o.color);
  assert.ok(colours.lastIndexOf(TOKENS["--stage-halo"]) < colours.indexOf(TOKENS["--stage-text"]));
});

test("every joint has a halo and a core dot", () => {
  const fills = draw("maybe").filter((o) => o.op === "fill");
  assert.equal(fills.filter((o) => o.color === TOKENS["--stage-halo"]).length, 42);
  assert.equal(fills.filter((o) => o.color === TOKENS["--stage-text"]).length, 42);
});

test("both hands share one colour; position, not colour, tells them apart", () => {
  const colours = new Set(draw("maybe").map((o) => o.color));
  assert.deepEqual([...colours].sort(), [TOKENS["--stage-halo"], TOKENS["--stage-text"]].sort());
});

test("a locked stage paints the core in the lock colour", () => {
  const ops = draw("good");
  assert.ok(ops.some((o) => o.color === TOKENS["--stage-lock"]));
  assert.ok(!ops.some((o) => o.color === TOKENS["--stage-text"]));
});
