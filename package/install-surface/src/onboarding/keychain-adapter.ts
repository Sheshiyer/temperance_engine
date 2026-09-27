import type { KeychainSecretReference } from "./contracts.ts";

export interface KeychainCommandResult { exitCode: number; stdout: string; }
export interface KeychainIO {
  platform: NodeJS.Platform;
  exec(argv: readonly string[]): Promise<KeychainCommandResult>;
}

const systemKeychainIO: KeychainIO = {
  platform: process.platform,
  exec: async (argv) => {
    const child = Bun.spawn([...argv], { stdout: "pipe", stderr: "ignore" });
    const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { exitCode, stdout };
  },
};

export class KeychainAdapterError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "KeychainAdapterError";
  }
}

function referenceArgs(reference: KeychainSecretReference): string[] {
  if (reference.store !== "macos-keychain") throw new KeychainAdapterError("KEYCHAIN_REFERENCE_INVALID");
  for (const value of [reference.service, reference.account]) {
    if (!value || value.length > 512 || value.trim() !== value || value.includes("\0") || /[\r\n]/u.test(value)) {
      throw new KeychainAdapterError("KEYCHAIN_REFERENCE_INVALID");
    }
  }
  return ["-s", reference.service, "-a", reference.account];
}

/** Secret values exist only in process memory and the macOS Keychain command. */
export class MacOsKeychainAdapter {
  constructor(private readonly io: KeychainIO = systemKeychainIO) {}

  private assertPlatform(): void {
    if (this.io.platform !== "darwin") throw new KeychainAdapterError("KEYCHAIN_UNSUPPORTED_PLATFORM");
  }

  async has(reference: KeychainSecretReference): Promise<boolean> {
    this.assertPlatform();
    const result = await this.io.exec(["/usr/bin/security", "find-generic-password", ...referenceArgs(reference)]);
    return result.exitCode === 0;
  }

  async read(reference: KeychainSecretReference): Promise<string> {
    this.assertPlatform();
    const result = await this.io.exec(["/usr/bin/security", "find-generic-password", ...referenceArgs(reference), "-w"]);
    if (result.exitCode !== 0) throw new KeychainAdapterError("KEYCHAIN_ITEM_UNAVAILABLE");
    const secret = result.stdout.replace(/[\r\n]+$/u, "");
    if (!secret) throw new KeychainAdapterError("KEYCHAIN_ITEM_EMPTY");
    return secret;
  }

  async put(reference: KeychainSecretReference, secret: string): Promise<void> {
    this.assertPlatform();
    if (!secret || secret.length > 65_536 || secret.includes("\0") || /[\r\n]/u.test(secret)) {
      throw new KeychainAdapterError("KEYCHAIN_SECRET_INVALID");
    }
    const result = await this.io.exec(["/usr/bin/security", "add-generic-password", "-U", ...referenceArgs(reference), "-w", secret]);
    if (result.exitCode !== 0) throw new KeychainAdapterError("KEYCHAIN_WRITE_FAILED");
  }

  async delete(reference: KeychainSecretReference): Promise<boolean> {
    this.assertPlatform();
    const result = await this.io.exec(["/usr/bin/security", "delete-generic-password", ...referenceArgs(reference)]);
    if (result.exitCode === 44) return false;
    if (result.exitCode !== 0) throw new KeychainAdapterError("KEYCHAIN_DELETE_FAILED");
    return true;
  }
}
