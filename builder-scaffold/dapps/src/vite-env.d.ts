/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILDER_PACKAGE_ID?: string;
  readonly VITE_EXTENSION_CONFIG_ID?: string;
  readonly VITE_BOUNTY_ID?: string;
  readonly VITE_BOUNTY_COIN_TYPE?: string;
  readonly VITE_ATTESTOR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
