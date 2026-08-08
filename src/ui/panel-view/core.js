class PanelView {
  constructor({ container, floating, translator, handlers, signal }) {
    this.translator = translator;
    this.handlers = handlers;
    this.currentView = "main";
    this.recordQuery = "";
    this.i18nBindings = [];
    this.shortcutInputs = {};
    this.backupMessage = null;
    this.recordsMessage = null;
    this.refs = {};
    this.panel = this.build(floating);
    this.buildDynamicControls();
    this.bindEvents(signal);
    container.prepend(this.panel);
    this.applyLanguage();
  }

  t(key, values) {
    return this.translator.t(key, values);
  }

  createI18nElement(tagName, key, options = {}, ...children) {
    const node = createElement(tagName, options, ...children);
    this.i18nBindings.push({ node, key });
    return node;
  }

  createButton({
    action = "",
    textKey = null,
    text = "",
    className = "ytec-button",
    attributes = {},
    dataset = {},
  }) {
    const options = {
      className,
      text,
      attributes: {
        type: "button",
        ...attributes,
      },
      dataset: {
        action,
        ...dataset,
      },
    };

    return textKey
      ? this.createI18nElement("button", textKey, options)
      : createElement("button", options);
  }

  createLabel(key) {
    return this.createI18nElement("span", key, {
      className: "ytec-label",
    });
  }

  createSection(titleKey, children, dataset = {}) {
    return createElement(
      "section",
      {
        className: "ytec-section",
        dataset,
      },
      this.createI18nElement("h3", titleKey),
      children,
    );
  }

  build(floating) {
    const menu = this.createButton({
      text: "☰",
      className: "ytec-menu",
      attributes: {
        "aria-controls": "ytec-content",
        "aria-expanded": "false",
      },
    });

    const title = this.createI18nElement("h2", "appTitle", {
      id: "ytec-title",
    });
    const titleBinding = this.i18nBindings.at(-1);
    const navigationButton = this.createButton({
      action: "navigate",
      text: "⚙",
      className: "ytec-icon",
    });

    const speedValue = createElement("strong", { text: "1.00x" });
    const speedSlider = createElement("input", {
      className: "ytec-slider",
      attributes: {
        type: "range",
        min: SPEED.min,
        max: SPEED.max,
        step: SPEED.sliderStep,
        value: 1,
      },
    });
    const speedPresets = createElement("div", {
      className: "ytec-preset-grid",
    });
    const speedSection = this.createSection(
      "speed",
      [
        createElement(
          "div",
          { className: "ytec-row" },
          this.createLabel("currentSpeed"),
          speedValue,
        ),
        speedSlider,
        speedPresets,
      ],
      { section: "speed" },
    );

    const loopToggle = this.createButton({
      action: "toggle-loop",
      className: "ytec-button ytec-toggle",
      attributes: {
        "aria-pressed": "false",
      },
    });
    const setStartButton = this.createButton({
      action: "set-start",
      textKey: "setStart",
    });
    const setEndButton = this.createButton({
      action: "set-end",
      textKey: "setEnd",
    });
    const clearLoopButton = this.createButton({
      action: "clear-loop",
      textKey: "clear",
    });
    const loopStartInput = createElement("input", {
      className: "ytec-input",
      attributes: {
        type: "text",
        inputmode: "decimal",
        placeholder: "00:00.000",
        "aria-invalid": "false",
      },
    });
    const loopEndInput = createElement("input", {
      className: "ytec-input",
      attributes: {
        type: "text",
        inputmode: "decimal",
        placeholder: "00:00.000",
        "aria-invalid": "false",
      },
    });
    const loopStatus = createElement("p", {
      className: "ytec-status",
      attributes: {
        "aria-live": "polite",
      },
      dataset: {
        error: "false",
      },
    });
    const loopPersistence = createElement("p", {
      className: "ytec-hint",
    });
    const loopSection = this.createSection(
      "loop",
      [
        createElement(
          "div",
          { className: "ytec-row" },
          this.createLabel("loopPlayback"),
          loopToggle,
        ),
        createElement(
          "div",
          { className: "ytec-button-grid" },
          setStartButton,
          setEndButton,
          clearLoopButton,
        ),
        createElement(
          "div",
          { className: "ytec-time-grid" },
          loopStartInput,
          createElement("span", { text: "→" }),
          loopEndInput,
        ),
        loopStatus,
        loopPersistence,
      ],
      { section: "loop" },
    );
    const mainView = createElement(
      "div",
      {
        className: "ytec-view",
        dataset: { view: "main" },
      },
      speedSection,
      loopSection,
    );

    const languageSelect = createElement("select", {
      className: "ytec-select",
    });
    const speedStepSelect = createElement("select", {
      className: "ytec-select",
    });
    const shortsAsWatchToggle = this.createButton({
      action: "toggle-shorts-watch",
      className: "ytec-button ytec-toggle",
      attributes: {
        "aria-pressed": "false",
      },
    });
    const autoConfirmToggle = this.createButton({
      action: "toggle-auto-confirm",
      className: "ytec-button ytec-toggle",
      attributes: {
        "aria-pressed": "false",
      },
    });
    const generalSection = this.createSection("general", [
      createElement(
        "label",
        { className: "ytec-row" },
        this.createLabel("language"),
        languageSelect,
      ),
      createElement(
        "label",
        { className: "ytec-row" },
        this.createLabel("speedStep"),
        speedStepSelect,
      ),
      createElement(
        "div",
        { className: "ytec-row" },
        createElement(
          "div",
          { className: "ytec-setting-stack" },
          this.createLabel("shortsAsWatch"),
          this.createI18nElement("p", "shortsAsWatchHint", {
            className: "ytec-hint",
          }),
        ),
        shortsAsWatchToggle,
      ),
      createElement(
        "div",
        { className: "ytec-row" },
        this.createLabel("autoConfirm"),
        autoConfirmToggle,
      ),
    ]);

    const shortcutGroups = createElement("div");
    const clearShortcutsButton = this.createButton({
      action: "clear-shortcuts",
      textKey: "clearShortcuts",
    });
    const shortcutSection = this.createSection("shortcuts", [
      this.createI18nElement("p", "shortcutsEmptyHint", {
        className: "ytec-hint",
      }),
      shortcutGroups,
      clearShortcutsButton,
    ]);

    const storedCount = createElement("span", {
      className: "ytec-label",
    });
    const recordsSummarySection = this.createSection("records", [
      createElement(
        "div",
        { className: "ytec-row" },
        storedCount,
        this.createButton({
          action: "open-records",
          textKey: "manageRecords",
        }),
      ),
    ]);

    const importMode = createElement(
      "select",
      { className: "ytec-select" },
      this.createI18nElement("option", "mergeImport", {
        attributes: { value: "merge" },
      }),
      this.createI18nElement("option", "replaceImport", {
        attributes: { value: "replace" },
      }),
    );
    const backupFile = createElement("input", {
      attributes: {
        type: "file",
        accept: "application/json,.json",
        hidden: true,
      },
    });
    const backupStatus = createElement("p", {
      className: "ytec-status",
      attributes: {
        "aria-live": "polite",
      },
      dataset: {
        error: "false",
      },
    });
    const deleteCurrentButton = this.createButton({
      action: "delete-current",
      textKey: "deleteCurrent",
    });
    const backupSection = this.createSection("backup", [
      this.createI18nElement("p", "backupHint", {
        className: "ytec-hint",
      }),
      createElement(
        "label",
        { className: "ytec-row" },
        this.createLabel("importMode"),
        importMode,
      ),
      createElement(
        "div",
        { className: "ytec-two-column" },
        this.createButton({
          action: "export-backup",
          textKey: "exportBackup",
        }),
        this.createButton({
          action: "choose-import",
          textKey: "importBackup",
        }),
      ),
      deleteCurrentButton,
      backupFile,
      backupStatus,
    ]);
    const settingsView = createElement(
      "div",
      {
        className: "ytec-view",
        attributes: { hidden: true },
        dataset: { view: "settings" },
      },
      generalSection,
      shortcutSection,
      recordsSummarySection,
      backupSection,
    );

    const recordsSearch = createElement("input", {
      className: "ytec-input",
      attributes: {
        type: "search",
        autocomplete: "off",
      },
    });
    const recordCount = createElement("span", {
      className: "ytec-label",
    });
    const deleteAllRecordsButton = this.createButton({
      action: "delete-all-records",
      textKey: "deleteAllRecords",
      className: "ytec-button ytec-danger",
    });
    const recordsStatus = createElement("p", {
      className: "ytec-status",
      attributes: {
        "aria-live": "polite",
      },
      dataset: {
        error: "false",
      },
    });
    const recordList = createElement("div", {
      className: "ytec-record-list",
    });
    const recordsView = createElement(
      "div",
      {
        className: "ytec-view",
        attributes: { hidden: true },
        dataset: { view: "records" },
      },
      createElement(
        "div",
        { className: "ytec-record-toolbar" },
        recordsSearch,
        createElement(
          "div",
          { className: "ytec-row" },
          recordCount,
          deleteAllRecordsButton,
        ),
        this.createI18nElement("p", "emptyDeletesRecord", {
          className: "ytec-hint",
        }),
        recordsStatus,
      ),
      recordList,
    );

    const content = createElement(
      "div",
      {
        id: "ytec-content",
        className: "ytec-content",
        attributes: {
          role: "dialog",
          "aria-modal": "false",
          "aria-labelledby": "ytec-title",
          hidden: true,
        },
      },
      createElement(
        "header",
        { className: "ytec-header" },
        title,
        navigationButton,
      ),
      mainView,
      settingsView,
      recordsView,
    );

    Object.assign(this.refs, {
      menu,
      content,
      titleBinding,
      navigationButton,
      views: {
        main: mainView,
        settings: settingsView,
        records: recordsView,
      },
      speedSection,
      speedValue,
      speedSlider,
      speedPresets,
      loopSection,
      loopToggle,
      setStartButton,
      setEndButton,
      clearLoopButton,
      loopStartInput,
      loopEndInput,
      loopStatus,
      loopPersistence,
      languageSelect,
      speedStepSelect,
      shortsAsWatchToggle,
      autoConfirmToggle,
      shortcutGroups,
      clearShortcutsButton,
      storedCount,
      importMode,
      backupFile,
      backupStatus,
      deleteCurrentButton,
      recordsSearch,
      recordCount,
      deleteAllRecordsButton,
      recordsStatus,
      recordList,
    });

    return createElement(
      "div",
      {
        id: PANEL_ID,
        className: floating ? "ytec-floating" : "",
      },
      menu,
      content,
    );
  }

}
