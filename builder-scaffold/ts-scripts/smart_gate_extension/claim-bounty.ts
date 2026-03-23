import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { CLOCK_OBJECT_ID } from "../utils/constants";
import {
    enrichBountyConfigError,
    extractEvent,
    fromHex,
    requireAddressEnv,
    requireBountyCoinTypeFromEnv,
    requireBountyIdFromEnv,
    requirePositiveU64Env,
    getEnvConfig,
    handleError,
    hydrateWorldConfig,
    initializeContext,
    requireEnv,
} from "../utils/helper";
import { resolveSmartGateExtensionIdsFromEnv } from "./extension-ids";
import { MODULE } from "./modules";

type BountyClaimedEvent = {
    bounty_id: string;
    hunter: string;
    killmail_id: string;
    claimed_at: string;
    claimed_amount: string;
};

type ClaimEnvInput = {
    bountyId: string;
    coinType: string;
    killmailId: bigint;
    killerAddress: string;
    victimItemId: bigint;
    victimTenant: string;
    killTimestampMs: bigint;
    isShipLoss: boolean;
    claimSignatureBytes: number[];
};

function requireSignatureBytes(name: string): number[] {
    try {
        return Array.from(fromHex(requireEnv(name).trim()));
    } catch {
        throw new Error(`${name} must be a valid hex signature`);
    }
}

// 读取并校验 claim 必填参数：确保签名、killmail 与时间戳可直接映射到链上 claim payload。
function readClaimEnvInput(): ClaimEnvInput {
    return {
        bountyId: requireBountyIdFromEnv(),
        coinType: requireBountyCoinTypeFromEnv(),
        killmailId: requirePositiveU64Env("KILLMAIL_ID"),
        killerAddress: requireAddressEnv("KILLER_ADDRESS"),
        victimItemId: requirePositiveU64Env("VICTIM_ITEM_ID"),
        victimTenant: (process.env.VICTIM_TENANT || process.env.TENANT || "dev").trim() || "dev",
        killTimestampMs: requirePositiveU64Env("KILL_TIMESTAMP_MS"),
        isShipLoss: (process.env.IS_SHIP_LOSS || "true").trim().toLowerCase() === "true",
        claimSignatureBytes: requireSignatureBytes("CLAIM_SIGNATURE_HEX"),
    };
}

// 组装领取交易：传入 claim payload 关键字段（含 bounty_id 对应对象 + 签名）并提取托管奖励。
function buildClaimBountyTx(
    builderPackageId: string,
    extensionConfigId: string,
    hunterAddress: string,
    input: ClaimEnvInput
): Transaction {
    const tx = new Transaction();
    tx.setSender(hunterAddress);

    const [victim] = tx.moveCall({
        target: `${builderPackageId}::${MODULE.CORPSE_GATE_BOUNTY}::character_id`,
        arguments: [tx.pure.u64(input.victimItemId), tx.pure.string(input.victimTenant)],
    });

    const [payoutBalance] = tx.moveCall({
        target: `${builderPackageId}::${MODULE.CORPSE_GATE_BOUNTY}::claim_bounty`,
        typeArguments: [input.coinType],
        arguments: [
            tx.object(extensionConfigId),
            tx.object(input.bountyId),
            tx.pure.u64(input.killmailId),
            tx.pure.address(input.killerAddress),
            victim,
            tx.pure.u64(input.killTimestampMs),
            tx.pure.bool(input.isShipLoss),
            tx.pure.vector("u8", input.claimSignatureBytes),
            tx.object(CLOCK_OBJECT_ID),
        ],
    });

    const [payoutCoin] = tx.moveCall({
        target: `0x2::coin::from_balance`,
        typeArguments: [input.coinType],
        arguments: [payoutBalance],
    });

    tx.transferObjects([payoutCoin], tx.pure.address(hunterAddress));
    return tx;
}

// 输出领取事件关键字段，便于核对 killmail 与最终 payout。
function logClaimedEvent(event: BountyClaimedEvent | null): void {
    if (!event) {
        console.log("BountyClaimedEvent not found in transaction events");
        return;
    }
    console.log("BountyClaimedEvent:");
    console.log("  bounty_id:", event.bounty_id);
    console.log("  hunter:", event.hunter);
    console.log("  killmail_id:", event.killmail_id);
    console.log("  claimed_at:", event.claimed_at);
    console.log("  claimed_amount:", event.claimed_amount);
}

async function main() {
    console.log("============= Claim Bounty ==============\n");

    try {
        const input = readClaimEnvInput();

        const env = getEnvConfig();
        const playerKey = requireEnv("PLAYER_A_PRIVATE_KEY");
        const ctx = initializeContext(env.network, playerKey);
        const { client, keypair, address } = ctx;
        await hydrateWorldConfig(ctx);

        const { builderPackageId, extensionConfigId } = resolveSmartGateExtensionIdsFromEnv();

        const tx = buildClaimBountyTx(builderPackageId, extensionConfigId, address, input);

        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer: keypair,
            options: { showEffects: true, showEvents: true },
        });

        console.log("Bounty claimed!");
        console.log("Transaction digest:", result.digest);

        const claimedEvent = extractEvent<BountyClaimedEvent>(result, "::BountyClaimedEvent");
        logClaimedEvent(claimedEvent);
    } catch (error) {
        handleError(enrichBountyConfigError(error));
    }
}

main();
