import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { getBountyModuleIdsFromEnv } from "../utils/helper";
import { MODULE } from "./modules";

export type SmartGateExtensionIds = {
    builderPackageId: string;
    adminCapId: string;
    extensionConfigId: string;
};

export function requireBuilderPackageId(): string {
    return getBountyModuleIdsFromEnv().builderPackageId;
}

/**
 * Resolve builder package and extension config IDs from env only (no AdminCap).
 * Use for entry points that don't need admin, e.g. issue_jump_permit.
 */
export function resolveSmartGateExtensionIdsFromEnv(): {
    builderPackageId: string;
    extensionConfigId: string;
} {
    const { builderPackageId, extensionConfigId } = getBountyModuleIdsFromEnv();
    return {
        builderPackageId,
        extensionConfigId,
    };
}

/**
 * Resolve smart_gate_extension IDs (env + AdminCap for the given owner).
 * BUILDER_PACKAGE_ID and EXTENSION_CONFIG_ID come from .env (set after publishing).
 */
export async function resolveSmartGateExtensionIds(
    client: SuiJsonRpcClient,
    ownerAddress: string
): Promise<SmartGateExtensionIds> {
    const { builderPackageId, extensionConfigId } = resolveSmartGateExtensionIdsFromEnv();
    const adminCapType = `${builderPackageId}::${MODULE.CONFIG}::AdminCap`;

    const adminCapIdFromEnv = process.env.ADMIN_CAP_ID?.trim();
    if (adminCapIdFromEnv) {
        if (!adminCapIdFromEnv.startsWith("0x") || adminCapIdFromEnv.length < 3) {
            throw new Error("ADMIN_CAP_ID must be a valid Sui object ID");
        }
        const obj = await client.getObject({
            id: adminCapIdFromEnv,
            options: { showOwner: true, showType: true },
        });
        const actualType = obj.data?.type;
        if (!actualType) {
            throw new Error(`AdminCap object ${adminCapIdFromEnv} not found`);
        }
        if (actualType !== adminCapType) {
            throw new Error(
                `ADMIN_CAP_ID ${adminCapIdFromEnv} has type ${actualType}, expected ${adminCapType}`
            );
        }
        const owner = obj.data?.owner as unknown;
        const ownedBy =
            typeof owner === "object" &&
            owner !== null &&
            "AddressOwner" in owner &&
            typeof (owner as { AddressOwner?: unknown }).AddressOwner === "string"
                ? (owner as { AddressOwner: string }).AddressOwner
                : null;
        if (ownedBy && ownedBy !== ownerAddress) {
            throw new Error(
                `AdminCap ${adminCapIdFromEnv} is owned by ${ownedBy}, but signer address is ${ownerAddress}. ` +
                    `Set ADMIN_PRIVATE_KEY to the key that owns the AdminCap.`
            );
        }

        return { builderPackageId, adminCapId: adminCapIdFromEnv, extensionConfigId };
    }

    const result = await client.getOwnedObjects({
        owner: ownerAddress,
        filter: { StructType: adminCapType },
        limit: 1,
    });

    const adminCapId = result.data[0]?.data?.objectId;
    if (!adminCapId) {
        throw new Error(
            `AdminCap not found for ${ownerAddress}. ` +
                `Make sure this address published the smart_gate_extension package, ` +
                `or set ADMIN_CAP_ID to the AdminCap object ID from the publish output.`
        );
    }

    return { builderPackageId, adminCapId, extensionConfigId };
}
