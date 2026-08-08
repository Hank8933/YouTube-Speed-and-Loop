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
