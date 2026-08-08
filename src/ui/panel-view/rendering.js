class PanelView {
  commitPointInput(point, input) {
    const result = this.handlers.setPointText?.(point, input.value);

    if (result?.valid === false) {
      this.setInputError(input, result.messageKey ?? "invalidTime");
    } else {
      this.clearInputError(input);
    }
  }

  setInputError(input, messageKey) {
    const message = this.t(messageKey);
    input.dataset.parseInvalid = "true";
    input.setAttribute("aria-invalid", "true");
    input.title = message;
    input.setCustomValidity(message);
    input.reportValidity();
  }

  clearInputError(input) {
    delete input.dataset.parseInvalid;
    input.setAttribute("aria-invalid", "false");
    input.removeAttribute("title");
    input.setCustomValidity("");
  }

  clearLoopInputError(point) {
    this.clearInputError(
      point === "start" ? this.refs.loopStartInput : this.refs.loopEndInput,
    );
  }

  clearLoopInputErrors() {
    this.clearInputError(this.refs.loopStartInput);
    this.clearInputError(this.refs.loopEndInput);
  }

  renderSpeed(state) {
    const rate = state?.rate ?? 1;
    const available = Boolean(state?.available);
    this.refs.speedValue.textContent = `${rate.toFixed(2)}x`;
    this.refs.speedSlider.value = String(clamp(rate, SPEED.min, SPEED.max));
    this.refs.speedSlider.disabled = !available;
    this.refs.speedSlider.setAttribute(
      "aria-valuetext",
      `${rate.toFixed(2)}x`,
    );

    for (const button of this.refs.speedPresets.querySelectorAll(
      "button[data-rate]",
    )) {
      button.disabled = !available;
      button.setAttribute(
        "aria-pressed",
        String(
          Math.abs(Number(button.dataset.rate) - rate) <
            SPEED.presetMatchTolerance,
        ),
      );
    }
  }

  renderLoop(state, persistence) {
    const available = Boolean(state?.available);
    const start = state?.start ?? null;
    const end = state?.end ?? null;
    const invalidRange =
      Number.isFinite(start) && Number.isFinite(end) && end <= start;

    this.renderToggle(this.refs.loopToggle, Boolean(state?.enabled));
    this.refs.loopToggle.disabled = !available || !state?.validRange;
    this.refs.setStartButton.disabled = !available;
    this.refs.setEndButton.disabled = !available;
    this.refs.clearLoopButton.disabled =
      start === null && end === null && !state?.enabled;
    this.refs.loopStartInput.disabled = !available;
    this.refs.loopEndInput.disabled = !available;

    this.renderTimeInput(this.refs.loopStartInput, start, invalidRange);
    this.renderTimeInput(this.refs.loopEndInput, end, invalidRange);

    const statusKey = invalidRange ? "invalidRange" : state?.statusKey;
    this.refs.loopStatus.textContent = statusKey ? this.t(statusKey) : "";
    this.refs.loopStatus.dataset.error = String(invalidRange);

    const persistenceKey = persistence?.failed
      ? "pointsSaveFailed"
      : persistence?.saved
        ? "pointsSaved"
        : "pointsNotSaved";
    this.refs.loopPersistence.textContent = available
      ? this.t(persistenceKey)
      : "";
  }

  renderTimeInput(input, value, invalidRange) {
    const parseInvalid = input.dataset.parseInvalid === "true";

    if (!parseInvalid && document.activeElement !== input) {
      input.value = TimeCodec.format(value);
    }

    const invalid = parseInvalid || invalidRange;
    input.setAttribute("aria-invalid", String(invalid));

    if (parseInvalid) {
      const message = this.t("invalidTime");
      input.title = message;
      input.setCustomValidity(message);
    } else if (invalidRange) {
      input.title = this.t("invalidRange");
      input.setCustomValidity("");
    } else {
      input.removeAttribute("title");
      input.setCustomValidity("");
    }
  }

  renderPreferences(preferences) {
    this.refs.languageSelect.value = normalizeLanguage(preferences.language);
    this.refs.speedStepSelect.value = String(
      normalizeSpeedStep(preferences.speedStep),
    );
    this.renderToggle(
      this.refs.shortsAsWatchToggle,
      Boolean(preferences.shortsAsWatch),
    );
    this.renderToggle(
      this.refs.autoConfirmToggle,
      Boolean(preferences.autoConfirm),
    );
  }

  renderToggle(button, enabled) {
    button.textContent = this.t(enabled ? "on" : "off");
    button.setAttribute("aria-pressed", String(enabled));
  }

  renderShortcuts(bindings, formatBinding) {
    const normalized = normalizeShortcuts(bindings);
    this.refs.clearShortcutsButton.disabled =
      Object.keys(normalized).length === 0;

    for (const action of SHORTCUT_ACTIONS) {
      const input = this.shortcutInputs[action];
      const binding = normalized[action];
      input.value = binding ? formatBinding(binding) : "";
      input.placeholder = binding ? "" : this.t("shortcutPlaceholder");
      input.title = this.t("shortcutHint");
    }
  }

  renderStorage(count, currentSaved) {
    this.refs.storedCount.textContent = this.t("storedVideos", { count });
    this.refs.deleteCurrentButton.disabled = !currentSaved;
  }

  setBackupMessage(messageKey, values = {}, error = false) {
    this.backupMessage = messageKey ? { messageKey, values, error } : null;
    this.renderMessage(this.refs.backupStatus, this.backupMessage);
  }

  setRecordsMessage(messageKey, values = {}, error = false) {
    this.recordsMessage = messageKey ? { messageKey, values, error } : null;
    this.renderMessage(this.refs.recordsStatus, this.recordsMessage);
  }

  renderMessage(node, message) {
    node.textContent = message
      ? this.t(message.messageKey, message.values)
      : "";
    node.dataset.error = String(Boolean(message?.error));
  }

}
