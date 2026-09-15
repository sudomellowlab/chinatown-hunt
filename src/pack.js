/* ════════════════════════════════════════════════════════════════════
   GAME PACK
   Pure functions, no DOM, no imports. The participant file carries its
   game content (locations now; challenges, answers and the culprit later)
   as one scrambled string instead of readable JSON, so viewing the page
   source gives nothing away.

   This deters peeking; it is not encryption. The key travels inside the
   string, because without a server there is nowhere else to keep it.
   ════════════════════════════════════════════════════════════════════ */
const Pack = {
  PREFIX: "cth1",

  seal(value, key = Pack.randomKey()){
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return `${Pack.PREFIX}.${Pack.b64(key)}.${Pack.b64(Pack.mix(bytes, key))}`;
  },

  open(sealed){
    const parts = String(sealed).split(".");
    if (parts.length !== 3 || parts[0] !== Pack.PREFIX) throw new Error("not a game pack");
    const key = Pack.unb64(parts[1]);
    if (key.length < 8) throw new Error("not a game pack");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Pack.mix(Pack.unb64(parts[2]), key))); }
    catch (e) { throw new Error("game pack is damaged"); }
  },

  randomKey(){ return crypto.getRandomValues(new Uint8Array(16)); },

  // XOR against a keystream from xorshift32 seeded by the key; the same call undoes it.
  mix(bytes, key){
    let s = 0x9e3779b9;
    for (const k of key) s = Math.imul(s ^ k, 0x01000193) >>> 0;
    if (!s) s = 1;
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      out[i] = bytes[i] ^ (s & 0xff);
    }
    return out;
  },

  b64(bytes){
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  unb64(text){
    let bin;
    try { bin = atob(text); } catch (e) { throw new Error("not a game pack"); }
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  },
};

export { Pack };
