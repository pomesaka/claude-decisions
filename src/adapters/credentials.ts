import type { CredentialStore, TokenAuthenticator } from "../ports/model";
export class EnvCredentialStore implements CredentialStore {
  constructor(private values: Readonly<Record<string, string | undefined>>) {}
  async get(name: string) {
    return this.values[name] ?? null;
  }
}
export class EnvTokenAuthenticator implements TokenAuthenticator {
  constructor(private store: CredentialStore) {}
  async authenticate(token: string) {
    const expected = await this.store.get("DECISIONS_API_TOKEN");
    if (!expected || !token) return false;
    // Fixed-length digests avoid revealing the position of a token mismatch.
    const digest = (value: string) =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    const [a, b] = await Promise.all([digest(expected), digest(token)]);
    const left = new Uint8Array(a),
      right = new Uint8Array(b);
    let difference = 0;
    for (let i = 0; i < left.length; i++)
      difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
    return difference === 0;
  }
}
