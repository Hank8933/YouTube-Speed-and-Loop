// ==UserScript==
// @name               YouTube Speed and A-B Loop
// @name:zh-TW         YouTube 播放速度與 A-B 循環
// @namespace          https://github.com/Hank8933
// @version            1.2.0
// @description        Playback speed and stable A-B Loop for regular videos and Shorts, with records, shortcuts, multilingual settings, and JSON backup.
// @description:zh-TW  支援一般影片與 Shorts 的播放速度、穩定 A-B 循環、逐影片紀錄、快捷鍵、多語系與 JSON 備份。
// @author             Hank8933
// @homepage           https://github.com/Hank8933/YouTube-Speed-and-Loop
// @match              https://www.youtube.com/*
// @grant              none
// @run-at             document-start
// @noframes
// @license            MIT
// ==/UserScript==

(() => {
  "use strict";

  const APP_KEY = "__ytecApplication__";
  const LEGACY_APP_KEYS = Object.freeze(["__ytecApplicationV4__"]);
  const LOG_PREFIX = "[YouTube Speed and A-B Loop]";
  const PANEL_ID = "ytec-panel";
  const STYLE_ID = "ytec-style";
  const STATE_KEY = "ytec-state-v2";
  const LEGACY_STATE_KEYS = Object.freeze(["ytec-state-v1"]);
  const STATE_VERSION = 2;
  const BACKUP_FORMAT = "youtube-speed-loop-backup";
  const BACKUP_VERSION = 2;
  const SUPPORTED_BACKUP_VERSIONS = new Set([1, 2]);
  const SUPPORTED_STATE_VERSIONS = new Set([1, 2]);
  const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
  const MAX_VIDEO_TITLE_LENGTH = 300;
  const BACKUP_URL_REVOKE_DELAY_MS = 1000;

  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  const SHORTS_PATH_PATTERN = /^\/shorts\/([A-Za-z0-9_-]{11})(?:\/|$)/;

  const LEGACY_KEYS = Object.freeze({
    language: "yt-speed-loop-language",
    speedStep: "yt-speed-loop-shortcut-step",
    shortcuts: "yt-speed-loop-shortcuts",
    autoConfirm: "yt-auto-confirm-enabled",
  });

  const SELECTORS = Object.freeze({
    mastheadButtons: "ytd-masthead #end #buttons",
    mastheadEnd: "ytd-masthead #end",
    watchRoot: "ytd-watch-flexy",
    player: "#movie_player, .html5-video-player",
    shortsRenderer: "ytd-reel-video-renderer",
    popupRoot: "ytd-popup-container",
    confirmDialog: "yt-confirm-dialog-renderer",
  });

  /** @type {number} */
  const DEFAULT_SPEED_SHORTCUT_STEP = 0.25;

  const SPEED = Object.freeze({
    min: 0.25,
    max: 5,
    sliderStep: 0.05,
    presets: Object.freeze([1, 1.5, 2, 3, 4, 5]),
    shortcutSteps: Object.freeze([0.05, 0.1, 0.25, 0.5, 1]),
    defaultShortcutStep: DEFAULT_SPEED_SHORTCUT_STEP,
    presetMatchTolerance: 0.001,
  });

  const LOOP = Object.freeze({
    seekTolerance: 0.25,
    bufferTolerance: 0.25,
    exactSeekTolerance: 0.001,
    minStartTolerance: 0.01,
    maxStartTolerance: 0.08,
    startToleranceDivisor: 8,
    fallbackIntervalMs: 50,
  });

  const VISIBILITY_SCORE = Object.freeze({
    invisible: -10_000,
    visibleRatioWeight: 1000,
    centeredBonus: 800,
    distancePenaltyWeight: 250,
  });

  const WATCH_VIDEO_SCORE = Object.freeze({
    matchingVideoIdBonus: 5000,
    mismatchedVideoIdPenalty: 5000,
    mainVideoBonus: 1000,
    playingBonus: 500,
    hasSourceBonus: 100,
  });

  const SHORTS_VIDEO_SCORE = Object.freeze({
    matchingVideoIdBonus: 5000,
    mismatchedVideoIdPenalty: 500,
    playingBonus: 3500,
    centeredBonus: 2500,
    activeBonus: 1800,
    hiddenPenalty: 7000,
    hasMediaDataBonus: 150,
    hasSourceBonus: 100,
    minimumVisibleRatio: 0.1,
  });

  const RECONCILE = Object.freeze({
    defaultDelayMs: 25,
    visualChangeDelayMs: 16,
    navigationFallbackDelayMs: 50,
    unknownVideoConfirmations: 3,
    unknownVideoRetryDelayMs: 80,
    maxMediaRetries: 40,
    mediaRetryStepMs: 50,
    maxMediaRetryDelayMs: 1000,
  });

  const AUTO_CONFIRM_COOLDOWN_MS = 2000;

  const LANGUAGES = Object.freeze([
    Object.freeze({ value: "auto", label: null }),
    Object.freeze({ value: "zh-TW", label: "繁體中文" }),
    Object.freeze({ value: "zh-CN", label: "简体中文" }),
    Object.freeze({ value: "en", label: "English" }),
  ]);

  const SHORTCUT_GROUPS = Object.freeze([
    Object.freeze({
      labelKey: "speedShortcuts",
      open: true,
      actions: Object.freeze([
        Object.freeze({ id: "speedDown", labelKey: "speedDown" }),
        Object.freeze({ id: "speedUp", labelKey: "speedUp" }),
        Object.freeze({ id: "speedReset", labelKey: "speedReset" }),
      ]),
    }),
    Object.freeze({
      labelKey: "loopShortcuts",
      open: false,
      actions: Object.freeze([
        Object.freeze({ id: "toggleLoop", labelKey: "toggleLoop" }),
        Object.freeze({ id: "setStart", labelKey: "setStart" }),
        Object.freeze({ id: "jumpStart", labelKey: "jumpStart" }),
        Object.freeze({ id: "setEnd", labelKey: "setEnd" }),
        Object.freeze({ id: "clearLoop", labelKey: "clearLoop" }),
      ]),
    }),
  ]);

  const SHORTCUT_ACTIONS = Object.freeze(
    SHORTCUT_GROUPS.flatMap((group) =>
      group.actions.map((action) => action.id),
    ),
  );

  const CONTINUE_WATCHING_PATTERNS = Object.freeze([
    /continue watching/i,
    /still watching/i,
    /video paused/i,
    /繼續觀看/,
    /仍在觀看/,
    /影片已暫停/,
    /继续观看/,
    /仍在观看/,
    /视频已暂停/,
  ]);

  const LIFECYCLE_SELECTOR = [
    "ytd-masthead",
    "ytd-watch-flexy",
    "ytd-shorts",
    "ytd-reel-video-renderer",
    "ytd-popup-container",
    "#movie_player",
    ".html5-video-player",
    "video",
    `#${PANEL_ID}`,
  ].join(",");

  const TEXT = Object.freeze({
    "zh-TW": Object.freeze({
      appTitle: "YouTube 增強控制",
      settingsTitle: "設定",
      recordsTitle: "A-B 紀錄管理",
      openPanel: "開啟 YouTube 增強控制",
      closePanel: "關閉 YouTube 增強控制",
      openSettings: "開啟設定",
      backToMain: "返回控制面板",
      backToSettings: "返回設定",

      speed: "播放速度",
      currentSpeed: "目前速度",

      loop: "A-B 循環",
      loopPlayback: "循環播放",
      setStart: "設為開始",
      setEnd: "設為結束",
      clear: "清除",
      startTime: "循環開始時間",
      endTime: "循環結束時間",
      invalidTime: "格式錯誤，可輸入 SS、MM:SS 或 HH:MM:SS.fff。",
      invalidRange: "啟用 Loop 時，A 與 B 都必須存在，且 B 必須大於 A。",
      loadingA: "A 點不在目前緩衝區，正在載入。",
      pointsSaved: "已自動儲存此影片的 A/B 與 Loop 狀態。",
      pointsNotSaved: "此影片尚未儲存 A/B 紀錄。",
      pointsSaveFailed: "A/B 已套用，但無法寫入瀏覽器儲存空間。",

      general: "一般設定",
      language: "介面語言",
      autoLanguage: "自動（瀏覽器）",
      speedStep: "倍速快捷鍵步進",
      shortsAsWatch: "Shorts 使用一般影片介面",
      shortsAsWatchHint: "開啟後，/shorts/ 會重新導向標準 /watch 播放頁。",
      autoConfirm: "自動點擊「繼續觀看」",

      shortcuts: "快捷鍵",
      shortcutsEmptyHint: "快捷鍵預設皆為空白；點欄位後按下要綁定的按鍵。",
      speedShortcuts: "倍速快捷鍵",
      loopShortcuts: "循環快捷鍵",
      speedDown: "降低倍速",
      speedUp: "提高倍速",
      speedReset: "重設為 1x",
      toggleLoop: "切換循環",
      jumpStart: "跳到開始",
      clearLoop: "清除循環",
      shortcutPlaceholder: "點一下後按快捷鍵",
      shortcutHint: "按 Delete 或 Backspace 可清除此快捷鍵",
      clearShortcuts: "清除全部快捷鍵",

      records: "A-B 紀錄",
      manageRecords: "管理已儲存紀錄",
      storedVideos: "已儲存影片：{count}",
      searchRecords: "搜尋標題或影片 ID",
      recordCount: "顯示 {shown} / {total} 筆",
      noRecords: "目前沒有已儲存的 A-B 紀錄。",
      noMatchingRecords: "找不到符合搜尋條件的紀錄。",
      untitledVideo: "未命名影片",
      recordUpdated: "更新：{date}",
      recordSource: "來源：{source}",
      sourceWatch: "一般影片",
      sourceShorts: "Shorts",
      savedLoopEnabled: "進入影片時自動啟用 Loop",
      saveRecord: "儲存",
      openVideo: "開啟影片",
      deleteRecord: "刪除",
      deleteAllRecords: "刪除全部紀錄",
      confirmDeleteRecord: "確定刪除「{title}」的 A-B 紀錄？",
      confirmDeleteAllRecords:
        "確定刪除全部 {count} 筆 A-B 紀錄？此操作無法復原。",
      recordSaved: "已儲存「{title}」的 A-B 紀錄。",
      recordDeleted: "已刪除「{title}」的 A-B 紀錄。",
      allRecordsDeleted: "已刪除全部 A-B 紀錄。",
      emptyDeletesRecord: "A、B 都留空時會刪除此筆紀錄。",

      backup: "備份與還原",
      backupHint: "備份包含設定、快捷鍵與所有影片的 A/B、Loop 狀態及來源。",
      importMode: "匯入方式",
      mergeImport: "合併（匯入資料優先）",
      replaceImport: "完全取代現有資料",
      confirmReplaceImport:
        "匯入後會完全取代目前設定、快捷鍵與所有 A/B 紀錄，確定繼續？",
      exportBackup: "匯出備份",
      importBackup: "匯入備份",
      deleteCurrent: "刪除此影片的儲存點",
      backupExported: "已匯出備份，共 {count} 部影片。",
      backupImported: "匯入完成，目前共 {count} 部影片。",
      currentDeleted: "已刪除此影片的 A/B 儲存點。",
      invalidBackup: "備份格式無效或內容已損毀。",
      unsupportedBackup: "此備份版本不受目前腳本支援。",
      backupTooLarge: "備份檔超過 5 MB，已取消匯入。",
      storageError: "無法寫入 localStorage，請檢查瀏覽器儲存權限或容量。",
      importReadError: "無法讀取備份檔。",
      exportError: "無法建立備份檔。",

      on: "開",
      off: "關",
    }),

    "zh-CN": Object.freeze({
      appTitle: "YouTube 增强控制",
      settingsTitle: "设置",
      recordsTitle: "A-B 记录管理",
      openPanel: "打开 YouTube 增强控制",
      closePanel: "关闭 YouTube 增强控制",
      openSettings: "打开设置",
      backToMain: "返回控制面板",
      backToSettings: "返回设置",

      speed: "播放速度",
      currentSpeed: "当前速度",

      loop: "A-B 循环",
      loopPlayback: "循环播放",
      setStart: "设为开始",
      setEnd: "设为结束",
      clear: "清除",
      startTime: "循环开始时间",
      endTime: "循环结束时间",
      invalidTime: "格式错误，可输入 SS、MM:SS 或 HH:MM:SS.fff。",
      invalidRange: "启用 Loop 时，A 与 B 都必须存在，且 B 必须大于 A。",
      loadingA: "A 点不在当前缓冲区，正在加载。",
      pointsSaved: "已自动保存此视频的 A/B 与 Loop 状态。",
      pointsNotSaved: "此视频尚未保存 A/B 记录。",
      pointsSaveFailed: "A/B 已应用，但无法写入浏览器存储空间。",

      general: "常规设置",
      language: "界面语言",
      autoLanguage: "自动（浏览器）",
      speedStep: "倍速快捷键步进",
      shortsAsWatch: "Shorts 使用普通视频界面",
      shortsAsWatchHint: "开启后，/shorts/ 会重定向到标准 /watch 播放页。",
      autoConfirm: "自动点击“继续观看”",

      shortcuts: "快捷键",
      shortcutsEmptyHint: "快捷键默认均为空；点击字段后按下要绑定的按键。",
      speedShortcuts: "倍速快捷键",
      loopShortcuts: "循环快捷键",
      speedDown: "降低倍速",
      speedUp: "提高倍速",
      speedReset: "重设为 1x",
      toggleLoop: "切换循环",
      jumpStart: "跳到开始",
      clearLoop: "清除循环",
      shortcutPlaceholder: "点击后按快捷键",
      shortcutHint: "按 Delete 或 Backspace 可清除此快捷键",
      clearShortcuts: "清除全部快捷键",

      records: "A-B 记录",
      manageRecords: "管理已保存记录",
      storedVideos: "已保存视频：{count}",
      searchRecords: "搜索标题或视频 ID",
      recordCount: "显示 {shown} / {total} 条",
      noRecords: "目前没有已保存的 A-B 记录。",
      noMatchingRecords: "找不到符合搜索条件的记录。",
      untitledVideo: "未命名视频",
      recordUpdated: "更新：{date}",
      recordSource: "来源：{source}",
      sourceWatch: "普通视频",
      sourceShorts: "Shorts",
      savedLoopEnabled: "进入视频时自动启用 Loop",
      saveRecord: "保存",
      openVideo: "打开视频",
      deleteRecord: "删除",
      deleteAllRecords: "删除全部记录",
      confirmDeleteRecord: "确定删除“{title}”的 A-B 记录？",
      confirmDeleteAllRecords:
        "确定删除全部 {count} 条 A-B 记录？此操作无法恢复。",
      recordSaved: "已保存“{title}”的 A-B 记录。",
      recordDeleted: "已删除“{title}”的 A-B 记录。",
      allRecordsDeleted: "已删除全部 A-B 记录。",
      emptyDeletesRecord: "A、B 都留空时会删除此记录。",

      backup: "备份与恢复",
      backupHint: "备份包含设置、快捷键以及所有视频的 A/B、Loop 状态和来源。",
      importMode: "导入方式",
      mergeImport: "合并（导入数据优先）",
      replaceImport: "完全替换现有数据",
      confirmReplaceImport:
        "导入后会完全替换当前设置、快捷键和所有 A/B 记录，确定继续吗？",
      exportBackup: "导出备份",
      importBackup: "导入备份",
      deleteCurrent: "删除此视频的保存点",
      backupExported: "已导出备份，共 {count} 个视频。",
      backupImported: "导入完成，目前共 {count} 个视频。",
      currentDeleted: "已删除此视频的 A/B 保存点。",
      invalidBackup: "备份格式无效或内容已损坏。",
      unsupportedBackup: "当前脚本不支持此备份版本。",
      backupTooLarge: "备份文件超过 5 MB，已取消导入。",
      storageError: "无法写入 localStorage，请检查浏览器存储权限或容量。",
      importReadError: "无法读取备份文件。",
      exportError: "无法创建备份文件。",

      on: "开",
      off: "关",
    }),

    en: Object.freeze({
      appTitle: "YouTube Enhanced Controls",
      settingsTitle: "Settings",
      recordsTitle: "A-B Record Manager",
      openPanel: "Open YouTube enhanced controls",
      closePanel: "Close YouTube enhanced controls",
      openSettings: "Open settings",
      backToMain: "Back to controls",
      backToSettings: "Back to settings",

      speed: "Playback speed",
      currentSpeed: "Current speed",

      loop: "A-B Loop",
      loopPlayback: "Loop playback",
      setStart: "Set start",
      setEnd: "Set end",
      clear: "Clear",
      startTime: "Loop start time",
      endTime: "Loop end time",
      invalidTime: "Invalid format. Use SS, MM:SS, or HH:MM:SS.fff.",
      invalidRange:
        "When Loop is enabled, both A and B are required and B must be later than A.",
      loadingA: "Point A is outside the current buffer and is loading.",
      pointsSaved:
        "The A/B points and Loop state for this video are saved automatically.",
      pointsNotSaved: "No A/B record is saved for this video.",
      pointsSaveFailed:
        "The A/B points were applied, but browser storage could not be updated.",

      general: "General",
      language: "Interface language",
      autoLanguage: "Automatic (browser)",
      speedStep: "Speed shortcut step",
      shortsAsWatch: "Use the standard video page for Shorts",
      shortsAsWatchHint:
        "When enabled, /shorts/ URLs are redirected to the standard /watch player.",
      autoConfirm: "Automatically click “Continue watching”",

      shortcuts: "Keyboard shortcuts",
      shortcutsEmptyHint:
        "Shortcuts are empty by default. Click a field, then press the key combination to bind.",
      speedShortcuts: "Speed shortcuts",
      loopShortcuts: "Loop shortcuts",
      speedDown: "Decrease speed",
      speedUp: "Increase speed",
      speedReset: "Reset to 1x",
      toggleLoop: "Toggle loop",
      jumpStart: "Jump to start",
      clearLoop: "Clear loop",
      shortcutPlaceholder: "Click, then press a shortcut",
      shortcutHint: "Press Delete or Backspace to clear this shortcut",
      clearShortcuts: "Clear all shortcuts",

      records: "A-B records",
      manageRecords: "Manage saved records",
      storedVideos: "Saved videos: {count}",
      searchRecords: "Search title or video ID",
      recordCount: "Showing {shown} of {total}",
      noRecords: "There are no saved A-B records.",
      noMatchingRecords: "No records match the current search.",
      untitledVideo: "Untitled video",
      recordUpdated: "Updated: {date}",
      recordSource: "Source: {source}",
      sourceWatch: "Standard video",
      sourceShorts: "Shorts",
      savedLoopEnabled: "Enable Loop automatically when opening the video",
      saveRecord: "Save",
      openVideo: "Open video",
      deleteRecord: "Delete",
      deleteAllRecords: "Delete all records",
      confirmDeleteRecord: "Delete the A-B record for “{title}”?",
      confirmDeleteAllRecords:
        "Delete all {count} A-B records? This cannot be undone.",
      recordSaved: "Saved the A-B record for “{title}”.",
      recordDeleted: "Deleted the A-B record for “{title}”.",
      allRecordsDeleted: "All A-B records were deleted.",
      emptyDeletesRecord: "Leaving both A and B empty deletes the record.",

      backup: "Backup and restore",
      backupHint:
        "The backup includes settings, shortcuts, and every saved A/B point, Loop state, and source.",
      importMode: "Import mode",
      mergeImport: "Merge (imported data wins)",
      replaceImport: "Replace all existing data",
      confirmReplaceImport:
        "This will replace all settings, shortcuts, and saved A/B records. Continue?",
      exportBackup: "Export backup",
      importBackup: "Import backup",
      deleteCurrent: "Delete saved points for this video",
      backupExported: "Backup exported with {count} saved videos.",
      backupImported: "Import complete. {count} videos are currently saved.",
      currentDeleted: "The saved A/B points for this video were deleted.",
      invalidBackup:
        "The backup format is invalid or the content is corrupted.",
      unsupportedBackup:
        "This backup version is not supported by the current script.",
      backupTooLarge: "The backup exceeds 5 MB, so the import was cancelled.",
      storageError:
        "Could not write to localStorage. Check browser storage permissions or quota.",
      importReadError: "The backup file could not be read.",
      exportError: "The backup file could not be created.",

      on: "On",
      off: "Off",
    }),
  });

  const CSS = `
        #${PANEL_ID} {
            --ytec-bg: var(--yt-spec-menu-background, #282828);
            --ytec-text: var(--yt-spec-text-primary, #f1f1f1);
            --ytec-secondary: var(--yt-spec-text-secondary, #aaa);
            --ytec-muted: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.15));
            --ytec-hover: var(--yt-spec-10-percent-layer, rgba(255, 255, 255, 0.1));
            --ytec-border: var(--yt-spec-10-percent-layer, rgba(255, 255, 255, 0.15));
            --ytec-input: rgba(0, 0, 0, 0.28);
            --ytec-active: #f00;
            --ytec-focus: #3ea6ff;
            --ytec-danger: #ff6b6b;

            position: relative;
            z-index: 99999;
            align-self: center;
            margin-right: 8px;
            color: var(--ytec-text);
            font-family: Roboto, Arial, sans-serif;
        }

        #${PANEL_ID}.ytec-floating {
            position: fixed;
            top: 8px;
            right: 68px;
            z-index: 2147483646;
            margin: 0;
        }

        #${PANEL_ID},
        #${PANEL_ID} * {
            box-sizing: border-box;
        }

        #${PANEL_ID} [hidden] {
            display: none !important;
        }

        #${PANEL_ID} button,
        #${PANEL_ID} input,
        #${PANEL_ID} select {
            font: inherit;
        }

        #${PANEL_ID} .ytec-menu,
        #${PANEL_ID} .ytec-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 0;
            background: transparent;
            color: var(--ytec-text);
            cursor: pointer;
        }

        #${PANEL_ID} .ytec-menu {
            width: 40px;
            height: 40px;
            border: 1px solid var(--ytec-border);
            border-radius: 50%;
            font-size: 24px;
            line-height: 1;
        }

        #${PANEL_ID} .ytec-icon {
            width: 34px;
            height: 34px;
            flex: 0 0 34px;
            border-radius: 50%;
            font-size: 20px;
        }

        #${PANEL_ID} .ytec-menu:hover,
        #${PANEL_ID} .ytec-icon:hover {
            background: var(--ytec-hover);
        }

        #${PANEL_ID} .ytec-content {
            position: absolute;
            top: calc(100% + 10px);
            right: 0;
            width: min(450px, calc(100vw - 24px));
            max-height: calc(100vh - 80px);
            overflow-y: auto;
            padding: 12px;
            border: 1px solid var(--ytec-border);
            border-radius: 12px;
            background: var(--ytec-bg);
            color: var(--ytec-text);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        }

        #${PANEL_ID} .ytec-header {
            position: sticky;
            top: -12px;
            z-index: 2;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: -12px -12px 4px;
            padding: 12px 12px 8px;
            background: var(--ytec-bg);
        }

        #${PANEL_ID} h2,
        #${PANEL_ID} h3 {
            margin: 0;
            font-weight: 700;
        }

        #${PANEL_ID} h2 {
            min-width: 0;
            overflow: hidden;
            font-size: 16px;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        #${PANEL_ID} h3 {
            padding: 0 4px;
            font-size: 15px;
        }

        #${PANEL_ID} .ytec-view,
        #${PANEL_ID} .ytec-section {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        #${PANEL_ID} .ytec-section {
            padding: 8px;
            border-radius: 8px;
        }

        #${PANEL_ID} .ytec-section:hover {
            background: rgba(255, 255, 255, 0.04);
        }

        #${PANEL_ID} .ytec-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }

        #${PANEL_ID} .ytec-label {
            min-width: 0;
            font-size: 14px;
            line-height: 1.35;
        }

        #${PANEL_ID} .ytec-setting-stack {
            display: flex;
            min-width: 0;
            flex-direction: column;
            gap: 4px;
        }

        #${PANEL_ID} .ytec-button-grid,
        #${PANEL_ID} .ytec-two-column,
        #${PANEL_ID} .ytec-preset-grid,
        #${PANEL_ID} .ytec-record-actions {
            display: grid;
            gap: 6px;
        }

        #${PANEL_ID} .ytec-button-grid,
        #${PANEL_ID} .ytec-record-actions {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        #${PANEL_ID} .ytec-two-column {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        #${PANEL_ID} .ytec-preset-grid {
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 5px;
        }

        #${PANEL_ID} .ytec-button {
            min-width: 0;
            padding: 7px 10px;
            border: 0;
            border-radius: 18px;
            background: var(--ytec-muted);
            color: var(--ytec-text);
            font-size: 13px;
            text-align: center;
            white-space: nowrap;
            cursor: pointer;
        }

        #${PANEL_ID} .ytec-button:hover:not(:disabled) {
            background: var(--ytec-hover);
        }

        #${PANEL_ID} .ytec-button[aria-pressed="true"] {
            background: var(--ytec-active);
            color: #fff;
        }

        #${PANEL_ID} .ytec-button.ytec-danger {
            background: rgba(255, 80, 80, 0.2);
        }

        #${PANEL_ID} .ytec-button.ytec-danger:hover:not(:disabled) {
            background: rgba(255, 80, 80, 0.35);
        }

        #${PANEL_ID} .ytec-button:disabled,
        #${PANEL_ID} input:disabled,
        #${PANEL_ID} select:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        #${PANEL_ID} .ytec-toggle {
            min-width: 64px;
        }

        #${PANEL_ID} .ytec-slider {
            width: 100%;
            margin: 0;
        }

        #${PANEL_ID} .ytec-time-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
            align-items: center;
            gap: 8px;
        }

        #${PANEL_ID} .ytec-input,
        #${PANEL_ID} .ytec-select {
            width: 100%;
            min-width: 0;
            padding: 8px;
            border: 1px solid var(--ytec-border);
            border-radius: 8px;
            background: var(--ytec-input);
            color: var(--ytec-text);
            font-size: 14px;
        }

        #${PANEL_ID} .ytec-input {
            font-family: "Courier New", Courier, monospace;
            text-align: center;
        }

        #${PANEL_ID} .ytec-select {
            width: min(220px, 62%);
            cursor: pointer;
        }

        #${PANEL_ID} .ytec-select option {
            background: #282828;
            color: #fff;
        }

        #${PANEL_ID} .ytec-input[aria-invalid="true"] {
            border-color: var(--ytec-danger);
        }

        #${PANEL_ID} details {
            overflow: hidden;
            border: 1px solid var(--ytec-border);
            border-radius: 8px;
        }

        #${PANEL_ID} summary {
            padding: 10px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            user-select: none;
        }

        #${PANEL_ID} .ytec-shortcut-list {
            display: flex;
            flex-direction: column;
            gap: 7px;
            padding: 0 8px 8px;
        }

        #${PANEL_ID} .ytec-shortcut-row {
            display: grid;
            grid-template-columns: 116px minmax(0, 1fr);
            align-items: center;
            gap: 8px;
        }

        #${PANEL_ID} .ytec-shortcut-label {
            font-size: 13px;
            text-align: right;
        }

        #${PANEL_ID} .ytec-shortcut-input {
            cursor: pointer;
        }

        #${PANEL_ID} .ytec-status,
        #${PANEL_ID} .ytec-hint,
        #${PANEL_ID} .ytec-record-meta {
            margin: 0;
            font-size: 12px;
            line-height: 1.4;
            white-space: normal;
        }

        #${PANEL_ID} .ytec-status {
            min-height: 16px;
            color: var(--ytec-danger);
        }

        #${PANEL_ID} .ytec-status[data-error="false"],
        #${PANEL_ID} .ytec-hint,
        #${PANEL_ID} .ytec-record-meta {
            color: var(--ytec-secondary);
        }

        #${PANEL_ID} .ytec-record-toolbar {
            position: sticky;
            top: 38px;
            z-index: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 6px 0 8px;
            background: var(--ytec-bg);
        }

        #${PANEL_ID} .ytec-record-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        #${PANEL_ID} .ytec-record-card {
            display: flex;
            flex-direction: column;
            gap: 9px;
            padding: 10px;
            border: 1px solid var(--ytec-border);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.03);
        }

        #${PANEL_ID} .ytec-record-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
        }

        #${PANEL_ID} .ytec-record-title {
            min-width: 0;
            overflow: hidden;
            font-size: 14px;
            font-weight: 700;
            line-height: 1.35;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        #${PANEL_ID} .ytec-record-id {
            flex: 0 0 auto;
            color: var(--ytec-secondary);
            font-family: "Courier New", Courier, monospace;
            font-size: 11px;
        }

        #${PANEL_ID} .ytec-record-times {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            gap: 8px;
        }

        #${PANEL_ID} .ytec-record-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        #${PANEL_ID} .ytec-record-field-label {
            color: var(--ytec-secondary);
            font-size: 12px;
        }

        #${PANEL_ID} .ytec-record-empty {
            padding: 24px 12px;
            border: 1px dashed var(--ytec-border);
            border-radius: 10px;
            color: var(--ytec-secondary);
            font-size: 13px;
            text-align: center;
        }

        #${PANEL_ID} button:focus-visible,
        #${PANEL_ID} input:focus-visible,
        #${PANEL_ID} select:focus-visible,
        #${PANEL_ID} summary:focus-visible {
            outline: 2px solid var(--ytec-focus);
            outline-offset: 2px;
        }

        @media (max-width: 480px) {
            #${PANEL_ID} .ytec-content {
                right: -8px;
            }

            #${PANEL_ID} .ytec-shortcut-row {
                grid-template-columns: 104px minmax(0, 1fr);
            }

            #${PANEL_ID} .ytec-record-actions {
                grid-template-columns: 1fr;
            }
        }
    `;

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

  function normalizeLanguage(value) {
    return LANGUAGES.some((language) => language.value === value)
      ? value
      : "auto";
  }

  function resolveLanguage(preference) {
    if (preference !== "auto" && TEXT[preference]) {
      return preference;
    }

    const browserLanguages = [
      ...(navigator.languages ?? []),
      navigator.language,
    ].filter(Boolean);

    for (const language of browserLanguages) {
      const normalized = language.toLowerCase();

      if (/^zh-(tw|hant|hk|mo)/.test(normalized)) {
        return "zh-TW";
      }

      if (normalized.startsWith("zh")) {
        return "zh-CN";
      }

      if (normalized.startsWith("en")) {
        return "en";
      }
    }

    return "en";
  }

  function normalizeSpeedStep(value) {
    const parsed = Number(value);
    return SPEED.shortcutSteps.includes(parsed)
      ? parsed
      : SPEED.defaultShortcutStep;
  }

  function normalizeVideoId(value) {
    return typeof value === "string" && VIDEO_ID_PATTERN.test(value)
      ? value
      : null;
  }

  function normalizeTitle(value) {
    return typeof value === "string"
      ? value.trim().slice(0, MAX_VIDEO_TITLE_LENGTH)
      : "";
  }

  function normalizeSource(value) {
    return value === "shorts" ? "shorts" : "watch";
  }

  function normalizeNullableTime(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function normalizeBinding(value) {
    if (
      !isPlainObject(value) ||
      typeof value.key !== "string" ||
      typeof value.code !== "string" ||
      value.code.length === 0
    ) {
      return null;
    }

    return {
      key: value.key,
      code: value.code,
      ctrlKey: Boolean(value.ctrlKey),
      altKey: Boolean(value.altKey),
      shiftKey: Boolean(value.shiftKey),
      metaKey: Boolean(value.metaKey),
    };
  }

  function normalizeShortcuts(value) {
    const result = {};

    if (!isPlainObject(value)) {
      return result;
    }

    for (const action of SHORTCUT_ACTIONS) {
      const binding = normalizeBinding(value[action]);

      if (binding) {
        result[action] = binding;
      }
    }

    return result;
  }

  function normalizeRecord(value) {
    if (!isPlainObject(value)) {
      return null;
    }

    const start = normalizeNullableTime(value.start);
    const end = normalizeNullableTime(value.end);

    if (start === null && end === null) {
      return null;
    }

    const validRange =
      Number.isFinite(start) && Number.isFinite(end) && end > start;
    const title = normalizeTitle(value.title);
    const parsedDate =
      typeof value.updatedAt === "string" ? new Date(value.updatedAt) : null;

    return {
      start,
      end,
      enabled:
        validRange && (value.enabled === true || value.enabled === "true"),
      title,
      source: normalizeSource(value.source),
      updatedAt:
        parsedDate && !Number.isNaN(parsedDate.getTime())
          ? parsedDate.toISOString()
          : new Date().toISOString(),
    };
  }

  function defaultState() {
    return {
      version: STATE_VERSION,
      preferences: {
        language: "auto",
        speedStep: SPEED.defaultShortcutStep,
        autoConfirm: false,
        shortsAsWatch: false,
      },
      shortcuts: {},
      loops: {},
    };
  }

  function normalizeState(value) {
    const source = isPlainObject(value) ? value : {};
    const preferences = isPlainObject(source.preferences)
      ? source.preferences
      : {};
    const loops = {};

    if (isPlainObject(source.loops)) {
      for (const [rawVideoId, rawRecord] of Object.entries(source.loops)) {
        const videoId = normalizeVideoId(rawVideoId);
        const record = normalizeRecord(rawRecord);

        if (videoId && record) {
          loops[videoId] = record;
        }
      }
    }

    return {
      version: STATE_VERSION,
      preferences: {
        language: normalizeLanguage(preferences.language),
        speedStep: normalizeSpeedStep(preferences.speedStep),
        autoConfirm:
          preferences.autoConfirm === true ||
          preferences.autoConfirm === "true",
        shortsAsWatch:
          preferences.shortsAsWatch === true ||
          preferences.shortsAsWatch === "true",
      },
      shortcuts: normalizeShortcuts(source.shortcuts),
      loops,
    };
  }

  class StateStore {
    constructor() {
      this.state = this.load();
    }

    load() {
      const current = readStorage(STATE_KEY);

      if (current !== null) {
        const state = normalizeState(parseJson(current, {}));
        const serialized = JSON.stringify(state);

        if (serialized !== current) {
          writeStorage(STATE_KEY, serialized);
        }

        return state;
      }

      for (const legacyStateKey of LEGACY_STATE_KEYS) {
        const legacyState = readStorage(legacyStateKey);

        if (legacyState !== null) {
          const state = normalizeState(parseJson(legacyState, {}));
          writeStorage(STATE_KEY, JSON.stringify(state));
          return state;
        }
      }

      const state = defaultState();
      state.preferences.language = normalizeLanguage(
        readStorage(LEGACY_KEYS.language) ?? state.preferences.language,
      );
      state.preferences.speedStep = normalizeSpeedStep(
        readStorage(LEGACY_KEYS.speedStep) ?? state.preferences.speedStep,
      );
      state.preferences.autoConfirm =
        readStorage(LEGACY_KEYS.autoConfirm) === "true";
      state.shortcuts = normalizeShortcuts(
        parseJson(readStorage(LEGACY_KEYS.shortcuts), {}),
      );

      const normalized = normalizeState(state);
      writeStorage(STATE_KEY, JSON.stringify(normalized));
      return normalized;
    }

    snapshot() {
      return cloneJson(this.state);
    }

    getPreferences() {
      return { ...this.state.preferences };
    }

    getShortcuts() {
      return cloneJson(this.state.shortcuts);
    }

    getRecord(videoId) {
      const normalizedId = normalizeVideoId(videoId);
      const record = normalizedId ? this.state.loops[normalizedId] : null;
      return record ? { ...record } : null;
    }

    listRecords() {
      return Object.entries(this.state.loops)
        .map(([videoId, record]) => ({ videoId, ...record }))
        .sort((left, right) => {
          const dateDifference =
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime();

          if (dateDifference !== 0) {
            return dateDifference;
          }

          return (left.title || left.videoId).localeCompare(
            right.title || right.videoId,
          );
        });
    }

    countRecords() {
      return Object.keys(this.state.loops).length;
    }

    setPreferences(patch) {
      const next = this.snapshot();
      next.preferences = {
        ...next.preferences,
        ...(isPlainObject(patch) ? patch : {}),
      };
      return this.commit(next);
    }

    setShortcuts(shortcuts) {
      const next = this.snapshot();
      next.shortcuts = normalizeShortcuts(shortcuts);
      return this.commit(next);
    }

    setRecord(videoId, record) {
      const normalizedId = normalizeVideoId(videoId);

      if (!normalizedId) {
        return false;
      }

      const normalizedRecord = normalizeRecord(record);

      if (!normalizedRecord) {
        return this.deleteRecord(normalizedId);
      }

      const next = this.snapshot();
      next.loops[normalizedId] = normalizedRecord;
      return this.commit(next);
    }

    deleteRecord(videoId) {
      const normalizedId = normalizeVideoId(videoId);

      if (!normalizedId) {
        return false;
      }

      const next = this.snapshot();
      delete next.loops[normalizedId];
      return this.commit(next);
    }

    clearRecords() {
      const next = this.snapshot();
      next.loops = {};
      return this.commit(next);
    }

    importState(rawState, mode) {
      const imported = normalizeState(rawState);

      if (mode === "replace") {
        return this.commit(imported);
      }

      const rawPreferences = isPlainObject(rawState?.preferences)
        ? rawState.preferences
        : {};
      const preferences = { ...this.state.preferences };

      for (const key of [
        "language",
        "speedStep",
        "autoConfirm",
        "shortsAsWatch",
      ]) {
        if (hasOwn(rawPreferences, key)) {
          preferences[key] = imported.preferences[key];
        }
      }

      return this.commit({
        version: STATE_VERSION,
        preferences,
        shortcuts: {
          ...this.state.shortcuts,
          ...imported.shortcuts,
        },
        loops: {
          ...this.state.loops,
          ...imported.loops,
        },
      });
    }

    commit(nextState) {
      const normalized = normalizeState(nextState);
      const serialized = JSON.stringify(normalized);

      if (!writeStorage(STATE_KEY, serialized)) {
        return false;
      }

      this.state = normalized;
      return true;
    }
  }

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

  function installStyle() {
    let style = document.getElementById(STYLE_ID);

    if (!style) {
      style = createElement("style", { id: STYLE_ID });
      (document.head ?? document.documentElement).append(style);
    }

    style.textContent = CSS;
  }

  function parseLocationRoute() {
    const url = new URL(location.href);

    if (url.pathname === "/watch") {
      const videoId = normalizeVideoId(url.searchParams.get("v"));
      return videoId ? { type: "watch", videoId } : null;
    }

    const match = url.pathname.match(SHORTS_PATH_PATTERN);
    const videoId = normalizeVideoId(match?.[1]);
    return videoId ? { type: "shorts", videoId } : null;
  }

  function isPlaybackPath() {
    return (
      location.pathname === "/watch" ||
      /^\/shorts(?:\/|$)/.test(location.pathname)
    );
  }

  function routeKey(route) {
    return route ? `${route.type}:${route.videoId}` : "";
  }

  function createWatchUrl(videoId) {
    const target = new URL("/watch", location.origin);

    for (const [key, value] of new URLSearchParams(location.search)) {
      if (key !== "v") {
        target.searchParams.append(key, value);
      }
    }

    target.searchParams.set("v", videoId);
    target.hash = location.hash;
    return target;
  }

  function createRecordUrl(record, shortsAsWatch) {
    if (record.source === "shorts" && !shortsAsWatch) {
      return new URL(`/shorts/${record.videoId}`, location.origin);
    }

    const target = new URL("/watch", location.origin);
    target.searchParams.set("v", record.videoId);
    return target;
  }

  function resolvePanelHost() {
    const mastheadButtons = document.querySelector(SELECTORS.mastheadButtons);

    if (mastheadButtons) {
      return {
        container: mastheadButtons,
        floating: false,
      };
    }

    const mastheadEnd = document.querySelector(SELECTORS.mastheadEnd);

    if (mastheadEnd) {
      return {
        container: mastheadEnd,
        floating: false,
      };
    }

    if (document.body) {
      return {
        container: document.body,
        floating: true,
      };
    }

    return null;
  }

  function visibilityScore(element) {
    const rect = element.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return {
        score: VISIBILITY_SCORE.invisible,
        ratio: 0,
        centered: false,
      };
    }

    const viewportWidth = Math.max(
      document.documentElement.clientWidth,
      window.innerWidth || 0,
    );
    const viewportHeight = Math.max(
      document.documentElement.clientHeight,
      window.innerHeight || 0,
    );
    const visibleWidth = Math.max(
      0,
      Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0),
    );
    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0),
    );
    const area = rect.width * rect.height;
    const ratio = area > 0 ? (visibleWidth * visibleHeight) / area : 0;
    const viewportCenter = viewportHeight / 2;
    const centered =
      rect.top <= viewportCenter && rect.bottom >= viewportCenter;
    const distance =
      Math.abs(rect.top + rect.height / 2 - viewportCenter) /
      Math.max(viewportHeight, 1);

    return {
      score:
        ratio * VISIBILITY_SCORE.visibleRatioWeight +
        (centered ? VISIBILITY_SCORE.centeredBonus : 0) -
        distance * VISIBILITY_SCORE.distancePenaltyWeight,
      ratio,
      centered,
    };
  }

  function extractVideoIdFromUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
      return null;
    }

    try {
      const url = new URL(rawUrl, location.origin);
      const shortsMatch = url.pathname.match(SHORTS_PATH_PATTERN);

      return normalizeVideoId(shortsMatch?.[1] ?? url.searchParams.get("v"));
    } catch {
      return null;
    }
  }

  function getRendererVideoId(renderer) {
    if (!(renderer instanceof Element)) {
      return null;
    }

    const candidates = [
      renderer.getAttribute("video-id"),
      renderer.getAttribute("data-video-id"),
    ];

    try {
      // Keep optional YouTube Polymer internals behind one reflective boundary.
      const data =
        Reflect.get(renderer, "data") ??
        Reflect.get(renderer, "__data")?.data ??
        Reflect.get(renderer, "__dataHost")?.data ??
        null;

      candidates.push(
        data?.videoId,
        data?.reelWatchEndpoint?.videoId,
        data?.navigationEndpoint?.reelWatchEndpoint?.videoId,
        data?.command?.reelWatchEndpoint?.videoId,
        data?.overlay?.reelPlayerOverlayRenderer?.navigationEndpoint
          ?.reelWatchEndpoint?.videoId,
      );
    } catch {
      // YouTube Polymer internals are optional and may be inaccessible.
    }

    for (const candidate of candidates) {
      const videoId = normalizeVideoId(candidate);

      if (videoId) {
        return videoId;
      }
    }

    for (const link of renderer.querySelectorAll(
      'a[href*="/shorts/"], a[href*="watch?v="]',
    )) {
      const videoId = extractVideoIdFromUrl(link.getAttribute("href") ?? "");

      if (videoId) {
        return videoId;
      }
    }

    return null;
  }

  function getPlayerData(video) {
    const player = video?.closest?.(SELECTORS.player);

    try {
      return player?.getVideoData?.() ?? null;
    } catch {
      return null;
    }
  }

  function getVideoId(video) {
    if (!(video instanceof HTMLVideoElement)) {
      return null;
    }

    /*
     * On Shorts, the renderer is updated before the player API in some SPA
     * transitions. Prefer the renderer ID to avoid briefly restoring the
     * previous Short's record on a reused <video> element.
     */
    const rendererVideoId = getRendererVideoId(
      video.closest(SELECTORS.shortsRenderer),
    );

    if (rendererVideoId) {
      return rendererVideoId;
    }

    const playerData = getPlayerData(video);

    return normalizeVideoId(playerData?.video_id ?? playerData?.videoId);
  }

  function getVideoTitle(video) {
    const playerTitle = normalizeTitle(getPlayerData(video)?.title);

    if (playerTitle) {
      return playerTitle;
    }

    const rendererTitle = video
      ?.closest(SELECTORS.shortsRenderer)
      ?.querySelector(
        '#video-title, [id="video-title"], h2 yt-formatted-string, h2',
      )?.textContent;

    const normalizedRendererTitle = normalizeTitle(rendererTitle);

    if (normalizedRendererTitle) {
      return normalizedRendererTitle;
    }

    const watchTitle = document.querySelector(
      "ytd-watch-metadata h1 yt-formatted-string, #title h1 yt-formatted-string",
    )?.textContent;
    const meta = document.querySelector('meta[name="title"]');
    const metaTitle = meta instanceof HTMLMetaElement ? meta.content : "";

    return normalizeTitle(
      (watchTitle || metaTitle || document.title || "").replace(
        /\s+-\s+YouTube\s*$/i,
        "",
      ),
    );
  }

  function resolveWatchVideo(route) {
    const watchRoot = document.querySelector(SELECTORS.watchRoot);

    if (!watchRoot) {
      return null;
    }

    const rootVideoId = normalizeVideoId(watchRoot.getAttribute("video-id"));

    if (rootVideoId && rootVideoId !== route.videoId) {
      return null;
    }

    const candidates = [...watchRoot.querySelectorAll("video")]
      .filter((video) => video instanceof HTMLVideoElement && video.isConnected)
      .map((video) => {
        const videoId = getVideoId(video);
        const visibility = visibilityScore(video);
        let score = visibility.score;

        if (videoId === route.videoId) {
          score += WATCH_VIDEO_SCORE.matchingVideoIdBonus;
        } else if (videoId) {
          score -= WATCH_VIDEO_SCORE.mismatchedVideoIdPenalty;
        }

        if (video.classList.contains("html5-main-video")) {
          score += WATCH_VIDEO_SCORE.mainVideoBonus;
        }

        if (!video.paused && !video.ended) {
          score += WATCH_VIDEO_SCORE.playingBonus;
        }

        if (video.currentSrc) {
          score += WATCH_VIDEO_SCORE.hasSourceBonus;
        }

        return {
          video,
          videoId,
          score,
        };
      })
      .sort((left, right) => right.score - left.score);

    const candidate =
      candidates.find((item) => item.videoId === route.videoId) ??
      candidates.find((item) => !item.videoId) ??
      null;

    if (!candidate) {
      return null;
    }

    return {
      route,
      video: candidate.video,
      verified:
        candidate.videoId === route.videoId || candidate.videoId === null,
    };
  }

  function getShortsVideos() {
    return [
      ...new Set([
        ...document.querySelectorAll("ytd-reel-video-renderer video"),
        ...document.querySelectorAll("ytd-shorts video"),
        ...document.querySelectorAll("#shorts-container video"),
        ...document.querySelectorAll("video.html5-main-video"),
      ]),
    ].filter((video) => video instanceof HTMLVideoElement && video.isConnected);
  }

  function scoreShortsVideo(video, expectedVideoId) {
    const renderer = video.closest(SELECTORS.shortsRenderer);
    const videoId = getVideoId(video);
    const visibility = visibilityScore(video);
    const playing = !video.paused && !video.ended;
    const active = Boolean(
      renderer?.hasAttribute("is-active") ||
      renderer?.hasAttribute("active") ||
      renderer?.getAttribute("aria-hidden") === "false",
    );

    let score = visibility.score;

    if (expectedVideoId && videoId === expectedVideoId) {
      score += SHORTS_VIDEO_SCORE.matchingVideoIdBonus;
    } else if (expectedVideoId && videoId) {
      score -= SHORTS_VIDEO_SCORE.mismatchedVideoIdPenalty;
    }

    if (playing) {
      score += SHORTS_VIDEO_SCORE.playingBonus;
    }

    if (visibility.centered) {
      score += SHORTS_VIDEO_SCORE.centeredBonus;
    }

    if (active) {
      score += SHORTS_VIDEO_SCORE.activeBonus;
    }

    if (renderer?.hidden || renderer?.getAttribute("aria-hidden") === "true") {
      score -= SHORTS_VIDEO_SCORE.hiddenPenalty;
    }

    if (video.readyState > HTMLMediaElement.HAVE_NOTHING) {
      score += SHORTS_VIDEO_SCORE.hasMediaDataBonus;
    }

    if (video.currentSrc) {
      score += SHORTS_VIDEO_SCORE.hasSourceBonus;
    }

    return {
      video,
      videoId,
      score,
      playing,
      active,
      centered: visibility.centered,
      visibleRatio: visibility.ratio,
    };
  }

  function resolveShortsVideo(locationRoute) {
    const candidates = getShortsVideos()
      .map((video) => scoreShortsVideo(video, locationRoute?.videoId ?? null))
      .sort((left, right) => right.score - left.score);

    const candidate =
      candidates.find(
        (item) =>
          item.videoId === locationRoute?.videoId &&
          (item.playing ||
            item.centered ||
            (item.active &&
              item.visibleRatio > SHORTS_VIDEO_SCORE.minimumVisibleRatio)),
      ) ??
      candidates.find((item) => item.playing && item.visibleRatio > 0) ??
      candidates.find((item) => item.centered && item.visibleRatio > 0) ??
      candidates.find(
        (item) =>
          item.videoId === locationRoute?.videoId && item.visibleRatio > 0,
      ) ??
      candidates.find(
        (item) =>
          item.visibleRatio > SHORTS_VIDEO_SCORE.minimumVisibleRatio,
      ) ??
      candidates.find((item) => item.videoId === locationRoute?.videoId) ??
      null;

    const videoId = candidate?.videoId ?? locationRoute?.videoId ?? null;

    if (!videoId) {
      return null;
    }

    return {
      route: {
        type: "shorts",
        videoId,
      },
      video: candidate?.video ?? null,
      verified: Boolean(candidate?.videoId),
    };
  }

  function resolvePlaybackContext() {
    const route = parseLocationRoute();

    if (route?.type === "watch") {
      return (
        resolveWatchVideo(route) ?? {
          route,
          video: null,
          verified: true,
        }
      );
    }

    if (
      route?.type === "shorts" ||
      /^\/shorts(?:\/|$)/.test(location.pathname)
    ) {
      return resolveShortsVideo(route);
    }

    return null;
  }

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

  class SpeedController {
    constructor(onChange) {
      this.onChange = onChange;
      this.video = null;
      this.abortController = null;
    }

    bind(video) {
      this.abortController?.abort();
      this.abortController = null;
      this.video = video;

      if (!video) {
        this.notify();
        return;
      }

      this.abortController = new AbortController();
      const { signal } = this.abortController;
      const notifyIfCurrent = () => {
        if (this.video === video) {
          this.notify();
        }
      };

      video.addEventListener("ratechange", notifyIfCurrent, { signal });
      video.addEventListener("loadedmetadata", notifyIfCurrent, { signal });
      this.notify();
    }

    setRate(rawRate) {
      if (!this.video || !Number.isFinite(rawRate)) {
        return;
      }

      const rate = clamp(rawRate, SPEED.min, SPEED.max);
      this.video.defaultPlaybackRate = rate;
      this.video.playbackRate = rate;
      this.notify();
    }

    adjust(direction, rawStep) {
      if (!this.video || !direction) {
        return;
      }

      const step = normalizeSpeedStep(rawStep);
      const precision = Math.max(2, String(step).split(".")[1]?.length ?? 0);
      const factor = 10 ** precision;
      const nextRate =
        Math.round(
          (this.video.playbackRate + Math.sign(direction) * step) * factor,
        ) / factor;

      this.setRate(nextRate);
    }

    getState() {
      const rate =
        Number.isFinite(this.video?.playbackRate) && this.video.playbackRate > 0
          ? this.video.playbackRate
          : 1;

      return {
        available: Boolean(this.video),
        rate,
      };
    }

    notify() {
      this.onChange?.(this.getState());
    }

    destroy() {
      this.abortController?.abort();
      this.abortController = null;
      this.video = null;
    }
  }

  class LoopController {
    constructor({ onStateChange, onRecordChange }) {
      this.onStateChange = onStateChange;
      this.onRecordChange = onRecordChange;
      this.video = null;
      this.abortController = null;
      this.enabled = false;
      this.start = null;
      this.end = null;
      this.statusKey = null;
      this.frameRequest = null;
      this.fallbackTimer = null;
      this.seekState = null;
    }

    bind(video) {
      this.abortController?.abort();
      this.abortController = null;
      this.stopScheduler();
      this.cancelSeek();
      this.video = video;

      if (!video) {
        this.statusKey = null;
        this.notify();
        return;
      }

      try {
        video.loop = false;
      } catch {
        // Native loop is optional and independent from custom A-B Loop.
      }

      this.abortController = new AbortController();
      const { signal } = this.abortController;
      const isCurrent = () => this.video === video;

      const synchronize = () => {
        if (!isCurrent()) {
          return;
        }

        const previous = this.getRecordState();
        this.start = this.clampPoint(this.start);
        this.end = this.clampPoint(this.end);

        if (!this.hasValidRange()) {
          this.enabled = false;
          this.stopScheduler();
        }

        this.notify();

        const current = this.getRecordState();

        if (
          previous.start !== current.start ||
          previous.end !== current.end ||
          previous.enabled !== current.enabled
        ) {
          this.emitRecordChange();
        }

        this.enforce();
        this.startScheduler();
      };

      video.addEventListener("loadedmetadata", synchronize, { signal });
      video.addEventListener("durationchange", synchronize, { signal });

      video.addEventListener(
        "timeupdate",
        () => {
          if (!isCurrent()) {
            return;
          }

          this.maybeCompleteSeek();
          this.enforce();
          this.startScheduler();
        },
        { signal },
      );

      video.addEventListener(
        "seeking",
        () => {
          if (isCurrent()) {
            this.stopScheduler();
          }
        },
        { signal },
      );

      video.addEventListener(
        "seeked",
        () => {
          if (!isCurrent()) {
            return;
          }

          this.handleSeeked();
          this.enforce();
          this.startScheduler();
        },
        { signal },
      );

      video.addEventListener(
        "waiting",
        () => {
          if (isCurrent() && this.seekState) {
            this.statusKey = "loadingA";
            this.notify();
          }
        },
        { signal },
      );

      for (const eventName of ["canplay", "playing"]) {
        video.addEventListener(
          eventName,
          () => {
            if (!isCurrent()) {
              return;
            }

            this.maybeCompleteSeek();
            this.enforce();
            this.startScheduler();
          },
          { signal },
        );
      }

      video.addEventListener(
        "pause",
        () => {
          if (isCurrent()) {
            this.stopScheduler();
          }
        },
        { signal },
      );

      video.addEventListener(
        "ended",
        () => {
          if (isCurrent()) {
            this.enforce();
          }
        },
        { signal },
      );

      video.addEventListener(
        "emptied",
        () => {
          if (!isCurrent()) {
            return;
          }

          this.stopScheduler();
          this.cancelSeek();
        },
        { signal },
      );

      synchronize();
    }

    loadRecord(record) {
      this.stopScheduler();
      this.cancelSeek();
      this.statusKey = null;

      const normalized = normalizeRecord(record);
      this.start = normalized?.start ?? null;
      this.end = normalized?.end ?? null;
      this.enabled = Boolean(normalized?.enabled) && this.hasValidRange();
      this.notify();

      if (this.video && this.enabled) {
        this.enforce();
        this.startScheduler();
      }
    }

    setPoint(point, value) {
      if (point !== "start" && point !== "end") {
        return;
      }

      this.cancelSeek();
      this.statusKey = null;
      this[point] = this.clampPoint(value);

      if (!this.hasValidRange()) {
        this.enabled = false;
        this.stopScheduler();
      }

      this.notify();
      this.emitRecordChange();
      this.startScheduler();
    }

    clear() {
      this.stopScheduler();
      this.cancelSeek();
      this.enabled = false;
      this.start = null;
      this.end = null;
      this.statusKey = null;
      this.notify();
      this.emitRecordChange();
    }

    toggle() {
      if (!this.video || !this.hasValidRange()) {
        return;
      }

      this.statusKey = null;
      this.enabled = !this.enabled;

      if (this.enabled) {
        this.enforce();
        this.startScheduler();
      } else {
        this.stopScheduler();
        this.cancelSeek();
      }

      this.notify();
      this.emitRecordChange();
    }

    jumpToStart() {
      if (this.video && Number.isFinite(this.start)) {
        this.seekToStart();
      }
    }

    getRecordState() {
      return {
        start: this.start,
        end: this.end,
        enabled: this.enabled && this.hasValidRange(),
      };
    }

    getState() {
      return {
        available: Boolean(this.video),
        enabled: this.enabled,
        start: this.start,
        end: this.end,
        validRange: this.hasValidRange(),
        statusKey: this.statusKey,
      };
    }

    emitRecordChange() {
      this.onRecordChange?.(this.getRecordState());
    }

    notify() {
      this.onStateChange?.(this.getState());
    }

    clampPoint(value) {
      const time = normalizeNullableTime(value);

      if (time === null) {
        return null;
      }

      const duration =
        Number.isFinite(this.video?.duration) && this.video.duration > 0
          ? this.video.duration
          : Number.POSITIVE_INFINITY;

      return clamp(time, 0, duration);
    }

    hasValidRange() {
      return (
        Number.isFinite(this.start) &&
        Number.isFinite(this.end) &&
        this.start >= 0 &&
        this.end > this.start
      );
    }

    isAdPlaying() {
      return (
        this.video
          ?.closest(SELECTORS.player)
          ?.classList.contains("ad-showing") === true
      );
    }

    enforce() {
      const video = this.video;

      if (
        !video ||
        !this.enabled ||
        !this.hasValidRange() ||
        this.isAdPlaying() ||
        this.seekState ||
        video.seeking ||
        (video.paused && !video.ended)
      ) {
        return;
      }

      const currentTime = video.currentTime;

      if (!Number.isFinite(currentTime)) {
        return;
      }

      const duration = this.end - this.start;
      const startTolerance = Math.min(
        LOOP.maxStartTolerance,
        Math.max(
          LOOP.minStartTolerance,
          duration / LOOP.startToleranceDivisor,
        ),
      );

      if (
        currentTime < this.start - startTolerance ||
        currentTime >= this.end
      ) {
        this.seekToStart();
      }
    }

    seekToStart() {
      const video = this.video;

      if (
        !video ||
        this.seekState ||
        video.seeking ||
        !Number.isFinite(this.start)
      ) {
        return;
      }

      if (
        Math.abs(video.currentTime - this.start) < LOOP.exactSeekTolerance &&
        !video.ended
      ) {
        return;
      }

      this.seekState = {
        target: this.start,
        shouldResume: !video.paused || video.ended,
      };

      /*
       * Stop all loop checks before assigning currentTime. While
       * seekState exists, every other callback is prevented from
       * issuing a second seek.
       */
      this.stopScheduler();
      this.statusKey = this.isBuffered(this.start) ? null : "loadingA";
      this.notify();

      try {
        video.currentTime = this.start;
      } catch {
        this.cancelSeek();
        this.statusKey = null;
        this.notify();
        this.startScheduler();
      }
    }

    maybeCompleteSeek() {
      const video = this.video;
      const seekState = this.seekState;

      if (!video || !seekState || video.seeking) {
        return;
      }

      const nearTarget =
        Math.abs(video.currentTime - seekState.target) <= LOOP.seekTolerance;
      const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

      if (nearTarget && hasData) {
        this.completeSeek();
      }
    }

    handleSeeked() {
      if (!this.seekState || !this.video) {
        return;
      }

      const nearTarget =
        Math.abs(this.video.currentTime - this.seekState.target) <=
        LOOP.seekTolerance;

      if (nearTarget) {
        this.completeSeek();
        return;
      }

      this.cancelSeek();
      this.statusKey = null;
      this.notify();
    }

    completeSeek() {
      const video = this.video;
      const seekState = this.seekState;

      if (!video || !seekState) {
        return;
      }

      const shouldResume = seekState.shouldResume;
      this.cancelSeek();
      this.statusKey = null;
      this.notify();

      if (shouldResume && video.paused && !video.ended) {
        void video.play().catch(() => {});
      }
    }

    cancelSeek() {
      this.seekState = null;
    }

    isBuffered(time) {
      const video = this.video;

      if (!video) {
        return false;
      }

      try {
        for (let index = 0; index < video.buffered.length; index += 1) {
          if (
            time >= video.buffered.start(index) - LOOP.bufferTolerance &&
            time <= video.buffered.end(index) + LOOP.bufferTolerance
          ) {
            return true;
          }
        }
      } catch {
        return false;
      }

      return false;
    }

    startScheduler() {
      const video = this.video;

      if (
        !video ||
        video.paused ||
        !this.enabled ||
        !this.hasValidRange() ||
        this.seekState ||
        video.seeking ||
        this.isAdPlaying() ||
        this.frameRequest ||
        this.fallbackTimer !== null
      ) {
        return;
      }

      if (typeof video.requestVideoFrameCallback === "function") {
        const tick = () => {
          if (this.frameRequest?.video !== video) {
            return;
          }

          this.frameRequest = null;
          this.enforce();
          this.startScheduler();
        };

        this.frameRequest = {
          video,
          id: video.requestVideoFrameCallback(tick),
        };
        return;
      }

      this.fallbackTimer = window.setInterval(
        () => this.enforce(),
        LOOP.fallbackIntervalMs,
      );
    }

    stopScheduler() {
      if (this.frameRequest) {
        const { video, id } = this.frameRequest;

        if (typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(id);
        }

        this.frameRequest = null;
      }

      if (this.fallbackTimer !== null) {
        clearInterval(this.fallbackTimer);
        this.fallbackTimer = null;
      }
    }

    destroy() {
      this.abortController?.abort();
      this.abortController = null;
      this.stopScheduler();
      this.cancelSeek();
      this.video = null;
    }
  }

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

  class PanelView {
    constructor({ container, floating, translator, handlers, signal }) {
      this.translator = translator;
      this.handlers = handlers;
      this.currentView = "main";
      this.recordQuery = "";
      this.i18nBindings = [];
      this.shortcutInputs = {};
      this.backupMessage = null;
      this.recordsMessage = null;
      this.refs = {};
      this.panel = this.build(floating);
      this.buildDynamicControls();
      this.bindEvents(signal);
      container.prepend(this.panel);
      this.applyLanguage();
    }

    t(key, values) {
      return this.translator.t(key, values);
    }

    createI18nElement(tagName, key, options = {}, ...children) {
      const node = createElement(tagName, options, ...children);
      this.i18nBindings.push({ node, key });
      return node;
    }

    createButton({
      action = "",
      textKey = null,
      text = "",
      className = "ytec-button",
      attributes = {},
      dataset = {},
    }) {
      const options = {
        className,
        text,
        attributes: {
          type: "button",
          ...attributes,
        },
        dataset: {
          action,
          ...dataset,
        },
      };

      return textKey
        ? this.createI18nElement("button", textKey, options)
        : createElement("button", options);
    }

    createLabel(key) {
      return this.createI18nElement("span", key, {
        className: "ytec-label",
      });
    }

    createSection(titleKey, children, dataset = {}) {
      return createElement(
        "section",
        {
          className: "ytec-section",
          dataset,
        },
        this.createI18nElement("h3", titleKey),
        children,
      );
    }

    build(floating) {
      const menu = this.createButton({
        text: "☰",
        className: "ytec-menu",
        attributes: {
          "aria-controls": "ytec-content",
          "aria-expanded": "false",
        },
      });

      const title = this.createI18nElement("h2", "appTitle", {
        id: "ytec-title",
      });
      const titleBinding = this.i18nBindings.at(-1);
      const navigationButton = this.createButton({
        action: "navigate",
        text: "⚙",
        className: "ytec-icon",
      });

      const speedValue = createElement("strong", { text: "1.00x" });
      const speedSlider = createElement("input", {
        className: "ytec-slider",
        attributes: {
          type: "range",
          min: SPEED.min,
          max: SPEED.max,
          step: SPEED.sliderStep,
          value: 1,
        },
      });
      const speedPresets = createElement("div", {
        className: "ytec-preset-grid",
      });
      const speedSection = this.createSection(
        "speed",
        [
          createElement(
            "div",
            { className: "ytec-row" },
            this.createLabel("currentSpeed"),
            speedValue,
          ),
          speedSlider,
          speedPresets,
        ],
        { section: "speed" },
      );

      const loopToggle = this.createButton({
        action: "toggle-loop",
        className: "ytec-button ytec-toggle",
        attributes: {
          "aria-pressed": "false",
        },
      });
      const setStartButton = this.createButton({
        action: "set-start",
        textKey: "setStart",
      });
      const setEndButton = this.createButton({
        action: "set-end",
        textKey: "setEnd",
      });
      const clearLoopButton = this.createButton({
        action: "clear-loop",
        textKey: "clear",
      });
      const loopStartInput = createElement("input", {
        className: "ytec-input",
        attributes: {
          type: "text",
          inputmode: "decimal",
          placeholder: "00:00.000",
          "aria-invalid": "false",
        },
      });
      const loopEndInput = createElement("input", {
        className: "ytec-input",
        attributes: {
          type: "text",
          inputmode: "decimal",
          placeholder: "00:00.000",
          "aria-invalid": "false",
        },
      });
      const loopStatus = createElement("p", {
        className: "ytec-status",
        attributes: {
          "aria-live": "polite",
        },
        dataset: {
          error: "false",
        },
      });
      const loopPersistence = createElement("p", {
        className: "ytec-hint",
      });
      const loopSection = this.createSection(
        "loop",
        [
          createElement(
            "div",
            { className: "ytec-row" },
            this.createLabel("loopPlayback"),
            loopToggle,
          ),
          createElement(
            "div",
            { className: "ytec-button-grid" },
            setStartButton,
            setEndButton,
            clearLoopButton,
          ),
          createElement(
            "div",
            { className: "ytec-time-grid" },
            loopStartInput,
            createElement("span", { text: "→" }),
            loopEndInput,
          ),
          loopStatus,
          loopPersistence,
        ],
        { section: "loop" },
      );
      const mainView = createElement(
        "div",
        {
          className: "ytec-view",
          dataset: { view: "main" },
        },
        speedSection,
        loopSection,
      );

      const languageSelect = createElement("select", {
        className: "ytec-select",
      });
      const speedStepSelect = createElement("select", {
        className: "ytec-select",
      });
      const shortsAsWatchToggle = this.createButton({
        action: "toggle-shorts-watch",
        className: "ytec-button ytec-toggle",
        attributes: {
          "aria-pressed": "false",
        },
      });
      const autoConfirmToggle = this.createButton({
        action: "toggle-auto-confirm",
        className: "ytec-button ytec-toggle",
        attributes: {
          "aria-pressed": "false",
        },
      });
      const generalSection = this.createSection("general", [
        createElement(
          "label",
          { className: "ytec-row" },
          this.createLabel("language"),
          languageSelect,
        ),
        createElement(
          "label",
          { className: "ytec-row" },
          this.createLabel("speedStep"),
          speedStepSelect,
        ),
        createElement(
          "div",
          { className: "ytec-row" },
          createElement(
            "div",
            { className: "ytec-setting-stack" },
            this.createLabel("shortsAsWatch"),
            this.createI18nElement("p", "shortsAsWatchHint", {
              className: "ytec-hint",
            }),
          ),
          shortsAsWatchToggle,
        ),
        createElement(
          "div",
          { className: "ytec-row" },
          this.createLabel("autoConfirm"),
          autoConfirmToggle,
        ),
      ]);

      const shortcutGroups = createElement("div");
      const clearShortcutsButton = this.createButton({
        action: "clear-shortcuts",
        textKey: "clearShortcuts",
      });
      const shortcutSection = this.createSection("shortcuts", [
        this.createI18nElement("p", "shortcutsEmptyHint", {
          className: "ytec-hint",
        }),
        shortcutGroups,
        clearShortcutsButton,
      ]);

      const storedCount = createElement("span", {
        className: "ytec-label",
      });
      const recordsSummarySection = this.createSection("records", [
        createElement(
          "div",
          { className: "ytec-row" },
          storedCount,
          this.createButton({
            action: "open-records",
            textKey: "manageRecords",
          }),
        ),
      ]);

      const importMode = createElement(
        "select",
        { className: "ytec-select" },
        this.createI18nElement("option", "mergeImport", {
          attributes: { value: "merge" },
        }),
        this.createI18nElement("option", "replaceImport", {
          attributes: { value: "replace" },
        }),
      );
      const backupFile = createElement("input", {
        attributes: {
          type: "file",
          accept: "application/json,.json",
          hidden: true,
        },
      });
      const backupStatus = createElement("p", {
        className: "ytec-status",
        attributes: {
          "aria-live": "polite",
        },
        dataset: {
          error: "false",
        },
      });
      const deleteCurrentButton = this.createButton({
        action: "delete-current",
        textKey: "deleteCurrent",
      });
      const backupSection = this.createSection("backup", [
        this.createI18nElement("p", "backupHint", {
          className: "ytec-hint",
        }),
        createElement(
          "label",
          { className: "ytec-row" },
          this.createLabel("importMode"),
          importMode,
        ),
        createElement(
          "div",
          { className: "ytec-two-column" },
          this.createButton({
            action: "export-backup",
            textKey: "exportBackup",
          }),
          this.createButton({
            action: "choose-import",
            textKey: "importBackup",
          }),
        ),
        deleteCurrentButton,
        backupFile,
        backupStatus,
      ]);
      const settingsView = createElement(
        "div",
        {
          className: "ytec-view",
          attributes: { hidden: true },
          dataset: { view: "settings" },
        },
        generalSection,
        shortcutSection,
        recordsSummarySection,
        backupSection,
      );

      const recordsSearch = createElement("input", {
        className: "ytec-input",
        attributes: {
          type: "search",
          autocomplete: "off",
        },
      });
      const recordCount = createElement("span", {
        className: "ytec-label",
      });
      const deleteAllRecordsButton = this.createButton({
        action: "delete-all-records",
        textKey: "deleteAllRecords",
        className: "ytec-button ytec-danger",
      });
      const recordsStatus = createElement("p", {
        className: "ytec-status",
        attributes: {
          "aria-live": "polite",
        },
        dataset: {
          error: "false",
        },
      });
      const recordList = createElement("div", {
        className: "ytec-record-list",
      });
      const recordsView = createElement(
        "div",
        {
          className: "ytec-view",
          attributes: { hidden: true },
          dataset: { view: "records" },
        },
        createElement(
          "div",
          { className: "ytec-record-toolbar" },
          recordsSearch,
          createElement(
            "div",
            { className: "ytec-row" },
            recordCount,
            deleteAllRecordsButton,
          ),
          this.createI18nElement("p", "emptyDeletesRecord", {
            className: "ytec-hint",
          }),
          recordsStatus,
        ),
        recordList,
      );

      const content = createElement(
        "div",
        {
          id: "ytec-content",
          className: "ytec-content",
          attributes: {
            role: "dialog",
            "aria-modal": "false",
            "aria-labelledby": "ytec-title",
            hidden: true,
          },
        },
        createElement(
          "header",
          { className: "ytec-header" },
          title,
          navigationButton,
        ),
        mainView,
        settingsView,
        recordsView,
      );

      Object.assign(this.refs, {
        menu,
        content,
        titleBinding,
        navigationButton,
        views: {
          main: mainView,
          settings: settingsView,
          records: recordsView,
        },
        speedSection,
        speedValue,
        speedSlider,
        speedPresets,
        loopSection,
        loopToggle,
        setStartButton,
        setEndButton,
        clearLoopButton,
        loopStartInput,
        loopEndInput,
        loopStatus,
        loopPersistence,
        languageSelect,
        speedStepSelect,
        shortsAsWatchToggle,
        autoConfirmToggle,
        shortcutGroups,
        clearShortcutsButton,
        storedCount,
        importMode,
        backupFile,
        backupStatus,
        deleteCurrentButton,
        recordsSearch,
        recordCount,
        deleteAllRecordsButton,
        recordsStatus,
        recordList,
      });

      return createElement(
        "div",
        {
          id: PANEL_ID,
          className: floating ? "ytec-floating" : "",
        },
        menu,
        content,
      );
    }

    buildDynamicControls() {
      for (const rate of SPEED.presets) {
        this.refs.speedPresets.append(
          this.createButton({
            action: "set-speed",
            text: `${rate}x`,
            dataset: { rate },
            attributes: {
              "aria-pressed": "false",
            },
          }),
        );
      }

      for (const language of LANGUAGES) {
        this.refs.languageSelect.append(
          language.value === "auto"
            ? this.createI18nElement("option", "autoLanguage", {
                attributes: { value: language.value },
              })
            : createElement("option", {
                text: language.label,
                attributes: { value: language.value },
              }),
        );
      }

      for (const step of SPEED.shortcutSteps) {
        this.refs.speedStepSelect.append(
          createElement("option", {
            text: `${step}x`,
            attributes: { value: step },
          }),
        );
      }

      for (const group of SHORTCUT_GROUPS) {
        const details = createElement("details", {
          properties: { open: group.open },
        });
        const list = createElement("div", {
          className: "ytec-shortcut-list",
        });

        for (const action of group.actions) {
          const input = createElement("input", {
            className: "ytec-input ytec-shortcut-input",
            attributes: { type: "text" },
            properties: { readOnly: true },
            dataset: { shortcutAction: action.id },
          });

          this.shortcutInputs[action.id] = input;
          list.append(
            createElement(
              "label",
              { className: "ytec-shortcut-row" },
              this.createI18nElement("span", action.labelKey, {
                className: "ytec-shortcut-label",
              }),
              input,
            ),
          );
        }

        details.append(this.createI18nElement("summary", group.labelKey), list);
        this.refs.shortcutGroups.append(details);
      }
    }

    bindEvents(signal) {
      this.panel.addEventListener(
        "click",
        (event) => {
          const button =
            event.target instanceof Element
              ? event.target.closest("button")
              : null;

          if (
            !(button instanceof HTMLButtonElement) ||
            !this.panel.contains(button)
          ) {
            return;
          }

          if (button === this.refs.menu) {
            event.stopPropagation();
            this.setOpen(this.refs.content.hidden);
            return;
          }

          switch (button.dataset.action) {
            case "navigate":
              this.navigate();
              break;
            case "open-records":
              this.setView("records");
              break;
            case "set-speed":
              this.handlers.setSpeed?.(Number(button.dataset.rate));
              break;
            case "toggle-loop":
              this.handlers.toggleLoop?.();
              break;
            case "set-start":
              this.handlers.setPointNow?.("start");
              break;
            case "set-end":
              this.handlers.setPointNow?.("end");
              break;
            case "clear-loop":
              this.handlers.clearLoop?.();
              break;
            case "toggle-shorts-watch":
              this.handlers.toggleShortsAsWatch?.();
              break;
            case "toggle-auto-confirm":
              this.handlers.toggleAutoConfirm?.();
              break;
            case "clear-shortcuts":
              this.handlers.clearShortcuts?.();
              break;
            case "export-backup":
              this.handlers.exportBackup?.();
              break;
            case "choose-import":
              this.refs.backupFile.click();
              break;
            case "delete-current":
              this.handlers.deleteCurrentRecord?.();
              break;
            case "save-record":
              this.saveRecordCard(button.closest(".ytec-record-card"));
              break;
            case "open-record":
              this.handlers.openRecord?.(button.dataset.videoId);
              break;
            case "delete-record":
              this.deleteRecordCard(button.closest(".ytec-record-card"));
              break;
            case "delete-all-records":
              this.deleteAllRecords();
              break;
            default:
              break;
          }
        },
        { signal },
      );

      this.panel.addEventListener(
        "input",
        (event) => {
          const target = event.target;

          if (target === this.refs.speedSlider) {
            this.handlers.setSpeed?.(Number(target.value));
            return;
          }

          if (
            target === this.refs.loopStartInput ||
            target === this.refs.loopEndInput
          ) {
            this.clearInputError(target);
            return;
          }

          if (target === this.refs.recordsSearch) {
            this.recordQuery = target.value;
            this.renderRecordManager();
            return;
          }

          if (
            target instanceof HTMLInputElement &&
            target.closest(".ytec-record-card")
          ) {
            this.clearInputError(target);
            this.setRecordCardStatus(target.closest(".ytec-record-card"), null);
          }
        },
        { signal },
      );

      this.panel.addEventListener(
        "change",
        (event) => {
          const target = event.target;

          if (target === this.refs.languageSelect) {
            this.handlers.setLanguage?.(target.value);
            return;
          }

          if (target === this.refs.speedStepSelect) {
            this.handlers.setSpeedStep?.(target.value);
            return;
          }

          if (target === this.refs.loopStartInput) {
            this.commitPointInput("start", target);
            return;
          }

          if (target === this.refs.loopEndInput) {
            this.commitPointInput("end", target);
            return;
          }

          if (target === this.refs.backupFile) {
            const file = target.files?.[0] ?? null;
            const mode = this.refs.importMode.value;
            target.value = "";
            void this.handlers.importBackup?.(file, mode);
          }
        },
        { signal },
      );

      this.panel.addEventListener(
        "keydown",
        (event) => {
          const input =
            event.target instanceof HTMLInputElement ? event.target : null;
          const action = input?.dataset.shortcutAction;

          if (!action) {
            return;
          }

          if (this.handlers.captureShortcut?.(event, action)) {
            input.blur();
          }
        },
        { signal },
      );

      document.addEventListener(
        "pointerdown",
        (event) => {
          if (this.refs.content.hidden) {
            return;
          }

          if (
            event.target instanceof Node &&
            this.panel.contains(event.target)
          ) {
            return;
          }

          this.setOpen(false);
        },
        { signal },
      );

      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape" || this.refs.content.hidden) {
            return;
          }

          if (this.currentView === "records") {
            this.setView("settings");
          } else if (this.currentView === "settings") {
            this.setView("main");
          } else {
            this.setOpen(false);
          }
        },
        { signal },
      );
    }

    navigate() {
      if (this.currentView === "main") {
        this.setView("settings");
      } else if (this.currentView === "records") {
        this.setView("settings");
      } else {
        this.setView("main");
      }
    }

    setView(view) {
      if (!hasOwn(this.refs.views, view)) {
        return;
      }

      this.currentView = view;

      for (const [name, node] of Object.entries(this.refs.views)) {
        node.hidden = name !== view;
      }

      this.refs.titleBinding.key =
        view === "main"
          ? "appTitle"
          : view === "settings"
            ? "settingsTitle"
            : "recordsTitle";
      this.refs.navigationButton.textContent = view === "main" ? "⚙" : "←";
      this.applyLanguage();

      if (view === "records") {
        this.renderRecordManager();
        requestAnimationFrame(() => this.refs.recordsSearch.focus());
      }
    }

    setOpen(open) {
      this.refs.content.hidden = !open;
      this.refs.menu.textContent = open ? "×" : "☰";
      this.refs.menu.setAttribute("aria-expanded", String(open));
      this.refs.menu.setAttribute(
        "aria-label",
        this.t(open ? "closePanel" : "openPanel"),
      );

      if (!open) {
        this.setView("main");
      }
    }

    setPlaybackVisible(visible) {
      this.refs.speedSection.hidden = !visible;
      this.refs.loopSection.hidden = !visible;
    }

    applyLanguage() {
      this.panel.lang = this.translator.locale;

      for (const binding of this.i18nBindings) {
        binding.node.textContent = this.t(binding.key);
      }

      this.refs.menu.setAttribute(
        "aria-label",
        this.t(this.refs.content.hidden ? "openPanel" : "closePanel"),
      );
      this.refs.navigationButton.setAttribute(
        "aria-label",
        this.t(
          this.currentView === "main"
            ? "openSettings"
            : this.currentView === "records"
              ? "backToSettings"
              : "backToMain",
        ),
      );
      this.refs.speedSlider.setAttribute("aria-label", this.t("speed"));
      this.refs.loopStartInput.setAttribute("aria-label", this.t("startTime"));
      this.refs.loopEndInput.setAttribute("aria-label", this.t("endTime"));
      this.refs.recordsSearch.placeholder = this.t("searchRecords");
      this.renderMessage(this.refs.backupStatus, this.backupMessage);
      this.renderMessage(this.refs.recordsStatus, this.recordsMessage);
    }

    commitPointInput(point, input) {
      const result = this.handlers.setPointText?.(point, input.value);

      if (result?.valid === false) {
        this.setInputError(input, result.messageKey ?? "invalidTime");
      } else {
        this.clearInputError(input);
      }
    }

    setInputError(input, messageKey) {
      const message = this.t(messageKey);
      input.dataset.parseInvalid = "true";
      input.setAttribute("aria-invalid", "true");
      input.title = message;
      input.setCustomValidity(message);
      input.reportValidity();
    }

    clearInputError(input) {
      delete input.dataset.parseInvalid;
      input.setAttribute("aria-invalid", "false");
      input.removeAttribute("title");
      input.setCustomValidity("");
    }

    clearLoopInputError(point) {
      this.clearInputError(
        point === "start" ? this.refs.loopStartInput : this.refs.loopEndInput,
      );
    }

    clearLoopInputErrors() {
      this.clearInputError(this.refs.loopStartInput);
      this.clearInputError(this.refs.loopEndInput);
    }

    renderSpeed(state) {
      const rate = state?.rate ?? 1;
      const available = Boolean(state?.available);
      this.refs.speedValue.textContent = `${rate.toFixed(2)}x`;
      this.refs.speedSlider.value = String(clamp(rate, SPEED.min, SPEED.max));
      this.refs.speedSlider.disabled = !available;
      this.refs.speedSlider.setAttribute(
        "aria-valuetext",
        `${rate.toFixed(2)}x`,
      );

      for (const button of this.refs.speedPresets.querySelectorAll(
        "button[data-rate]",
      )) {
        button.disabled = !available;
        button.setAttribute(
          "aria-pressed",
          String(
            Math.abs(Number(button.dataset.rate) - rate) <
              SPEED.presetMatchTolerance,
          ),
        );
      }
    }

    renderLoop(state, persistence) {
      const available = Boolean(state?.available);
      const start = state?.start ?? null;
      const end = state?.end ?? null;
      const invalidRange =
        Number.isFinite(start) && Number.isFinite(end) && end <= start;

      this.renderToggle(this.refs.loopToggle, Boolean(state?.enabled));
      this.refs.loopToggle.disabled = !available || !state?.validRange;
      this.refs.setStartButton.disabled = !available;
      this.refs.setEndButton.disabled = !available;
      this.refs.clearLoopButton.disabled =
        start === null && end === null && !state?.enabled;
      this.refs.loopStartInput.disabled = !available;
      this.refs.loopEndInput.disabled = !available;

      this.renderTimeInput(this.refs.loopStartInput, start, invalidRange);
      this.renderTimeInput(this.refs.loopEndInput, end, invalidRange);

      const statusKey = invalidRange ? "invalidRange" : state?.statusKey;
      this.refs.loopStatus.textContent = statusKey ? this.t(statusKey) : "";
      this.refs.loopStatus.dataset.error = String(invalidRange);

      const persistenceKey = persistence?.failed
        ? "pointsSaveFailed"
        : persistence?.saved
          ? "pointsSaved"
          : "pointsNotSaved";
      this.refs.loopPersistence.textContent = available
        ? this.t(persistenceKey)
        : "";
    }

    renderTimeInput(input, value, invalidRange) {
      const parseInvalid = input.dataset.parseInvalid === "true";

      if (!parseInvalid && document.activeElement !== input) {
        input.value = TimeCodec.format(value);
      }

      const invalid = parseInvalid || invalidRange;
      input.setAttribute("aria-invalid", String(invalid));

      if (parseInvalid) {
        const message = this.t("invalidTime");
        input.title = message;
        input.setCustomValidity(message);
      } else if (invalidRange) {
        input.title = this.t("invalidRange");
        input.setCustomValidity("");
      } else {
        input.removeAttribute("title");
        input.setCustomValidity("");
      }
    }

    renderPreferences(preferences) {
      this.refs.languageSelect.value = normalizeLanguage(preferences.language);
      this.refs.speedStepSelect.value = String(
        normalizeSpeedStep(preferences.speedStep),
      );
      this.renderToggle(
        this.refs.shortsAsWatchToggle,
        Boolean(preferences.shortsAsWatch),
      );
      this.renderToggle(
        this.refs.autoConfirmToggle,
        Boolean(preferences.autoConfirm),
      );
    }

    renderToggle(button, enabled) {
      button.textContent = this.t(enabled ? "on" : "off");
      button.setAttribute("aria-pressed", String(enabled));
    }

    renderShortcuts(bindings, formatBinding) {
      const normalized = normalizeShortcuts(bindings);
      this.refs.clearShortcutsButton.disabled =
        Object.keys(normalized).length === 0;

      for (const action of SHORTCUT_ACTIONS) {
        const input = this.shortcutInputs[action];
        const binding = normalized[action];
        input.value = binding ? formatBinding(binding) : "";
        input.placeholder = binding ? "" : this.t("shortcutPlaceholder");
        input.title = this.t("shortcutHint");
      }
    }

    renderStorage(count, currentSaved) {
      this.refs.storedCount.textContent = this.t("storedVideos", { count });
      this.refs.deleteCurrentButton.disabled = !currentSaved;
    }

    setBackupMessage(messageKey, values = {}, error = false) {
      this.backupMessage = messageKey ? { messageKey, values, error } : null;
      this.renderMessage(this.refs.backupStatus, this.backupMessage);
    }

    setRecordsMessage(messageKey, values = {}, error = false) {
      this.recordsMessage = messageKey ? { messageKey, values, error } : null;
      this.renderMessage(this.refs.recordsStatus, this.recordsMessage);
    }

    renderMessage(node, message) {
      node.textContent = message
        ? this.t(message.messageKey, message.values)
        : "";
      node.dataset.error = String(Boolean(message?.error));
    }

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

  class Application {
    constructor() {
      this.store = new StateStore();
      this.preferences = this.store.getPreferences();
      this.translator = new Translator(this.preferences.language);
      this.backupService = new BackupService(this.store);

      this.appAbortController = new AbortController();
      this.panelAbortController = null;
      this.domObserver = null;
      this.reconcileTimer = null;
      this.reconcileDueAt = Number.POSITIVE_INFINITY;

      this.view = null;
      this.route = null;
      this.routeSignature = "";
      this.video = null;
      this.pendingUnknownVideo = null;
      this.mediaRetryCount = 0;
      this.persistenceFailed = false;
      this.started = false;
      this.waitingForDocument = false;
      this.destroyed = false;

      this.speedController = new SpeedController((state) => {
        this.view?.renderSpeed(state);
      });

      this.loopController = new LoopController({
        onStateChange: (state) => {
          this.renderLoop(state);
        },
        onRecordChange: (record) => {
          this.persistCurrentRecord(record);
        },
      });

      this.shortcutManager = new ShortcutManager({
        bindings: this.store.getShortcuts(),
        onChange: (bindings) => {
          this.persistShortcuts(bindings);
        },
        onAction: (action) => {
          this.executeShortcut(action);
        },
      });

      this.autoConfirmController = new AutoConfirmController(
        this.preferences.autoConfirm,
      );
    }

    start() {
      if (this.destroyed || this.started) {
        return;
      }

      if (this.redirectShortsIfNeeded()) {
        return;
      }

      if (!document.documentElement) {
        if (!this.waitingForDocument) {
          this.waitingForDocument = true;

          document.addEventListener(
            "readystatechange",
            () => {
              this.waitingForDocument = false;
              this.start();
            },
            {
              once: true,
              signal: this.appAbortController.signal,
            },
          );
        }

        return;
      }

      this.started = true;
      installStyle();

      const { signal } = this.appAbortController;

      this.shortcutManager.start(signal);

      document.addEventListener(
        "yt-navigate-start",
        () => {
          this.handleNavigationStart();
        },
        { signal },
      );

      for (const eventName of [
        "yt-navigate-finish",
        "yt-page-data-updated",
        "yt-player-updated",
      ]) {
        document.addEventListener(
          eventName,
          () => {
            this.scheduleReconcile(0);
          },
          { signal },
        );
      }

      window.addEventListener(
        "popstate",
        () => {
          this.scheduleReconcile(0);
        },
        { signal },
      );

      window.addEventListener(
        "hashchange",
        () => {
          this.scheduleReconcile(0);
        },
        { signal },
      );

      window.addEventListener(
        "pageshow",
        () => {
          this.scheduleReconcile(0);
        },
        { signal },
      );

      document.addEventListener(
        "visibilitychange",
        () => {
          if (!document.hidden) {
            this.scheduleReconcile(0);
          }
        },
        { signal },
      );

      window.addEventListener(
        "pagehide",
        (event) => {
          if (!event.persisted) {
            this.destroy();
          }
        },
        { signal },
      );

      for (const eventName of [
        "play",
        "playing",
        "loadedmetadata",
        "durationchange",
        "emptied",
      ]) {
        document.addEventListener(
          eventName,
          (event) => {
            if (event.target instanceof HTMLVideoElement && isPlaybackPath()) {
              this.scheduleReconcile(0);
            }
          },
          {
            capture: true,
            signal,
          },
        );
      }

      document.addEventListener(
        "scroll",
        () => {
          if (/^\/shorts(?:\/|$)/.test(location.pathname)) {
            this.scheduleReconcile(RECONCILE.visualChangeDelayMs);
          }
        },
        {
          capture: true,
          passive: true,
          signal,
        },
      );

      window.addEventListener(
        "resize",
        () => {
          if (isPlaybackPath()) {
            this.scheduleReconcile(RECONCILE.visualChangeDelayMs);
          }
        },
        {
          passive: true,
          signal,
        },
      );

      this.domObserver = new MutationObserver((records) => {
        this.handleMutations(records);
      });

      this.domObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "video-id",
          "data-video-id",
          "is-active",
          "active",
          "aria-hidden",
          "hidden",
        ],
      });

      if (this.preferences.autoConfirm) {
        this.autoConfirmController.refresh();
      }

      this.scheduleReconcile(0);
    }

    redirectShortsIfNeeded() {
      this.preferences = this.store.getPreferences();

      const route = parseLocationRoute();

      if (!this.preferences.shortsAsWatch || route?.type !== "shorts") {
        return false;
      }

      const target = createWatchUrl(route.videoId);

      if (target.href === location.href) {
        return false;
      }

      location.replace(target.href);
      return true;
    }

    handleNavigationStart() {
      this.bindVideo(null);
      this.route = null;
      this.routeSignature = "";
      this.pendingUnknownVideo = null;
      this.mediaRetryCount = 0;
      this.persistenceFailed = false;

      this.loopController.loadRecord(null);
      this.view?.clearLoopInputErrors();
      this.view?.setPlaybackVisible(isPlaybackPath());
      this.renderAll();

      /*
       * Some Shorts transitions emit yt-navigate-start without a
       * matching finish event. Schedule a fallback reconciliation.
       */
      this.scheduleReconcile(RECONCILE.navigationFallbackDelayMs);
    }

    handleMutations(records) {
      if (this.destroyed) {
        return;
      }

      if (this.view && !this.view.panel.isConnected) {
        this.scheduleReconcile(0);
        return;
      }

      if (this.video && !this.video.isConnected) {
        this.scheduleReconcile(0);
        return;
      }

      const locationSignature = routeKey(parseLocationRoute());

      if (locationSignature && locationSignature !== this.routeSignature) {
        this.scheduleReconcile(0);
        return;
      }

      for (const record of records) {
        if (
          record.type === "attributes" &&
          record.target instanceof Element &&
          record.target.matches(
            [SELECTORS.watchRoot, SELECTORS.shortsRenderer, "video"].join(","),
          )
        ) {
          this.scheduleReconcile(0);
          return;
        }

        const changedNodes = [...record.addedNodes, ...record.removedNodes];

        if (changedNodes.some(nodeAffectsLifecycle)) {
          this.scheduleReconcile(0);
          return;
        }
      }
    }

    /**
     * @param {number} [delay]
     */
    scheduleReconcile(delay = RECONCILE.defaultDelayMs) {
      if (this.destroyed) {
        return;
      }

      const normalizedDelay = Number.isFinite(delay) && delay > 0 ? delay : 0;
      const dueAt = Date.now() + normalizedDelay;

      if (this.reconcileTimer !== null && dueAt >= this.reconcileDueAt) {
        return;
      }

      if (this.reconcileTimer !== null) {
        clearTimeout(this.reconcileTimer);
      }

      this.reconcileDueAt = dueAt;
      this.reconcileTimer = window.setTimeout(() => {
        this.reconcileTimer = null;
        this.reconcileDueAt = Number.POSITIVE_INFINITY;

        try {
          this.reconcile();
        } catch (error) {
          console.error(`${LOG_PREFIX} Reconciliation failed.`, error);
        }
      }, normalizedDelay);
    }

    reconcile() {
      if (this.destroyed || this.redirectShortsIfNeeded()) {
        return;
      }

      this.reconcilePanel();

      const context = resolvePlaybackContext();
      const fallbackRoute = parseLocationRoute();
      const nextRoute = context?.route ?? fallbackRoute;
      const nextSignature = routeKey(nextRoute);
      const routeChanged = nextSignature !== this.routeSignature;

      if (routeChanged) {
        /*
         * YouTube frequently reuses the same <video> element across
         * SPA navigation and Shorts swipes. Detach old listeners
         * before loading the next record.
         */
        this.bindVideo(null);
        this.route = nextRoute;
        this.routeSignature = nextSignature;
        this.pendingUnknownVideo = null;
        this.mediaRetryCount = 0;
        this.persistenceFailed = false;

        this.loopController.loadRecord(
          this.store.getRecord(nextRoute?.videoId),
        );
        this.view?.clearLoopInputErrors();
      }

      let nextVideo = context?.video ?? null;

      /*
       * A Shorts renderer can briefly expose a playable <video> before
       * its videoId is available. Require the same unknown candidate
       * to win several consecutive resolutions before binding it.
       */
      if (nextVideo && context?.verified === false) {
        const sameCandidate =
          this.pendingUnknownVideo?.signature === nextSignature &&
          this.pendingUnknownVideo?.video === nextVideo;

        this.pendingUnknownVideo = {
          signature: nextSignature,
          video: nextVideo,
          count: sameCandidate ? this.pendingUnknownVideo.count + 1 : 1,
        };

        if (
          this.pendingUnknownVideo.count <
          RECONCILE.unknownVideoConfirmations
        ) {
          nextVideo = null;
          this.scheduleReconcile(RECONCILE.unknownVideoRetryDelayMs);
        }
      } else {
        this.pendingUnknownVideo = null;
      }

      if (nextVideo) {
        this.mediaRetryCount = 0;

        if (nextVideo !== this.video) {
          this.bindVideo(nextVideo);
        }
      } else if (this.video && !this.video.isConnected) {
        this.bindVideo(null);
      }

      const shouldShowPlaybackControls =
        Boolean(nextRoute) || Boolean(nextVideo) || isPlaybackPath();

      this.view?.setPlaybackVisible(shouldShowPlaybackControls);
      this.autoConfirmController.refresh();
      this.renderAll();

      /*
       * Initial player construction is asynchronous. Retries are
       * bounded and stop immediately once a video is bound.
       */
      if (
        shouldShowPlaybackControls &&
        !this.video &&
        this.mediaRetryCount < RECONCILE.maxMediaRetries
      ) {
        this.mediaRetryCount += 1;

        this.scheduleReconcile(
          Math.min(
            RECONCILE.maxMediaRetryDelayMs,
            RECONCILE.mediaRetryStepMs * this.mediaRetryCount,
          ),
        );
      }
    }

    reconcilePanel() {
      const host = resolvePanelHost();

      if (!host) {
        this.disposePanel();
        return;
      }

      const currentPanel = this.view?.panel;
      const floatingMatches =
        currentPanel?.classList.contains("ytec-floating") === host.floating;

      if (
        currentPanel?.isConnected &&
        currentPanel.parentElement === host.container &&
        floatingMatches
      ) {
        return;
      }

      this.disposePanel();
      document.getElementById(PANEL_ID)?.remove();

      this.panelAbortController = new AbortController();
      this.view = new PanelView({
        container: host.container,
        floating: host.floating,
        translator: this.translator,
        handlers: this.createViewHandlers(),
        signal: this.panelAbortController.signal,
      });

      this.view.setPlaybackVisible(Boolean(this.route) || isPlaybackPath());
      this.renderAll();
    }

    createViewHandlers() {
      return {
        setSpeed: (rate) => {
          this.speedController.setRate(rate);
        },

        toggleLoop: () => {
          this.loopController.toggle();
        },

        setPointNow: (point) => {
          this.setPointFromCurrentTime(point);
        },

        setPointText: (point, text) => this.setPointFromText(point, text),

        clearLoop: () => {
          this.view?.clearLoopInputErrors();
          this.loopController.clear();
        },

        setLanguage: (language) => {
          this.setLanguage(language);
        },

        setSpeedStep: (step) => {
          this.setSpeedStep(step);
        },

        toggleShortsAsWatch: () => {
          this.toggleShortsAsWatch();
        },

        toggleAutoConfirm: () => {
          this.toggleAutoConfirm();
        },

        captureShortcut: (event, action) =>
          this.shortcutManager.capture(event, action),

        clearShortcuts: () => {
          this.shortcutManager.clearAll();
        },

        exportBackup: () => {
          this.exportBackup();
        },

        importBackup: (file, mode) => this.importBackup(file, mode),

        deleteCurrentRecord: () => {
          this.deleteCurrentRecord();
        },

        listRecords: (query) => this.listRecords(query),

        saveRecord: (videoId, startText, endText, enabled) =>
          this.saveManagedRecord(videoId, startText, endText, enabled),

        deleteRecord: (videoId) => this.deleteManagedRecord(videoId),

        deleteAllRecords: () => this.deleteAllManagedRecords(),

        openRecord: (videoId) => {
          this.openRecord(videoId);
        },
      };
    }

    bindVideo(video) {
      if (video === this.video) {
        return;
      }

      this.video = video;
      this.speedController.bind(video);
      this.loopController.bind(video);
    }

    setPointFromCurrentTime(point) {
      if (!this.video || !Number.isFinite(this.video.currentTime)) {
        return;
      }

      this.view?.clearLoopInputError(point);
      this.loopController.setPoint(point, this.video.currentTime);
    }

    setPointFromText(point, text) {
      const parsed = TimeCodec.parse(text);

      if (!parsed.valid) {
        return {
          valid: false,
          messageKey: "invalidTime",
        };
      }

      this.loopController.setPoint(point, parsed.value);

      return {
        valid: true,
      };
    }

    persistCurrentRecord(record) {
      if (!this.route) {
        return;
      }

      const empty = record.start === null && record.end === null;

      const persisted = empty
        ? this.store.deleteRecord(this.route.videoId)
        : this.store.setRecord(this.route.videoId, {
            ...record,
            title: getVideoTitle(this.video),
            source: this.route.type,
            updatedAt: new Date().toISOString(),
          });

      this.persistenceFailed = !persisted;
      this.renderAll();
      this.view?.refreshRecordManager();
    }

    persistShortcuts(bindings) {
      if (!this.store.setShortcuts(bindings)) {
        this.shortcutManager.setBindings(this.store.getShortcuts());
        this.view?.setBackupMessage("storageError", {}, true);
      }

      this.renderAll();
    }

    setLanguage(language) {
      const persisted = this.store.setPreferences({
        language: normalizeLanguage(language),
      });

      if (!persisted) {
        this.view?.setBackupMessage("storageError", {}, true);
        this.renderAll();
        return;
      }

      this.preferences = this.store.getPreferences();
      this.translator.setPreference(this.preferences.language);
      this.view?.applyLanguage();
      this.renderAll();
      this.view?.refreshRecordManager();
    }

    setSpeedStep(step) {
      const persisted = this.store.setPreferences({
        speedStep: normalizeSpeedStep(step),
      });

      if (!persisted) {
        this.view?.setBackupMessage("storageError", {}, true);
        this.renderAll();
        return;
      }

      this.preferences = this.store.getPreferences();
      this.renderAll();
    }

    toggleShortsAsWatch() {
      const persisted = this.store.setPreferences({
        shortsAsWatch: !this.preferences.shortsAsWatch,
      });

      if (!persisted) {
        this.view?.setBackupMessage("storageError", {}, true);
        this.renderAll();
        return;
      }

      this.preferences = this.store.getPreferences();
      this.renderAll();
      this.redirectShortsIfNeeded();
    }

    toggleAutoConfirm() {
      const persisted = this.store.setPreferences({
        autoConfirm: !this.preferences.autoConfirm,
      });

      if (!persisted) {
        this.view?.setBackupMessage("storageError", {}, true);
        this.renderAll();
        return;
      }

      this.preferences = this.store.getPreferences();
      this.autoConfirmController.setEnabled(this.preferences.autoConfirm);
      this.renderAll();
    }

    executeShortcut(action) {
      switch (action) {
        case "speedDown":
          this.speedController.adjust(-1, this.preferences.speedStep);
          break;

        case "speedUp":
          this.speedController.adjust(1, this.preferences.speedStep);
          break;

        case "speedReset":
          this.speedController.setRate(1);
          break;

        case "toggleLoop":
          this.loopController.toggle();
          break;

        case "setStart":
          this.setPointFromCurrentTime("start");
          break;

        case "jumpStart":
          this.loopController.jumpToStart();
          break;

        case "setEnd":
          this.setPointFromCurrentTime("end");
          break;

        case "clearLoop":
          this.view?.clearLoopInputErrors();
          this.loopController.clear();
          break;

        default:
          break;
      }
    }

    listRecords(query) {
      const records = this.store.listRecords();
      const needle = String(query ?? "")
        .trim()
        .toLocaleLowerCase();

      if (!needle) {
        return {
          items: records,
          total: records.length,
        };
      }

      return {
        items: records.filter((record) => {
          const title = record.title?.toLocaleLowerCase() ?? "";

          return (
            record.videoId.toLocaleLowerCase().includes(needle) ||
            title.includes(needle) ||
            record.source.toLocaleLowerCase().includes(needle)
          );
        }),
        total: records.length,
      };
    }

    saveManagedRecord(videoId, startText, endText, enabled) {
      const normalizedId = normalizeVideoId(videoId);

      if (!normalizedId) {
        return {
          ok: false,
          messageKey: "storageError",
        };
      }

      const parsedStart = TimeCodec.parse(startText);
      const parsedEnd = TimeCodec.parse(endText);

      if (!parsedStart.valid) {
        return {
          ok: false,
          messageKey: "invalidTime",
          field: "start",
        };
      }

      if (!parsedEnd.valid) {
        return {
          ok: false,
          messageKey: "invalidTime",
          field: "end",
        };
      }

      const start = parsedStart.value;
      const end = parsedEnd.value;
      const empty = start === null && end === null;
      const validRange =
        Number.isFinite(start) && Number.isFinite(end) && end > start;

      if (
        !empty &&
        ((start !== null && end !== null && !validRange) ||
          (enabled && !validRange))
      ) {
        return {
          ok: false,
          messageKey: "invalidRange",
        };
      }

      const existing = this.store.getRecord(normalizedId);
      const isCurrent = normalizedId === this.route?.videoId;

      const persisted = empty
        ? this.store.deleteRecord(normalizedId)
        : this.store.setRecord(normalizedId, {
            start,
            end,
            enabled: Boolean(enabled),
            title:
              existing?.title || (isCurrent ? getVideoTitle(this.video) : ""),
            source: existing?.source ?? (isCurrent ? this.route.type : "watch"),
            updatedAt: new Date().toISOString(),
          });

      if (!persisted) {
        return {
          ok: false,
          messageKey: "storageError",
        };
      }

      if (isCurrent) {
        this.persistenceFailed = false;
        this.loopController.loadRecord(this.store.getRecord(normalizedId));
        this.view?.clearLoopInputErrors();
      }

      this.renderAll();

      return {
        ok: true,
        deleted: empty,
      };
    }

    deleteManagedRecord(videoId) {
      const normalizedId = normalizeVideoId(videoId);

      if (!normalizedId || !this.store.deleteRecord(normalizedId)) {
        return {
          ok: false,
          messageKey: "storageError",
        };
      }

      if (normalizedId === this.route?.videoId) {
        this.persistenceFailed = false;
        this.loopController.loadRecord(null);
        this.view?.clearLoopInputErrors();
      }

      this.renderAll();

      return {
        ok: true,
      };
    }

    deleteAllManagedRecords() {
      if (!this.store.clearRecords()) {
        return {
          ok: false,
          messageKey: "storageError",
        };
      }

      this.persistenceFailed = false;
      this.loopController.loadRecord(null);
      this.view?.clearLoopInputErrors();
      this.renderAll();

      return {
        ok: true,
      };
    }

    openRecord(videoId) {
      const record = this.store.getRecord(videoId);

      if (!record) {
        return;
      }

      const target = createRecordUrl(
        {
          videoId,
          ...record,
        },
        this.preferences.shortsAsWatch,
      );

      const opened = window.open(target.href, "_blank", "noopener,noreferrer");

      if (opened) {
        opened.opener = null;
      }
    }

    exportBackup() {
      try {
        const count = this.backupService.exportToFile();

        this.view?.setBackupMessage("backupExported", { count }, false);
      } catch {
        this.view?.setBackupMessage("exportError", {}, true);
      }
    }

    async importBackup(file, mode) {
      if (!file) {
        return;
      }

      if (
        mode === "replace" &&
        !window.confirm(this.translator.t("confirmReplaceImport"))
      ) {
        return;
      }

      try {
        const result = await this.backupService.importFromFile(file, mode);

        if (!result.persisted) {
          this.view?.setBackupMessage("storageError", {}, true);
          return;
        }

        this.preferences = this.store.getPreferences();

        this.translator.setPreference(this.preferences.language);

        this.shortcutManager.setBindings(this.store.getShortcuts());

        this.autoConfirmController.setEnabled(this.preferences.autoConfirm);

        this.persistenceFailed = false;
        this.loopController.loadRecord(
          this.store.getRecord(this.route?.videoId),
        );

        this.view?.clearLoopInputErrors();
        this.view?.applyLanguage();
        this.renderAll();
        this.view?.refreshRecordManager();

        this.view?.setBackupMessage(
          "backupImported",
          {
            count: result.count,
          },
          false,
        );

        this.redirectShortsIfNeeded();
      } catch (error) {
        const messageKey =
          error instanceof BackupError ? error.messageKey : "importReadError";

        this.view?.setBackupMessage(messageKey, {}, true);
      }
    }

    deleteCurrentRecord() {
      if (!this.route) {
        return;
      }

      const result = this.deleteManagedRecord(this.route.videoId);

      this.view?.setBackupMessage(
        result.ok ? "currentDeleted" : result.messageKey,
        {},
        !result.ok,
      );

      this.view?.refreshRecordManager();
    }

    renderLoop(state = this.loopController.getState()) {
      if (!this.view) {
        return;
      }

      this.view.renderLoop(state, {
        saved: Boolean(this.store.getRecord(this.route?.videoId)),
        failed: this.persistenceFailed,
      });
    }

    renderAll() {
      if (!this.view) {
        return;
      }

      this.preferences = this.store.getPreferences();

      this.view.renderSpeed(this.speedController.getState());

      this.renderLoop();

      this.view.renderPreferences(this.preferences);

      this.view.renderShortcuts(this.shortcutManager.getBindings(), (binding) =>
        this.shortcutManager.format(binding),
      );

      this.view.renderStorage(
        this.store.countRecords(),
        Boolean(this.store.getRecord(this.route?.videoId)),
      );
    }

    disposePanel() {
      this.panelAbortController?.abort();
      this.panelAbortController = null;
      this.view?.remove();
      this.view = null;
    }

    destroy() {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;

      if (this.reconcileTimer !== null) {
        clearTimeout(this.reconcileTimer);
      }

      this.reconcileTimer = null;
      this.reconcileDueAt = Number.POSITIVE_INFINITY;
      this.domObserver?.disconnect();
      this.domObserver = null;
      this.panelAbortController?.abort();
      this.panelAbortController = null;
      this.appAbortController.abort();

      this.speedController.destroy();
      this.loopController.destroy();
      this.autoConfirmController.destroy();
      this.view?.remove();

      this.view = null;
      this.video = null;
      this.route = null;
      this.routeSignature = "";
      this.pendingUnknownVideo = null;

      document.getElementById(STYLE_ID)?.remove();

      for (const key of [APP_KEY, ...LEGACY_APP_KEYS]) {
        if (window[key] === this) {
          delete window[key];
        }
      }
    }
  }

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
})();
