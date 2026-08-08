const APP_KEY = "__ytecApplication__";
const LEGACY_APP_KEYS = Object.freeze(["__ytecApplicationV4__"]);
const LOG_PREFIX = "[YouTube Speed and A-B Loop]";
const PANEL_ID = "ytec-panel";
const STYLE_ID = "ytec-style";
const STATE_KEY = "ytec-state-v2";
const LEGACY_STATE_KEYS = Object.freeze(["ytec-state-v1"]);
const STATE_VERSION = 2;
const BACKUP_FORMAT = "youtube-speed-loop-backup";
const BACKUP_VERSION = 2;
const SUPPORTED_BACKUP_VERSIONS = new Set([1, 2]);
const SUPPORTED_STATE_VERSIONS = new Set([1, 2]);
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_TITLE_LENGTH = 300;
const BACKUP_URL_REVOKE_DELAY_MS = 1000;

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SHORTS_PATH_PATTERN = /^\/shorts\/([A-Za-z0-9_-]{11})(?:\/|$)/;

const LEGACY_KEYS = Object.freeze({
  language: "yt-speed-loop-language",
  speedStep: "yt-speed-loop-shortcut-step",
  shortcuts: "yt-speed-loop-shortcuts",
  autoConfirm: "yt-auto-confirm-enabled",
});

const SELECTORS = Object.freeze({
  mastheadButtons: "ytd-masthead #end #buttons",
  mastheadEnd: "ytd-masthead #end",
  watchRoot: "ytd-watch-flexy",
  player: "#movie_player, .html5-video-player",
  shortsRenderer: "ytd-reel-video-renderer",
  popupRoot: "ytd-popup-container",
  confirmDialog: "yt-confirm-dialog-renderer",
});

/** @type {number} */
const DEFAULT_SPEED_SHORTCUT_STEP = 0.25;

const SPEED = Object.freeze({
  min: 0.25,
  max: 5,
  sliderStep: 0.05,
  presets: Object.freeze([1, 1.5, 2, 3, 4, 5]),
  shortcutSteps: Object.freeze([0.05, 0.1, 0.25, 0.5, 1]),
  defaultShortcutStep: DEFAULT_SPEED_SHORTCUT_STEP,
  presetMatchTolerance: 0.001,
});

const LOOP = Object.freeze({
  seekTolerance: 0.25,
  bufferTolerance: 0.25,
  exactSeekTolerance: 0.001,
  minStartTolerance: 0.01,
  maxStartTolerance: 0.08,
  startToleranceDivisor: 8,
  fallbackIntervalMs: 50,
});

const VISIBILITY_SCORE = Object.freeze({
  invisible: -10_000,
  visibleRatioWeight: 1000,
  centeredBonus: 800,
  distancePenaltyWeight: 250,
});

const WATCH_VIDEO_SCORE = Object.freeze({
  matchingVideoIdBonus: 5000,
  mismatchedVideoIdPenalty: 5000,
  mainVideoBonus: 1000,
  playingBonus: 500,
  hasSourceBonus: 100,
});

const SHORTS_VIDEO_SCORE = Object.freeze({
  matchingVideoIdBonus: 5000,
  mismatchedVideoIdPenalty: 500,
  playingBonus: 3500,
  centeredBonus: 2500,
  activeBonus: 1800,
  hiddenPenalty: 7000,
  hasMediaDataBonus: 150,
  hasSourceBonus: 100,
  minimumVisibleRatio: 0.1,
});

const RECONCILE = Object.freeze({
  defaultDelayMs: 25,
  visualChangeDelayMs: 16,
  navigationFallbackDelayMs: 50,
  unknownVideoConfirmations: 3,
  unknownVideoRetryDelayMs: 80,
  maxMediaRetries: 40,
  mediaRetryStepMs: 50,
  maxMediaRetryDelayMs: 1000,
});

const AUTO_CONFIRM_COOLDOWN_MS = 2000;

const LANGUAGES = Object.freeze([
  Object.freeze({ value: "auto", label: null }),
  Object.freeze({ value: "zh-TW", label: "繁體中文" }),
  Object.freeze({ value: "zh-CN", label: "简体中文" }),
  Object.freeze({ value: "en", label: "English" }),
]);

const SHORTCUT_GROUPS = Object.freeze([
  Object.freeze({
    labelKey: "speedShortcuts",
    open: true,
    actions: Object.freeze([
      Object.freeze({ id: "speedDown", labelKey: "speedDown" }),
      Object.freeze({ id: "speedUp", labelKey: "speedUp" }),
      Object.freeze({ id: "speedReset", labelKey: "speedReset" }),
    ]),
  }),
  Object.freeze({
    labelKey: "loopShortcuts",
    open: false,
    actions: Object.freeze([
      Object.freeze({ id: "toggleLoop", labelKey: "toggleLoop" }),
      Object.freeze({ id: "setStart", labelKey: "setStart" }),
      Object.freeze({ id: "jumpStart", labelKey: "jumpStart" }),
      Object.freeze({ id: "setEnd", labelKey: "setEnd" }),
      Object.freeze({ id: "clearLoop", labelKey: "clearLoop" }),
    ]),
  }),
]);

const SHORTCUT_ACTIONS = Object.freeze(
  SHORTCUT_GROUPS.flatMap((group) =>
    group.actions.map((action) => action.id),
  ),
);

const CONTINUE_WATCHING_PATTERNS = Object.freeze([
  /continue watching/i,
  /still watching/i,
  /video paused/i,
  /繼續觀看/,
  /仍在觀看/,
  /影片已暫停/,
  /继续观看/,
  /仍在观看/,
  /视频已暂停/,
]);

const LIFECYCLE_SELECTOR = [
  "ytd-masthead",
  "ytd-watch-flexy",
  "ytd-shorts",
  "ytd-reel-video-renderer",
  "ytd-popup-container",
  "#movie_player",
  ".html5-video-player",
  "video",
  `#${PANEL_ID}`,
].join(",");
