function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function interpolate(template, values = {}) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) =>
    hasOwn(values, key) ? String(values[key]) : match,
  );
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function parseJson(value, fallback) {
  try {
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function appendChildren(parent, values) {
  for (const value of values.flat(Infinity)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }

    parent.append(
      value instanceof Node ? value : document.createTextNode(String(value)),
    );
  }
}

function createElement(tagName, options = {}, ...children) {
  const element = document.createElement(tagName);

  if (options.id) {
    element.id = options.id;
  }

  if (options.className) {
    element.className = options.className;
  }

  if (hasOwn(options, "text")) {
    element.textContent = String(options.text ?? "");
  }

  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    if (value === false || value === null || value === undefined) {
      continue;
    }

    element.setAttribute(name, value === true ? "" : String(value));
  }

  for (const [name, value] of Object.entries(options.dataset ?? {})) {
    if (value !== null && value !== undefined) {
      element.dataset[name] = String(value);
    }
  }

  for (const [name, value] of Object.entries(options.properties ?? {})) {
    element[name] = value;
  }

  appendChildren(element, children);
  return element;
}
