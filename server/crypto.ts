import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(): Buffer | null {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey || envKey === "generate-a-random-32-char-hex-string") {
    return null;
  }
  return Buffer.from(envKey, "hex");
}

function deriveKey(key: Buffer, salt: Buffer): Buffer {
  return scryptSync(key, salt, KEY_LENGTH);
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a base64 string containing salt + iv + tag + ciphertext.
 * If no ENCRYPTION_KEY is configured, returns the plaintext as-is.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = deriveKey(key, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: salt (16) + iv (12) + tag (16) + ciphertext
  const result = Buffer.concat([salt, iv, tag, encrypted]);
  return `enc:${result.toString("base64")}`;
}

/**
 * Decrypts an encrypted string produced by encrypt().
 * If the input doesn't have the "enc:" prefix, returns it as-is (plaintext fallback
 * for existing unencrypted data).
 */
export function decrypt(encryptedValue: string): string {
  if (!encryptedValue.startsWith("enc:")) {
    // Legacy plaintext value — return as-is
    return encryptedValue;
  }

  const key = getKey();
  if (!key) {
    // No key configured but data is encrypted — can't decrypt
    throw new Error("ENCRYPTION_KEY is required to decrypt stored passphrases");
  }

  const data = Buffer.from(encryptedValue.slice(4), "base64");
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const derivedKey = deriveKey(key, salt);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
