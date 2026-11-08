class ShortsLinkController {
  constructor() {
    this.enabled = false;
    this.observer = null;
    this.abortController = null;
    this.rewritten = new WeakMap();
    this.liveAnchors = new Set();
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);

    if (next === this.enabled) {
      return;
    }

    if (!next) {
      this.stop();
      return;
    }

    this.enabled = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    for (const eventName of [
      "pointerover", "pointerdown", "mousedown", "focusin", "contextmenu",
      "click", "auxclick", "keydown",
    ]) {
      window.addEventListener(eventName, (event) => this.handleInteraction(event), {
        capture: true,
        signal,
      });
    }

    // documentElement may not exist at document-start.
    this.observer = new MutationObserver((records) => this.handleMutations(records));
    this.observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "download"],
    });
    this.scan(document);
  }

  visitAnchors(root, callback) {
    if (root instanceof HTMLAnchorElement) {
      callback(root);
    }

    if (typeof root?.querySelectorAll === "function") {
      for (const anchor of root.querySelectorAll("a")) {
        callback(anchor);
      }
    }
  }

  scan(root) {
    this.visitAnchors(root, (anchor) => this.rewriteAnchor(anchor));
  }

  rewriteAnchor(anchor) {
    if (!this.enabled || !(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const current = anchor.getAttribute("href");
    const previous = this.rewritten.get(anchor);

    if (anchor.hasAttribute("download")) {
      this.restoreAnchor(anchor);
      return;
    }

    if (previous?.written === current) {
      return;
    }

    // Discard stale restore data when an anchor changes href.
    this.rewritten.delete(anchor);
    this.liveAnchors.delete(anchor);

    const target = createShortsWatchLink(current, anchor.baseURI);

    if (!target) {
      return;
    }

    this.rewritten.set(anchor, { original: current, written: target });
    this.liveAnchors.add(anchor);
    anchor.setAttribute("href", target);
  }

  restoreAnchor(anchor) {
    const saved = this.rewritten.get(anchor);

    if (saved && anchor.getAttribute("href") === saved.written) {
      anchor.setAttribute("href", saved.original);
    }

    this.rewritten.delete(anchor);
    this.liveAnchors.delete(anchor);
  }

  handleMutations(records) {
    if (!this.enabled) {
      return;
    }

    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target.isConnected) {
          this.rewriteAnchor(record.target);
        }
        continue;
      }

      for (const node of record.addedNodes) {
        if (node.isConnected) {
          this.scan(node);
        }
      }

      for (const node of record.removedNodes) {
        this.visitAnchors(node, (anchor) => {
          if (!anchor.isConnected) {
            this.restoreAnchor(anchor);
          }
        });
      }
    }
  }

  handleInteraction(event) {
    if (!this.enabled || event.defaultPrevented) {
      return;
    }

    if (event.type === "keydown" && event.key !== "Enter") {
      return;
    }

    const path = event.composedPath?.() ?? [];
    const anchor = path.find((node) => node instanceof HTMLAnchorElement)
      ?? event.target?.closest?.("a[href]");

    if (!anchor || anchor.isContentEditable || anchor.hasAttribute("download")) {
      return;
    }

    // Catch clicks before the mutation observer runs.
    this.rewriteAnchor(anchor);
    const saved = this.rewritten.get(anchor);

    if (!saved || anchor.getAttribute("href") !== saved.written) {
      return;
    }

    const activatesLink =
      (event.type === "click" && event.button === 0) ||
      (event.type === "auxclick" && event.button === 1) ||
      (event.type === "keydown" && event.key === "Enter");

    if (activatesLink) {
      // Stop later handlers without cancelling the default action.
      event.stopImmediatePropagation();
    }
  }

  stop() {
    this.enabled = false;
    this.observer?.disconnect();
    this.observer = null;
    this.abortController?.abort();
    this.abortController = null;

    for (const anchor of this.liveAnchors) {
      this.restoreAnchor(anchor);
    }

    this.liveAnchors.clear();
    this.rewritten = new WeakMap();
  }

  destroy() {
    this.stop();
  }
}
