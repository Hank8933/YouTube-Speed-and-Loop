class Translator {
  constructor(preference) {
    this.setPreference(preference);
  }

  setPreference(preference) {
    this.preference = normalizeLanguage(preference);
    this.locale = resolveLanguage(this.preference);
  }

  t(key, values) {
    const template = TEXT[this.locale]?.[key] ?? TEXT.en[key] ?? key;
    return interpolate(template, values);
  }
}
