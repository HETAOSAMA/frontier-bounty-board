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
    requireEnv,
} from "../utils/helper";
import { resolveSmartGateExtensionIdsFromEnv } from "./extension-ids";
import { MODULE } from "./modules";

type BountyAcceptedEvent = {
    bounty_id: string;
    hunter: string;
    accepted_at: string;
};

// 组装接单交易：把当前发送者地址写入 accepted_hunters，并记录接单时间。
function buildAcceptBountyTx(
    builderPackageId: string,
    bountyId: string,
    coinType: string,
    hunterAddress: string
): Transaction {
    const tx = new Transaction();
    tx.setSender(hunterAddress);

    tx.moveCall({
        target: `${builderPackageId}::${MODULE.CORPSE_GATE_BOUNTY}::accept_bounty`,
        typeArguments: [coinType],
        arguments: [tx.object(bountyId), tx.object(CLOCK_OBJECT_ID)],
    });

    return tx;
}

// 输出接单事件关键字段，便于确认接单地址与接单时间。
function logAcceptedEvent(event: BountyAcceptedEvent | null): void {
    if (!event) {
        console.log("BountyAcceptedEvent not found in transaction events");
        return;
    }
    console.log("BountyAcceptedEvent:");
    console.log("  bounty_id:", event.bounty_id);
    console.log("  hunter:", event.hunter);
    console.log("  accepted_at:", event.accepted_at);
}

async function main() {
    console.log("============= Accept Bounty ==============\n");

    try {
        const bountyId = requireBountyIdFromEnv();
        const coinType = requireBountyCoinTypeFromEnv();

        const env = getEnvConfig();
        const playerKey = requireEnv("PLAYER_A_PRIVATE_KEY");
        const ctx = initializeContext(env.network, playerKey);
        const { client, keypair, address } = ctx;
        await hydrateWorldConfig(ctx);

        const { builderPackageId } = resolveSmartGateExtensionIdsFromEnv();

        const tx = buildAcceptBountyTx(builderPackageId, bountyId, coinType, address);

        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer: keypair,
            options: { showEffects: true, showEvents: true },
        });

        console.log("Bounty accepted!");
        console.log("Transaction digest:", result.digest);

        const acceptedEvent = extractEvent<BountyAcceptedEvent>(result, "::BountyAcceptedEvent");
        logAcceptedEvent(acceptedEvent);
    } catch (error) {
        handleError(enrichBountyConfigError(error));
    }
}

main();
