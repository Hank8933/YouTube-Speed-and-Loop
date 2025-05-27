// ==UserScript==
// @name               YouTube Speed and Loop
// @name:zh-TW         YouTube 播放速度與循環
// @namespace          https://github.com/Hank8933
// @version            1.0
// @description        Enhances YouTube with playback speeds beyond 2x and repeat functionality
// @description:zh-TW  為 YouTube 提供超過 2 倍的播放速度控制和重複播放功能
// @author             Hank8933
// @homepage           https://github.com/Hank8933/YouTube-Speed-and-Loop
// @match              https://www.youtube.com/*
// @grant              none
// @license            MIT
// ==/UserScript==

(function() {
    'use strict';

    // Define CSS with variables
    const panelCSS = `
        :root {
            --primary-bg: #212121;
            --hover-bg: #333;
            --active-bg: #f00;
            --panel-bg: rgba(33, 33, 33, 0.9);
            --text-color: #fff;
            --shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        }
        .yt-custom-control-panel {
            position: relative;
            top: 0;
            left: 0;
            z-index: 99999;
            font-family: Roboto, Arial, sans-serif;
            align-self: center;
        }
        .yt-custom-control-toggle {
            background-color: var(--primary-bg);
            color: var(--text-color);
            padding: 8px 16px;
            border-radius: 20px;
            border: none;
            font-weight: bold;
            cursor: pointer;
            transition: background-color 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .yt-custom-control-toggle:hover {
            background-color: var(--hover-bg);
        }
        .yt-custom-control-content {
            position: absolute;
            top: calc(100% + 5px);
            left: 50%;
            transform: translateX(-50%);
            background-color: var(--panel-bg);
            color: var(--text-color);
            padding: 10px;
            border-radius: 8px;
            box-shadow: var(--shadow);
            display: none;
            flex-direction: column;
            gap: 5px;
            min-width: 300px;
            white-space: nowrap;
        }
        .yt-custom-control-panel.expanded .yt-custom-control-content {
            display: flex;
        }
        .yt-custom-control-title {
            font-weight: bold;
            margin-bottom: 5px;
        }
        .yt-custom-control-section {
            margin-bottom: 5px;
        }
        .yt-custom-btn {
            background-color: #444;
            border: none;
            color: var(--text-color);
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            white-space: nowrap;
            text-align: center;
            flex: 1;
            margin-right: 5px;
        }
        .yt-custom-btn:last-child {
            margin-right: 0;
        }
        .yt-custom-btn:hover {
            background-color: #555;
        }
        .yt-custom-btn.active {
            background-color: var(--active-bg);
        }
        .yt-speed-controls {
            display: flex;
            flex-direction: column;
            gap: 5px;
            white-space: nowrap;
        }
        .yt-slider-row {
            display: flex;
            align-items: center;
            width: 100%;
        }
        .yt-custom-slider {
            flex-grow: 1;
            min-width: 100px;
        }
        .yt-preset-speeds {
            display: flex;
            gap: 5px;
            width: 100%;
        }
        .yt-custom-slider-value {
            min-width: 40px;
            text-align: right;
        }
        #end {
            display: flex;
            align-items: center;
        }
        #buttons {
            margin-left: 10px;
        }
    `;

    // Add CSS to document head
    const styleEl = document.createElement('style');
    styleEl.textContent = panelCSS;
    document.head.appendChild(styleEl);

    // Utility function to create DOM elements
    function createElement(tag, className, textContent) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (textContent) el.textContent = textContent;
        return el;
    }

    // Store disconnect functions for cleanup
    let playbackRateDisconnect = () => {};
    let loopDisconnect = () => {};

    // Clean up existing panels and observers
    function cleanUpPanels() {
        // Disconnect observers to stop intervals
        playbackRateDisconnect();
        loopDisconnect();
        // Reset disconnect functions
        playbackRateDisconnect = () => {};
        loopDisconnect = () => {};
        // Remove existing panels
        const existingPanels = document.querySelectorAll('.yt-custom-control-panel');
        existingPanels.forEach(panel => panel.remove());
    }

    // Create control panel DOM structure
    function createControlPanel() {
        const panel = createElement('div', 'yt-custom-control-panel');
        const toggleBtn = createElement('button', 'yt-custom-control-toggle', '≡');
        toggleBtn.id = 'yt-toggle-panel';
        const contentDiv = createElement('div', 'yt-custom-control-content');

        const titleDiv = createElement('div', 'yt-custom-control-title');
        titleDiv.appendChild(createElement('span', '', 'YouTube Enhanced Controls'));

        const speedSection = createElement('div', 'yt-custom-control-section');
        const speedText = createElement('div', '');
        speedText.textContent = 'Playback Speed: ';
        const speedValue = createElement('span', '', '1.0');
        speedValue.id = 'yt-speed-value';
        speedText.appendChild(speedValue);
        speedText.append('x');
        const speedControls = createElement('div', 'yt-speed-controls');
        const sliderRow = createElement('div', 'yt-slider-row');
        const speedSlider = createElement('input', 'yt-custom-slider');
        speedSlider.type = 'range';
        speedSlider.id = 'yt-speed-slider';
        speedSlider.min = '0.25';
        speedSlider.max = '5';
        speedSlider.step = '0.25';
        speedSlider.value = '1';
        sliderRow.appendChild(speedSlider);
        speedControls.appendChild(sliderRow);
        const presetSpeeds = createElement('div', 'yt-preset-speeds');
        [1, 1.5, 2, 3, 4, 5].forEach(speed => {
            const btn = createElement('button', 'yt-custom-btn yt-speed-preset', `${speed}x`);
            btn.dataset.speed = speed;
            presetSpeeds.appendChild(btn);
        });
        speedControls.appendChild(presetSpeeds);
        speedSection.appendChild(speedText);
        speedSection.appendChild(speedControls);

        const loopSection = createElement('div', 'yt-custom-control-section');
        loopSection.appendChild(createElement('div', '', 'Loop Playback'));
        const loopToggle = createElement('button', 'yt-custom-btn', 'Off');
        loopToggle.id = 'yt-loop-toggle';
        loopSection.appendChild(loopToggle);

        const loopRangeSection = createElement('div', 'yt-custom-control-section');
        loopRangeSection.appendChild(createElement('div', '', 'Loop Range'));
        const rangeButtons = createElement('div', '');
        const loopStartBtn = createElement('button', 'yt-custom-btn', 'Set Start');
        loopStartBtn.id = 'yt-loop-start-btn';
        const loopEndBtn = createElement('button', 'yt-custom-btn', 'Set End');
        loopEndBtn.id = 'yt-loop-end-btn';
        const loopClearBtn = createElement('button', 'yt-custom-btn', 'Clear');
        loopClearBtn.id = 'yt-loop-clear-btn';
        rangeButtons.append(loopStartBtn, loopEndBtn, loopClearBtn);
        const loopInfo = createElement('div', '', 'No loop range set');
        loopInfo.id = 'yt-loop-info';
        loopRangeSection.append(rangeButtons, loopInfo);

        contentDiv.append(titleDiv, speedSection, loopSection, loopRangeSection);
        panel.append(toggleBtn, contentDiv);

        const endDiv = document.querySelector('#end');
        if (endDiv) {
            endDiv.insertBefore(panel, endDiv.querySelector('#buttons'));
        } else {
            document.body.appendChild(panel);
        }
        return panel;
    }

    // Wait for video element
    function waitForVideo() {
        return new Promise(resolve => {
            const checkVideo = () => {
                const video = document.querySelector('video');
                if (video) resolve(video);
                else setTimeout(checkVideo, 200);
            };
            checkVideo();
        });
    }

    // Observe native playback rate changes
    function observePlaybackRate(video) {
        let lastRate = video.playbackRate;
        const interval = setInterval(() => {
            const newRate = video.playbackRate;
            if (newRate !== lastRate) {
                SpeedController.updatePlaybackRate(newRate);
                lastRate = newRate;
            }
        }, 500);
        return { disconnect: () => clearInterval(interval) };
    }

    // Observe native loop changes
    function observeNativeLoop(video, toggle, updateLoopState) {
        let lastLoopState = video.loop;
        const interval = setInterval(() => {
            const currentLoopState = video.loop;
            if (currentLoopState !== lastLoopState) {
                updateLoopState(currentLoopState, toggle);
                lastLoopState = currentLoopState;
            }
        }, 500);
        return { disconnect: () => clearInterval(interval) };
    }

    // Speed Controller Module
    const SpeedController = {
        updatePlaybackRate(rate) {
            const video = document.querySelector('video');
            if (!video) return;
            const speedValue = document.getElementById('yt-speed-value');
            const speedSlider = document.getElementById('yt-speed-slider');
            const speedPresets = document.querySelectorAll('.yt-speed-preset');
            if (speedValue) speedValue.textContent = rate.toFixed(2);
            if (speedSlider) speedSlider.value = rate;
            speedPresets.forEach(btn => {
                btn.classList.toggle('active', parseFloat(btn.dataset.speed) === rate);
            });
        },
        init(video, slider, presetSpeeds) {
            slider.addEventListener('input', () => {
                const rate = parseFloat(slider.value);
                video.playbackRate = rate;
                this.updatePlaybackRate(rate);
            });
            presetSpeeds.addEventListener('click', (e) => {
                const btn = e.target.closest('.yt-speed-preset');
                if (btn) {
                    const rate = parseFloat(btn.dataset.speed);
                    video.playbackRate = rate;
                    this.updatePlaybackRate(rate);
                }
            });
        }
    };

    // Loop Controller Module
    const LoopController = {
        init(video, toggle, startBtn, endBtn, clearBtn, info) {
            let isLooping = video.loop;
            let loopStart = null;
            let loopEnd = null;

            toggle.textContent = isLooping ? 'On' : 'Off';
            toggle.classList.toggle('active', isLooping);

            const updateLoopState = (newState, toggleBtn) => {
                isLooping = newState;
                toggleBtn.textContent = isLooping ? 'On' : 'Off';
                toggleBtn.classList.toggle('active', isLooping);
            };

            toggle.addEventListener('click', () => {
                isLooping = !isLooping;
                video.loop = isLooping;
                updateLoopState(isLooping, toggle);
            });

            startBtn.addEventListener('click', () => {
                loopStart = video.currentTime;
                this.updateLoopInfo(loopStart, loopEnd, info);
            });

            endBtn.addEventListener('click', () => {
                loopEnd = video.currentTime;
                this.updateLoopInfo(loopStart, loopEnd, info);
            });

            clearBtn.addEventListener('click', () => {
                loopStart = null;
                loopEnd = null;
                this.updateLoopInfo(loopStart, loopEnd, info);
            });

            video.addEventListener('timeupdate', () => {
                if (isLooping && loopStart !== null && loopEnd !== null && loopStart < loopEnd) {
                    if (video.currentTime >= loopEnd) {
                        video.currentTime = loopStart;
                    }
                }
            });

            const loopObserver = observeNativeLoop(video, toggle, updateLoopState);
            loopDisconnect = loopObserver?.disconnect || (() => {});
        },
        updateLoopInfo(start, end, info) {
            if (start !== null && end !== null) {
                info.textContent = `From ${this.formatTime(start)} to ${this.formatTime(end)}`;
            } else if (start !== null) {
                info.textContent = `Start: ${this.formatTime(start)}, End: Not set`;
            } else if (end !== null) {
                info.textContent = `Start: Not set, End: ${this.formatTime(end)}`;
            } else {
                info.textContent = 'No loop range set';
            }
        },
        formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    };

    // Main initialization
    async function init() {
        const video = await waitForVideo();
        cleanUpPanels();
        const panel = createControlPanel();

        setTimeout(() => {
            const toggleBtn = document.getElementById('yt-toggle-panel');
            const speedSlider = document.getElementById('yt-speed-slider');
            const presetSpeeds = document.querySelector('.yt-preset-speeds');
            const loopToggle = document.getElementById('yt-loop-toggle');
            const loopStartBtn = document.getElementById('yt-loop-start-btn');
            const loopEndBtn = document.getElementById('yt-loop-end-btn');
            const loopClearBtn = document.getElementById('yt-loop-clear-btn');
            const loopInfo = document.getElementById('yt-loop-info');

            toggleBtn.addEventListener('click', () => {
                panel.classList.toggle('expanded');
                toggleBtn.textContent = panel.classList.contains('expanded') ? '_' : '≡';
            });

            SpeedController.init(video, speedSlider, presetSpeeds);
            LoopController.init(video, loopToggle, loopStartBtn, loopEndBtn, loopClearBtn, loopInfo);
            const playbackRateObserver = observePlaybackRate(video);
            playbackRateDisconnect = playbackRateObserver?.disconnect || (() => {});
            SpeedController.updatePlaybackRate(video.playbackRate || 1);
        }, 2000);
    }

    // Ensure DOM is loaded
    document.addEventListener('DOMContentLoaded', () => {
        if (!document.body) return;
        setTimeout(init, 1000);
    });

    // Detect page navigation
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (lastUrl !== location.href) {
            lastUrl = location.href;
            cleanUpPanels();
            setTimeout(init, 1000);
        }
    });
    observer.observe(document, { subtree: true, childList: true });
})();
