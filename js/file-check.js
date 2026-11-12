/*
 * file-check.js
 * A plain (non-module) script, so it still runs when index.html is opened
 * straight from a folder. Browsers refuse to load JavaScript modules from
 * file:// pages, so the game can't start there: say so, and point to the
 * live site or a local server instead of showing a page that does nothing.
 */
if (window.location.protocol === "file:") {
  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.remove("is-booting");
    const banner = document.createElement("p");
    banner.className = "file-warning";
    banner.setAttribute("role", "alert");
    const link = document.createElement("a");
    link.href = "https://nimarco.github.io/warped/";
    link.textContent = "nimarco.github.io/warped";
    const command = document.createElement("code");
    command.textContent = "python3 -m http.server 8000";
    banner.append(
      "This page was opened as a file, and browsers block the game's scripts there. Play it at ",
      link,
      ", or run ",
      command,
      " in this folder and open http://localhost:8000."
    );
    document.body.prepend(banner);
  });
}
