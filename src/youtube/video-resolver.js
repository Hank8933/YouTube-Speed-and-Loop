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
