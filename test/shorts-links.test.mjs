import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, Script } from "node:vm";

const sourcePaths = [
  "src/config/constants.js",
  "src/core/utils.js",
  "src/core/normalization.js",
  "src/storage/state-store.js",
  "src/youtube/routes.js",
  "src/controllers/shorts-link-controller.js",
  "src/app/application.js",
];
const source = new Script(
  (await Promise.all(sourcePaths.map((filename) =>
    readFile(new URL(`../${filename}`, import.meta.url), "utf8"),
  ))).join("\n\n"),
);
const videoId = "dQw4w9WgXcQ";
const baseUrl = "https://www.youtube.com/";

function createRuntime(globals = {}) {
  const storage = new Map();
  const context = createContext({
    URL,
    URLSearchParams,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    ...globals,
  });
  source.runInContext(context);
  return (expression) => new Script(expression).runInContext(context);
}

test("Shorts URLs preserve timestamps, repeated parameters, and fragments", () => {
  const run = createRuntime();
  const convert = run("createShortsWatchLink");
  const url = new URL(convert(
    `/shorts/${videoId}?t=42&list=PL123&tag=a&tag=b&v=old#chapter`,
    baseUrl,
  ));
  assert.equal(url.pathname, "/watch");
  assert.equal(url.searchParams.get("v"), videoId);
  assert.equal(url.searchParams.get("t"), "42");
  assert.equal(url.searchParams.get("list"), "PL123");
  assert.deepEqual(url.searchParams.getAll("tag"), ["a", "b"]);
  assert.deepEqual(url.searchParams.getAll("v"), [videoId]);
  assert.equal(url.hash, "#chapter");
});

test("Shorts conversion accepts supported hosts and a trailing slash", () => {
  const convert = createRuntime()("createShortsWatchLink");
  for (const host of ["youtube.com", "www.youtube.com", "m.youtube.com"]) {
    const result = new URL(convert(`https://${host}/shorts/${videoId}/`, baseUrl));
    assert.equal(result.hostname, host);
    assert.equal(result.pathname, "/watch");
  }
});

test("Shorts conversion rejects unrelated or unsafe URLs", () => {
  const convert = createRuntime()("createShortsWatchLink");
  for (const value of [
    null, 42, "", `/watch?v=${videoId}`, "/shorts/short", "/shorts/",
    `/shorts/${videoId}/extra`,
    `https://youtube.com.example.org/shorts/${videoId}`,
    `https://example.org/shorts/${videoId}`,
    `https://user:pass@www.youtube.com/shorts/${videoId}`,
    `https://www.youtube.com:8443/shorts/${videoId}`,
    `ftp://www.youtube.com/shorts/${videoId}`,
    `javascript:shorts/${videoId}`,
  ]) {
    assert.equal(convert(value, baseUrl), null, String(value));
  }
});

test("direct-link mode defaults off and wins conflicting imported preferences", () => {
  const run = createRuntime();
  assert.equal(run("defaultState().preferences.rewriteShortsLinks"), false);
  for (const value of [true, "true"]) {
    const preferences = run(`normalizeState({ preferences: {
      shortsAsWatch: true, rewriteShortsLinks: ${JSON.stringify(value)}
    }}).preferences`);
    assert.equal(preferences.rewriteShortsLinks, true);
    assert.equal(preferences.shortsAsWatch, false);
  }
  assert.equal(run("normalizeState({}).preferences.rewriteShortsLinks"), false);
});

test("merging a legacy redirect backup disables existing direct-link mode", () => {
  const run = createRuntime();
  run(`const store = new StateStore();
    store.setPreferences({ rewriteShortsLinks: true });
    store.importState({ preferences: { shortsAsWatch: true } }, "merge");`);
  assert.equal(run("store.getPreferences().shortsAsWatch"), true);
  assert.equal(run("store.getPreferences().rewriteShortsLinks"), false);
});

test("merging a backup without Shorts preferences preserves the current mode", () => {
  const run = createRuntime();
  run(`const store = new StateStore();
    store.setPreferences({ rewriteShortsLinks: true });
    store.importState({ preferences: { language: "en" } }, "merge");`);
  assert.equal(run("store.getPreferences().rewriteShortsLinks"), true);
  assert.equal(run("store.getPreferences().shortsAsWatch"), false);
  assert.equal(run("store.getPreferences().language"), "en");
});

test("replacing with a legacy backup resets the new preference", () => {
  const run = createRuntime();
  run(`const store = new StateStore();
    store.setPreferences({ rewriteShortsLinks: true });
    store.importState({ preferences: { shortsAsWatch: true } }, "replace");`);
  assert.equal(run("store.getPreferences().rewriteShortsLinks"), false);
  assert.equal(run("store.getPreferences().shortsAsWatch"), true);
});

test("application toggles switch modes without enabling both", () => {
  const run = createRuntime();
  run(`const app = Object.create(Application.prototype);
    app.store = new StateStore();
    app.renderAll = () => {};
    app.redirectShortsIfNeeded = () => false;
    app.toggleRewriteShortsLinks();`);
  assert.equal(run("app.store.getPreferences().rewriteShortsLinks"), true);
  run("app.toggleShortsAsWatch()");
  assert.equal(run("app.store.getPreferences().shortsAsWatch"), true);
  assert.equal(run("app.store.getPreferences().rewriteShortsLinks"), false);
  run("app.toggleRewriteShortsLinks()");
  assert.equal(run("app.store.getPreferences().rewriteShortsLinks"), true);
  assert.equal(run("app.store.getPreferences().shortsAsWatch"), false);
});

// These small stubs exercise controller state, not browser event propagation.
function controllerFixture() {
  class Anchor {
    constructor(href) {
      this.attributes = new Map([["href", href]]);
      this.baseURI = baseUrl;
      this.isConnected = true;
      this.isContentEditable = false;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    hasAttribute(name) { return this.attributes.has(name); }
  }
  class Observer {
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  const anchor = new Anchor(`/shorts/${videoId}?t=5`);
  const listeners = [];
  const run = createRuntime({
    HTMLAnchorElement: Anchor,
    MutationObserver: Observer,
    AbortController,
    document: { baseURI: baseUrl, querySelectorAll: () => [anchor] },
    window: { addEventListener: (...args) => listeners.push(args) },
  });
  const controller = run("new ShortsLinkController()");
  return { run, controller, anchor, listeners };
}

test("controller enable is idempotent and stop restores links and cleans up", () => {
  const { controller, anchor, listeners } = controllerFixture();
  const original = anchor.getAttribute("href");
  controller.setEnabled(true);
  assert.equal(new URL(anchor.getAttribute("href")).pathname, "/watch");
  const observer = controller.observer;
  const signal = controller.abortController.signal;
  const listenerCount = listeners.length;
  controller.setEnabled(true);
  assert.equal(controller.observer, observer);
  assert.equal(listeners.length, listenerCount);
  controller.stop();
  assert.equal(anchor.getAttribute("href"), original);
  assert.equal(observer.connected, false);
  assert.equal(signal.aborted, true);
  assert.equal(controller.liveAnchors.size, 0);
});

test("controller does not restore an obsolete URL onto a recycled anchor", () => {
  const { controller, anchor } = controllerFixture();
  controller.setEnabled(true);
  const replacement = "/watch?v=abcdefghijk";
  anchor.setAttribute("href", replacement);
  controller.handleMutations([{ type: "attributes", target: anchor }]);
  controller.stop();
  assert.equal(anchor.getAttribute("href"), replacement);
});

test("removed anchors are restored and removed from the retained set", () => {
  const { controller, anchor } = controllerFixture();
  controller.setEnabled(true);
  anchor.isConnected = false;
  controller.handleMutations([{ type: "childList", addedNodes: [], removedNodes: [anchor] }]);
  assert.equal(anchor.getAttribute("href"), `/shorts/${videoId}?t=5`);
  assert.equal(controller.liveAnchors.size, 0);
});

test("adding download restores a previously rewritten anchor", () => {
  const { controller, anchor } = controllerFixture();
  controller.setEnabled(true);
  anchor.setAttribute("download", "clip");
  controller.handleMutations([{ type: "attributes", target: anchor }]);
  assert.equal(anchor.getAttribute("href"), `/shorts/${videoId}?t=5`);
  assert.equal(controller.liveAnchors.size, 0);
});

test("link activation stops delegated handlers without cancelling defaults", () => {
  const { controller, anchor } = controllerFixture();
  controller.setEnabled(true);
  for (const [type, button, key] of [["click", 0], ["auxclick", 1], ["keydown", 0, "Enter"]]) {
    let stopped = false;
    let prevented = false;
    controller.handleInteraction({
      type, button, key, defaultPrevented: false,
      composedPath: () => [anchor],
      stopImmediatePropagation: () => { stopped = true; },
      preventDefault: () => { prevented = true; },
    });
    assert.equal(stopped, true, type);
    assert.equal(prevented, false, type);
  }
});

test("direct-link mode does not redirect a pasted Shorts URL", () => {
  const { run } = controllerFixture();
  run(`globalThis.location = {
      href: "https://www.youtube.com/shorts/${videoId}",
      replace() { throw new Error("Unexpected redirect"); }
    };
    const app = Object.create(Application.prototype);
    app.store = new StateStore();
    app.store.setPreferences({ rewriteShortsLinks: true });
    app.shortsLinkController = new ShortsLinkController();`);
  assert.equal(run("app.redirectShortsIfNeeded()"), false);
  assert.equal(run("app.shortsLinkController.enabled"), true);
});

test("record-manager links open watch pages when direct-link mode is enabled", () => {
  const opened = [];
  const run = createRuntime({
    location: { origin: baseUrl.slice(0, -1) },
    window: { open: (url) => { opened.push(url); return null; } },
  });
  run(`const app = Object.create(Application.prototype);
    app.store = new StateStore();
    app.store.setRecord("${videoId}", { start: 1, end: 3, source: "shorts" });
    app.preferences = { shortsAsWatch: false, rewriteShortsLinks: true };
    app.openRecord("${videoId}");`);
  assert.equal(new URL(opened[0]).pathname, "/watch");
  assert.equal(new URL(opened[0]).searchParams.get("v"), videoId);
});
