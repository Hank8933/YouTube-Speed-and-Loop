class PanelView {
  renderRecordManager() {
    const result = this.handlers.listRecords?.(this.recordQuery) ?? {
      items: [],
      total: 0,
    };
    const items = Array.isArray(result.items) ? result.items : [];
    const total = Number.isFinite(result.total) ? result.total : 0;

    this.refs.recordCount.textContent = this.t("recordCount", {
      shown: items.length,
      total,
    });
    this.refs.deleteAllRecordsButton.disabled = total === 0;

    const fragment = document.createDocumentFragment();

    if (items.length === 0) {
      fragment.append(
        createElement("div", {
          className: "ytec-record-empty",
          text: this.t(total ? "noMatchingRecords" : "noRecords"),
        }),
      );
    } else {
      for (const record of items) {
        fragment.append(this.createRecordCard(record));
      }
    }

    this.refs.recordList.replaceChildren(fragment);
  }

  createRecordCard(record) {
    const title = record.title || this.t("untitledVideo");
    const startInput = createElement("input", {
      className: "ytec-input",
      attributes: {
        type: "text",
        inputmode: "decimal",
        placeholder: "00:00.000",
        "aria-invalid": "false",
      },
      properties: {
        value: TimeCodec.format(record.start),
      },
      dataset: {
        recordField: "start",
      },
    });
    const endInput = createElement("input", {
      className: "ytec-input",
      attributes: {
        type: "text",
        inputmode: "decimal",
        placeholder: "00:00.000",
        "aria-invalid": "false",
      },
      properties: {
        value: TimeCodec.format(record.end),
      },
      dataset: {
        recordField: "end",
      },
    });
    const enabledInput = createElement("input", {
      attributes: { type: "checkbox" },
      properties: { checked: Boolean(record.enabled) },
      dataset: { recordField: "enabled" },
    });
    const source = this.t(
      record.source === "shorts" ? "sourceShorts" : "sourceWatch",
    );
    const status = createElement("p", {
      className: "ytec-status",
      attributes: { "aria-live": "polite" },
      dataset: {
        role: "record-card-status",
        error: "false",
      },
    });

    return createElement(
      "article",
      {
        className: "ytec-record-card",
        dataset: {
          videoId: record.videoId,
          title,
        },
      },
      createElement(
        "div",
        { className: "ytec-record-head" },
        createElement("div", {
          className: "ytec-record-title",
          text: title,
          attributes: { title },
        }),
        createElement("code", {
          className: "ytec-record-id",
          text: record.videoId,
        }),
      ),
      createElement("p", {
        className: "ytec-record-meta",
        text: this.t("recordSource", { source }),
      }),
      createElement("p", {
        className: "ytec-record-meta",
        text: this.t("recordUpdated", {
          date: this.formatDate(record.updatedAt),
        }),
      }),
      createElement(
        "div",
        { className: "ytec-record-times" },
        createElement(
          "label",
          { className: "ytec-record-field" },
          createElement("span", {
            className: "ytec-record-field-label",
            text: "A",
          }),
          startInput,
        ),
        createElement(
          "label",
          { className: "ytec-record-field" },
          createElement("span", {
            className: "ytec-record-field-label",
            text: "B",
          }),
          endInput,
        ),
      ),
      createElement(
        "label",
        { className: "ytec-row" },
        createElement("span", {
          className: "ytec-label",
          text: this.t("savedLoopEnabled"),
        }),
        enabledInput,
      ),
      createElement(
        "div",
        { className: "ytec-record-actions" },
        createElement("button", {
          className: "ytec-button",
          text: this.t("saveRecord"),
          attributes: { type: "button" },
          dataset: { action: "save-record" },
        }),
        createElement("button", {
          className: "ytec-button",
          text: this.t("openVideo"),
          attributes: { type: "button" },
          dataset: {
            action: "open-record",
            videoId: record.videoId,
          },
        }),
        createElement("button", {
          className: "ytec-button ytec-danger",
          text: this.t("deleteRecord"),
          attributes: { type: "button" },
          dataset: { action: "delete-record" },
        }),
      ),
      status,
    );
  }

  saveRecordCard(card) {
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const startInput = card.querySelector('[data-record-field="start"]');
    const endInput = card.querySelector('[data-record-field="end"]');
    const enabledInput = card.querySelector('[data-record-field="enabled"]');

    if (
      !(startInput instanceof HTMLInputElement) ||
      !(endInput instanceof HTMLInputElement) ||
      !(enabledInput instanceof HTMLInputElement)
    ) {
      return;
    }

    this.clearInputError(startInput);
    this.clearInputError(endInput);
    this.setRecordCardStatus(card, null);

    const result = this.handlers.saveRecord?.(
      card.dataset.videoId,
      startInput.value,
      endInput.value,
      enabledInput.checked,
    );

    if (!result?.ok) {
      if (result?.field === "start") {
        this.setInputError(startInput, result.messageKey ?? "invalidTime");
        startInput.focus();
      } else if (result?.field === "end") {
        this.setInputError(endInput, result.messageKey ?? "invalidTime");
        endInput.focus();
      } else {
        this.setRecordCardStatus(
          card,
          result?.messageKey ?? "storageError",
          true,
        );
      }

      return;
    }

    this.setRecordsMessage(
      result.deleted ? "recordDeleted" : "recordSaved",
      { title: card.dataset.title },
      false,
    );
    this.renderRecordManager();
  }

  deleteRecordCard(card) {
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const title = card.dataset.title || this.t("untitledVideo");

    if (!window.confirm(this.t("confirmDeleteRecord", { title }))) {
      return;
    }

    const result = this.handlers.deleteRecord?.(card.dataset.videoId);

    if (!result?.ok) {
      this.setRecordCardStatus(
        card,
        result?.messageKey ?? "storageError",
        true,
      );
      return;
    }

    this.setRecordsMessage("recordDeleted", { title }, false);
    this.renderRecordManager();
  }

  deleteAllRecords() {
    const total = this.handlers.listRecords?.("").total ?? 0;

    if (
      total === 0 ||
      !window.confirm(this.t("confirmDeleteAllRecords", { count: total }))
    ) {
      return;
    }

    const result = this.handlers.deleteAllRecords?.();

    if (!result?.ok) {
      this.setRecordsMessage(result?.messageKey ?? "storageError", {}, true);
      return;
    }

    this.setRecordsMessage("allRecordsDeleted", {}, false);
    this.renderRecordManager();
  }

  setRecordCardStatus(card, messageKey, error = false) {
    const status = card?.querySelector?.('[data-role="record-card-status"]');

    if (!(status instanceof HTMLElement)) {
      return;
    }

    status.textContent = messageKey ? this.t(messageKey) : "";
    status.dataset.error = String(Boolean(error));
  }

  formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    try {
      return new Intl.DateTimeFormat(this.translator.locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  }

  refreshRecordManager() {
    if (this.currentView === "records") {
      this.renderRecordManager();
    }
  }

  remove() {
    this.panel.remove();
  }
}
