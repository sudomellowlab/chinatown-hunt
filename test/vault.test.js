import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault } from "../src/vault.js";

const FAST = 1000;   // fewer PBKDF2 rounds keep the tests quick; the format records the count

test("sealed text opens with the right password", async () => {
  const sealed = await Vault.seal("tools(app); // ✓ unicode", "lantern-42", FAST);
  assert.equal(await Vault.open(sealed, "lantern-42"), "tools(app); // ✓ unicode");
});

test("the wrong password is refused", async () => {
  const sealed = await Vault.seal("secret", "lantern-42", FAST);
  for (const guess of ["", "lantern-43", "Lantern-42", "lantern-42 "])
    await assert.rejects(Vault.open(sealed, guess), /wrong password/);
});

test("neither the text nor the password appears in the sealed form", async () => {
  const sealed = await Vault.seal("Pretend to be at", "lantern-42", FAST);
  assert.ok(sealed.startsWith("ctv1.1000."));
  for (const secret of ["Pretend", "lantern"]) assert.ok(!sealed.includes(secret));
  assert.ok(!Buffer.from(sealed.split(".")[4], "base64").toString("latin1").includes("Pretend"));
});

test("each seal is different, even with the same text and password", async () => {
  const a = await Vault.seal("same", "pw", FAST), b = await Vault.seal("same", "pw", FAST);
  assert.notEqual(a, b);
});

test("a damaged or foreign string is refused", async () => {
  const sealed = await Vault.seal("secret", "pw", FAST);
  const parts = sealed.split(".");
  const flipped = Buffer.from(parts[4], "base64"); flipped[0] ^= 1;
  await assert.rejects(Vault.open([...parts.slice(0, 4), flipped.toString("base64")].join("."), "pw"), /wrong password/);
  for (const bad of ["", "cth1.a.b", "ctv1.x.a.b.c", "ctv1.1000.!!.a.b", null])
    await assert.rejects(Vault.open(bad, "pw"), /not a locked bundle/);
});

test("sealing without a password is refused", async () => {
  await assert.rejects(Vault.seal("secret", ""), /no password/);
});

test("the default strength is used unless told otherwise", async () => {
  assert.ok(Vault.ITERATIONS >= 200000);
  const sealed = await Vault.seal("x", "pw");
  assert.equal(sealed.split(".")[1], String(Vault.ITERATIONS));
});
