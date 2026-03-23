import "dotenv/config";
import { bcs } from "@mysten/sui/bcs";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { deriveObjectID } from "@mysten/sui/utils";

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

function unwrapMoveFields(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error("Expected an object for Move fields");
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

function deriveCharacterObjectId(args: {
    worldPackageId: string;
    objectRegistryId: string;
    characterId: TenantItemId;
}): string {
    const keyBytes = TenantItemIdBcs.serialize({
        item_id: args.characterId.itemId,
        tenant: args.characterId.tenant,
    }).toBytes();
    const typeTag = `${args.worldPackageId}::in_game_id::TenantItemId`;
    return deriveObjectID(args.objectRegistryId, typeTag, keyBytes);
}

async function main() {
    const network =
        ((process.env.SUI_NETWORK || process.env.NETWORK || "testnet").trim() as Network) ||
        "testnet";
    const rpcUrl = process.env.SUI_RPC_URL || DEFAULT_RPC_URLS[network];

    const worldPackageId = normalizeHexId(requireEnv("WORLD_PACKAGE_ID"));
    const objectRegistryId = normalizeHexId(requireEnv("WORLD_OBJECT_REGISTRY_ID"));
    const tenant = (process.env.TENANT || "").trim();

    const name = (process.env.NAME || "").trim();
    const limit = Number.parseInt((process.env.LIMIT || "10").trim(), 10);
    const maxEventsScanned = Number.parseInt((process.env.MAX_SCAN || "1000").trim(), 10);

    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error("LIMIT must be an integer between 1 and 50");
    }
    if (!Number.isInteger(maxEventsScanned) || maxEventsScanned < 1) {
        throw new Error("MAX_SCAN must be a positive integer");
    }

    const client = new SuiJsonRpcClient({ url: rpcUrl, network });
    const moveEventType = `${worldPackageId}::metadata::MetadataChangedEvent`;
    const expectedCharacterType = `${worldPackageId}::character::Character`;

    console.log("============= Resolve Character Name ==============");
    console.log("Network:", network);
    console.log("RPC:", rpcUrl);
    console.log("Tenant filter:", tenant || "(any)");
    console.log("Name filter:", name || "(any)");
    console.log("World package (original-id):", worldPackageId);
    console.log("ObjectRegistry:", objectRegistryId);
    console.log("Event type:", moveEventType);
    console.log("");

    let cursor: EventCursor = null;
    let hasNextPage = true;
    let scanned = 0;
    const results: Array<Record<string, unknown>> = [];

    while (hasNextPage && scanned < maxEventsScanned && results.length < limit) {
        const page = await client.queryEvents({
            query: { MoveEventType: moveEventType },
            cursor,
            limit: 50,
            order: "descending",
        });

        for (const e of page.data) {
            scanned += 1;
            if (scanned > maxEventsScanned) break;
            if (!isRecord(e.parsedJson)) continue;

            const json = e.parsedJson;
            const assemblyKey = parseTenantItemId("assembly_key", json.assembly_key);
            if (tenant && assemblyKey.tenant !== tenant) continue;

            const eventName = typeof json.name === "string" ? json.name.trim() : "";
            if (!eventName) continue;
            if (name && eventName.toLowerCase() !== name.toLowerCase()) continue;

            const characterObjectId = deriveCharacterObjectId({
                worldPackageId,
                objectRegistryId,
                characterId: assemblyKey,
            });

            const obj = await client.getObject({
                id: characterObjectId,
                options: { showType: true, showContent: true },
            });

            const actualType = obj.data?.type;
            if (actualType !== expectedCharacterType) {
                continue;
            }

            const content = obj.data?.content;
            const fields =
                content && content.dataType === "moveObject"
                    ? unwrapMoveFields(content.fields)
                    : null;
            const characterAddress = fields ? (fields.character_address as unknown) : null;
            const wallet =
                typeof characterAddress === "string" ? normalizeHexId(characterAddress) : null;

            results.push({
                name: eventName,
                tenant: assemblyKey.tenant,
                item_id: assemblyKey.itemId.toString(),
                character_object_id: characterObjectId,
                character_wallet: wallet,
                txDigest: e.id?.txDigest,
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
