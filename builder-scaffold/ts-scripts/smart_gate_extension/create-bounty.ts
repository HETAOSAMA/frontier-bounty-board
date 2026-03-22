import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { CLOCK_OBJECT_ID } from "../utils/constants";
import {
    enrichBountyConfigError,
    extractEvent,
    requireAddressEnv,
    requireBountyCoinTypeFromEnv,
    requirePositiveU64Env,
    getEnvConfig,
    handleError,
    hydrateWorldConfig,
    initializeContext,
} from "../utils/helper";
import { resolveSmartGateExtensionIdsFromEnv } from "./extension-ids";
import { MODULE } from "./modules";

type BountyCreatedEvent = {
    bounty_id: string;
    creator: string;
    target: string;
    created_at: string;
    expires_at: string;
    escrow_amount: string;
};

// 组装创建悬赏交易：切分托管资产、调用 create_bounty（返回共享 Bounty 的 ID）。
function buildCreateBountyTx(
    sender: string,
    builderPackageId: string,
    coinType: string,
    target: string,
    escrowAmount: bigint,
    expiresAtMs: bigint
): Transaction {
    const tx = new Transaction();
    tx.setSender(sender);

    const [escrowCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(escrowAmount)]);
    const [escrowBalance] = tx.moveCall({
        target: `0x2::coin::into_balance`,
        typeArguments: [coinType],
        arguments: [escrowCoin],
    });

    tx.moveCall({
        target: `${builderPackageId}::${MODULE.CORPSE_GATE_BOUNTY}::create_bounty`,
        typeArguments: [coinType],
        arguments: [
            tx.pure.address(target),
            tx.pure.u64(expiresAtMs),
            escrowBalance,
            tx.object(CLOCK_OBJECT_ID),
        ],
    });

    return tx;
}

// 输出关键事件字段，便于脚本调用方快速确认 bounty_id 和托管金额。
function logCreatedEvent(event: BountyCreatedEvent | null): void {
    if (!event) {
        console.log("BountyCreatedEvent not found in transaction events");
        return;
    }
    console.log("BountyCreatedEvent:");
    console.log("  bounty_id:", event.bounty_id);
    console.log("  creator:", event.creator);
    console.log("  target:", event.target);
    console.log("  created_at:", event.created_at);
    console.log("  expires_at:", event.expires_at);
    console.log("  escrow_amount:", event.escrow_amount);
}

async function main() {
    console.log("============= Create Bounty ==============\n");

    try {
        const target = requireAddressEnv("BOUNTY_TARGET_ADDRESS");
        const escrowAmount = requirePositiveU64Env("BOUNTY_ESCROW_AMOUNT");
        const expiresAtMs = BigInt(process.env.BOUNTY_EXPIRES_AT_MS || "0");
        const coinType = requireBountyCoinTypeFromEnv();

        const env = getEnvConfig();
        const ctx = initializeContext(env.network, env.adminExportedKey);
        const { client, keypair, address } = ctx;
        await hydrateWorldConfig(ctx);

        const { builderPackageId } = resolveSmartGateExtensionIdsFromEnv();

        const tx = buildCreateBountyTx(
            address,
            builderPackageId,
            coinType,
            target,
            escrowAmount,
            expiresAtMs
        );

        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer: keypair,
            options: { showEffects: true, showEvents: true, showObjectChanges: true },
        });

        console.log("Bounty created!");
        console.log("Transaction digest:", result.digest);

        const createdEvent = extractEvent<BountyCreatedEvent>(result, "::BountyCreatedEvent");
        logCreatedEvent(createdEvent);
    } catch (error) {
        handleError(enrichBountyConfigError(error));
    }
}

main();
