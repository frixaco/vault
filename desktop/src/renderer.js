const versions = window.versions;

document.querySelector("#runtime").textContent =
  `Electron ${versions.electron()} | Chromium ${versions.chrome()} | Node ${versions.node()}`;
