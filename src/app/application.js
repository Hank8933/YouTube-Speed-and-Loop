class Application {
  constructor() {
    this.store = new StateStore();
    this.preferences = this.store.getPreferences();
    this.translator = new Translator(this.preferences.language);
    this.backupService = new BackupService(this.store);

    this.appAbortController = new AbortController();
    this.panelAbortController = null;
    this.domObserver = null;
    this.reconcileTimer = null;
    this.reconcileDueAt = Number.POSITIVE_INFINITY;

    this.view = null;
    this.route = null;
    this.routeSignature = "";
    this.video = null;
    this.pendingUnknownVideo = null;
    this.mediaRetryCount = 0;
    this.persistenceFailed = false;
    this.started = false;
    this.waitingForDocument = false;
    this.destroyed = false;

    this.speedController = new SpeedController((state) => {
      this.view?.renderSpeed(state);
    });

    this.loopController = new LoopController({
      onStateChange: (state) => {
        this.renderLoop(state);
      },
      onRecordChange: (record) => {
        this.persistCurrentRecord(record);
      },
    });

    this.shortcutManager = new ShortcutManager({
      bindings: this.store.getShortcuts(),
      onChange: (bindings) => {
        this.persistShortcuts(bindings);
      },
      onAction: (action) => {
        this.executeShortcut(action);
      },
    });

    this.autoConfirmController = new AutoConfirmController(
      this.preferences.autoConfirm,
    );
  }

  start() {
    if (this.destroyed || this.started) {
      return;
    }

    if (this.redirectShortsIfNeeded()) {
      return;
    }

    if (!document.documentElement) {
      if (!this.waitingForDocument) {
        this.waitingForDocument = true;

        document.addEventListener(
          "readystatechange",
          () => {
            this.waitingForDocument = false;
            this.start();
          },
          {
            once: true,
            signal: this.appAbortController.signal,
          },
        );
      }

      return;
    }

    this.started = true;
    installStyle();

    const { signal } = this.appAbortController;

    this.shortcutManager.start(signal);

    document.addEventListener(
      "yt-navigate-start",
      () => {
        this.handleNavigationStart();
      },
      { signal },
    );

    for (const eventName of [
      "yt-navigate-finish",
      "yt-page-data-updated",
      "yt-player-updated",
    ]) {
      document.addEventListener(
        eventName,
        () => {
          this.scheduleReconcile(0);
        },
        { signal },
      );
    }

    window.addEventListener(
      "popstate",
      () => {
        this.scheduleReconcile(0);
      },
      { signal },
    );

    window.addEventListener(
      "hashchange",
      () => {
        this.scheduleReconcile(0);
      },
      { signal },
    );

    window.addEventListener(
      "pageshow",
      () => {
        this.scheduleReconcile(0);
      },
      { signal },
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          this.scheduleReconcile(0);
        }
      },
      { signal },
    );

    window.addEventListener(
      "pagehide",
      (event) => {
        if (!event.persisted) {
          this.destroy();
        }
      },
      { signal },
    );

    for (const eventName of [
      "play",
      "playing",
      "loadedmetadata",
      "durationchange",
      "emptied",
    ]) {
      document.addEventListener(
        eventName,
        (event) => {
          if (event.target instanceof HTMLVideoElement && isPlaybackPath()) {
            this.scheduleReconcile(0);
          }
        },
        {
          capture: true,
          signal,
        },
      );
    }

    document.addEventListener(
      "scroll",
      () => {
        if (/^\/shorts(?:\/|$)/.test(location.pathname)) {
          this.scheduleReconcile(RECONCILE.visualChangeDelayMs);
        }
      },
      {
        capture: true,
        passive: true,
        signal,
      },
    );

    window.addEventListener(
      "resize",
      () => {
        if (isPlaybackPath()) {
          this.scheduleReconcile(RECONCILE.visualChangeDelayMs);
        }
      },
      {
        passive: true,
        signal,
      },
    );

    this.domObserver = new MutationObserver((records) => {
      this.handleMutations(records);
    });

    this.domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "video-id",
        "data-video-id",
        "is-active",
        "active",
        "aria-hidden",
        "hidden",
      ],
    });

    if (this.preferences.autoConfirm) {
      this.autoConfirmController.refresh();
    }

    this.scheduleReconcile(0);
  }

  redirectShortsIfNeeded() {
    this.preferences = this.store.getPreferences();

    const route = parseLocationRoute();

    if (!this.preferences.shortsAsWatch || route?.type !== "shorts") {
      return false;
    }

    const target = createWatchUrl(route.videoId);

    if (target.href === location.href) {
      return false;
    }

    location.replace(target.href);
    return true;
  }

  handleNavigationStart() {
    this.bindVideo(null);
    this.route = null;
    this.routeSignature = "";
    this.pendingUnknownVideo = null;
    this.mediaRetryCount = 0;
    this.persistenceFailed = false;

    this.loopController.loadRecord(null);
    this.view?.clearLoopInputErrors();
    this.view?.setPlaybackVisible(isPlaybackPath());
    this.renderAll();

    /*
     * Some Shorts transitions emit yt-navigate-start without a
     * matching finish event. Schedule a fallback reconciliation.
     */
    this.scheduleReconcile(RECONCILE.navigationFallbackDelayMs);
  }

  handleMutations(records) {
    if (this.destroyed) {
      return;
    }

    if (this.view && !this.view.panel.isConnected) {
      this.scheduleReconcile(0);
      return;
    }

    if (this.video && !this.video.isConnected) {
      this.scheduleReconcile(0);
      return;
    }

    const locationSignature = routeKey(parseLocationRoute());

    if (locationSignature && locationSignature !== this.routeSignature) {
      this.scheduleReconcile(0);
      return;
    }

    for (const record of records) {
      if (
        record.type === "attributes" &&
        record.target instanceof Element &&
        record.target.matches(
          [SELECTORS.watchRoot, SELECTORS.shortsRenderer, "video"].join(","),
        )
      ) {
        this.scheduleReconcile(0);
        return;
      }

      const changedNodes = [...record.addedNodes, ...record.removedNodes];

      if (changedNodes.some(nodeAffectsLifecycle)) {
        this.scheduleReconcile(0);
        return;
      }
    }
  }

  /**
   * @param {number} [delay]
   */
  scheduleReconcile(delay = RECONCILE.defaultDelayMs) {
    if (this.destroyed) {
      return;
    }

    const normalizedDelay = Number.isFinite(delay) && delay > 0 ? delay : 0;
    const dueAt = Date.now() + normalizedDelay;

    if (this.reconcileTimer !== null && dueAt >= this.reconcileDueAt) {
      return;
    }

    if (this.reconcileTimer !== null) {
      clearTimeout(this.reconcileTimer);
    }

    this.reconcileDueAt = dueAt;
    this.reconcileTimer = window.setTimeout(() => {
      this.reconcileTimer = null;
      this.reconcileDueAt = Number.POSITIVE_INFINITY;

      try {
        this.reconcile();
      } catch (error) {
        console.error(`${LOG_PREFIX} Reconciliation failed.`, error);
      }
    }, normalizedDelay);
  }

  reconcile() {
    if (this.destroyed || this.redirectShortsIfNeeded()) {
      return;
    }

    this.reconcilePanel();

    const context = resolvePlaybackContext();
    const fallbackRoute = parseLocationRoute();
    const nextRoute = context?.route ?? fallbackRoute;
    const nextSignature = routeKey(nextRoute);
    const routeChanged = nextSignature !== this.routeSignature;

    if (routeChanged) {
      /*
       * YouTube frequently reuses the same <video> element across
       * SPA navigation and Shorts swipes. Detach old listeners
       * before loading the next record.
       */
      this.bindVideo(null);
      this.route = nextRoute;
      this.routeSignature = nextSignature;
      this.pendingUnknownVideo = null;
      this.mediaRetryCount = 0;
      this.persistenceFailed = false;

      this.loopController.loadRecord(
        this.store.getRecord(nextRoute?.videoId),
      );
      this.view?.clearLoopInputErrors();
    }

    let nextVideo = context?.video ?? null;

    /*
     * A Shorts renderer can briefly expose a playable <video> before
     * its videoId is available. Require the same unknown candidate
     * to win several consecutive resolutions before binding it.
     */
    if (nextVideo && context?.verified === false) {
      const sameCandidate =
        this.pendingUnknownVideo?.signature === nextSignature &&
        this.pendingUnknownVideo?.video === nextVideo;

      this.pendingUnknownVideo = {
        signature: nextSignature,
        video: nextVideo,
        count: sameCandidate ? this.pendingUnknownVideo.count + 1 : 1,
      };

      if (
        this.pendingUnknownVideo.count <
        RECONCILE.unknownVideoConfirmations
      ) {
        nextVideo = null;
        this.scheduleReconcile(RECONCILE.unknownVideoRetryDelayMs);
      }
    } else {
      this.pendingUnknownVideo = null;
    }

    if (nextVideo) {
      this.mediaRetryCount = 0;

      if (nextVideo !== this.video) {
        this.bindVideo(nextVideo);
      }
    } else if (this.video && !this.video.isConnected) {
      this.bindVideo(null);
    }

    const shouldShowPlaybackControls =
      Boolean(nextRoute) || Boolean(nextVideo) || isPlaybackPath();

    this.view?.setPlaybackVisible(shouldShowPlaybackControls);
    this.autoConfirmController.refresh();
    this.renderAll();

    /*
     * Initial player construction is asynchronous. Retries are
     * bounded and stop immediately once a video is bound.
     */
    if (
      shouldShowPlaybackControls &&
      !this.video &&
      this.mediaRetryCount < RECONCILE.maxMediaRetries
    ) {
      this.mediaRetryCount += 1;

      this.scheduleReconcile(
        Math.min(
          RECONCILE.maxMediaRetryDelayMs,
          RECONCILE.mediaRetryStepMs * this.mediaRetryCount,
        ),
      );
    }
  }

  reconcilePanel() {
    const host = resolvePanelHost();

    if (!host) {
      this.disposePanel();
      return;
    }

    const currentPanel = this.view?.panel;
    const floatingMatches =
      currentPanel?.classList.contains("ytec-floating") === host.floating;

    if (
      currentPanel?.isConnected &&
      currentPanel.parentElement === host.container &&
      floatingMatches
    ) {
      return;
    }

    this.disposePanel();
    document.getElementById(PANEL_ID)?.remove();

    this.panelAbortController = new AbortController();
    this.view = new PanelView({
      container: host.container,
      floating: host.floating,
      translator: this.translator,
      handlers: this.createViewHandlers(),
      signal: this.panelAbortController.signal,
    });

    this.view.setPlaybackVisible(Boolean(this.route) || isPlaybackPath());
    this.renderAll();
  }

  createViewHandlers() {
    return {
      setSpeed: (rate) => {
        this.speedController.setRate(rate);
      },

      toggleLoop: () => {
        this.loopController.toggle();
      },

      setPointNow: (point) => {
        this.setPointFromCurrentTime(point);
      },

      setPointText: (point, text) => this.setPointFromText(point, text),

      clearLoop: () => {
        this.view?.clearLoopInputErrors();
        this.loopController.clear();
      },

      setLanguage: (language) => {
        this.setLanguage(language);
      },

      setSpeedStep: (step) => {
        this.setSpeedStep(step);
      },

      toggleShortsAsWatch: () => {
        this.toggleShortsAsWatch();
      },

      toggleAutoConfirm: () => {
        this.toggleAutoConfirm();
      },

      captureShortcut: (event, action) =>
        this.shortcutManager.capture(event, action),

      clearShortcuts: () => {
        this.shortcutManager.clearAll();
      },

      exportBackup: () => {
        this.exportBackup();
      },

      importBackup: (file, mode) => this.importBackup(file, mode),

      deleteCurrentRecord: () => {
        this.deleteCurrentRecord();
      },

      listRecords: (query) => this.listRecords(query),

      saveRecord: (videoId, startText, endText, enabled) =>
        this.saveManagedRecord(videoId, startText, endText, enabled),

      deleteRecord: (videoId) => this.deleteManagedRecord(videoId),

      deleteAllRecords: () => this.deleteAllManagedRecords(),

      openRecord: (videoId) => {
        this.openRecord(videoId);
      },
    };
  }

  bindVideo(video) {
    if (video === this.video) {
      return;
    }

    this.video = video;
    this.speedController.bind(video);
    this.loopController.bind(video);
  }

  setPointFromCurrentTime(point) {
    if (!this.video || !Number.isFinite(this.video.currentTime)) {
      return;
    }

    this.view?.clearLoopInputError(point);
    this.loopController.setPoint(point, this.video.currentTime);
  }

  setPointFromText(point, text) {
    const parsed = TimeCodec.parse(text);

    if (!parsed.valid) {
      return {
        valid: false,
        messageKey: "invalidTime",
      };
    }

    this.loopController.setPoint(point, parsed.value);

    return {
      valid: true,
    };
  }

  persistCurrentRecord(record) {
    if (!this.route) {
      return;
    }

    const empty = record.start === null && record.end === null;

    const persisted = empty
      ? this.store.deleteRecord(this.route.videoId)
      : this.store.setRecord(this.route.videoId, {
          ...record,
          title: getVideoTitle(this.video),
          source: this.route.type,
          updatedAt: new Date().toISOString(),
        });

    this.persistenceFailed = !persisted;
    this.renderAll();
    this.view?.refreshRecordManager();
  }

  persistShortcuts(bindings) {
    if (!this.store.setShortcuts(bindings)) {
      this.shortcutManager.setBindings(this.store.getShortcuts());
      this.view?.setBackupMessage("storageError", {}, true);
    }

    this.renderAll();
  }

  setLanguage(language) {
    const persisted = this.store.setPreferences({
      language: normalizeLanguage(language),
    });

    if (!persisted) {
      this.view?.setBackupMessage("storageError", {}, true);
      this.renderAll();
      return;
    }

    this.preferences = this.store.getPreferences();
    this.translator.setPreference(this.preferences.language);
    this.view?.applyLanguage();
    this.renderAll();
    this.view?.refreshRecordManager();
  }

  setSpeedStep(step) {
    const persisted = this.store.setPreferences({
      speedStep: normalizeSpeedStep(step),
    });

    if (!persisted) {
      this.view?.setBackupMessage("storageError", {}, true);
      this.renderAll();
      return;
    }

    this.preferences = this.store.getPreferences();
    this.renderAll();
  }

  toggleShortsAsWatch() {
    const persisted = this.store.setPreferences({
      shortsAsWatch: !this.preferences.shortsAsWatch,
    });

    if (!persisted) {
      this.view?.setBackupMessage("storageError", {}, true);
      this.renderAll();
      return;
    }

    this.preferences = this.store.getPreferences();
    this.renderAll();
    this.redirectShortsIfNeeded();
  }

  toggleAutoConfirm() {
    const persisted = this.store.setPreferences({
      autoConfirm: !this.preferences.autoConfirm,
    });

    if (!persisted) {
      this.view?.setBackupMessage("storageError", {}, true);
      this.renderAll();
      return;
    }

    this.preferences = this.store.getPreferences();
    this.autoConfirmController.setEnabled(this.preferences.autoConfirm);
    this.renderAll();
  }

  executeShortcut(action) {
    switch (action) {
      case "speedDown":
        this.speedController.adjust(-1, this.preferences.speedStep);
        break;

      case "speedUp":
        this.speedController.adjust(1, this.preferences.speedStep);
        break;

      case "speedReset":
        this.speedController.setRate(1);
        break;

      case "toggleLoop":
        this.loopController.toggle();
        break;

      case "setStart":
        this.setPointFromCurrentTime("start");
        break;

      case "jumpStart":
        this.loopController.jumpToStart();
        break;

      case "setEnd":
        this.setPointFromCurrentTime("end");
        break;

      case "clearLoop":
        this.view?.clearLoopInputErrors();
        this.loopController.clear();
        break;

      default:
        break;
    }
  }

  listRecords(query) {
    const records = this.store.listRecords();
    const needle = String(query ?? "")
      .trim()
      .toLocaleLowerCase();

    if (!needle) {
      return {
        items: records,
        total: records.length,
      };
    }

    return {
      items: records.filter((record) => {
        const title = record.title?.toLocaleLowerCase() ?? "";

        return (
          record.videoId.toLocaleLowerCase().includes(needle) ||
          title.includes(needle) ||
          record.source.toLocaleLowerCase().includes(needle)
        );
      }),
      total: records.length,
    };
  }

  saveManagedRecord(videoId, startText, endText, enabled) {
    const normalizedId = normalizeVideoId(videoId);

    if (!normalizedId) {
      return {
        ok: false,
        messageKey: "storageError",
      };
    }

    const parsedStart = TimeCodec.parse(startText);
    const parsedEnd = TimeCodec.parse(endText);

    if (!parsedStart.valid) {
      return {
        ok: false,
        messageKey: "invalidTime",
        field: "start",
      };
    }

    if (!parsedEnd.valid) {
      return {
        ok: false,
        messageKey: "invalidTime",
        field: "end",
      };
    }

    const start = parsedStart.value;
    const end = parsedEnd.value;
    const empty = start === null && end === null;
    const validRange =
      Number.isFinite(start) && Number.isFinite(end) && end > start;

    if (
      !empty &&
      ((start !== null && end !== null && !validRange) ||
        (enabled && !validRange))
    ) {
      return {
        ok: false,
        messageKey: "invalidRange",
      };
    }

    const existing = this.store.getRecord(normalizedId);
    const isCurrent = normalizedId === this.route?.videoId;

    const persisted = empty
      ? this.store.deleteRecord(normalizedId)
      : this.store.setRecord(normalizedId, {
          start,
          end,
          enabled: Boolean(enabled),
          title:
            existing?.title || (isCurrent ? getVideoTitle(this.video) : ""),
          source: existing?.source ?? (isCurrent ? this.route.type : "watch"),
          updatedAt: new Date().toISOString(),
        });

    if (!persisted) {
      return {
        ok: false,
        messageKey: "storageError",
      };
    }

    if (isCurrent) {
      this.persistenceFailed = false;
      this.loopController.loadRecord(this.store.getRecord(normalizedId));
      this.view?.clearLoopInputErrors();
    }

    this.renderAll();

    return {
      ok: true,
      deleted: empty,
    };
  }

  deleteManagedRecord(videoId) {
    const normalizedId = normalizeVideoId(videoId);

    if (!normalizedId || !this.store.deleteRecord(normalizedId)) {
      return {
        ok: false,
        messageKey: "storageError",
      };
    }

    if (normalizedId === this.route?.videoId) {
      this.persistenceFailed = false;
      this.loopController.loadRecord(null);
      this.view?.clearLoopInputErrors();
    }

    this.renderAll();

    return {
      ok: true,
    };
  }

  deleteAllManagedRecords() {
    if (!this.store.clearRecords()) {
      return {
        ok: false,
        messageKey: "storageError",
      };
    }

    this.persistenceFailed = false;
    this.loopController.loadRecord(null);
    this.view?.clearLoopInputErrors();
    this.renderAll();

    return {
      ok: true,
    };
  }

  openRecord(videoId) {
    const record = this.store.getRecord(videoId);

    if (!record) {
      return;
    }

    const target = createRecordUrl(
      {
        videoId,
        ...record,
      },
      this.preferences.shortsAsWatch,
    );

    const opened = window.open(target.href, "_blank", "noopener,noreferrer");

    if (opened) {
      opened.opener = null;
    }
  }

  exportBackup() {
    try {
      const count = this.backupService.exportToFile();

      this.view?.setBackupMessage("backupExported", { count }, false);
    } catch {
      this.view?.setBackupMessage("exportError", {}, true);
    }
  }

  async importBackup(file, mode) {
    if (!file) {
      return;
    }

    if (
      mode === "replace" &&
      !window.confirm(this.translator.t("confirmReplaceImport"))
    ) {
      return;
    }

    try {
      const result = await this.backupService.importFromFile(file, mode);

      if (!result.persisted) {
        this.view?.setBackupMessage("storageError", {}, true);
        return;
      }

      this.preferences = this.store.getPreferences();

      this.translator.setPreference(this.preferences.language);

      this.shortcutManager.setBindings(this.store.getShortcuts());

      this.autoConfirmController.setEnabled(this.preferences.autoConfirm);

      this.persistenceFailed = false;
      this.loopController.loadRecord(
        this.store.getRecord(this.route?.videoId),
      );

      this.view?.clearLoopInputErrors();
      this.view?.applyLanguage();
      this.renderAll();
      this.view?.refreshRecordManager();

      this.view?.setBackupMessage(
        "backupImported",
        {
          count: result.count,
        },
        false,
      );

      this.redirectShortsIfNeeded();
    } catch (error) {
      const messageKey =
        error instanceof BackupError ? error.messageKey : "importReadError";

      this.view?.setBackupMessage(messageKey, {}, true);
    }
  }

  deleteCurrentRecord() {
    if (!this.route) {
      return;
    }

    const result = this.deleteManagedRecord(this.route.videoId);

    this.view?.setBackupMessage(
      result.ok ? "currentDeleted" : result.messageKey,
      {},
      !result.ok,
    );

    this.view?.refreshRecordManager();
  }

  renderLoop(state = this.loopController.getState()) {
    if (!this.view) {
      return;
    }

    this.view.renderLoop(state, {
      saved: Boolean(this.store.getRecord(this.route?.videoId)),
      failed: this.persistenceFailed,
    });
  }

  renderAll() {
    if (!this.view) {
      return;
    }

    this.preferences = this.store.getPreferences();

    this.view.renderSpeed(this.speedController.getState());

    this.renderLoop();

    this.view.renderPreferences(this.preferences);

    this.view.renderShortcuts(this.shortcutManager.getBindings(), (binding) =>
      this.shortcutManager.format(binding),
    );

    this.view.renderStorage(
      this.store.countRecords(),
      Boolean(this.store.getRecord(this.route?.videoId)),
    );
  }

  disposePanel() {
    this.panelAbortController?.abort();
    this.panelAbortController = null;
    this.view?.remove();
    this.view = null;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    if (this.reconcileTimer !== null) {
      clearTimeout(this.reconcileTimer);
    }

    this.reconcileTimer = null;
    this.reconcileDueAt = Number.POSITIVE_INFINITY;
    this.domObserver?.disconnect();
    this.domObserver = null;
    this.panelAbortController?.abort();
    this.panelAbortController = null;
    this.appAbortController.abort();

    this.speedController.destroy();
    this.loopController.destroy();
    this.autoConfirmController.destroy();
    this.view?.remove();

    this.view = null;
    this.video = null;
    this.route = null;
    this.routeSignature = "";
    this.pendingUnknownVideo = null;

    document.getElementById(STYLE_ID)?.remove();

    for (const key of [APP_KEY, ...LEGACY_APP_KEYS]) {
      if (window[key] === this) {
        delete window[key];
      }
    }
  }
}
