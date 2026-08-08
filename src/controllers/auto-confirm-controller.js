class AutoConfirmController {
  constructor(enabled) {
    this.enabled = Boolean(enabled);
    this.observer = null;
    this.observerRoot = null;
    this.lastConfirmedAt = new WeakMap();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);

    if (this.enabled) {
      this.refresh();
    } else {
      this.stop();
    }
  }

  refresh() {
    if (!this.enabled) {
      return;
    }

    const nextRoot =
      document.querySelector(SELECTORS.popupRoot) ?? document.body;

    if (!nextRoot) {
      return;
    }

    if (nextRoot === this.observerRoot && this.observer) {
      this.scan();
      return;
    }

    this.stop();
    this.observerRoot = nextRoot;
    this.observer = new MutationObserver((records) => {
      const dialogs = new Set();

      for (const record of records) {
        if (record.target instanceof Element) {
          const dialog = record.target.closest(SELECTORS.confirmDialog);

          if (dialog) {
            dialogs.add(dialog);
          }
        }

        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) {
            continue;
          }

          if (node.matches(SELECTORS.confirmDialog)) {
            dialogs.add(node);
          }

          node
            .querySelectorAll(SELECTORS.confirmDialog)
            .forEach((dialog) => dialogs.add(dialog));
        }
      }

      dialogs.forEach((dialog) => this.tryConfirm(dialog));
    });

    this.observer.observe(nextRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "hidden", "style"],
    });

    this.scan();
  }

  scan() {
    if (!this.enabled) {
      return;
    }

    document
      .querySelectorAll(SELECTORS.confirmDialog)
      .forEach((dialog) => this.tryConfirm(dialog));
  }

  tryConfirm(dialog) {
    if (
      !this.enabled ||
      !(dialog instanceof HTMLElement) ||
      !dialog.isConnected ||
      dialog.hidden ||
      dialog.getAttribute("aria-hidden") === "true" ||
      dialog.getClientRects().length === 0
    ) {
      return;
    }

    const text = (dialog.innerText || dialog.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!CONTINUE_WATCHING_PATTERNS.some((pattern) => pattern.test(text))) {
      return;
    }

    const now = Date.now();

    if (
      now - (this.lastConfirmedAt.get(dialog) ?? 0) <
      AUTO_CONFIRM_COOLDOWN_MS
    ) {
      return;
    }

    const button =
      dialog.querySelector("#confirm-button button") ??
      dialog.querySelector("#confirm-button");

    if (
      !(button instanceof HTMLElement) ||
      button.matches(":disabled") ||
      button.getAttribute("aria-disabled") === "true"
    ) {
      return;
    }

    this.lastConfirmedAt.set(dialog, now);
    button.click();
  }

  stop() {
    this.observer?.disconnect();
    this.observer = null;
    this.observerRoot = null;
  }

  destroy() {
    this.stop();
  }
}
