class BackupError extends Error {
  constructor(messageKey) {
    super(messageKey);
    this.name = "BackupError";
    this.messageKey = messageKey;
  }
}

class BackupService {
  constructor(store) {
    this.store = store;
  }

  exportToFile() {
    const snapshot = this.store.snapshot();
    const envelope = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: snapshot,
    };
    const blob = new Blob([JSON.stringify(envelope, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const anchor = createElement("a", {
      attributes: {
        href: url,
        download: `youtube-ab-loop-backup-${timestamp}.json`,
      },
      properties: {
        hidden: true,
      },
    });

    (document.body ?? document.documentElement).append(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(url),
      BACKUP_URL_REVOKE_DELAY_MS,
    );
    return Object.keys(snapshot.loops).length;
  }

  async importFromFile(file, mode) {
    if (!(file instanceof File)) {
      throw new BackupError("importReadError");
    }

    if (file.size > MAX_BACKUP_BYTES) {
      throw new BackupError("backupTooLarge");
    }

    let envelope;

    try {
      envelope = JSON.parse(await file.text());
    } catch {
      throw new BackupError("invalidBackup");
    }

    if (
      !isPlainObject(envelope) ||
      envelope.format !== BACKUP_FORMAT ||
      !isPlainObject(envelope.data) ||
      !isPlainObject(envelope.data.preferences) ||
      !isPlainObject(envelope.data.shortcuts) ||
      !isPlainObject(envelope.data.loops)
    ) {
      throw new BackupError("invalidBackup");
    }

    if (
      !SUPPORTED_BACKUP_VERSIONS.has(Number(envelope.version)) ||
      !SUPPORTED_STATE_VERSIONS.has(Number(envelope.data.version))
    ) {
      throw new BackupError("unsupportedBackup");
    }

    return {
      persisted: this.store.importState(
        envelope.data,
        mode === "replace" ? "replace" : "merge",
      ),
      count: this.store.countRecords(),
    };
  }
}
