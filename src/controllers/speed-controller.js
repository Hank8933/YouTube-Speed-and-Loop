class SpeedController {
  constructor(onChange) {
    this.onChange = onChange;
    this.video = null;
    this.abortController = null;
  }

  bind(video) {
    this.abortController?.abort();
    this.abortController = null;
    this.video = video;

    if (!video) {
      this.notify();
      return;
    }

    this.abortController = new AbortController();
    const { signal } = this.abortController;
    const notifyIfCurrent = () => {
      if (this.video === video) {
        this.notify();
      }
    };

    video.addEventListener("ratechange", notifyIfCurrent, { signal });
    video.addEventListener("loadedmetadata", notifyIfCurrent, { signal });
    this.notify();
  }

  setRate(rawRate) {
    if (!this.video || !Number.isFinite(rawRate)) {
      return;
    }

    const rate = clamp(rawRate, SPEED.min, SPEED.max);
    this.video.defaultPlaybackRate = rate;
    this.video.playbackRate = rate;
    this.notify();
  }

  adjust(direction, rawStep) {
    if (!this.video || !direction) {
      return;
    }

    const step = normalizeSpeedStep(rawStep);
    const precision = Math.max(2, String(step).split(".")[1]?.length ?? 0);
    const factor = 10 ** precision;
    const nextRate =
      Math.round(
        (this.video.playbackRate + Math.sign(direction) * step) * factor,
      ) / factor;

    this.setRate(nextRate);
  }

  getState() {
    const rate =
      Number.isFinite(this.video?.playbackRate) && this.video.playbackRate > 0
        ? this.video.playbackRate
        : 1;

    return {
      available: Boolean(this.video),
      rate,
    };
  }

  notify() {
    this.onChange?.(this.getState());
  }

  destroy() {
    this.abortController?.abort();
    this.abortController = null;
    this.video = null;
  }
}
