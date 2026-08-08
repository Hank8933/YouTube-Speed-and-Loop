class StateStore {
  constructor() {
    this.state = this.load();
  }

  load() {
    const current = readStorage(STATE_KEY);

    if (current !== null) {
      const state = normalizeState(parseJson(current, {}));
      const serialized = JSON.stringify(state);

      if (serialized !== current) {
        writeStorage(STATE_KEY, serialized);
      }

      return state;
    }

    for (const legacyStateKey of LEGACY_STATE_KEYS) {
      const legacyState = readStorage(legacyStateKey);

      if (legacyState !== null) {
        const state = normalizeState(parseJson(legacyState, {}));
        writeStorage(STATE_KEY, JSON.stringify(state));
        return state;
      }
    }

    const state = defaultState();
    state.preferences.language = normalizeLanguage(
      readStorage(LEGACY_KEYS.language) ?? state.preferences.language,
    );
    state.preferences.speedStep = normalizeSpeedStep(
      readStorage(LEGACY_KEYS.speedStep) ?? state.preferences.speedStep,
    );
    state.preferences.autoConfirm =
      readStorage(LEGACY_KEYS.autoConfirm) === "true";
    state.shortcuts = normalizeShortcuts(
      parseJson(readStorage(LEGACY_KEYS.shortcuts), {}),
    );

    const normalized = normalizeState(state);
    writeStorage(STATE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  snapshot() {
    return cloneJson(this.state);
  }

  getPreferences() {
    return { ...this.state.preferences };
  }

  getShortcuts() {
    return cloneJson(this.state.shortcuts);
  }

  getRecord(videoId) {
    const normalizedId = normalizeVideoId(videoId);
    const record = normalizedId ? this.state.loops[normalizedId] : null;
    return record ? { ...record } : null;
  }

  listRecords() {
    return Object.entries(this.state.loops)
      .map(([videoId, record]) => ({ videoId, ...record }))
      .sort((left, right) => {
        const dateDifference =
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime();

        if (dateDifference !== 0) {
          return dateDifference;
        }

        return (left.title || left.videoId).localeCompare(
          right.title || right.videoId,
        );
      });
  }

  countRecords() {
    return Object.keys(this.state.loops).length;
  }

  setPreferences(patch) {
    const next = this.snapshot();
    next.preferences = {
      ...next.preferences,
      ...(isPlainObject(patch) ? patch : {}),
    };
    return this.commit(next);
  }

  setShortcuts(shortcuts) {
    const next = this.snapshot();
    next.shortcuts = normalizeShortcuts(shortcuts);
    return this.commit(next);
  }

  setRecord(videoId, record) {
    const normalizedId = normalizeVideoId(videoId);

    if (!normalizedId) {
      return false;
    }

    const normalizedRecord = normalizeRecord(record);

    if (!normalizedRecord) {
      return this.deleteRecord(normalizedId);
    }

    const next = this.snapshot();
    next.loops[normalizedId] = normalizedRecord;
    return this.commit(next);
  }

  deleteRecord(videoId) {
    const normalizedId = normalizeVideoId(videoId);

    if (!normalizedId) {
      return false;
    }

    const next = this.snapshot();
    delete next.loops[normalizedId];
    return this.commit(next);
  }

  clearRecords() {
    const next = this.snapshot();
    next.loops = {};
    return this.commit(next);
  }

  importState(rawState, mode) {
    const imported = normalizeState(rawState);

    if (mode === "replace") {
      return this.commit(imported);
    }

    const rawPreferences = isPlainObject(rawState?.preferences)
      ? rawState.preferences
      : {};
    const preferences = { ...this.state.preferences };

    for (const key of [
      "language",
      "speedStep",
      "autoConfirm",
      "shortsAsWatch",
    ]) {
      if (hasOwn(rawPreferences, key)) {
        preferences[key] = imported.preferences[key];
      }
    }

    return this.commit({
      version: STATE_VERSION,
      preferences,
      shortcuts: {
        ...this.state.shortcuts,
        ...imported.shortcuts,
      },
      loops: {
        ...this.state.loops,
        ...imported.loops,
      },
    });
  }

  commit(nextState) {
    const normalized = normalizeState(nextState);
    const serialized = JSON.stringify(normalized);

    if (!writeStorage(STATE_KEY, serialized)) {
      return false;
    }

    this.state = normalized;
    return true;
  }
}
