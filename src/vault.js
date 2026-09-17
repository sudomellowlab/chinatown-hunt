/* ════════════════════════════════════════════════════════════════════
   VAULT
   Real encryption with a password, using the browser's own Web Crypto
   (also in Node): PBKDF2-SHA256 turns the password into an AES-GCM key.
   The participant file carries its field tools this way, so without the
   password they can be neither read nor run. The password itself is
   never stored anywhere in the file.
   No DOM, no imports.
   ════════════════════════════════════════════════════════════════════ */
const Vault = {
  PREFIX: "ctv1",
  ITERATIONS: 250000,

  async key(password, salt, iterations){
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  },

  async seal(text, password, iterations = Vault.ITERATIONS){
    if (!password) throw new Error("no password");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await Vault.key(password, salt, iterations), new TextEncoder().encode(text));
    return [Vault.PREFIX, iterations, Vault.b64(salt), Vault.b64(iv), Vault.b64(new Uint8Array(data))].join(".");
  },

  // Throws "wrong password" if the password doesn't match (AES-GCM checks that for us).
  async open(sealed, password){
    const parts = String(sealed).split(".");
    const iterations = Number(parts[1]);
    if (parts.length !== 5 || parts[0] !== Vault.PREFIX || !Number.isInteger(iterations) || iterations < 1) throw new Error("not a locked bundle");
    const [salt, iv, data] = parts.slice(2).map(Vault.unb64);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await Vault.key(password, salt, iterations), data); }
    catch (e) { throw new Error("wrong password"); }
    return new TextDecoder().decode(plain);
  },

  b64(bytes){ let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); },
  unb64(text){
    try { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
    catch (e) { throw new Error("not a locked bundle"); }
  },
};

export { Vault };
