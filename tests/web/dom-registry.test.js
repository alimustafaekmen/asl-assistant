// The DOM registry's two failure paths.
//
// The registry splits elements in two: required ones are proved present while
// the scripts load, and optional ones are progressive enhancement that resolve
// to null. Both halves only matter when an element is missing, which is what a
// redesign that drops or renames markup produces, so both are exercised here by
// making that element disappear.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

test("a missing required element fails while the scripts load", () => {
  // Failing here rather than when the coach screen opens is the whole point:
  // the id is in the message, so the markup that dropped it is findable.
  assert.throws(
    () => loadWebApp({ missingIds: ["coachTargetTile"] }),
    /coachTargetTile/,
    "a missing required element must name itself",
  );
});

test("a required element of the wrong type fails while the scripts load", () => {
  // Retagging #cameraVideo to something that is not a <video> would otherwise
  // surface as a null dereference once the camera starts. The message must
  // name the element and say that its type is wrong ("not of the expected type").
  assert.throws(
    () => loadWebApp({ wrongTypeIds: ["cameraVideo"] }),
    /cameraVideo.*not of the expected type/,
    "a wrongly typed element must say so and name itself",
  );
});

test("an optional element of the wrong type resolves to null", () => {
  // optionalElement() applies the same type check but reports it as absence,
  // because the feature is enhancement rather than a requirement.
  const app = loadWebApp({ wrongTypeIds: ["recordWord"] });

  assert.equal(app.evaluate("els.recordWord"), null);
});

test("a missing optional element leaves its feature inert", () => {
  const app = loadWebApp({ missingIds: ["wordQualityPills"] });

  assert.equal(app.evaluate("els.wordQualityPills"), null);
  // The renderer reads the pills through that field, so it has nothing to do.
  const updateWordQualityPills = app.get("updateWordQualityPills");
  assert.doesNotThrow(() => updateWordQualityPills(true, true, true));
});

test("the word guidance panel renders nothing without its lists", () => {
  const app = loadWebApp({
    missingIds: ["wordDemoList", "wordRiskList", "wordConfusionList"],
  });
  app.evaluate('confusionPairs = [{ word_a: "hear", word_b: "listen", count: 3 }];');
  app.evaluate('perWordStats = { hear: { f1: 0.9 }, listen: { f1: 0.4 } };');

  const renderWordGuidancePanel = app.get("renderWordGuidancePanel");
  assert.doesNotThrow(() => renderWordGuidancePanel());
});

test("every optional element resolves to null rather than a placeholder", () => {
  // optionalElement() returns null for a missing element instead of an object
  // that would silently absorb writes.
  const app = loadWebApp({ missingIds: ["recordWord", "coachReference"] });

  assert.equal(app.evaluate("els.recordWord"), null);
  assert.equal(app.evaluate("els.coachReference"), null);
});
