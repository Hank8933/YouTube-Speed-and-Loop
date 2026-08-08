function normalizeLanguage(value) {
  return LANGUAGES.some((language) => language.value === value)
    ? value
    : "auto";
}

function resolveLanguage(preference) {
  if (preference !== "auto" && TEXT[preference]) {
    return preference;
  }

  const browserLanguages = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean);

  for (const language of browserLanguages) {
    const normalized = language.toLowerCase();

    if (/^zh-(tw|hant|hk|mo)/.test(normalized)) {
      return "zh-TW";
    }

    if (normalized.startsWith("zh")) {
      return "zh-CN";
    }

    if (normalized.startsWith("en")) {
      return "en";
    }
  }

  return "en";
}

function normalizeSpeedStep(value) {
  const parsed = Number(value);
  return SPEED.shortcutSteps.includes(parsed)
    ? parsed
    : SPEED.defaultShortcutStep;
}

function normalizeVideoId(value) {
  return typeof value === "string" && VIDEO_ID_PATTERN.test(value)
    ? value
    : null;
}

function normalizeTitle(value) {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_VIDEO_TITLE_LENGTH)
    : "";
}

function normalizeSource(value) {
  return value === "shorts" ? "shorts" : "watch";
}

function normalizeNullableTime(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeBinding(value) {
  if (
    !isPlainObject(value) ||
    typeof value.key !== "string" ||
    typeof value.code !== "string" ||
    value.code.length === 0
  ) {
    return null;
  }

  return {
    key: value.key,
    code: value.code,
    ctrlKey: Boolean(value.ctrlKey),
    altKey: Boolean(value.altKey),
    shiftKey: Boolean(value.shiftKey),
    metaKey: Boolean(value.metaKey),
  };
}

function normalizeShortcuts(value) {
  const result = {};

  if (!isPlainObject(value)) {
    return result;
  }

  for (const action of SHORTCUT_ACTIONS) {
    const binding = normalizeBinding(value[action]);

    if (binding) {
      result[action] = binding;
    }
  }

  return result;
}

function normalizeRecord(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const start = normalizeNullableTime(value.start);
  const end = normalizeNullableTime(value.end);

  if (start === null && end === null) {
    return null;
  }

  const validRange =
    Number.isFinite(start) && Number.isFinite(end) && end > start;
  const title = normalizeTitle(value.title);
  const parsedDate =
    typeof value.updatedAt === "string" ? new Date(value.updatedAt) : null;

  return {
    start,
    end,
    enabled:
      validRange && (value.enabled === true || value.enabled === "true"),
    title,
    source: normalizeSource(value.source),
    updatedAt:
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString(),
  };
}

function defaultState() {
  return {
    version: STATE_VERSION,
    preferences: {
      language: "auto",
      speedStep: SPEED.defaultShortcutStep,
      autoConfirm: false,
      shortsAsWatch: false,
    },
    shortcuts: {},
    loops: {},
  };
}

function normalizeState(value) {
  const source = isPlainObject(value) ? value : {};
  const preferences = isPlainObject(source.preferences)
    ? source.preferences
    : {};
  const loops = {};

  if (isPlainObject(source.loops)) {
    for (const [rawVideoId, rawRecord] of Object.entries(source.loops)) {
      const videoId = normalizeVideoId(rawVideoId);
      const record = normalizeRecord(rawRecord);

      if (videoId && record) {
        loops[videoId] = record;
      }
    }
  }

  return {
    version: STATE_VERSION,
    preferences: {
      language: normalizeLanguage(preferences.language),
      speedStep: normalizeSpeedStep(preferences.speedStep),
      autoConfirm:
        preferences.autoConfirm === true ||
        preferences.autoConfirm === "true",
      shortsAsWatch:
        preferences.shortsAsWatch === true ||
        preferences.shortsAsWatch === "true",
    },
    shortcuts: normalizeShortcuts(source.shortcuts),
    loops,
  };
}
