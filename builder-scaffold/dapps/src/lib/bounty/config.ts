import { getDappBountyConfigOrNull } from "../../env/bounty-config";
export function getBountyDappConfigOrNull():
  | {
      builderPackageId: string;
      extensionConfigId: string;
      coinType: string;
    }
  | null {
  const cfg = getDappBountyConfigOrNull();
  const builderPackageId = cfg?.builderPackageId?.trim();
  const extensionConfigId = cfg?.extensionConfigId?.trim();
  const coinType = cfg?.bountyCoinType?.trim();
  if (!builderPackageId || !extensionConfigId || !coinType) return null;
  return { builderPackageId, extensionConfigId, coinType };
}
