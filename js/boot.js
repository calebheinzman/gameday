// Startup guard (classic script, runs before the app module). If the app
// fails to start — e.g. a stale cached file after a deploy — replace the
// endless "Loading…" with a message and a reload button.
(function () {
  function showStartupError() {
    var view = document.querySelector("[data-view='loading']");
    if (!view || view.hidden || window.gamedayStarted) return;
    var message = view.querySelector("[data-loading-message]");
    var button = view.querySelector("[data-loading-retry]");
    message.textContent = "Game Day couldn't start. Reload to get the latest version.";
    button.textContent = "Reload";
    button.hidden = false;
    button.addEventListener("click", function () {
      location.reload();
    });
  }
  window.addEventListener("error", showStartupError);
  window.addEventListener("unhandledrejection", showStartupError);
})();
