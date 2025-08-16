# YouTube-Speed-and-Loop

Enhances YouTube with playback speeds beyond 2x and repeat functionality.

## Features

- **Playback Speed Control**: Adjust playback speed from 0.25x to 5x using a slider or preset buttons.
- **Loop Playback**: Toggle loop playback on/off for the entire video.
- **Loop Range**: Set specific start and end times to loop a section of the video.

## Installation

1. Install a userscript manager like [Tampermonkey](https://www.tampermonkey.net/) and enable developer mode (see [this guide](https://www.tampermonkey.net/faq.php#Q209)).
2. Go to [Greasy Fork](https://greasyfork.org/zh-TW/scripts/529190-youtube-speed-and-loop) to install the script.

## Usage

- **Playback Speed**:
  - Use the slider to adjust the speed dynamically.
  - Click preset buttons (1x, 1.5x, 2x, 3x, 4x, 5x) for quick selection.
- **Loop Playback**:
  - Click the "Loop Playback" button to toggle looping on/off.
- **Loop Range**:
  - Click "Set Start" to mark the loop start time.
  - Click "Set End" to mark the loop end time.
  - Click "Clear" to reset the loop range.

## Screenshots

### Collapsed Control Panel  
The control panel in its minimized state.  
![Control Panel Collapsed](https://raw.githubusercontent.com/Hank8933/YouTube-Speed-and-Loop/main/images/control-panel-collapsed.png)

### Expanded Control Panel  
The full panel with all options visible.  
![Control Panel Expanded](https://raw.githubusercontent.com/Hank8933/YouTube-Speed-and-Loop/main/images/control-panel-expanded.png)

## 📦 Changelog

- **v1.1.0** (Current)

    - ✨ Feature: Added an auto-clicker for the "Continue Watching?" dialog and precise manual inputs for loop timing.

    - 🎨 UI Overhaul: Complete redesign of the control panel for a modern look, relocated to the top-right for better UI integration.
    
    - 🔧 Stability: Refactored initialization logic for significantly improved reliability and speed during page navigation.

- **v1.0.1**

    - 🛠️ Fix: Prevent multiple control panels from appearing.

    - 🔄 Fix: Keep custom loop toggle in sync with the native video loop state.

- **v1.0**

    - 🎉 Initial Release: Basic playback speed and loop functionality.

## License

[MIT License](https://github.com/Hank8933/YouTube-Speed-and-Loop/blob/main/LICENSE)
