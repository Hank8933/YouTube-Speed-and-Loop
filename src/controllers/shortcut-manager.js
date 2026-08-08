class ShortcutManager {
  constructor({ bindings, onChange, onAction }) {
    this.bindings = normalizeShortcuts(bindings);
    this.onChange = onChange;
    this.onAction = onAction;
  }

  start(signal) {
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.repeat ||
          event.isComposing ||
          eventTargetsTextInput(event)
        ) {
          return;
        }

        for (const action of SHORTCUT_ACTIONS) {
          if (!this.matches(event, this.bindings[action])) {
            continue;
          }

          event.preventDefault();
          event.stopImmediatePropagation();
          this.onAction?.(action);
          return;
        }
      },
      {
        capture: true,
        signal,
      },
    );
  }

  setBindings(bindings) {
    this.bindings = normalizeShortcuts(bindings);
  }

  getBindings() {
    return cloneJson(this.bindings);
  }

  capture(event, action) {
    if (!SHORTCUT_ACTIONS.includes(action)) {
      return false;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.repeat || event.isComposing) {
      return false;
    }

    if (event.key === "Escape") {
      return true;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      delete this.bindings[action];
      this.notify();
      return true;
    }

    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
      return false;
    }

    const binding = normalizeBinding({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    });

    if (!binding) {
      return false;
    }

    for (const existingAction of SHORTCUT_ACTIONS) {
      if (
        existingAction !== action &&
        this.matches(binding, this.bindings[existingAction])
      ) {
        delete this.bindings[existingAction];
      }
    }

    this.bindings[action] = binding;
    this.notify();
    return true;
  }

  clearAll() {
    this.bindings = {};
    this.notify();
  }

  matches(eventOrBinding, binding) {
    return (
      Boolean(binding) &&
      eventOrBinding.code === binding.code &&
      Boolean(eventOrBinding.ctrlKey) === binding.ctrlKey &&
      Boolean(eventOrBinding.altKey) === binding.altKey &&
      Boolean(eventOrBinding.shiftKey) === binding.shiftKey &&
      Boolean(eventOrBinding.metaKey) === binding.metaKey
    );
  }

  format(binding) {
    if (!binding) {
      return "";
    }

    const parts = [];

    if (binding.ctrlKey) {
      parts.push("Ctrl");
    }

    if (binding.altKey) {
      parts.push("Alt");
    }

    if (binding.shiftKey) {
      parts.push("Shift");
    }

    if (binding.metaKey) {
      parts.push("Meta");
    }

    let key =
      binding.code === "Space" ? "Space" : binding.key || binding.code;

    if (key.length === 1) {
      key = key.toUpperCase();
    }

    parts.push(key);
    return parts.join(" + ");
  }

  notify() {
    this.onChange?.(this.getBindings());
  }
}
