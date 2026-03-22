export const BOUNTY_CONFIG_KEYS = {
    builderPackageId: "BUILDER_PACKAGE_ID",
    extensionConfigId: "EXTENSION_CONFIG_ID",
    bountyId: "BOUNTY_ID",
    bountyCoinType: "BOUNTY_COIN_TYPE",
} as const;

export type BountyModuleIds = {
    builderPackageId: string;
    extensionConfigId: string;
};

export type BountyObjectConfig = {
    bountyCoinType: string;
    bountyId?: string;
};

export type BountySharedConfig = BountyModuleIds & {
    bountyCoinType: string;
    bountyId?: string;
};

type EnvReader = (key: string) => string | undefined;

type ParseOptions = {
    requireBountyId?: boolean;
};

// 统一读取环境变量：优先标准键，兼容 VITE_ 前缀，避免脚本与 dapp 各自维护键名。
function readEnvWithCompat(reader: EnvReader, key: string): string {
    const direct = reader(key)?.trim();
    if (direct) return direct;

    const viteKey = `VITE_${key}`;
    const viteValue = reader(viteKey)?.trim();
    if (viteValue) return viteValue;

    throw new Error(`Missing required config key ${key} (or ${viteKey})`);
}

// 校验对象 ID/地址格式，报错时给出字段名，方便快速定位配置问题。
function parseObjectId(label: string, value: string): string {
    if (!value.startsWith("0x") || value.length < 3) {
        throw new Error(`${label} must be a valid Sui object ID/address`);
    }
    return value;
}

// 校验 Move 类型标签格式，用于统一约束 BOUNTY_COIN_TYPE。
function parseMoveType(label: string, value: string): string {
    if (!value.startsWith("0x") || !value.includes("::")) {
        throw new Error(`${label} must be a valid Move type, e.g. 0x2::sui::SUI`);
    }
    return value;
}

export function readBountyModuleIds(reader: EnvReader): BountyModuleIds {
    return {
        builderPackageId: parseObjectId(
            BOUNTY_CONFIG_KEYS.builderPackageId,
            readEnvWithCompat(reader, BOUNTY_CONFIG_KEYS.builderPackageId)
        ),
        extensionConfigId: parseObjectId(
            BOUNTY_CONFIG_KEYS.extensionConfigId,
            readEnvWithCompat(reader, BOUNTY_CONFIG_KEYS.extensionConfigId)
        ),
    };
}

export function readBountyObjectConfig(reader: EnvReader, options: ParseOptions = {}): BountyObjectConfig {
    const bountyCoinType = parseMoveType(
        BOUNTY_CONFIG_KEYS.bountyCoinType,
        readEnvWithCompat(reader, BOUNTY_CONFIG_KEYS.bountyCoinType)
    );

    const idKey = BOUNTY_CONFIG_KEYS.bountyId;
    const rawId = reader(idKey)?.trim() || reader(`VITE_${idKey}`)?.trim();
    if (!rawId) {
        if (options.requireBountyId) {
            throw new Error(`Missing required config key ${idKey} (or VITE_${idKey})`);
        }
        return { bountyCoinType };
    }

    return {
        bountyCoinType,
        bountyId: parseObjectId(idKey, rawId),
    };
}

export function readBountySharedConfig(
    reader: EnvReader,
    options: ParseOptions = {}
): BountySharedConfig {
    return {
        ...readBountyModuleIds(reader),
        ...readBountyObjectConfig(reader, options),
    };
}
