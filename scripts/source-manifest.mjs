export const sourceEntries = Object.freeze([
  "src/config/constants.js",
  "src/i18n/messages.js",
  "src/ui/styles.js",
  "src/core/utils.js",
  "src/core/normalization.js",
  "src/storage/state-store.js",
  "src/i18n/translator.js",
  "src/core/time-codec.js",
  "src/ui/style-manager.js",
  "src/youtube/routes.js",
  "src/youtube/panel-host.js",
  "src/youtube/video-resolver.js",
  "src/core/events.js",
  "src/services/backup-service.js",
  "src/controllers/speed-controller.js",
  "src/controllers/loop-controller.js",
  "src/controllers/shortcut-manager.js",
  "src/controllers/auto-confirm-controller.js",
  Object.freeze({
    type: "class-fragments",
    className: "PanelView",
    files: Object.freeze([
      "src/ui/panel-view/core.js",
      "src/ui/panel-view/events.js",
      "src/ui/panel-view/rendering.js",
      "src/ui/panel-view/records.js",
    ]),
  }),
  "src/app/application.js",
  "src/main.js",
]);

export const sourceFiles = Object.freeze(
  sourceEntries.flatMap((entry) =>
    typeof entry === "string" ? [entry] : [...entry.files],
  ),
);
