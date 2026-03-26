import "dotenv/config";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { deriveObjectID } from "@mysten/sui/utils";
import { bcs } from "@mysten/sui/bcs";

type Network = "localnet" | "testnet" | "devnet" | "mainnet";

const DEFAULT_RPC_URLS: Record<Network, string> = {
    localnet: "http://127.0.0.1:9000",
    testnet: "https://fullnode.testnet.sui.io:443",
    devnet: "https://fullnode.devnet.sui.io:443",
    mainnet: "https://fullnode.mainnet.sui.io:443",
};

const TenantItemIdBcs = bcs.struct("TenantItemId", {
    item_id: bcs.u64(),
    tenant: bcs.string(),
});

type EventCursor = { txDigest: string; eventSeq: string } | null;

type TenantItemId = { itemId: bigint; tenant: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function parseStringLike(label: string, value: unknown): string {
    if (typeof value !== "string") {
        throw new Error(`${label} must be a string`);
    }
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`${label} is required`);
    }
    return normalized;
}

function parseU64Like(label: string, value: unknown): bigint {
    if (typeof value !== "string" && typeof value !== "number") {
        throw new Error(`${label} must be a string or number`);
    }
    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized)) {
        throw new Error(`${label} must be an unsigned integer`);
    }
    return BigInt(normalized);
}

function normalizeHexId(value: string): string {
    const stripped = value.trim().toLowerCase();
    const withoutPrefix = stripped.startsWith("0x") ? stripped.slice(2) : stripped;
    if (
        !/^[0-9a-f]+$/.test(withoutPrefix) ||
        withoutPrefix.length === 0 ||
        withoutPrefix.length > 64
    ) {
        throw new Error(`Invalid Sui object ID/address: ${value}`);
    }
    return `0x${withoutPrefix.padStart(64, "0")}`;
}

function unwrapMoveFields(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error(`Expected an object for Move fields`);
    }
    if (isRecord(value.fields)) {
        return unwrapMoveFields(value.fields);
    }
    return value;
}

function parseTenantItemId(label: string, value: unknown): TenantItemId {
    const fields = unwrapMoveFields(value);
    return {
        itemId: parseU64Like(`${label}.item_id`, fields.item_id),
        tenant: parseStringLike(`${label}.tenant`, fields.tenant),
    };
}

function parseIsShipLoss(value: unknown): boolean {
    if (typeof value === "string") {
        return value.toUpperCase() === "SHIP";
    }
    if (isRecord(value)) {
        if (typeof value.variant === "string") {
            return value.variant.toUpperCase() === "SHIP";
        }
        return Object.prototype.hasOwnProperty.call(value, "SHIP");
    }
    return false;
}

function normalizeKillTimestampMs(timestampSecondsOrMs: bigint): bigint {
    const MILLIS_THRESHOLD = 1_000_000_000_000n;
    return timestampSecondsOrMs < MILLIS_THRESHOLD
        ? timestampSecondsOrMs * 1000n
        : timestampSecondsOrMs;
}

function deriveCharacterObjectId(args: {
    worldPackageId: string;
    objectRegistryId: string;
    tenant: string;
    characterId: bigint;
}): string {
    const keyBytes = TenantItemIdBcs.serialize({
        item_id: args.characterId,
        tenant: args.tenant,
    }).toBytes();
    const typeTag = `${args.worldPackageId}::in_game_id::TenantItemId`;
    return deriveObjectID(args.objectRegistryId, typeTag, keyBytes);
}

async function fetchCharacterWalletAddress(
    client: SuiJsonRpcClient,
    characterObjectId: string
): Promise<string> {
    const result = await client.getObject({
        id: characterObjectId,
        options: { showContent: true },
    });
    const content = result.data?.content;
    if (!content || content.dataType !== "moveObject") {
        throw new Error(`Character object ${characterObjectId} not found`);
    }
    const fields = unwrapMoveFields(content.fields);
    return normalizeHexId(parseStringLike("character.character_address", fields.character_address));
}

async function main() {
    const network =
        ((process.env.SUI_NETWORK || process.env.NETWORK || "testnet").trim() as Network) ||
        "testnet";
    const rpcUrl = process.env.SUI_RPC_URL || DEFAULT_RPC_URLS[network];

    const worldPackageId = normalizeHexId(requireEnv("WORLD_PACKAGE_ID"));
    const objectRegistryId = normalizeHexId(requireEnv("WORLD_OBJECT_REGISTRY_ID"));
    const tenant = (process.env.TENANT || "dev").trim() || "dev";

    const killerWalletFilter = process.env.KILLER_WALLET
        ? normalizeHexId(process.env.KILLER_WALLET)
        : null;
    const victimWalletFilter = process.env.VICTIM_WALLET
        ? normalizeHexId(process.env.VICTIM_WALLET)
        : null;
    const killerCharacterFilter =
        process.env.KILLER_CHARACTER_ID && /^\d+$/.test(process.env.KILLER_CHARACTER_ID.trim())
            ? BigInt(process.env.KILLER_CHARACTER_ID.trim())
            : null;
    const victimCharacterFilter =
        process.env.VICTIM_CHARACTER_ID && /^\d+$/.test(process.env.VICTIM_CHARACTER_ID.trim())
            ? BigInt(process.env.VICTIM_CHARACTER_ID.trim())
            : null;
    const killmailItemFilter =
        process.env.KILLMAIL_ITEM_ID && /^\d+$/.test(process.env.KILLMAIL_ITEM_ID.trim())
            ? BigInt(process.env.KILLMAIL_ITEM_ID.trim())
            : null;
    const limit = Number.parseInt((process.env.LIMIT || "10").trim(), 10);
    const maxEventsScanned = Number.parseInt((process.env.MAX_SCAN || "300").trim(), 10);

    const client = new SuiJsonRpcClient({ url: rpcUrl, network });
    const moveEventType = `${worldPackageId}::killmail::KillmailCreatedEvent`;

    console.log("============= Query Killmails ==============");
    console.log("Network:", network);
    console.log("RPC:", rpcUrl);
    console.log("Tenant:", tenant);
    console.log("World package (original-id):", worldPackageId);
    console.log("ObjectRegistry:", objectRegistryId);
    console.log("Event type:", moveEventType);
    if (killerWalletFilter) console.log("Filter killer wallet:", killerWalletFilter);
    if (victimWalletFilter) console.log("Filter victim wallet:", victimWalletFilter);
    if (killerCharacterFilter)
        console.log("Filter killer character_id:", killerCharacterFilter.toString());
    if (victimCharacterFilter)
        console.log("Filter victim character_id:", victimCharacterFilter.toString());
    if (killmailItemFilter) console.log("Filter killmail item_id:", killmailItemFilter.toString());
    console.log("");

    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error("LIMIT must be an integer between 1 and 50");
    }
    if (!Number.isInteger(maxEventsScanned) || maxEventsScanned < 1) {
        throw new Error("MAX_SCAN must be a positive integer");
    }

    const seenCharacters = new Map<string, string>();
    const results: Array<Record<string, unknown>> = [];

    let cursor: EventCursor = null;
    let scanned = 0;
    let hasNextPage = true;

    while (hasNextPage && scanned < maxEventsScanned && results.length < limit) {
        const page = await client.queryEvents({
            query: { MoveEventType: moveEventType },
            cursor,
            limit: 50,
            order: "descending",
        });

        for (const e of page.data) {
            scanned += 1;
            if (!isRecord(e.parsedJson)) continue;

            const json = e.parsedJson;
            const key = parseTenantItemId("key", json.key);
            if (key.tenant !== tenant) continue;

            const killerId = parseTenantItemId("killer_id", json.killer_id);
            const victimId = parseTenantItemId("victim_id", json.victim_id);

            if (killmailItemFilter && key.itemId !== killmailItemFilter) continue;
            if (killerCharacterFilter && killerId.itemId !== killerCharacterFilter) continue;
            if (victimCharacterFilter && victimId.itemId !== victimCharacterFilter) continue;
            const killTimestampSec = parseU64Like("kill_timestamp", json.kill_timestamp);
            const isShipLoss = parseIsShipLoss(json.loss_type);

            const killerCharacterObjectId = deriveCharacterObjectId({
                worldPackageId,
                objectRegistryId,
                tenant: killerId.tenant,
                characterId: killerId.itemId,
            });
            const victimCharacterObjectId = deriveCharacterObjectId({
                worldPackageId,
                objectRegistryId,
                tenant: victimId.tenant,
                characterId: victimId.itemId,
            });

            const killerCacheKey = `${killerId.tenant}:${killerId.itemId.toString()}`;
            const victimCacheKey = `${victimId.tenant}:${victimId.itemId.toString()}`;

            const killerWallet =
                seenCharacters.get(killerCacheKey) ||
                (await fetchCharacterWalletAddress(client, killerCharacterObjectId).catch(
                    () => null
                ));
            const victimWallet =
                seenCharacters.get(victimCacheKey) ||
                (await fetchCharacterWalletAddress(client, victimCharacterObjectId).catch(
                    () => null
                ));

            if (killerWallet) seenCharacters.set(killerCacheKey, killerWallet);
            if (victimWallet) seenCharacters.set(victimCacheKey, victimWallet);

            if (killerWalletFilter && killerWallet !== killerWalletFilter) continue;
            if (victimWalletFilter && victimWallet !== victimWalletFilter) continue;

            results.push({
                txDigest: e.id?.txDigest,
                eventSeq: e.id?.eventSeq,
                killmail_item_id: key.itemId.toString(),
                kill_timestamp_sec: killTimestampSec.toString(),
                kill_timestamp_ms: normalizeKillTimestampMs(killTimestampSec).toString(),
                is_ship_loss: isShipLoss,
                killer_character_id: killerId.itemId.toString(),
                victim_character_id: victimId.itemId.toString(),
                killer_wallet: killerWallet,
                victim_wallet: victimWallet,
                raw_loss_type: json.loss_type,
            });

            if (results.length >= limit) break;
        }

        cursor = page.nextCursor;
        hasNextPage = page.hasNextPage;
    }

    console.log(JSON.stringify({ scanned, returned: results.length, results }, null, 2));
}

main().catch((e) => {
    console.error("\n=== Error ===");
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
});
