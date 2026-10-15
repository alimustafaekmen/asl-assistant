// Model Test fixture manifests.
//
// Word fixtures exported from the Google competition data may not be
// redistributed, so they live in an ignored folder with a manifest of their
// own. The panel must add them when that manifest is present and work from the
// published manifest alone when it is not, which is the case in every clone.
// fetch is the boundary faked here.

const test = require("node:test");
const assert = require("node:assert/strict");

const PUBLISHED = "./data/model-test-samples/manifest.json";
const LOCAL = "./data/model-test-samples/local/manifest.json";

const publishedManifest = () => ({
  schema_version: "asl-model-test-manifest-v1",
  letters: [{ id: "letter-a", label: "A", path: "./data/model-test-samples/letters/letter-a.json" }],
  words: [{ id: "word-give-smoke", label: "give", path: "./data/model-test-samples/words/word-give-smoke.json" }],
});

const localManifest = () => ({
  schema_version: "asl-model-test-manifest-v1",
  words: [{ id: "word-all-01", label: "all", path: "./data/model-test-samples/local/word-all-01.json" }],
});

function fakeFetch(responses) {
  const requested = [];
  const fetch = async (url) => {
    requested.push(url);
    if (!(url in responses)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => responses[url] };
  };
  return { fetch, requested };
}

async function loadManifestWith(responses) {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  const { fetch, requested } = fakeFetch(responses);
  const app = loadWebApp({ globals: { fetch } });
  await app.get("loadModelTestManifest")();
  return { manifest: app.get("state").modelTestManifest, requested };
}

test("local word fixtures are appended to the published ones when present", async () => {
  const { manifest, requested } = await loadManifestWith({
    [PUBLISHED]: publishedManifest(),
    [LOCAL]: localManifest(),
  });

  assert.ok(requested.includes(LOCAL));
  assert.deepEqual(
    manifest.words.map((item) => item.id),
    ["word-give-smoke", "word-all-01"],
  );
  assert.deepEqual(manifest.letters.map((item) => item.id), ["letter-a"]);
});

test("a clone without the local folder keeps the published fixtures", async () => {
  const { manifest } = await loadManifestWith({ [PUBLISHED]: publishedManifest() });

  assert.deepEqual(manifest.words.map((item) => item.id), ["word-give-smoke"]);
});

test("a local fixture with the id of a published one is not listed twice", async () => {
  const duplicate = localManifest();
  duplicate.words.push({ ...publishedManifest().words[0] });
  const { manifest } = await loadManifestWith({
    [PUBLISHED]: publishedManifest(),
    [LOCAL]: duplicate,
  });

  assert.deepEqual(
    manifest.words.map((item) => item.id),
    ["word-give-smoke", "word-all-01"],
  );
});
