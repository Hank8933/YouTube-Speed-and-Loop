function installStyle() {
  let style = document.getElementById(STYLE_ID);

  if (!style) {
    style = createElement("style", { id: STYLE_ID });
    (document.head ?? document.documentElement).append(style);
  }

  style.textContent = CSS;
}
