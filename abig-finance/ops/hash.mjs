// Same scrypt format as src/lib/crypto.ts, for scripts that run outside the app.
import { randomBytes, scrypt } from "node:crypto";
export const hashPassword = (pw) => new Promise((res, rej) => {
  const salt = randomBytes(16), N = 32768, r = 8, p = 1;
  scrypt(pw, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(`scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${k.toString("base64")}`)));
});
