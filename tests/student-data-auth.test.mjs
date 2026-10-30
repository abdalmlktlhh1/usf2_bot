import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

const source = await readFile(
  new URL("../supabase/functions/student-data/index.ts", import.meta.url),
  "utf8",
);

test("Telegram account password stays within bcrypt's 72-byte limit", () => {
  const match = source.match(/function randomPassword\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, "randomPassword generator must exist");

  const factory = new Function("crypto", match[0] + "; return randomPassword;");
  const generate = factory(webcrypto);
  const first = generate();
  const second = generate();

  assert.equal(first.length, 64);
  assert.ok(first.length <= 72);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second, "each account must receive a fresh random password");
});
