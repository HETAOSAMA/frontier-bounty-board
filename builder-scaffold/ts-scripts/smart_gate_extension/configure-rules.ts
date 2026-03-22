import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { getEnvConfig, handleError, initializeContext } from "../utils/helper";
import { resolveSmartGateExtensionIds } from "./extension-ids";
import { keypairFromPrivateKey } from "../utils/config";
import { MODULE } from "./modules";

async function main() {
    console.log("============= Configure Smart Gate Rules ==============\n");

    try {
        const env = getEnvConfig();
        const ctx = initializeContext(env.network, env.adminExportedKey);
        const { client, keypair, address } = ctx;

        const { builderPackageId, adminCapId, extensionConfigId } =
            await resolveSmartGateExtensionIds(client, address);

        // 使用项目统一的私钥解析器，支持 suiprivkey... / 0xhex / raw-hex 等所有 Sui 私钥格式。
        // 从私钥自动派生 Sui 地址，无需额外部署环境变量存储地址。
        const attestorPrivateKey = process.env.ATTESTOR_PRIVATE_KEY;
        if (!attestorPrivateKey) {
            throw new Error("ATTESTOR_PRIVATE_KEY is required to derive trusted_attestor address");
        }
        const trustedAttestor = keypairFromPrivateKey(attestorPrivateKey)
            .getPublicKey()
            .toSuiAddress();

        const tx = new Transaction();

        tx.moveCall({
            target: `${builderPackageId}::${MODULE.CORPSE_GATE_BOUNTY}::set_bounty_config`,
            arguments: [
                tx.object(extensionConfigId),
                tx.object(adminCapId),
                tx.pure.address(trustedAttestor),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer: keypair,
            options: { showEffects: true, showObjectChanges: true },
        });

        console.log("Smart gate rules configured!");
        console.log("Transaction digest:", result.digest);
    } catch (error) {
        handleError(error);
    }
}

main();
