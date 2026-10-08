// Account feature: magic-link sign-in, linking a Sleeper username, and the
// settings sheet (league on/off switches, change account, sign out). Reports
// back to the app through callbacks; it never touches the game-day view.

import {
  watchSession,
  sendMagicLink,
  verifyEmailCode,
  signOut,
  getProfile,
  saveProfile,
  getLeagues,
  syncLeagues,
  clearLeagues,
  setLeagueEnabled,
} from "../../services/supabase.js";
import { getNflState, resolveUser, getUserLeagues } from "../../services/sleeper.js";
import { h } from "../../utils/dom.js";

export function createAccount(root, { onSignedOut, onNeedsSetup, onLoading, onReady, onLoadFailed }) {
  const els = {
    authForm: root.querySelector("[data-auth-form]"),
    authEmail: root.querySelector("[data-auth-email]"),
    authSubmit: root.querySelector("[data-auth-submit]"),
    authMessage: root.querySelector("[data-auth-message]"),
    codeForm: root.querySelector("[data-code-form]"),
    codeInput: root.querySelector("[data-code-input]"),
    codeSubmit: root.querySelector("[data-code-submit]"),
    codeMessage: root.querySelector("[data-code-message]"),
    setupForm: root.querySelector("[data-setup-form]"),
    setupUsername: root.querySelector("[data-setup-username]"),
    setupSubmit: root.querySelector("[data-setup-submit]"),
    setupCancel: root.querySelector("[data-setup-cancel]"),
    setupMessage: root.querySelector("[data-setup-message]"),
    settings: root.querySelector("[data-settings]"),
    settingsUsername: root.querySelector("[data-settings-username]"),
    settingsLeagues: root.querySelector("[data-settings-leagues]"),
    settingsMessage: root.querySelector("[data-settings-message]"),
    settingsChange: root.querySelector("[data-settings-change]"),
    settingsResync: root.querySelector("[data-settings-resync]"),
    settingsSignOut: root.querySelector("[data-settings-signout]"),
    settingsClose: root.querySelector("[data-settings-close]"),
  };

  // { userId, email, profile, season, leagues: [{ leagueId, name, enabled }] }
  let state = { userId: undefined }; // undefined until the first session report
  let leaguesChanged = false;

  function readyContext() {
    return {
      sleeperUserId: state.profile.sleeperUserId,
      leagues: state.leagues.filter((l) => l.enabled).map(({ leagueId, name }) => ({ leagueId, name })),
    };
  }

  // Pull the season's leagues from Sleeper into the saved list. Best effort:
  // if Sleeper is down, the previously saved list is used as-is.
  async function refreshLeagues({ strict = false } = {}) {
    const nfl = await getNflState();
    state.season = nfl.season;
    try {
      const fromSleeper = await getUserLeagues(state.profile.sleeperUserId, state.season);
      await syncLeagues(state.userId, state.season, fromSleeper);
    } catch (err) {
      if (strict) throw err;
    }
    state.leagues = await getLeagues(state.userId, state.season);
  }

  async function enter() {
    onLoading();
    try {
      state.profile = await getProfile(state.userId);
      if (!state.profile) {
        showSetup({ cancellable: false });
        return;
      }
      await refreshLeagues();
      onReady(readyContext());
    } catch (err) {
      onLoadFailed(err.message || "Couldn't load your account.", enter);
    }
  }

  function handleSession(session) {
    const userId = (session && session.user && session.user.id) || null;
    if (userId === state.userId) return; // token refreshes re-announce the same user
    state = { userId, email: session && session.user ? session.user.email : "" };
    if (!userId) {
      onSignedOut();
      return;
    }
    enter();
  }

  // --- sign in ---

  els.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = els.authEmail.value.trim();
    if (!email) return;
    els.authSubmit.disabled = true;
    els.authMessage.className = "form-message";
    els.authMessage.textContent = "Sending…";
    try {
      await sendMagicLink(email);
      els.authMessage.classList.add("is-success");
      els.authMessage.textContent = `Check ${email} and tap the link to sign in.`;
      els.codeForm.hidden = false;
    } catch (err) {
      els.authMessage.classList.add("is-error");
      els.authMessage.textContent = err.message;
    } finally {
      els.authSubmit.disabled = false;
    }
  });

  els.codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = els.authEmail.value.trim();
    const code = els.codeInput.value.replace(/\s/g, "");
    if (!email || !code) return;
    els.codeSubmit.disabled = true;
    els.codeMessage.className = "form-message";
    els.codeMessage.textContent = "Checking…";
    try {
      await verifyEmailCode(email, code);
      els.codeMessage.textContent = "";
    } catch (err) {
      els.codeMessage.classList.add("is-error");
      els.codeMessage.textContent = err.message;
    } finally {
      els.codeSubmit.disabled = false;
    }
  });

  // --- link Sleeper ---

  function showSetup({ cancellable }) {
    els.setupUsername.value = state.profile ? state.profile.sleeperUsername : "";
    els.setupCancel.hidden = !cancellable;
    els.setupMessage.textContent = "";
    els.setupMessage.className = "form-message";
    onNeedsSetup();
    els.setupUsername.focus();
  }

  els.setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = els.setupUsername.value.trim();
    if (!username) return;
    els.setupSubmit.disabled = true;
    els.setupMessage.className = "form-message";
    els.setupMessage.textContent = "Finding your leagues…";
    try {
      const user = await resolveUser(username);
      if (!user) throw new Error(`No Sleeper user named "${username}".`);
      const switching = state.profile && state.profile.sleeperUserId !== user.userId;
      if (switching) await clearLeagues(state.userId);
      const profile = { sleeperUsername: user.username, sleeperUserId: user.userId };
      await saveProfile(state.userId, profile);
      state.profile = profile;
      await refreshLeagues({ strict: true });
      onReady(readyContext());
    } catch (err) {
      els.setupMessage.classList.add("is-error");
      els.setupMessage.textContent = err.message;
    } finally {
      els.setupSubmit.disabled = false;
    }
  });

  els.setupCancel.addEventListener("click", () => onReady(readyContext()));

  // --- settings ---

  function renderLeagueToggles() {
    if (state.leagues.length === 0) {
      els.settingsLeagues.replaceChildren(h("li", { class: "muted" }, `No ${state.season} leagues on Sleeper.`));
      return;
    }
    els.settingsLeagues.replaceChildren(
      ...state.leagues.map((league) => {
        const input = h("input", { type: "checkbox", class: "switch", checked: league.enabled });
        input.addEventListener("change", async () => {
          input.disabled = true;
          try {
            await setLeagueEnabled(state.userId, league.leagueId, input.checked);
            league.enabled = input.checked;
            leaguesChanged = true;
            els.settingsMessage.textContent = "";
          } catch (err) {
            input.checked = league.enabled;
            els.settingsMessage.textContent = err.message;
          } finally {
            input.disabled = false;
          }
        });
        return h("li", {}, h("label", { class: "toggle-row" }, h("span", {}, league.name), input));
      })
    );
  }

  els.settingsResync.addEventListener("click", async () => {
    els.settingsResync.disabled = true;
    els.settingsMessage.textContent = "Checking Sleeper…";
    try {
      await refreshLeagues({ strict: true });
      leaguesChanged = true;
      renderLeagueToggles();
      els.settingsMessage.textContent = "League list is up to date.";
    } catch (err) {
      els.settingsMessage.textContent = err.message;
    } finally {
      els.settingsResync.disabled = false;
    }
  });

  els.settingsChange.addEventListener("click", () => {
    leaguesChanged = false;
    els.settings.close();
    showSetup({ cancellable: true });
  });

  els.settingsSignOut.addEventListener("click", async () => {
    els.settings.close();
    try {
      await signOut();
    } catch {
      // The local session is cleared even when the network call fails.
    }
  });

  els.settingsClose.addEventListener("click", () => els.settings.close());

  els.settings.addEventListener("close", () => {
    if (leaguesChanged && state.profile) onReady(readyContext());
    leaguesChanged = false;
  });

  return {
    start() {
      watchSession(handleSession);
    },

    openSettings() {
      if (!state.profile) return;
      els.settingsUsername.textContent = state.profile.sleeperUsername;
      els.settingsMessage.textContent = "";
      renderLeagueToggles();
      els.settings.showModal();
    },
  };
}
