import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import {
    extractEvent,
    getEnvConfig,
    handleError,
    hydrateWorldConfig,
    initializeContext,
    requireEnv,
} from "../utils/helper";

type TestResources = {
    character?: { gameCharacterBId?: number; gameCharacterCId?: number };
};

type WorldPublishObjectChange = {
    type: string;
    objectType?: string;
    objectId?: string;
};

const TenantItemIdBcs = bcs.struct("TenantItemId", {
    item_id: bcs.u64(),
    tenant: bcs.string(),
});

function readJsonFile<T>(filePath: string): T {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
}

function deriveCharacterObjectId(args: {
    worldPackageId: string;
    objectRegistryId: string;
    tenant: string;
    gameCharacterId: bigint;
}): string {
    const keyBytes = TenantItemIdBcs.serialize({
        item_id: args.gameCharacterId,
        tenant: args.tenant,
    }).toBytes();
    const typeTag = `${args.worldPackageId}::in_game_id::TenantItemId`;
    return deriveObjectID(args.objectRegistryId, typeTag, keyBytes);
}

function findKillmailRegistryId(worldPackageJsonPath: string, worldPackageId: string): string {
    const json = readJsonFile<{ objectChanges?: WorldPublishObjectChange[] }>(worldPackageJsonPath);
    const changes = json.objectChanges ?? [];
    const expectedType = `${worldPackageId}::killmail_registry::KillmailRegistry`;
    const created = changes.find(
        (c) =>
            c.type === "created" && c.objectType === expectedType && typeof c.objectId === "string"
    );
    if (!created?.objectId) {
        throw new Error(`在 ${worldPackageJsonPath} 中未找到 KillmailRegistry（${expectedType}）`);
    }
    return created.objectId;
}

function readDefaultCharacterIds(): { killerId: bigint; victimId: bigint } {
    const filePath = path.resolve(process.cwd(), "test-resources.json");
    const res = fs.existsSync(filePath) ? readJsonFile<TestResources>(filePath) : {};
    const killer = res.character?.gameCharacterBId;
    const victim = res.character?.gameCharacterCId;
    if (!killer || !victim) {
        throw new Error(
            "无法从 test-resources.json 读取默认角色 ID（需要 character.gameCharacterBId/gameCharacterCId）。请通过环境变量 KILLER_CHARACTER_ID / VICTIM_CHARACTER_ID 指定。"
        );
    }
    return { killerId: BigInt(killer), victimId: BigInt(victim) };
}

function parseU64FromEnv(name: string, fallback?: bigint): bigint {
    const raw = process.env[name];
    if (!raw || !raw.trim()) {
        if (fallback !== undefined) return fallback;
        throw new Error(`${name} is required`);
    }
    if (!/^\d+$/.test(raw.trim())) {
        throw new Error(`${name} must be a u64 integer`);
    }
    return BigInt(raw.trim());
}

async function main() {
    console.log("============= Mock Killmail (localnet) =============\n");

    try {
        const env = getEnvConfig();
        const adminKey = requireEnv("ADMIN_PRIVATE_KEY");
        const ctx = initializeContext(env.network, adminKey);
        const { client, keypair, address } = ctx;
        const world = await hydrateWorldConfig(ctx);

        const tenant = (process.env.TENANT || "dev").trim() || "dev";
        const defaults = readDefaultCharacterIds();
        const killerGameId = parseU64FromEnv("KILLER_CHARACTER_ID", defaults.killerId);
        const victimGameId = parseU64FromEnv("VICTIM_CHARACTER_ID", defaults.victimId);

        const reportedByCharacterObjectId = deriveCharacterObjectId({
            worldPackageId: world.packageId,
            objectRegistryId: world.objectRegistry,
            tenant,
            gameCharacterId: killerGameId,
        });

        const worldPackageJsonPath = path.resolve(
            process.cwd(),
            "deployments",
            env.network,
            "world_package.json"
        );
        const killmailRegistryId = findKillmailRegistryId(worldPackageJsonPath, world.packageId);

        const killmailItemId = parseU64FromEnv("KILLMAIL_ITEM_ID", BigInt(Date.now()));
        const solarSystemId = parseU64FromEnv("SOLAR_SYSTEM_ID", 30000142n);
        const killTimestampSec = parseU64FromEnv(
            "KILL_TIMESTAMP_SEC",
            BigInt(Math.floor(Date.now() / 1000))
        );
        const lossType = Number(parseU64FromEnv("LOSS_TYPE", 1n));
        if (lossType !== 1 && lossType !== 2) {
            throw new Error("LOSS_TYPE must be 1 (SHIP) or 2 (STRUCTURE)");
        }

        console.log("Admin:", address);
        console.log("World package:", world.packageId);
        console.log("AdminACL:", world.adminAcl);
        console.log("KillmailRegistry:", killmailRegistryId);
        console.log("Tenant:", tenant);
        console.log("Killer characterId:", killerGameId.toString());
        console.log("Victim characterId:", victimGameId.toString());
        console.log("ReportedBy Character objectId:", reportedByCharacterObjectId);
        console.log("Killmail item_id:", killmailItemId.toString());
        console.log("LossType:", lossType === 1 ? "SHIP" : "STRUCTURE");
        console.log("Kill timestamp (sec):", killTimestampSec.toString());
        console.log("Solar system item_id:", solarSystemId.toString());
        console.log("");

        const tx = new Transaction();
        tx.setSender(address);
        tx.moveCall({
            target: `${world.packageId}::killmail::create_killmail`,
            arguments: [
                tx.object(killmailRegistryId),
                tx.object(world.adminAcl),
                tx.pure.u64(killmailItemId),
                tx.pure.u64(killerGameId),
                tx.pure.u64(victimGameId),
                tx.object(reportedByCharacterObjectId),
                tx.pure.u64(killTimestampSec),
                tx.pure.u8(lossType),
                tx.pure.u64(solarSystemId),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer: keypair,
            options: { showEffects: true, showEvents: true },
        });

        console.log("Killmail created!");
        console.log("Transaction digest:", result.digest);

        const ev = extractEvent<Record<string, unknown>>(result, "::KillmailCreatedEvent");
        if (ev) {
            console.log("KillmailCreatedEvent:");
            console.log(JSON.stringify(ev, null, 2));
        } else {
            console.log("KillmailCreatedEvent not found in tx events");
        }
    } catch (err) {
        handleError(err);
    }
}

main();
