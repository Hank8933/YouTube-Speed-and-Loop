class LoopController {
  constructor({ onStateChange, onRecordChange }) {
    this.onStateChange = onStateChange;
    this.onRecordChange = onRecordChange;
    this.video = null;
    this.abortController = null;
    this.enabled = false;
    this.start = null;
    this.end = null;
    this.statusKey = null;
    this.frameRequest = null;
    this.fallbackTimer = null;
    this.seekState = null;
  }

  bind(video) {
    this.abortController?.abort();
    this.abortController = null;
    this.stopScheduler();
    this.cancelSeek();
    this.video = video;

    if (!video) {
      this.statusKey = null;
      this.notify();
      return;
    }

    try {
      video.loop = false;
    } catch {
      // Native loop is optional and independent from custom A-B Loop.
    }

    this.abortController = new AbortController();
    const { signal } = this.abortController;
    const isCurrent = () => this.video === video;

    const synchronize = () => {
      if (!isCurrent()) {
        return;
      }

      const previous = this.getRecordState();
      this.start = this.clampPoint(this.start);
      this.end = this.clampPoint(this.end);

      if (!this.hasValidRange()) {
        this.enabled = false;
        this.stopScheduler();
      }

      this.notify();

      const current = this.getRecordState();

      if (
        previous.start !== current.start ||
        previous.end !== current.end ||
        previous.enabled !== current.enabled
      ) {
        this.emitRecordChange();
      }

      this.enforce();
      this.startScheduler();
    };

    video.addEventListener("loadedmetadata", synchronize, { signal });
    video.addEventListener("durationchange", synchronize, { signal });

    video.addEventListener(
      "timeupdate",
      () => {
        if (!isCurrent()) {
          return;
        }

        this.maybeCompleteSeek();
        this.enforce();
        this.startScheduler();
      },
      { signal },
    );

    video.addEventListener(
      "seeking",
      () => {
        if (isCurrent()) {
          this.stopScheduler();
        }
      },
      { signal },
    );

    video.addEventListener(
      "seeked",
      () => {
        if (!isCurrent()) {
          return;
        }

        this.handleSeeked();
        this.enforce();
        this.startScheduler();
      },
      { signal },
    );

    video.addEventListener(
      "waiting",
      () => {
        if (isCurrent() && this.seekState) {
          this.statusKey = "loadingA";
          this.notify();
        }
      },
      { signal },
    );

    for (const eventName of ["canplay", "playing"]) {
      video.addEventListener(
        eventName,
        () => {
          if (!isCurrent()) {
            return;
          }

          this.maybeCompleteSeek();
          this.enforce();
          this.startScheduler();
        },
        { signal },
      );
    }

    video.addEventListener(
      "pause",
      () => {
        if (isCurrent()) {
          this.stopScheduler();
        }
      },
      { signal },
    );

    video.addEventListener(
      "ended",
      () => {
        if (isCurrent()) {
          this.enforce();
        }
      },
      { signal },
    );

    video.addEventListener(
      "emptied",
      () => {
        if (!isCurrent()) {
          return;
        }

        this.stopScheduler();
        this.cancelSeek();
      },
      { signal },
    );

    synchronize();
  }

  loadRecord(record) {
    this.stopScheduler();
    this.cancelSeek();
    this.statusKey = null;

    const normalized = normalizeRecord(record);
    this.start = normalized?.start ?? null;
    this.end = normalized?.end ?? null;
    this.enabled = Boolean(normalized?.enabled) && this.hasValidRange();
    this.notify();

    if (this.video && this.enabled) {
      this.enforce();
      this.startScheduler();
    }
  }

  setPoint(point, value) {
    if (point !== "start" && point !== "end") {
      return;
    }

    this.cancelSeek();
    this.statusKey = null;
    this[point] = this.clampPoint(value);

    if (!this.hasValidRange()) {
      this.enabled = false;
      this.stopScheduler();
    }

    this.notify();
    this.emitRecordChange();
    this.startScheduler();
  }

  clear() {
    this.stopScheduler();
    this.cancelSeek();
    this.enabled = false;
    this.start = null;
    this.end = null;
    this.statusKey = null;
    this.notify();
    this.emitRecordChange();
  }

  toggle() {
    if (!this.video || !this.hasValidRange()) {
      return;
    }

    this.statusKey = null;
    this.enabled = !this.enabled;

    if (this.enabled) {
      this.enforce();
      this.startScheduler();
    } else {
      this.stopScheduler();
      this.cancelSeek();
    }

    this.notify();
    this.emitRecordChange();
  }

  jumpToStart() {
    if (this.video && Number.isFinite(this.start)) {
      this.seekToStart();
    }
  }

  getRecordState() {
    return {
      start: this.start,
      end: this.end,
      enabled: this.enabled && this.hasValidRange(),
    };
  }

  getState() {
    return {
      available: Boolean(this.video),
      enabled: this.enabled,
      start: this.start,
      end: this.end,
      validRange: this.hasValidRange(),
      statusKey: this.statusKey,
    };
  }

  emitRecordChange() {
    this.onRecordChange?.(this.getRecordState());
  }

  notify() {
    this.onStateChange?.(this.getState());
  }

  clampPoint(value) {
    const time = normalizeNullableTime(value);

    if (time === null) {
      return null;
    }

    const duration =
      Number.isFinite(this.video?.duration) && this.video.duration > 0
        ? this.video.duration
        : Number.POSITIVE_INFINITY;

    return clamp(time, 0, duration);
  }

  hasValidRange() {
    return (
      Number.isFinite(this.start) &&
      Number.isFinite(this.end) &&
      this.start >= 0 &&
      this.end > this.start
    );
  }

  isAdPlaying() {
    return (
      this.video
        ?.closest(SELECTORS.player)
        ?.classList.contains("ad-showing") === true
    );
  }

  enforce() {
    const video = this.video;

    if (
      !video ||
      !this.enabled ||
      !this.hasValidRange() ||
      this.isAdPlaying() ||
      this.seekState ||
      video.seeking ||
      (video.paused && !video.ended)
    ) {
      return;
    }

    const currentTime = video.currentTime;

    if (!Number.isFinite(currentTime)) {
      return;
    }

    const duration = this.end - this.start;
    const startTolerance = Math.min(
      LOOP.maxStartTolerance,
      Math.max(
        LOOP.minStartTolerance,
        duration / LOOP.startToleranceDivisor,
      ),
    );

    if (
      currentTime < this.start - startTolerance ||
      currentTime >= this.end
    ) {
      this.seekToStart();
    }
  }

  seekToStart() {
    const video = this.video;

    if (
      !video ||
      this.seekState ||
      video.seeking ||
      !Number.isFinite(this.start)
    ) {
      return;
    }

    if (
      Math.abs(video.currentTime - this.start) < LOOP.exactSeekTolerance &&
      !video.ended
    ) {
      return;
    }

    this.seekState = {
      target: this.start,
      shouldResume: !video.paused || video.ended,
    };

    /*
     * Stop all loop checks before assigning currentTime. While
     * seekState exists, every other callback is prevented from
     * issuing a second seek.
     */
    this.stopScheduler();
    this.statusKey = this.isBuffered(this.start) ? null : "loadingA";
    this.notify();

    try {
      video.currentTime = this.start;
    } catch {
      this.cancelSeek();
      this.statusKey = null;
      this.notify();
      this.startScheduler();
    }
  }

  maybeCompleteSeek() {
    const video = this.video;
    const seekState = this.seekState;

    if (!video || !seekState || video.seeking) {
      return;
    }

    const nearTarget =
      Math.abs(video.currentTime - seekState.target) <= LOOP.seekTolerance;
    const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

    if (nearTarget && hasData) {
      this.completeSeek();
    }
  }

  handleSeeked() {
    if (!this.seekState || !this.video) {
      return;
    }

    const nearTarget =
      Math.abs(this.video.currentTime - this.seekState.target) <=
      LOOP.seekTolerance;

    if (nearTarget) {
      this.completeSeek();
      return;
    }

    this.cancelSeek();
    this.statusKey = null;
    this.notify();
  }

  completeSeek() {
    const video = this.video;
    const seekState = this.seekState;

    if (!video || !seekState) {
      return;
    }

    const shouldResume = seekState.shouldResume;
    this.cancelSeek();
    this.statusKey = null;
    this.notify();

    if (shouldResume && video.paused && !video.ended) {
      void video.play().catch(() => {});
    }
  }

  cancelSeek() {
    this.seekState = null;
  }

  isBuffered(time) {
    const video = this.video;

    if (!video) {
      return false;
    }

    try {
      for (let index = 0; index < video.buffered.length; index += 1) {
        if (
          time >= video.buffered.start(index) - LOOP.bufferTolerance &&
          time <= video.buffered.end(index) + LOOP.bufferTolerance
        ) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  startScheduler() {
    const video = this.video;

    if (
      !video ||
      video.paused ||
      !this.enabled ||
      !this.hasValidRange() ||
      this.seekState ||
      video.seeking ||
      this.isAdPlaying() ||
      this.frameRequest ||
      this.fallbackTimer !== null
    ) {
      return;
    }

    if (typeof video.requestVideoFrameCallback === "function") {
      const tick = () => {
        if (this.frameRequest?.video !== video) {
          return;
        }

        this.frameRequest = null;
        this.enforce();
        this.startScheduler();
      };

      this.frameRequest = {
        video,
        id: video.requestVideoFrameCallback(tick),
      };
      return;
    }

    this.fallbackTimer = window.setInterval(
      () => this.enforce(),
      LOOP.fallbackIntervalMs,
    );
  }

  stopScheduler() {
    if (this.frameRequest) {
      const { video, id } = this.frameRequest;

      if (typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(id);
      }

      this.frameRequest = null;
    }

    if (this.fallbackTimer !== null) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  destroy() {
    this.abortController?.abort();
    this.abortController = null;
    this.stopScheduler();
    this.cancelSeek();
    this.video = null;
  }
}
