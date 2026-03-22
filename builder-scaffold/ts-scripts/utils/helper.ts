import * as fs from "node:fs";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
    BountyModuleIds,
    BountyObjectConfig,
    createClient,
    keypairFromPrivateKey,
    HydratedWorldConfig,
    WorldConfig,
    getConfig,
    Network,
    DEFAULT_RPC_URLS,
    ExtractedObjectIds,
    getExtractedObjectIdsPath,
    readBountyModuleIds,
    readBountyObjectConfig,
    BOUNTY_CONFIG_KEYS,
} from "./config";
import { TENANT } from "./constants";

export interface EnvConfig {
    network: Network;
    rpcUrl: string;
    packageId: string;
    adminExportedKey: string;
    tenant: string;
}

export interface InitializedContext {
    client: SuiJsonRpcClient;
    keypair: Ed25519Keypair;
    config: WorldConfig;
    address: string;
    network: Network;
}

export const DELAY_MS = Number(process.env.DELAY_SECONDS ?? 2) * 1000; // 2 seconds

export function fromHex(hex: string): Uint8Array {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    const normalized = stripped.length % 2 === 0 ? stripped : "0" + stripped;
    if (!/^[0-9a-fA-F]*$/.test(normalized)) {
        throw new Error(`Invalid hex string: ${hex}`);
    }
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
        bytes[i / 2] = parseInt(normalized.substring(i, i + 2), 16);
    }
    return bytes;
}

export function toHex(bytes: Uint8Array): string {
    return (
        "0x" +
        Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
    );
}

/** @deprecated Use fromHex instead */
export const hexToBytes = fromHex;

/**
 * 从错误消息中提取 Move abort code。
 * 支持常见 Sui RPC / SDK 错误格式：
 *   - "ExecutionError: ... abort_code=6 ..."
 *   - "... ABORT_CODE:6 ..."
 *   - "... aborted with code 6 ..."
 */
function extractAbortCode(errorMessage: string): number | null {
    // 匹配 abort_code=X 或 ABORT_CODE:X 或 aborted with code X（X 为 u64 整数）
    const patterns = [/abort[_]?code[=:]\s*(\d+)/i, /aborted with code (\d+)/i];
    for (const re of patterns) {
        const m = errorMessage.match(re);
        if (m) return Number(m[1]);
    }
    return null;
}

/**
 * 根据 abort code 返回人类可读描述。
 * 仅覆盖 top-5 高频 bounty 守卫错误，其余返回通用回退。
 */
function decodeAbortCode(code: number): string {
    const known: Record<number, string> = {
        4: "EInvalidLifecycleTransition — Bounty lifecycle transition is invalid (e.g. trying to accept/cancel/reclaim on a bounty that is not in Open state)",
        6: "ECancelAfterAccept — Cannot cancel bounty after a hunter has already accepted it",
        9: "EInvalidClaimSignature — Invalid claim attestation signature (check trusted attestor key path and signature)",
        10: "EKillerNotAccepted — Killer is not in the accepted-hunters set (hunter must first accept the bounty)",
        12: "EInvalidKillTimestamp — Kill timestamp must be after bounty creation time",
    };
    return known[code] ?? `Unknown Move abort code ${code}. Check tx effects for details.`;
}

export function handleError(error: unknown): never {
    const enriched = enrichBountyConfigError(error);
    console.error("\n=== Error ===");
    const errorMsg = enriched instanceof Error ? enriched.message : String(enriched);
    console.error("Error:", errorMsg);

    // 尝试解码 Move abort code
    const code = extractAbortCode(errorMsg);
    if (code !== null) {
        console.error("Decoded:", decodeAbortCode(code));
    }

    if (enriched instanceof Error && enriched.stack) {
        console.error("Stack:", enriched.stack);
    }
    process.exit(1);
}

export function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
}

// 读取并校验悬赏模块关键 ID，支持标准键和 VITE_ 前缀键。
export function getBountyModuleIdsFromEnv(): BountyModuleIds {
    return readBountyModuleIds((key) => process.env[key]);
}

// 读取并校验悬赏对象配置（coin type / bounty id），按需强制要求 bounty id。
export function getBountyObjectConfigFromEnv(requireBountyId = false): BountyObjectConfig {
    return readBountyObjectConfig((key) => process.env[key], { requireBountyId });
}

export function requireBountyCoinTypeFromEnv(): string {
    return getBountyObjectConfigFromEnv(false).bountyCoinType;
}

export function requireBountyIdFromEnv(): string {
    return getBountyObjectConfigFromEnv(true).bountyId as string;
}

export function requireAddressEnv(name: string): string {
    const value = requireEnv(name).trim();
    if (!value.startsWith("0x") || value.length < 3) {
        throw new Error(`${name} must be a valid Sui address`);
    }
    return value;
}

export function requirePositiveU64Env(name: string): bigint {
    const raw = requireEnv(name).trim();
    let value: bigint;
    try {
        value = BigInt(raw);
    } catch {
        throw new Error(`${name} must be a valid u64 integer`);
    }
    if (value <= 0n) {
        throw new Error(`${name} must be greater than 0`);
    }
    return value;
}

export function getBountyConfigErrorHint(): string {
    return [
        `Required keys: ${BOUNTY_CONFIG_KEYS.builderPackageId}, ${BOUNTY_CONFIG_KEYS.extensionConfigId}, ${BOUNTY_CONFIG_KEYS.bountyCoinType}`,
        `Optional key: ${BOUNTY_CONFIG_KEYS.bountyId}`,
        "Vite-compatible aliases are also supported via VITE_ prefix.",
    ].join(" ");
}

export function enrichBountyConfigError(error: unknown): unknown {
    if (!(error instanceof Error)) {
        return error;
    }

    const message = error.message;
    const referencesBountyKeys = Object.values(BOUNTY_CONFIG_KEYS).some((key) =>
        message.includes(key)
    );
    const referencesBountyValidation =
        message.includes("must be a valid Move type") ||
        message.includes("must be a valid Sui object ID/address");
    const alreadyHasHint = message.includes("Required keys:");

    if ((referencesBountyKeys || referencesBountyValidation) && !alreadyHasHint) {
        error.message = `${message}. ${getBountyConfigErrorHint()}`;
    }

    return error;
}

export function getEnvConfig(): EnvConfig {
    const rawNetwork = (process.env.SUI_NETWORK || process.env.NETWORK || "localnet").trim();
    const isNetwork = (value: string): value is Network =>
        value === "localnet" || value === "testnet" || value === "devnet" || value === "mainnet";
    if (!isNetwork(rawNetwork)) {
        throw new Error(`Invalid network '${rawNetwork}'. Use localnet|testnet|devnet|mainnet.`);
    }
    const network = rawNetwork;

    const rpcUrl = process.env.SUI_RPC_URL || DEFAULT_RPC_URLS[network];
    if (network !== "localnet" && /(127\.0\.0\.1|localhost)/.test(rpcUrl)) {
        throw new Error(
            `SUI_RPC_URL (${rpcUrl}) looks like a local node but network is ${network}. ` +
                `Unset SUI_RPC_URL or set it to a ${network} fullnode URL.`
        );
    }
    const packageId = getDefaultWorldPackageId(network);
    if (!packageId) {
        throw new Error("WORLD_PACKAGE_ID is required");
    }
    const adminExportedKey = requireEnv("ADMIN_PRIVATE_KEY");

    return {
        network,
        rpcUrl,
        packageId,
        adminExportedKey,
        tenant: TENANT,
    };
}

export function initializeContext(network: Network, privateKey: string): InitializedContext {
    const client = createClient(network);
    const keypair = keypairFromPrivateKey(privateKey);
    const config = getConfig(network) as WorldConfig;
    const fromExtracted = getDefaultWorldPackageId(network);
    if (fromExtracted) config.packageId = fromExtracted;
    const address = keypair.getPublicKey().toSuiAddress();

    return { client, keypair, config, address, network };
}

export function extractEvent<T = unknown>(
    result: { events?: Array<{ type: string; parsedJson?: unknown }> | null | undefined },
    eventTypeSuffix: string
): T | null {
    const events = result.events || [];
    const event = events.find((event) => event.type.endsWith(eventTypeSuffix));
    return (event?.parsedJson as T) || null;
}

export async function hydrateWorldConfig(ctx: InitializedContext): Promise<HydratedWorldConfig> {
    const hasManualIds =
        !!ctx.config.governorCap &&
        !!ctx.config.serverAddressRegistry &&
        !!ctx.config.objectRegistry &&
        !!ctx.config.adminAcl &&
        !!ctx.config.energyConfig &&
        !!ctx.config.fuelConfig &&
        !!ctx.config.gateConfig;

    if (!hasManualIds) {
        const network = ctx.network;
        const extracted = loadExtractedObjectIds(network);
        if (!extracted?.world || extracted.world.packageId !== ctx.config.packageId) {
            const filePath = getExtractedObjectIdsPath(network);
            throw new Error(`Missing or mismatched ${filePath}. Deploy world-contracts first.`);
        }
        const { packageId: _p, ...ids } = extracted.world;
        ctx.config = { ...ctx.config, ...ids } as WorldConfig;
    }

    return ctx.config as HydratedWorldConfig;
}

export function loadExtractedObjectIds(network: string): ExtractedObjectIds | null {
    const filePath = getExtractedObjectIdsPath(network);
    if (!fs.existsSync(filePath)) return null;
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw) as ExtractedObjectIds;
    } catch {
        return null;
    }
}

export function getDefaultWorldPackageId(network: string): string {
    return process.env.WORLD_PACKAGE_ID || loadExtractedObjectIds(network)?.world?.packageId || "";
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
