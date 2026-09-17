import { Engine } from "./engine.js";
import { Play } from "./play.js";
import { Vault } from "./vault.js";
import { GAME } from "./game.js";
import { KEY, store, state, save, feed, hooks, map, onFix, render, renderClock, renderSheet, checkReveal,
  activateLocation, finishActive, locationById, msLeft, startReal, stopReal, h, $ } from "./app.js";

/* ════════════════════════════════════════════════════════════════════
   FIELD TOOLS LOCK — participant file only. If the organiser set a
   password at export, the field tools ride along encrypted. Tapping the
   clock (or a screen's title) five times quickly asks for the password;
   the right one decrypts the tools and opens them. Without a password
   at export there is nothing to unlock and the taps do nothing.
   ════════════════════════════════════════════════════════════════════ */
const FIELD_PACK = "__FIELD_PACK__";
const TAP_TARGETS = "#clock, #startTitle, #sheetname, #revealTitle";
const TAPS = 5, TAP_WINDOW_MS = 3000;

const lock = { taps: [], tools: null, busy: false };
function lockable(){ return typeof FIELD_PACK === "string" && FIELD_PACK.startsWith(Vault.PREFIX + "."); }

document.addEventListener("click", e => {
  if (!lockable() || !e.target.closest?.(TAP_TARGETS)) return;
  const now = Date.now();
  lock.taps = [...lock.taps.filter(t => now - t < TAP_WINDOW_MS), now];
  if (lock.taps.length < TAPS) return;
  lock.taps = [];
  if (lock.tools) lock.tools.open(); else askPassword();
});

const input = h("input", { id: "unlockPass", type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Password" });
const message = h("p", { id: "unlockMsg", class: "small" });
const box = h("form", { id: "unlock", hidden: true },
  h("div", { class: "unlockcard" },
    h("h2", {}, "Organiser password"),
    input, message,
    h("div", { class: "navrow" },
      h("button", { type: "button", id: "unlockCancel", class: "secondary", onclick: () => { box.hidden = true; } }, "Cancel"),
      h("button", { type: "submit", id: "unlockOk", class: "primary" }, "Unlock"))));
document.body.append(box);

function askPassword(){
  input.value = ""; message.textContent = "";
  box.hidden = false;
  input.focus();
}
box.addEventListener("submit", async e => {
  e.preventDefault();
  if (lock.busy || !input.value) return;
  // Web Crypto only exists on https pages (and local files).
  if (!globalThis.crypto?.subtle) { message.textContent = "This page can't unlock the tools. Open the game's https link."; return; }
  lock.busy = true; message.textContent = "Checking…";
  let code;
  try { code = await Vault.open(FIELD_PACK, input.value); }
  catch (err) {
    lock.busy = false;
    message.textContent = err.message === "wrong password" ? "Wrong password." : "The tools in this file are damaged. Export the game again.";
    input.select();
    return;
  }
  const app = { GAME, Engine, Play, KEY, store, state, save, feed, hooks, map, onFix, render, renderClock, renderSheet, checkReveal,
    activateLocation, finishActive, locationById, msLeft, startReal, stopReal, h, $ };
  lock.tools = new Function("app", `${code}\nreturn fieldTools(app);`)(app);
  lock.busy = false;
  box.hidden = true;
  lock.tools.open();
});
