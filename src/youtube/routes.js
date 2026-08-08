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
