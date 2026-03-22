import {
    type BountySharedConfig,
    BOUNTY_CONFIG_KEYS,
    readBountySharedConfig,
} from "../../../shared/bounty-config";

type ViteEnvMap = Record<string, string | boolean | undefined>;

function readViteEnv(key: string): string | undefined {
    const value = (import.meta.env as ViteEnvMap)[key];
    return typeof value === "string" ? value : undefined;
}

function hasAnyBountyValue(): boolean {
    return Object.values(BOUNTY_CONFIG_KEYS).some((key) => {
        const direct = readViteEnv(key);
        const vite = readViteEnv(`VITE_${key}`);
        return !!(direct && direct.trim()) || !!(vite && vite.trim());
    });
}

export function getDappBountyConfig(options: { requireBountyId?: boolean } = {}): BountySharedConfig {
    return readBountySharedConfig(readViteEnv, options);
}

export function getDappBountyConfigOrNull(
    options: { requireBountyId?: boolean } = {}
): BountySharedConfig | null {
    if (!hasAnyBountyValue()) {
        return null;
    }
    return getDappBountyConfig(options);
}
