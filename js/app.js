// Startup and coordination: decides which view is on screen and hands the
// signed-in user's leagues from the account feature to the game-day feature.

import { createAccount } from "./features/account/index.js";
import { createGameday } from "./features/gameday/index.js";

const views = {
  loading: document.querySelector("[data-view='loading']"),
  auth: document.querySelector("[data-view='auth']"),
  setup: document.querySelector("[data-view='setup']"),
  gameday: document.querySelector("[data-view='gameday']"),
};
const loadingMessage = document.querySelector("[data-loading-message]");
const loadingRetry = document.querySelector("[data-loading-retry]");
const settingsButton = document.querySelector("[data-open-settings]");

let retryLoad = null;

function showView(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

const gameday = createGameday(views.gameday);

const account = createAccount(document.body, {
  onLoading() {
    gameday.stop();
    loadingMessage.textContent = "Loading your leagues…";
    loadingRetry.hidden = true;
    showView("loading");
  },
  onLoadFailed(message, retry) {
    loadingMessage.textContent = message;
    retryLoad = retry;
    loadingRetry.hidden = false;
    showView("loading");
  },
  onSignedOut() {
    gameday.stop();
    showView("auth");
  },
  onNeedsSetup() {
    gameday.stop();
    showView("setup");
  },
  onReady(context) {
    showView("gameday");
    gameday.start(context);
  },
});

loadingRetry.addEventListener("click", () => retryLoad && retryLoad());
settingsButton.addEventListener("click", () => account.openSettings());

showView("loading");
account.start();
