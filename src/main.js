const previousApplications = new Set(
  [APP_KEY, ...LEGACY_APP_KEYS]
    .map((key) => window[key])
    .filter(Boolean),
);

for (const previousApplication of previousApplications) {
  if (typeof previousApplication.destroy !== "function") {
    continue;
  }

  try {
    previousApplication.destroy();
  } catch (error) {
    console.warn(`${LOG_PREFIX} Previous instance cleanup failed.`, error);
  }
}

for (const key of [APP_KEY, ...LEGACY_APP_KEYS]) {
  if (window[key]) {
    delete window[key];
  }
}

const application = new Application();
window[APP_KEY] = application;

try {
  application.start();
} catch (error) {
  application.destroy();

  console.error(`${LOG_PREFIX} Initialization failed.`, error);
}
