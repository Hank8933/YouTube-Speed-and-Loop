import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, Script } from "node:vm";

const source = new Script((await Promise.all([
  "src/config/constants.js",
  "src/core/utils.js",
  "src/core/normalization.js",
  "src/storage/state-store.js",
  "src/core/time-codec.js",
  "src/controllers/loop-controller.js",
  "src/ui/panel-view/rendering.js",
  "src/app/application.js",
].map((filename) => readFile(new URL(`../${filename}`, import.meta.url), "utf8"))))
  .join("\n\n"));

function fixture() {
  const storage = new Map();
  const context = createContext({
    AbortController,
    Event,
    EventTarget,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, options) { this.target = target; this.options = options; }
      disconnect() { this.target = null; }
    },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    document: { activeElement: null },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  source.runInContext(context);
  const run = (expression) => new Script(expression).runInContext(context);
  run(`
    const records = [];
    const states = [];
    const controller = new LoopController({
      onRecordChange: record => records.push(record),
      onStateChange: state => states.push(state),
    });
    const video = Object.assign(new EventTarget(), {
      duration: 180, currentTime: 40, paused: true, ended: false,
      seeking: false, readyState: 4, playbackRate: 1,
      loop: false, playCalls: 0,
      buffered: { length: 1, start: () => 0, end: () => 180 },
      closest: () => null,
      play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
    });
    controller.bind(video);
  `);
  return run;
}

test("empty bounds enable a full-video loop without seeking or forcing playback", () => {
  const run = fixture();
  assert.equal(run("controller.getState().canToggle"), true);
  run("controller.toggle()");
  assert.equal(run("controller.enabled"), true);
  assert.equal(run("controller.start"), 0);
  assert.equal(run("controller.end"), 180);
  assert.equal(run("video.currentTime"), 40);
  assert.equal(run("video.paused"), true);
  assert.equal(run("video.playCalls"), 0);
  assert.equal(run("records.length"), 1);
  assert.equal(run("records[0].enabled"), true);
});

test("a full-video range can be disabled and enabled again", () => {
  const run = fixture();
  run("controller.toggle(); controller.toggle()");
  assert.equal(run("controller.enabled"), false);
  assert.equal(run("controller.start"), 0);
  assert.equal(run("controller.end"), 180);
  run("controller.toggle()");
  assert.equal(run("controller.enabled"), true);
});

test("existing A-B bounds are preserved", () => {
  const run = fixture();
  run("controller.setPoint('start', 15); controller.setPoint('end', 50); controller.toggle()");
  assert.equal(run("controller.enabled"), true);
  assert.equal(run("controller.start"), 15);
  assert.equal(run("controller.end"), 50);
});

test("partial and invalid ranges are not silently replaced", () => {
  for (const [start, end] of [[10, null], [null, 10], [20, 10], [0, 0]]) {
    const run = fixture();
    run(`controller.setPoint('start', ${start}); controller.setPoint('end', ${end})`);
    assert.equal(run("controller.getState().canToggle"), false);
    run("controller.toggle()");
    assert.equal(run("controller.enabled"), false);
    assert.equal(run("controller.start"), start);
    assert.equal(run("controller.end"), end);
  }
});

test("empty bounds require a known positive finite duration", () => {
  for (const duration of ["NaN", "Infinity", "0", "-1"]) {
    const run = fixture();
    run(`video.duration = ${duration}`);
    assert.equal(run("controller.getState().canToggle"), false);
    run("controller.toggle()");
    assert.equal(run("controller.enabled"), false);
    assert.equal(run("controller.start"), null);
    assert.equal(run("controller.end"), null);
  }
});

test("loaded metadata makes an empty range available", () => {
  const run = fixture();
  run("video.duration = NaN; video.dispatchEvent(new Event('durationchange'))");
  assert.equal(run("states.at(-1).canToggle"), false);
  run("video.duration = 123.5; video.dispatchEvent(new Event('loadedmetadata'))");
  assert.equal(run("states.at(-1).canToggle"), true);
  run("controller.toggle()");
  assert.equal(run("controller.end"), 123.5);
});

test("no bound video cannot enable looping", () => {
  const run = fixture();
  run("controller.bind(null)");
  assert.equal(run("controller.getState().canToggle"), false);
  run("controller.toggle()");
  assert.equal(run("controller.enabled"), false);
});

test("clearing resets the range but permits another full-video loop", () => {
  const run = fixture();
  run("controller.toggle(); controller.clear()");
  assert.equal(run("controller.enabled"), false);
  assert.equal(run("controller.start"), null);
  assert.equal(run("controller.end"), null);
  assert.equal(run("controller.getState().canToggle"), true);
  run("controller.toggle()");
  assert.equal(run("controller.enabled"), true);
});

test("automatic bounds use the existing record format and survive reload", () => {
  const run = fixture();
  run(`controller.toggle();
    const store = new StateStore();
    store.setRecord('dQw4w9WgXcQ', controller.getRecordState());
    const reloaded = new StateStore().getRecord('dQw4w9WgXcQ');
    controller.clear(); controller.loadRecord(reloaded);`);
  assert.equal(run("controller.enabled"), true);
  assert.equal(run("controller.start"), 0);
  assert.equal(run("controller.end"), 180);
});

test("the shortcut uses the same full-video default", () => {
  const run = fixture();
  run(`const app = Object.create(Application.prototype);
    app.loopController = controller;
    app.executeShortcut('toggleLoop');`);
  assert.equal(run("controller.enabled"), true);
  assert.equal(run("controller.start"), 0);
  assert.equal(run("controller.end"), 180);
});

test("the existing loop engine seeks to zero at the end of a full-video range", () => {
  const run = fixture();
  run(`controller.toggle();
    video.currentTime = video.duration; video.ended = true;
    video.dispatchEvent(new Event('ended'));`);
  assert.equal(run("video.currentTime"), 0);
  assert.equal(run("controller.seekState.shouldResume"), true);
  run("video.ended = false; controller.handleSeeked()");
  assert.equal(run("video.playCalls"), 1);
  assert.equal(run("controller.seekState"), null);
});

test("the panel enables empty times and still disables partial ranges", () => {
  const run = fixture();
  run(`const view = Object.create(PanelView.prototype);
    const element = () => ({ dataset: {}, setAttribute() {}, removeAttribute() {}, setCustomValidity() {} });
    view.t = key => key;
    view.refs = Object.fromEntries([
      'loopToggle', 'setStartButton', 'setEndButton', 'clearLoopButton',
      'loopStartInput', 'loopEndInput', 'loopStatus', 'loopPersistence',
    ].map(key => [key, element()]));
    view.renderLoop(controller.getState(), {});`);
  assert.equal(run("view.refs.loopToggle.disabled"), false);
  run("controller.setPoint('start', 10); view.renderLoop(controller.getState(), {})");
  assert.equal(run("view.refs.loopToggle.disabled"), true);
  run("controller.clear(); controller.toggle(); view.renderLoop(controller.getState(), {})");
  assert.equal(run("view.refs.loopToggle.disabled"), false);
  assert.equal(run("view.refs.loopStartInput.value"), "00:00.000");
  assert.equal(run("view.refs.loopEndInput.value"), "03:00.000");
});

test("binding preserves an existing native loop without inventing A-B bounds", () => {
  const run = fixture();
  run("controller.bind(null); video.loop = true; controller.bind(video)");
  assert.equal(run("video.loop"), true);
  assert.equal(run("controller.getState().enabled"), true);
  assert.equal(run("controller.getState().nativeLoop"), true);
  assert.equal(run("controller.start"), null);
  assert.equal(run("controller.end"), null);
  assert.equal(run("records.length"), 0);
});

test("the video observer watches only the loop attribute", () => {
  const run = fixture();
  assert.equal(run("controller.nativeLoopObserver.target === video"), true);
  assert.equal(run("controller.nativeLoopObserver.options.attributes"), true);
  assert.equal(run("JSON.stringify(controller.nativeLoopObserver.options.attributeFilter)"), '["loop"]');
  assert.equal(run("controller.nativeLoopObserver.options.subtree"), undefined);
});

test("native loop changes update the notified state even while paused", () => {
  const run = fixture();
  run("video.loop = true; controller.nativeLoopObserver.callback()");
  assert.equal(run("states.at(-1).enabled"), true);
  assert.equal(run("states.at(-1).nativeLoop"), true);
  run("video.loop = false; controller.nativeLoopObserver.callback()");
  assert.equal(run("states.at(-1).enabled"), false);
  assert.equal(run("states.at(-1).nativeLoop"), false);
  assert.equal(run("records.length"), 0);
  assert.equal(run("video.playCalls"), 0);
  assert.equal(run("video.currentTime"), 40);
});

test("native looping can be disabled with partial bounds or unknown duration", () => {
  for (const duration of ["NaN", "Infinity", "0", "180"]) {
    const run = fixture();
    run(`controller.setPoint('start', 10); video.duration = ${duration};
      video.loop = true; controller.nativeLoopObserver.callback()`);
    assert.equal(run("controller.getState().canToggle"), true);
    run("controller.toggle()");
    assert.equal(run("video.loop"), false);
    assert.equal(run("controller.getState().enabled"), false);
    assert.equal(run("controller.start"), 10);
    assert.equal(run("controller.end"), null);
  }
});

test("native looping suspends A-B playback without losing saved boundaries", () => {
  const run = fixture();
  run(`controller.setPoint('start', 15); controller.setPoint('end', 50);
    controller.toggle();
    video.cancelledFrames = [];
    video.cancelVideoFrameCallback = id => video.cancelledFrames.push(id);
    controller.frameRequest = {video, id: 7};
    controller.seekState = {target: 15, shouldResume: false};
    controller.statusKey = 'loadingA';
    video.loop = true;
    controller.nativeLoopObserver.callback();`);
  assert.equal(run("controller.enabled"), false);
  assert.equal(run("controller.getState().enabled"), true);
  assert.equal(run("controller.getState().nativeLoop"), true);
  assert.equal(run("controller.start"), 15);
  assert.equal(run("controller.end"), 50);
  assert.equal(run("controller.frameRequest"), null);
  assert.equal(run("controller.seekState"), null);
  assert.equal(run("controller.statusKey"), null);
  assert.equal(run("JSON.stringify(video.cancelledFrames)"), '[7]');
  assert.equal(run("records.at(-1).enabled"), false);
  assert.equal(run("records.at(-1).start"), 15);
  run("const count = records.length; controller.nativeLoopObserver.callback()");
  assert.equal(run("records.length === count"), true);
});

test("the A-B engine does not seek before a native-loop mutation is delivered", () => {
  const run = fixture();
  run(`controller.setPoint('start', 15); controller.setPoint('end', 50);
    controller.toggle(); video.loop = true; video.currentTime = 80;
    video.paused = false; controller.enforce(); controller.startScheduler();`);
  assert.equal(run("video.currentTime"), 80);
  assert.equal(run("controller.seekState"), null);
  assert.equal(run("controller.frameRequest"), null);
  assert.equal(run("controller.fallbackTimer"), null);
});

test("a panel toggle disables native and A-B looping before observer delivery", () => {
  const run = fixture();
  run("controller.toggle(); video.loop = true; controller.toggle()");
  assert.equal(run("video.loop"), false);
  assert.equal(run("controller.enabled"), false);
  run("controller.nativeLoopObserver.callback()");
  assert.equal(run("states.at(-1).enabled"), false);
});

test("clear disables native looping and clears the saved A-B state", () => {
  const run = fixture();
  run("controller.setPoint('start', 12); video.loop = true; controller.clear()");
  assert.equal(run("video.loop"), false);
  assert.equal(run("controller.getState().enabled"), false);
  assert.equal(run("records.at(-1).start"), null);
  assert.equal(run("records.at(-1).end"), null);
  assert.equal(run("records.at(-1).enabled"), false);
});

test("explicitly loading an enabled A-B record takes control from native looping", () => {
  const run = fixture();
  run(`video.loop = true; controller.nativeLoopObserver.callback();
    controller.loadRecord({start: 12, end: 50, enabled: true});
    controller.nativeLoopObserver.callback();`);
  assert.equal(run("video.loop"), false);
  assert.equal(run("controller.enabled"), true);
  assert.equal(run("controller.start"), 12);
  assert.equal(run("controller.end"), 50);
});

test("an enabled saved A-B range is restored when binding a native-looping video", () => {
  const run = fixture();
  run(`controller.bind(null); video.loop = true;
    controller.loadRecord({start: 12, end: 50, enabled: true});
    controller.bind(video);`);
  assert.equal(run("video.loop"), false);
  assert.equal(run("controller.enabled"), true);
  assert.equal(run("controller.start"), 12);
  assert.equal(run("controller.end"), 50);
});

test("replacing a video disconnects its loop observer and ignores stale callbacks", () => {
  const run = fixture();
  run(`const previous = controller.nativeLoopObserver;
    const nextVideo = Object.assign(new EventTarget(), {
      duration: 90, currentTime: 0, loop: false, paused: true, ended: false,
    });
    controller.bind(nextVideo); const count = states.length;
    video.loop = true; previous.callback();`);
  assert.equal(run("previous.target"), null);
  assert.equal(run("controller.nativeLoopObserver.target === nextVideo"), true);
  assert.equal(run("states.length === count"), true);
  assert.equal(run("controller.getState().enabled"), false);
});

test("destroy disconnects the observer without cancelling a native loop", () => {
  const run = fixture();
  run(`video.loop = true; controller.nativeLoopObserver.callback();
    const observer = controller.nativeLoopObserver;
    controller.destroy(); const count = states.length;
    observer.callback();`);
  assert.equal(run("observer.target"), null);
  assert.equal(run("controller.nativeLoopObserver"), null);
  assert.equal(run("video.loop"), true);
  assert.equal(run("states.length === count"), true);
});

test("a native loop is labelled separately and is not presented as a saved A-B state", () => {
  const run = fixture();
  run(`const view = Object.create(PanelView.prototype);
    const element = () => ({dataset: {}, attributes: {},
      setAttribute(k,v) {this.attributes[k]=v;}, removeAttribute() {}, setCustomValidity() {}});
    view.t = key => key;
    view.refs = Object.fromEntries([
      'loopToggle', 'setStartButton', 'setEndButton', 'clearLoopButton',
      'loopStartInput', 'loopEndInput', 'loopStatus', 'loopPersistence',
    ].map(key => [key, element()]));
    video.loop = true; controller.nativeLoopObserver.callback();
    view.renderLoop(controller.getState(), {saved:true});`);
  assert.equal(run("view.refs.loopToggle.attributes['aria-pressed']"), 'true');
  assert.equal(run("view.refs.loopToggle.disabled"), false);
  assert.equal(run("view.refs.loopStatus.textContent"), 'nativeLoopActive');
  assert.equal(run("view.refs.loopPersistence.textContent"), '');
  assert.equal(run("view.refs.loopStartInput.value"), '');
  assert.equal(run("view.refs.loopEndInput.value"), '');
});
