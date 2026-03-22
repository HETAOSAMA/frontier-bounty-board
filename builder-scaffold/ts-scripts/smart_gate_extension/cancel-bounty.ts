import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { CLOCK_OBJECT_ID } from "../utils/constants";
import {
    enrichBountyConfigError,
    extractEvent,
    requireBountyCoinTypeFromEnv,
    requireBountyIdFromEnv,
    getEnvConfig,
    handleError,
    hydrateWorldConfig,
    initializeContext,
} from "../utils/helper";
import { resolveSmartGateExtensionIdsFromEnv } from "./extension-ids";
import { MODULE } from "./modules";

type BountyCancelledEvent = {
    bounty_id: string;
    cancelled_by: string;
    cancelled_at: string;
    refunded_amount: string;
};

// 组装取消交易：仅在可取消状态下取回 escrow 并转回创建者钱包。
function buildCancelBountyTx(
    builderPackageId: string,
    bountyId: string,
    coinType: string,
    creatorAddress: string
): Transaction {
    const tx = new Transaction();
    tx.setSender(creatorAddress);

    const [refundBalance] = tx.moveCall({
        target: `${builderPackageId}::${MODULE.CORPSE_GATE_BOUNTY}::cancel_bounty`,
        typeArguments: [coinType],
        arguments: [tx.object(bountyId), tx.object(CLOCK_OBJECT_ID)],
    });

    const [refundCoin] = tx.moveCall({
        target: `0x2::coin::from_balance`,
        typeArguments: [coinType],
        arguments: [refundBalance],
    });

    tx.transferObjects([refundCoin], tx.pure.address(creatorAddress));
    return tx;
}

// 输出取消事件关键字段，便于确认退款金额和取消操作者。
function logCancelledEvent(event: BountyCancelledEvent | null): void {
    if (!event) {
        console.log("BountyCancelledEvent not found in transaction events");
        return;
    }
    console.log("BountyCancelledEvent:");
    console.log("  bounty_id:", event.bounty_id);
    console.log("  cancelled_by:", event.cancelled_by);
    console.log("  cancelled_at:", event.cancelled_at);
    console.log("  refunded_amount:", event.refunded_amount);
}

async function main() {
    console.log("============= Cancel Bounty ==============\n");

    try {
        const bountyId = requireBountyIdFromEnv();
        const coinType = requireBountyCoinTypeFromEnv();

        const env = getEnvConfig();
        const ctx = initializeContext(env.network, env.adminExportedKey);
        const { client, keypair, address } = ctx;
        await hydrateWorldConfig(ctx);

        const { builderPackageId } = resolveSmartGateExtensionIdsFromEnv();

        const tx = buildCancelBountyTx(builderPackageId, bountyId, coinType, address);

        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer: keypair,
            options: { showEffects: true, showEvents: true },
        });

        console.log("Bounty cancelled!");
        console.log("Transaction digest:", result.digest);

        const cancelledEvent = extractEvent<BountyCancelledEvent>(result, "::BountyCancelledEvent");
        logCancelledEvent(cancelledEvent);
    } catch (error) {
        handleError(enrichBountyConfigError(error));
    }
}

main();
