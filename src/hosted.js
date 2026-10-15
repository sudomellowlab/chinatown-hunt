import { Pack } from "./pack.js";

/* ════════════════════════════════════════════════════════════════════
   LIVE CONTENT — the hosted participant file only (dist/chinatown-hunt-hosted.html).
   The game is edited and published on the Game Editors site; this file is
   uploaded once and fetches whatever was published last on every load, so a
   change needs no new upload. If the relay can't be reached it plays the last
   version this phone saw, then the copy built into the file when it was
   downloaded. The editors site fills the three slots below at download.

   What arrives is exactly what Export puts in a file: the sealed game pack
   and the field tools, encrypted with their password (or null).
   ════════════════════════════════════════════════════════════════════ */
const HOSTED = {
  relay: "__HOSTED_RELAY__",                 // the sync relay, e.g. https://loquiz-sync.example.workers.dev
  game: "chinatown-hunt",                    // this game's key on the editors site
  cacheKey: "chinatown-hunt:published",
  baked: { gamePack: "__HOSTED_GAME_PACK__", fieldPack: "__HOSTED_FIELD_PACK__" },
};
const hostedRelay = () => /^https?:\/\//.test(HOSTED.relay) ? HOSTED.relay.replace(/\/+$/, "") : "";
const isPack = p => typeof p === "string" && p.startsWith(Pack.PREFIX + ".");

async function loadLive(){
  let live = isPack(HOSTED.baked.gamePack) ? HOSTED.baked : null;
  try {
    const cached = JSON.parse(localStorage.getItem(HOSTED.cacheKey) || "null");
    if (isPack(cached?.gamePack)) live = cached;
  } catch(e){}
  const relay = hostedRelay();
  if (relay) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);    // a slow network must never hold up the game
      const res = await fetch(`${relay}/api/content?game=${HOSTED.game}`, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (res.ok) {
        const pub = await res.json();
        if (isPack(pub?.content?.gamePack)) {
          live = { gamePack: pub.content.gamePack, fieldPack: pub.content.fieldPack ?? null, version: pub.version };
          try { localStorage.setItem(HOSTED.cacheKey, JSON.stringify(live)); } catch(e){}
        }
      }
    } catch(e){ /* offline: keep the saved or built-in copy */ }
  }
  if (!live) throw new Error("no game to play");
  return live;
}

let LIVE;
try { LIVE = await loadLive(); }
catch(e){
  document.body.insertAdjacentHTML("beforeend", '<p style="position:fixed;inset:0;z-index:9999;margin:0;padding:24px;display:flex;align-items:center;justify-content:center;text-align:center;background:#DCE0D8;font:17px Georgia,serif">The game couldn’t load. Check your connection and reload the page.</p>');
  throw e;
}
const GAME = Pack.open(LIVE.gamePack);

export { HOSTED, hostedRelay, LIVE, GAME };
