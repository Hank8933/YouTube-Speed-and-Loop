function eventTargetsTextInput(event) {
  const target = event.composedPath().find((node) => node instanceof Element);

  return Boolean(
    target?.closest(
      [
        "input",
        "textarea",
        "select",
        '[contenteditable]:not([contenteditable="false"])',
        '[role="textbox"]',
      ].join(","),
    ),
  );
}

function nodeAffectsLifecycle(node) {
  if (!(node instanceof Element)) {
    return false;
  }

  return (
    node.matches(LIFECYCLE_SELECTOR) ||
    (node.childElementCount > 0 &&
      node.querySelector(LIFECYCLE_SELECTOR) !== null)
  );
}
