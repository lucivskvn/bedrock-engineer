# Secret management

Bedrock Engineer stores application settings in an encrypted [electron-store](https://github.com/sindresorhus/electron-store) database. The encryption key is stored in the operating system keychain via [`keytar`](https://github.com/atom/node-keytar).

## How it works

1. On first launch the app looks for a store encryption key in the keychain.
2. If none is found, a new random key is generated and saved with the service name `bedrock-engineer`.
3. Any existing plaintext configuration is migrated and written back using the new key.
4. Subsequent runs load the key from the keychain and transparently decrypt the store.

The process is automatic and no action is required from users. Removing the keytar entry resets the store and forces a new key to be generated on the next run.
