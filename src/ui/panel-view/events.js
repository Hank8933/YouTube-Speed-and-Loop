class PanelView {
  buildDynamicControls() {
    for (const rate of SPEED.presets) {
      this.refs.speedPresets.append(
        this.createButton({
          action: "set-speed",
          text: `${rate}x`,
          dataset: { rate },
          attributes: {
            "aria-pressed": "false",
          },
        }),
      );
    }

    for (const language of LANGUAGES) {
      this.refs.languageSelect.append(
        language.value === "auto"
          ? this.createI18nElement("option", "autoLanguage", {
              attributes: { value: language.value },
            })
          : createElement("option", {
              text: language.label,
              attributes: { value: language.value },
            }),
      );
    }

    for (const step of SPEED.shortcutSteps) {
      this.refs.speedStepSelect.append(
        createElement("option", {
          text: `${step}x`,
          attributes: { value: step },
        }),
      );
    }

    for (const group of SHORTCUT_GROUPS) {
      const details = createElement("details", {
        properties: { open: group.open },
      });
      const list = createElement("div", {
        className: "ytec-shortcut-list",
      });

      for (const action of group.actions) {
        const input = createElement("input", {
          className: "ytec-input ytec-shortcut-input",
          attributes: { type: "text" },
          properties: { readOnly: true },
          dataset: { shortcutAction: action.id },
        });

        this.shortcutInputs[action.id] = input;
        list.append(
          createElement(
            "label",
            { className: "ytec-shortcut-row" },
            this.createI18nElement("span", action.labelKey, {
              className: "ytec-shortcut-label",
            }),
            input,
          ),
        );
      }

      details.append(this.createI18nElement("summary", group.labelKey), list);
      this.refs.shortcutGroups.append(details);
    }
  }

  bindEvents(signal) {
    this.panel.addEventListener(
      "click",
      (event) => {
        const button =
          event.target instanceof Element
            ? event.target.closest("button")
            : null;

        if (
          !(button instanceof HTMLButtonElement) ||
          !this.panel.contains(button)
        ) {
          return;
        }

        if (button === this.refs.menu) {
          event.stopPropagation();
          this.setOpen(this.refs.content.hidden);
          return;
        }

        switch (button.dataset.action) {
          case "navigate":
            this.navigate();
            break;
          case "open-records":
            this.setView("records");
            break;
          case "set-speed":
            this.handlers.setSpeed?.(Number(button.dataset.rate));
            break;
          case "toggle-loop":
            this.handlers.toggleLoop?.();
            break;
          case "set-start":
            this.handlers.setPointNow?.("start");
            break;
          case "set-end":
            this.handlers.setPointNow?.("end");
            break;
          case "clear-loop":
            this.handlers.clearLoop?.();
            break;
          case "toggle-shorts-watch":
            this.handlers.toggleShortsAsWatch?.();
            break;
          case "toggle-auto-confirm":
            this.handlers.toggleAutoConfirm?.();
            break;
          case "clear-shortcuts":
            this.handlers.clearShortcuts?.();
            break;
          case "export-backup":
            this.handlers.exportBackup?.();
            break;
          case "choose-import":
            this.refs.backupFile.click();
            break;
          case "delete-current":
            this.handlers.deleteCurrentRecord?.();
            break;
          case "save-record":
            this.saveRecordCard(button.closest(".ytec-record-card"));
            break;
          case "open-record":
            this.handlers.openRecord?.(button.dataset.videoId);
            break;
          case "delete-record":
            this.deleteRecordCard(button.closest(".ytec-record-card"));
            break;
          case "delete-all-records":
            this.deleteAllRecords();
            break;
          default:
            break;
        }
      },
      { signal },
    );

    this.panel.addEventListener(
      "input",
      (event) => {
        const target = event.target;

        if (target === this.refs.speedSlider) {
          this.handlers.setSpeed?.(Number(target.value));
          return;
        }

        if (
          target === this.refs.loopStartInput ||
          target === this.refs.loopEndInput
        ) {
          this.clearInputError(target);
          return;
        }

        if (target === this.refs.recordsSearch) {
          this.recordQuery = target.value;
          this.renderRecordManager();
          return;
        }

        if (
          target instanceof HTMLInputElement &&
          target.closest(".ytec-record-card")
        ) {
          this.clearInputError(target);
          this.setRecordCardStatus(target.closest(".ytec-record-card"), null);
        }
      },
      { signal },
    );

    this.panel.addEventListener(
      "change",
      (event) => {
        const target = event.target;

        if (target === this.refs.languageSelect) {
          this.handlers.setLanguage?.(target.value);
          return;
        }

        if (target === this.refs.speedStepSelect) {
          this.handlers.setSpeedStep?.(target.value);
          return;
        }

        if (target === this.refs.loopStartInput) {
          this.commitPointInput("start", target);
          return;
        }

        if (target === this.refs.loopEndInput) {
          this.commitPointInput("end", target);
          return;
        }

        if (target === this.refs.backupFile) {
          const file = target.files?.[0] ?? null;
          const mode = this.refs.importMode.value;
          target.value = "";
          void this.handlers.importBackup?.(file, mode);
        }
      },
      { signal },
    );

    this.panel.addEventListener(
      "keydown",
      (event) => {
        const input =
          event.target instanceof HTMLInputElement ? event.target : null;
        const action = input?.dataset.shortcutAction;

        if (!action) {
          return;
        }

        if (this.handlers.captureShortcut?.(event, action)) {
          input.blur();
        }
      },
      { signal },
    );

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (this.refs.content.hidden) {
          return;
        }

        if (
          event.target instanceof Node &&
          this.panel.contains(event.target)
        ) {
          return;
        }

        this.setOpen(false);
      },
      { signal },
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || this.refs.content.hidden) {
          return;
        }

        if (this.currentView === "records") {
          this.setView("settings");
        } else if (this.currentView === "settings") {
          this.setView("main");
        } else {
          this.setOpen(false);
        }
      },
      { signal },
    );
  }

  navigate() {
    if (this.currentView === "main") {
      this.setView("settings");
    } else if (this.currentView === "records") {
      this.setView("settings");
    } else {
      this.setView("main");
    }
  }

  setView(view) {
    if (!hasOwn(this.refs.views, view)) {
      return;
    }

    this.currentView = view;

    for (const [name, node] of Object.entries(this.refs.views)) {
      node.hidden = name !== view;
    }

    this.refs.titleBinding.key =
      view === "main"
        ? "appTitle"
        : view === "settings"
          ? "settingsTitle"
          : "recordsTitle";
    this.refs.navigationButton.textContent = view === "main" ? "⚙" : "←";
    this.applyLanguage();

    if (view === "records") {
      this.renderRecordManager();
      requestAnimationFrame(() => this.refs.recordsSearch.focus());
    }
  }

  setOpen(open) {
    this.refs.content.hidden = !open;
    this.refs.menu.textContent = open ? "×" : "☰";
    this.refs.menu.setAttribute("aria-expanded", String(open));
    this.refs.menu.setAttribute(
      "aria-label",
      this.t(open ? "closePanel" : "openPanel"),
    );

    if (!open) {
      this.setView("main");
    }
  }

  setPlaybackVisible(visible) {
    this.refs.speedSection.hidden = !visible;
    this.refs.loopSection.hidden = !visible;
  }

  applyLanguage() {
    this.panel.lang = this.translator.locale;

    for (const binding of this.i18nBindings) {
      binding.node.textContent = this.t(binding.key);
    }

    this.refs.menu.setAttribute(
      "aria-label",
      this.t(this.refs.content.hidden ? "openPanel" : "closePanel"),
    );
    this.refs.navigationButton.setAttribute(
      "aria-label",
      this.t(
        this.currentView === "main"
          ? "openSettings"
          : this.currentView === "records"
            ? "backToSettings"
            : "backToMain",
      ),
    );
    this.refs.speedSlider.setAttribute("aria-label", this.t("speed"));
    this.refs.loopStartInput.setAttribute("aria-label", this.t("startTime"));
    this.refs.loopEndInput.setAttribute("aria-label", this.t("endTime"));
    this.refs.recordsSearch.placeholder = this.t("searchRecords");
    this.renderMessage(this.refs.backupStatus, this.backupMessage);
    this.renderMessage(this.refs.recordsStatus, this.recordsMessage);
  }

}
