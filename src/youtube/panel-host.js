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
