const TimeCodec = Object.freeze({
  parse(rawValue) {
    const text = String(rawValue ?? "").trim();

    if (!text) {
      return { valid: true, value: null };
    }

    const parts = text.split(":");

    if (parts.length < 1 || parts.length > 3) {
      return { valid: false, value: null };
    }

    if (
      parts.slice(0, -1).some((part) => !/^\d+$/.test(part)) ||
      !/^\d+(?:\.\d{1,3})?$/.test(parts.at(-1))
    ) {
      return { valid: false, value: null };
    }

    const values = parts.map(Number);

    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      return { valid: false, value: null };
    }

    if (parts.length >= 2 && values.at(-1) >= 60) {
      return { valid: false, value: null };
    }

    if (parts.length === 3 && values[1] >= 60) {
      return { valid: false, value: null };
    }

    if (parts.length === 1) {
      return { valid: true, value: values[0] };
    }

    if (parts.length === 2) {
      return {
        valid: true,
        value: values[0] * 60 + values[1],
      };
    }

    return {
      valid: true,
      value: values[0] * 3600 + values[1] * 60 + values[2],
    };
  },

  format(seconds) {
    if (!Number.isFinite(seconds)) {
      return "";
    }

    const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
    const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
    const milliseconds = totalMilliseconds % 1000;

    return [
      hours ? `${String(hours).padStart(2, "0")}:` : "",
      String(minutes).padStart(2, "0"),
      ":",
      String(secs).padStart(2, "0"),
      ".",
      String(milliseconds).padStart(3, "0"),
    ].join("");
  },
});
