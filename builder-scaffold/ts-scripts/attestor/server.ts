import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import { blake2b } from "@noble/hashes/blake2b";
import { createClient, keypairFromPrivateKey, type Network } from "../utils/config";

type ClaimAttestationPayload = {
    bounty_id: string;
    killmail_id: bigint;
    killer: string;
    victim: CharacterId;
    kill_timestamp: bigint;
    is_ship_loss: boolean;
};

type CharacterId = {
    item_id: bigint;
    tenant: string;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type BountyState = {
    target: CharacterId;
    createdAt: bigint;
    expiresAt: bigint;
    acceptedHunters: string[];
};

type WorldVerificationConfig = {
    packageId: string;
    objectRegistryId: string;
    tenant: string;
};

type TenantItemId = {
    itemId: bigint;
    tenant: string;
};

type KillmailState = {
    killerId: TenantItemId;
    victimId: TenantItemId;
    killTimestampMs: bigint;
    isShipLoss: boolean;
};

type KillmailCreatedEventState = {
    killmailId: bigint;
    tenant: string;
    killerId: TenantItemId;
    victimId: TenantItemId;
    killTimestampMs: bigint;
    isShipLoss: boolean;
};

type EventCursor = Parameters<ReturnType<typeof createClient>["queryEvents"]>[0]["cursor"];

class HttpError extends Error {
    readonly statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
    }
}

const ED25519_FLAG = 0x00;
const INTENT_PREFIX = Uint8Array.from([0x03, 0x00, 0x00]);
const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_PORT = 8787;
// 默认仅监听本机回环接口，防止签名服务被局域网内其他主机意外访问（签名 oracle 风险）。
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_KEY_ID = "local-dev-key-1";
const DEFAULT_TENANT = "dev";
const DEFAULT_CANDIDATE_LIMIT = 50;
const MAX_CANDIDATE_LIMIT = 200;
const DEFAULT_CANDIDATE_MAX_SCAN = 500;
const MAX_CANDIDATE_MAX_SCAN = 5000;
const MILLIS_THRESHOLD = 1_000_000_000_000n;
const EVENT_QUERY_PAGE_SIZE = 100;
const VALID_NETWORKS = new Set<Network>(["localnet", "testnet", "devnet", "mainnet"]);

const AddressBcs = bcs.bytes(32).transform({
    input: (value: string) => hexToBytes(normalizeHexId(value)),
    output: (value) => bytesToHex(Uint8Array.from(value)),
});

const ObjectIdBcs = bcs.struct("ID", {
    bytes: AddressBcs,
});

const CharacterIdBcs = bcs.struct("CharacterId", {
    item_id: bcs.u64(),
    tenant: bcs.string(),
});

const ClaimAttestationPayloadBcs = bcs.struct("ClaimAttestationPayload", {
    bounty_id: ObjectIdBcs,
    killmail_id: bcs.u64(),
    killer: AddressBcs,
    victim: CharacterIdBcs,
    kill_timestamp: bcs.u64(),
    is_ship_loss: bcs.bool(),
});

const TenantItemIdBcs = bcs.struct("TenantItemId", {
    item_id: bcs.u64(),
    tenant: bcs.string(),
});

function printHelp(): void {
    console.log("Usage: tsx ts-scripts/attestor/server.ts");
    console.log("");
    console.log("Environment:");
    console.log("  ATTESTOR_PRIVATE_KEY   Required Sui Ed25519 private key");
    console.log(`  ATTESTOR_KEY_ID        Optional key identifier (default: ${DEFAULT_KEY_ID})`);
    console.log("  NETWORK                Optional network: localnet | testnet | devnet | mainnet");
    console.log("  SUI_RPC_URL            Optional explicit RPC URL override");
    console.log(`  ATTESTOR_HOST          Optional bind host (default: ${DEFAULT_HOST})`);
    console.log(`  ATTESTOR_PORT          Optional TCP port (default: ${DEFAULT_PORT})`);
    console.log("");
    console.log("Routes:");
    console.log("  GET  /health");
    console.log("  GET  /candidates?bounty_id=<id>&limit=<n>");
    console.log("  GET  /characters/search?name=<substring>&limit=<n>");
    console.log("  POST /attestations/claim");
}

function shouldPrintHelp(argv: string[]): boolean {
    return argv.includes("--help") || argv.includes("-h");
}

function main(): void {
    if (shouldPrintHelp(process.argv.slice(2))) {
        printHelp();
        return;
    }

    const privateKey = requireEnv("ATTESTOR_PRIVATE_KEY");
    const keypair = keypairFromPrivateKey(privateKey);
    const network = resolveNetwork();
    const client = createClient(network);
    const keyId = (process.env.ATTESTOR_KEY_ID || DEFAULT_KEY_ID).trim() || DEFAULT_KEY_ID;
    const attestorAddress = keypair.getPublicKey().toSuiAddress();
    const host = resolveHost();
    const port = resolvePort();
    const worldConfig = resolveWorldVerificationConfig();

    const server = createServer(async (request, response) => {
        try {
            await routeRequest(request, response, {
                attestorAddress,
                client,
                keyId,
                keypair,
                worldConfig,
            });
        } catch (error) {
            if (response.headersSent || response.writableEnded) {
                return;
            }
            const statusCode = error instanceof HttpError ? error.statusCode : 500;
            const message = error instanceof Error ? error.message : "Internal server error";
            writeJson(response, statusCode, { error: message });
        }
    });

    server.listen(port, host, () => {
        console.log(`Attestor listening on http://${host}:${port}`);
        console.log(`Network: ${network}`);
        console.log(`Key ID: ${keyId}`);
        console.log(`Attestor address: ${attestorAddress}`);
    });
}

async function routeRequest(
    request: IncomingMessage,
    response: ServerResponse,
    context: {
        attestorAddress: string;
        client: ReturnType<typeof createClient>;
        keyId: string;
        keypair: ReturnType<typeof keypairFromPrivateKey>;
        worldConfig: WorldVerificationConfig | null;
    }
): Promise<void> {
    const method = request.method || "GET";
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (method === "OPTIONS") {
        writeEmpty(response, 204);
        return;
    }

    if (method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, {
            ok: true,
            key_id: context.keyId,
            attestor_address: context.attestorAddress,
        });
        return;
    }

    if (method === "GET" && url.pathname === "/candidates") {
        const worldConfig = requireWorldVerificationConfig(context.worldConfig);
        const bountyId = parseObjectIdField("bounty_id", requireQueryParameter(url, "bounty_id"));
        const limit = parseCandidateLimit(url.searchParams.get("limit"));
        const bounty = await fetchBountyState(context.client, bountyId);
        const candidates = await listClaimableKillmailCandidates({
            bounty,
            bountyId,
            client: context.client,
            keyId: context.keyId,
            keypair: context.keypair,
            limit,
            worldConfig,
        });

        writeJson(response, 200, { candidates });
        return;
    }

    if (method === "GET" && url.pathname === "/characters/search") {
        const worldConfig = requireWorldVerificationConfig(context.worldConfig);
        const name = (url.searchParams.get("name") || "").trim();
        const limit = parseSearchLimit(url.searchParams.get("limit"));
        const tenantOverride = (url.searchParams.get("tenant") || "").trim();

        const candidates = await searchCharactersByName({
            client: context.client,
            worldConfig: {
                ...worldConfig,
                tenant: tenantOverride || worldConfig.tenant,
            },
            name,
            limit,
        });

        writeJson(response, 200, { candidates });
        return;
    }

    if (method === "POST" && url.pathname === "/attestations/claim") {
        const rawBody = await readJsonBody(request);
        const payload = parseClaimPayload(rawBody);
        const worldConfig = requireWorldVerificationConfig(context.worldConfig);
        const bounty = await fetchBountyState(context.client, payload.bounty_id);
        const killmail = await fetchKillmailState(context.client, payload.killmail_id, worldConfig);

        await validateKillerWalletMatchesKillmail(
            context.client,
            payload.killer,
            killmail.killerId,
            worldConfig
        );

        payload.is_ship_loss = killmail.isShipLoss;
        if (!payload.is_ship_loss) {
            throw new HttpError(400, "Killmail loss type must be SHIP");
        }

        validateKillmailClaim(payload, killmail);
        validateBountyClaim(payload, bounty);

        const signature = await signClaimPayload(payload, context.keypair);
        writeJson(response, 200, {
            key_id: context.keyId,
            payload: toResponsePayload(payload),
            signature,
        });
        return;
    }

    if (
        (url.pathname === "/health" && method !== "GET") ||
        (url.pathname === "/candidates" && method !== "GET") ||
        (url.pathname === "/characters/search" && method !== "GET") ||
        (url.pathname === "/attestations/claim" && method !== "POST")
    ) {
        throw new HttpError(405, `Method ${method} not allowed for ${url.pathname}`);
    }

    throw new HttpError(404, `Route ${method} ${url.pathname} not found`);
}

type CharacterSearchCandidate = {
    name: string;
    tenant: string;
    item_id: string;
    character_object_id: string;
    character_wallet: string;
};

const DEFAULT_CHARACTER_SEARCH_LIMIT = 10;
const MAX_CHARACTER_SEARCH_LIMIT = 50;
const DEFAULT_CHARACTER_SEARCH_MAX_SCAN = 5000;

function parseSearchLimit(value: string | null): number {
    if (value === null || value.trim() === "") {
        return DEFAULT_CHARACTER_SEARCH_LIMIT;
    }
    if (!/^\d+$/.test(value.trim())) {
        throw new HttpError(
            400,
            `limit must be an integer between 1 and ${MAX_CHARACTER_SEARCH_LIMIT}`
        );
    }
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CHARACTER_SEARCH_LIMIT) {
        throw new HttpError(
            400,
            `limit must be an integer between 1 and ${MAX_CHARACTER_SEARCH_LIMIT}`
        );
    }
    return parsed;
}

function resolveCharacterSearchMaxScan(): number {
    const raw = (
        process.env.CHARACTER_SEARCH_MAX_SCAN || String(DEFAULT_CHARACTER_SEARCH_MAX_SCAN)
    ).trim();
    if (!/^\d+$/.test(raw)) {
        throw new HttpError(500, "CHARACTER_SEARCH_MAX_SCAN must be a positive integer");
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new HttpError(500, "CHARACTER_SEARCH_MAX_SCAN must be a positive integer");
    }
    return parsed;
}

async function searchCharactersByName(input: {
    client: ReturnType<typeof createClient>;
    worldConfig: WorldVerificationConfig;
    name: string;
    limit: number;
}): Promise<CharacterSearchCandidate[]> {
    const query = input.name.trim().toLowerCase();
    const maxScan = resolveCharacterSearchMaxScan();
    const moveEventType = `${input.worldConfig.packageId}::metadata::MetadataChangedEvent`;
    const expectedCharacterType = `${input.worldConfig.packageId}::character::Character`;

    const out: CharacterSearchCandidate[] = [];
    const seen = new Set<string>();

    let cursor: EventCursor = null;
    let hasNextPage = true;
    let scanned = 0;

    while (hasNextPage && scanned < maxScan && out.length < input.limit) {
        const page = await input.client.queryEvents({
            query: { MoveEventType: moveEventType },
            cursor,
            limit: EVENT_QUERY_PAGE_SIZE,
            order: "descending",
        });

        for (const event of page.data) {
            scanned += 1;
            if (scanned > maxScan) {
                break;
            }
            if (!isRecord(event.parsedJson)) {
                continue;
            }

            const parsed = event.parsedJson;
            const key = parseTenantItemIdField("metadata.assembly_key", parsed.assembly_key);
            if (key.tenant !== input.worldConfig.tenant) {
                continue;
            }
            const nameValue = typeof parsed.name === "string" ? parsed.name.trim() : "";
            if (!nameValue) {
                continue;
            }

            if (query && !nameValue.toLowerCase().includes(query)) {
                continue;
            }

            const dedupeKey = `${key.tenant}:${key.itemId.toString()}`;
            if (seen.has(dedupeKey)) {
                continue;
            }

            const objectId = deriveCharacterObjectId(key, input.worldConfig);
            const obj = await input.client.getObject({
                id: objectId,
                options: { showContent: true, showType: true },
            });
            const actualType = obj.data?.type;
            if (actualType !== expectedCharacterType) {
                continue;
            }

            const content = obj.data?.content;
            if (!content || content.dataType !== "moveObject") {
                continue;
            }
            const fields = unwrapMoveFields(`character ${objectId}`, content.fields);
            const wallet = parseAddressField(
                "character.character_address",
                fields.character_address
            );

            seen.add(dedupeKey);
            out.push({
                name: nameValue,
                tenant: key.tenant,
                item_id: key.itemId.toString(),
                character_object_id: objectId,
                character_wallet: wallet,
            });

            if (out.length >= input.limit) {
                break;
            }
        }

        cursor = page.nextCursor;
        hasNextPage = page.hasNextPage;
    }

    return out;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > MAX_BODY_BYTES) {
            throw new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes`);
        }
        chunks.push(buffer);
    }

    if (chunks.length === 0) {
        throw new HttpError(400, "Request body is required");
    }

    const bodyText = Buffer.concat(chunks).toString("utf8").trim();
    if (!bodyText) {
        throw new HttpError(400, "Request body is required");
    }

    try {
        return JSON.parse(bodyText) as unknown;
    } catch {
        throw new HttpError(400, "Request body must be valid JSON");
    }
}

function parseClaimPayload(input: unknown): ClaimAttestationPayload {
    const source = isRecord(input) && isRecord(input.payload) ? input.payload : input;
    if (!isRecord(source)) {
        throw new HttpError(400, "Claim payload must be a JSON object");
    }

    const killTimestampSource = source.kill_timestamp_ms ?? source.kill_timestamp;
    const victimSource = source.victim ?? source.victim_id;
    const victimItemIdSource = source.victim_item_id ?? source.victimItemId;
    const victimTenantSource = source.victim_tenant ?? source.victimTenant;

    return {
        bounty_id: parseObjectIdField("bounty_id", source.bounty_id),
        killmail_id: parseU64Field("killmail_id", source.killmail_id),
        killer: parseAddressField("killer", source.killer),
        victim: parseCharacterIdField(
            "victim",
            victimSource,
            victimItemIdSource,
            victimTenantSource
        ),
        kill_timestamp: parseU64Field("kill_timestamp", killTimestampSource),
        is_ship_loss: parseBooleanLike("is_ship_loss", source.is_ship_loss, false),
    };
}

// 将 claim payload 按 Move `ClaimAttestationPayload` 的字段顺序做 BCS 序列化，确保链上验签字节完全一致。
function serializeClaimPayload(payload: ClaimAttestationPayload): Uint8Array {
    return ClaimAttestationPayloadBcs.serialize({
        bounty_id: { bytes: payload.bounty_id },
        killmail_id: payload.killmail_id,
        killer: payload.killer,
        victim: payload.victim,
        kill_timestamp: payload.kill_timestamp,
        is_ship_loss: payload.is_ship_loss,
    }).toBytes();
}

// 复用链上 `world::sig_verify` 的意图前缀与 blake2b256 摘要规则，输出 `[flag][sig][pubkey]` 十六进制签名。
async function signClaimPayload(
    payload: ClaimAttestationPayload,
    keypair: ReturnType<typeof keypairFromPrivateKey>
): Promise<string> {
    const message = serializeClaimPayload(payload);
    const digest = blake2b(concatBytes(INTENT_PREFIX, message), { dkLen: 32 });
    const signature = await keypair.sign(digest);
    const publicKey = keypair.getPublicKey().toRawBytes();
    const bytes = new Uint8Array(1 + signature.length + publicKey.length);

    bytes[0] = ED25519_FLAG;
    bytes.set(signature, 1);
    bytes.set(publicKey, 1 + signature.length);

    return bytesToHex(bytes);
}

// 从链上读取 bounty 对象并提取校验所需字段，避免对未授权的 killmail 直接签名。
async function fetchBountyState(
    client: ReturnType<typeof createClient>,
    bountyId: string
): Promise<BountyState> {
    const result = await client.getObject({
        id: bountyId,
        options: { showContent: true, showType: true },
    });

    const content = result.data?.content;
    if (!content || content.dataType !== "moveObject") {
        throw new HttpError(404, `Bounty object ${bountyId} was not found or has no Move content`);
    }

    const fields =
        isRecord(content.fields) && isRecord(content.fields.fields)
            ? content.fields.fields
            : content.fields;
    if (!isRecord(fields)) {
        throw new HttpError(500, `Bounty object ${bountyId} fields are unavailable`);
    }
    const bountyFields = fields as Record<string, unknown>;

    return {
        target: parseCharacterIdFromMoveFields("bounty.target", bountyFields.target),
        createdAt: parseU64Field("bounty.created_at", bountyFields.created_at),
        expiresAt: parseU64Field("bounty.expires_at", bountyFields.expires_at),
        acceptedHunters: parseAddressVector(
            "bounty.accepted_hunters",
            bountyFields.accepted_hunters
        ),
    };
}

// 签名前必须重放链上守卫条件：victim 命中 target、击杀时间晚于 created_at、killer 已接单。
function validateBountyClaim(payload: ClaimAttestationPayload, bounty: BountyState): void {
    if (!characterIdEquals(payload.victim, bounty.target)) {
        throw new HttpError(400, "Claim victim does not match bounty target");
    }
    if (payload.kill_timestamp <= bounty.createdAt) {
        throw new HttpError(400, "Kill timestamp must be greater than bounty created_at");
    }
    if (bounty.expiresAt !== 0n && payload.kill_timestamp > bounty.expiresAt) {
        throw new HttpError(400, "Kill timestamp must be within bounty time window");
    }
    if (!bounty.acceptedHunters.includes(payload.killer)) {
        throw new HttpError(400, "Killer is not in bounty accepted_hunters");
    }
}

function characterIdEquals(left: CharacterId, right: CharacterId): boolean {
    return left.item_id === right.item_id && left.tenant === right.tenant;
}

// 启用链上 killmail 校验前，先确保环境里提供了世界包和对象注册表配置。
function requireWorldVerificationConfig(
    config: WorldVerificationConfig | null
): WorldVerificationConfig {
    if (!config) {
        throw new HttpError(
            500,
            "WORLD_PACKAGE_ID and WORLD_OBJECT_REGISTRY_ID are required for killmail verification"
        );
    }
    return config;
}

// 查询并核对链上的 `KillmailCreatedEvent`，再把角色 ID 解析为钱包地址供签名前比对。
async function fetchKillmailState(
    client: ReturnType<typeof createClient>,
    killmailId: bigint,
    worldConfig: WorldVerificationConfig
): Promise<KillmailState> {
    const event = await findKillmailCreatedEvent(client, killmailId, worldConfig);

    return {
        killerId: event.killerId,
        victimId: event.victimId,
        killTimestampMs: event.killTimestampMs,
        isShipLoss: event.isShipLoss,
    };
}

// 分页扫描同类型事件并只产出当前 tenant 的 killmail；统一走这一条路径，保证 `/attestations/claim` 与 `/candidates` 的事件视图一致。
async function* queryKillmailCreatedEvents(
    client: ReturnType<typeof createClient>,
    worldConfig: WorldVerificationConfig
): AsyncGenerator<KillmailCreatedEventState> {
    const moveEventType = `${worldConfig.packageId}::killmail::KillmailCreatedEvent`;
    let cursor: EventCursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
        const page = await client.queryEvents({
            query: { MoveEventType: moveEventType },
            cursor,
            limit: EVENT_QUERY_PAGE_SIZE,
            order: "descending",
        });

        for (const event of page.data) {
            if (!isRecord(event.parsedJson)) {
                continue;
            }

            const parsedEvent = parseKillmailCreatedEventState(event.parsedJson);
            if (parsedEvent.tenant === worldConfig.tenant) {
                yield parsedEvent;
            }
        }

        cursor = page.nextCursor;
        hasNextPage = page.hasNextPage;
    }
}

// 统一解析 killmail 事件的关键字段，并把秒/毫秒时间折算成毫秒，避免不同调用方各自重复做非确定性转换。
function parseKillmailCreatedEventState(event: Record<string, unknown>): KillmailCreatedEventState {
    const key = parseTenantItemIdField("killmail.key", event.key);

    return {
        killmailId: key.itemId,
        tenant: key.tenant,
        killerId: parseTenantItemIdField("killmail.killer_id", event.killer_id),
        victimId: parseTenantItemIdField("killmail.victim_id", event.victim_id),
        killTimestampMs: normalizeKillTimestampMs(
            parseU64Field("killmail.kill_timestamp", event.kill_timestamp)
        ),
        isShipLoss: parseIsShipLoss(event.loss_type),
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

// 分页扫描同类型事件，并按 `key.item_id` 与 `key.tenant` 精确筛出目标 killmail。
async function findKillmailCreatedEvent(
    client: ReturnType<typeof createClient>,
    killmailId: bigint,
    worldConfig: WorldVerificationConfig
): Promise<KillmailCreatedEventState> {
    for await (const event of queryKillmailCreatedEvents(client, worldConfig)) {
        if (event.killmailId === killmailId) {
            return event;
        }
    }

    throw new HttpError(
        404,
        `KillmailCreatedEvent for killmail_id ${killmailId.toString()} and tenant ${worldConfig.tenant} was not found`
    );
}

// 角色对象 ID 不是明文字段，需按 `TenantItemId { item_id, tenant }` 的 BCS 编码重新派生。
function deriveCharacterObjectId(
    characterId: TenantItemId,
    worldConfig: WorldVerificationConfig
): string {
    const serializedKey = TenantItemIdBcs.serialize({
        item_id: characterId.itemId,
        tenant: characterId.tenant,
    }).toBytes();
    const tenantItemIdType = `${worldConfig.packageId}::in_game_id::TenantItemId`;

    return deriveObjectID(worldConfig.objectRegistryId, tenantItemIdType, serializedKey);
}

// 将链上 killmail 时间统一折算成毫秒：小于阈值按秒处理，否则视为已经是毫秒。
function normalizeKillTimestampMs(timestamp: bigint): bigint {
    return timestamp < MILLIS_THRESHOLD ? timestamp * 1000n : timestamp;
}

// 解析事件里的 `TenantItemId`，默认要求字段名是 Move struct 原样导出的 `item_id` / `tenant`。
function parseTenantItemIdField(label: string, value: unknown): TenantItemId {
    const fields = unwrapMoveFields(label, value);
    return {
        itemId: parseU64Field(`${label}.item_id`, fields.item_id),
        tenant: parseStringLike(`${label}.tenant`, fields.tenant),
    };
}

function parseCharacterIdFromMoveFields(label: string, value: unknown): CharacterId {
    const fields = unwrapMoveFields(label, value);
    return {
        item_id: parseU64Field(`${label}.item_id`, fields.item_id),
        tenant: parseStringLike(`${label}.tenant`, fields.tenant),
    };
}

function parseCharacterIdField(
    label: string,
    value: unknown,
    itemId: unknown,
    tenant: unknown
): CharacterId {
    if (isRecord(value)) {
        const fields = unwrapMoveFields(label, value);
        return {
            item_id: parseU64Field(`${label}.item_id`, fields.item_id),
            tenant: parseStringLike(`${label}.tenant`, fields.tenant),
        };
    }
    return {
        item_id: parseU64Field(`${label}.item_id`, itemId),
        tenant: parseStringLike(`${label}.tenant`, tenant),
    };
}

async function validateKillerWalletMatchesKillmail(
    client: ReturnType<typeof createClient>,
    killerWallet: string,
    killerId: TenantItemId,
    worldConfig: WorldVerificationConfig
): Promise<void> {
    const keys = await fetchWalletCharacterKeys(client, killerWallet, worldConfig);
    const matches = keys.some((k) => k.itemId === killerId.itemId && k.tenant === killerId.tenant);
    if (!matches) {
        throw new HttpError(400, "Killer wallet does not match killmail killer character");
    }
}

async function resolveAcceptedHunterWalletForKillerId(input: {
    client: ReturnType<typeof createClient>;
    acceptedHunters: string[];
    killerId: TenantItemId;
    worldConfig: WorldVerificationConfig;
}): Promise<string | null> {
    const cache = new Map<string, TenantItemId[]>();

    for (const wallet of input.acceptedHunters) {
        const keys =
            cache.get(wallet) ||
            (await fetchWalletCharacterKeys(input.client, wallet, input.worldConfig));
        cache.set(wallet, keys);
        if (
            keys.some(
                (k) => k.itemId === input.killerId.itemId && k.tenant === input.killerId.tenant
            )
        ) {
            return wallet;
        }
    }
    return null;
}

async function fetchWalletCharacterKeys(
    client: ReturnType<typeof createClient>,
    wallet: string,
    worldConfig: WorldVerificationConfig
): Promise<TenantItemId[]> {
    const playerProfileType = `${worldConfig.packageId}::character::PlayerProfile`;
    const owned = await client.getOwnedObjects({
        owner: wallet,
        filter: { StructType: playerProfileType },
        options: { showContent: true, showType: true },
        limit: 10,
    });

    const characterIds: string[] = [];
    for (const entry of owned.data) {
        const content = entry.data?.content;
        if (!content || content.dataType !== "moveObject") {
            continue;
        }
        const fields = unwrapMoveFields("player_profile", content.fields);
        const characterId = parseObjectIdField("player_profile.character_id", fields.character_id);
        characterIds.push(characterId);
    }

    if (characterIds.length === 0) {
        return [];
    }

    const keys: TenantItemId[] = [];
    for (const characterObjectId of characterIds) {
        const obj = await client.getObject({
            id: characterObjectId,
            options: { showContent: true, showType: true },
        });
        const content = obj.data?.content;
        if (!content || content.dataType !== "moveObject") {
            continue;
        }
        const fields = unwrapMoveFields(`character ${characterObjectId}`, content.fields);
        const key = parseTenantItemIdField("character.key", fields.key);
        keys.push(key);
    }

    return keys;
}

// 对比请求 payload 与链上 killmail 的归一化结果，任何一项不一致都拒绝签名。
function validateKillmailClaim(payload: ClaimAttestationPayload, killmail: KillmailState): void {
    if (!killmail.isShipLoss) {
        throw new HttpError(400, "Killmail loss type must be SHIP");
    }
    if (!characterIdEquals(payload.victim, toCharacterId(killmail.victimId))) {
        throw new HttpError(400, "Claim victim does not match killmail victim character");
    }
    if (payload.kill_timestamp !== killmail.killTimestampMs) {
        throw new HttpError(400, "Claim kill_timestamp does not match killmail timestamp");
    }
    if (payload.is_ship_loss !== killmail.isShipLoss) {
        throw new HttpError(400, "Claim is_ship_loss does not match killmail loss type");
    }
}

function toCharacterId(value: TenantItemId): CharacterId {
    return { item_id: value.itemId, tenant: value.tenant };
}

// `/candidates` 只是基于最近事件做 best-effort 自动发现；结果仍按与 `/attestations/claim` 相同的 payload/signature 规则生成，保证前端拿到的签名可直接复用。
async function listClaimableKillmailCandidates(input: {
    bounty: BountyState;
    bountyId: string;
    client: ReturnType<typeof createClient>;
    keyId: string;
    keypair: ReturnType<typeof keypairFromPrivateKey>;
    limit: number;
    worldConfig: WorldVerificationConfig;
}): Promise<
    Array<{
        killmail_id: string;
        killer: string;
        victim: string;
        kill_timestamp_ms: string;
        attestation: {
            key_id: string;
            payload: Record<string, string>;
            signature: string;
        };
    }>
> {
    const maxScan = resolveCandidateMaxScan();
    const out: Array<{
        killmail_id: string;
        killer: string;
        victim: { item_id: string; tenant: string };
        kill_timestamp_ms: string;
        attestation: {
            key_id: string;
            payload: Record<string, string>;
            signature: string;
        };
    }> = [];

    let scanned = 0;
    for await (const event of queryKillmailCreatedEvents(input.client, input.worldConfig)) {
        scanned += 1;
        if (scanned > maxScan) {
            break;
        }

        if (event.killTimestampMs <= input.bounty.createdAt) {
            break;
        }

        if (input.bounty.expiresAt !== 0n && event.killTimestampMs > input.bounty.expiresAt) {
            continue;
        }
        if (!event.isShipLoss) {
            continue;
        }

        const victim = toCharacterId(event.victimId);
        if (!characterIdEquals(victim, input.bounty.target)) {
            continue;
        }

        const killer = await resolveAcceptedHunterWalletForKillerId({
            client: input.client,
            acceptedHunters: input.bounty.acceptedHunters,
            killerId: event.killerId,
            worldConfig: input.worldConfig,
        });
        if (!killer) {
            continue;
        }

        const payload: ClaimAttestationPayload = {
            bounty_id: input.bountyId,
            killmail_id: event.killmailId,
            killer,
            victim,
            kill_timestamp: event.killTimestampMs,
            is_ship_loss: event.isShipLoss,
        };

        out.push({
            killmail_id: event.killmailId.toString(),
            killer,
            victim: { item_id: victim.item_id.toString(), tenant: victim.tenant },
            kill_timestamp_ms: event.killTimestampMs.toString(),
            attestation: {
                key_id: input.keyId,
                payload: toResponsePayload(payload),
                signature: await signClaimPayload(payload, input.keypair),
            },
        });

        if (out.length >= input.limit) {
            break;
        }
    }

    return out.sort((left, right) => {
        const timestampOrder = compareNumericStrings(
            left.kill_timestamp_ms,
            right.kill_timestamp_ms
        );
        if (timestampOrder !== 0) {
            return timestampOrder;
        }
        return compareNumericStrings(left.killmail_id, right.killmail_id);
    });
}

function requireQueryParameter(url: URL, name: string): string {
    const value = url.searchParams.get(name);
    if (!value || !value.trim()) {
        throw new HttpError(400, `${name} query parameter is required`);
    }
    return value.trim();
}

function parseCandidateLimit(value: string | null): number {
    if (value === null || value.trim() === "") {
        return DEFAULT_CANDIDATE_LIMIT;
    }

    if (!/^\d+$/.test(value.trim())) {
        throw new HttpError(400, `limit must be an integer between 1 and ${MAX_CANDIDATE_LIMIT}`);
    }

    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CANDIDATE_LIMIT) {
        throw new HttpError(400, `limit must be an integer between 1 and ${MAX_CANDIDATE_LIMIT}`);
    }

    return parsed;
}

function resolveCandidateMaxScan(): number {
    const raw = (process.env.CANDIDATE_MAX_SCAN || String(DEFAULT_CANDIDATE_MAX_SCAN)).trim();
    if (!/^\d+$/.test(raw)) {
        throw new HttpError(500, "CANDIDATE_MAX_SCAN must be a positive integer");
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CANDIDATE_MAX_SCAN) {
        throw new HttpError(
            500,
            `CANDIDATE_MAX_SCAN must be an integer between 1 and ${MAX_CANDIDATE_MAX_SCAN}`
        );
    }
    return parsed;
}

function compareNumericStrings(left: string, right: string): number {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    if (leftValue < rightValue) {
        return -1;
    }
    if (leftValue > rightValue) {
        return 1;
    }
    return 0;
}

function parseAddressVector(label: string, value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((entry, index) => parseAddressField(`${label}[${index}]`, entry));
    }

    if (isRecord(value)) {
        for (const candidateKey of ["contents", "items", "values"]) {
            const candidate = value[candidateKey];
            if (Array.isArray(candidate)) {
                return candidate.map((entry, index) =>
                    parseAddressField(`${label}[${index}]`, entry)
                );
            }
        }

        if (isRecord(value.fields)) {
            return parseAddressVector(label, value.fields.contents);
        }
    }

    throw new HttpError(400, `${label} must be a vector of Sui addresses`);
}

function parseObjectIdField(label: string, value: unknown): string {
    return normalizeHexId(parseStringLike(label, value));
}

function parseAddressField(label: string, value: unknown): string {
    return normalizeHexId(parseStringLike(label, value));
}

function parseU64Field(label: string, value: unknown): bigint {
    if (typeof value !== "string" && typeof value !== "number") {
        throw new HttpError(400, `${label} must be a string or number`);
    }

    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized)) {
        throw new HttpError(400, `${label} must be an unsigned integer`);
    }

    const parsed = BigInt(normalized);
    if (parsed < 0n || parsed > 18446744073709551615n) {
        throw new HttpError(400, `${label} must fit within u64`);
    }
    return parsed;
}

function parseBooleanLike(label: string, value: unknown, defaultValue: boolean): boolean {
    if (value === undefined || value === null) {
        return defaultValue;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    throw new HttpError(400, `${label} must be a boolean`);
}

function unwrapMoveFields(label: string, value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new HttpError(400, `${label} must be an object`);
    }

    if (isRecord(value.fields)) {
        return unwrapMoveFields(label, value.fields);
    }

    return value;
}

function parseStringLike(label: string, value: unknown): string {
    if (typeof value !== "string") {
        throw new HttpError(400, `${label} must be a string`);
    }

    const normalized = value.trim();
    if (!normalized) {
        throw new HttpError(400, `${label} is required`);
    }
    return normalized;
}

function normalizeHexId(value: string): string {
    const stripped = value.trim().toLowerCase();
    const withoutPrefix = stripped.startsWith("0x") ? stripped.slice(2) : stripped;
    if (
        !/^[0-9a-f]+$/.test(withoutPrefix) ||
        withoutPrefix.length === 0 ||
        withoutPrefix.length > 64
    ) {
        throw new HttpError(400, `Invalid Sui object ID/address: ${value}`);
    }
    return `0x${withoutPrefix.padStart(64, "0")}`;
}

function hexToBytes(value: string): Uint8Array {
    const normalized = value.startsWith("0x") ? value.slice(2) : value;
    return Uint8Array.from(Buffer.from(normalized, "hex"));
}

function bytesToHex(value: Uint8Array): string {
    return `0x${Buffer.from(value).toString("hex")}`;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
    const combined = new Uint8Array(left.length + right.length);
    combined.set(left, 0);
    combined.set(right, left.length);
    return combined;
}

function resolveNetwork(): Network {
    const requested = (
        process.env.NETWORK ||
        process.env.SUI_NETWORK ||
        "localnet"
    ).trim() as Network;
    if (!VALID_NETWORKS.has(requested)) {
        throw new HttpError(
            500,
            `NETWORK must be one of: ${Array.from(VALID_NETWORKS).join(", ")}`
        );
    }
    return requested;
}

function resolveHost(): string {
    return (process.env.ATTESTOR_HOST || DEFAULT_HOST).trim();
}

function resolvePort(): number {
    const raw = (process.env.ATTESTOR_PORT || process.env.PORT || String(DEFAULT_PORT)).trim();
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
        throw new HttpError(500, "ATTESTOR_PORT must be a valid TCP port");
    }
    return value;
}

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new HttpError(500, `${name} is required`);
    }
    return value;
}

function resolveWorldVerificationConfig(): WorldVerificationConfig | null {
    const packageId = process.env.WORLD_PACKAGE_ID?.trim();
    const objectRegistryId = process.env.WORLD_OBJECT_REGISTRY_ID?.trim();

    if (!packageId || !objectRegistryId) {
        return null;
    }

    return {
        packageId: normalizeHexId(packageId),
        objectRegistryId: normalizeHexId(objectRegistryId),
        tenant: (process.env.TENANT || DEFAULT_TENANT).trim() || DEFAULT_TENANT,
    };
}

function toResponsePayload(payload: ClaimAttestationPayload): Record<string, string> {
    return {
        bounty_id: payload.bounty_id,
        killmail_id: payload.killmail_id.toString(),
        killer: payload.killer,
        victim_item_id: payload.victim.item_id.toString(),
        victim_tenant: payload.victim.tenant,
        kill_timestamp: payload.kill_timestamp.toString(),
        is_ship_loss: payload.is_ship_loss ? "true" : "false",
    };
}

function writeJson(
    response: ServerResponse,
    statusCode: number,
    body: Record<string, JsonValue>
): void {
    if (response.headersSent || response.writableEnded) {
        return;
    }
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
    });
    response.end(JSON.stringify(body));
}

function writeEmpty(response: ServerResponse, statusCode: number): void {
    if (response.headersSent || response.writableEnded) {
        return;
    }
    response.writeHead(statusCode, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
    });
    response.end();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
