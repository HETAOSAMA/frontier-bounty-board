import { Transaction } from "@mysten/sui/transactions";

const CLOCK_OBJECT_ID = "0x6";

export function buildCreateBountyTx(args: {
  builderPackageId: string;
  coinType: string;
  targetItemId: bigint;
  targetTenant: string;
  expiresAt: bigint;
  escrowAmount: bigint;
}): Transaction {
  const tx = new Transaction();

  const [escrowCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(args.escrowAmount)]);
  const [escrowBalance] = tx.moveCall({
    target: `0x2::coin::into_balance`,
    typeArguments: [args.coinType],
    arguments: [escrowCoin],
  });

  const [target] = tx.moveCall({
    target: `${args.builderPackageId}::corpse_gate_bounty::character_id`,
    arguments: [tx.pure.u64(args.targetItemId), tx.pure.string(args.targetTenant)],
  });

  tx.moveCall({
    target: `${args.builderPackageId}::corpse_gate_bounty::create_bounty`,
    typeArguments: [args.coinType],
    arguments: [
      target,
      tx.pure.u64(args.expiresAt),
      escrowBalance,
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

export function buildAcceptBountyTx(args: {
  builderPackageId: string;
  coinType: string;
  bountyId: string;
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${args.builderPackageId}::corpse_gate_bounty::accept_bounty`,
    typeArguments: [args.coinType],
    arguments: [tx.object(args.bountyId), tx.object(CLOCK_OBJECT_ID)],
  });

  return tx;
}

export function buildCancelBountyTx(args: {
  builderPackageId: string;
  coinType: string;
  bountyId: string;
  refundTo: string;
}): Transaction {
  const tx = new Transaction();

  const [refundBalance] = tx.moveCall({
    target: `${args.builderPackageId}::corpse_gate_bounty::cancel_bounty`,
    typeArguments: [args.coinType],
    arguments: [tx.object(args.bountyId), tx.object(CLOCK_OBJECT_ID)],
  });

  const [refundCoin] = tx.moveCall({
    target: `0x2::coin::from_balance`,
    typeArguments: [args.coinType],
    arguments: [refundBalance],
  });

  tx.transferObjects([refundCoin], tx.pure.address(args.refundTo));
  return tx;
}

export function buildClaimBountyTx(args: {
  builderPackageId: string;
  extensionConfigId: string;
  coinType: string;
  bountyId: string;
  payoutTo: string;
  killmailId: bigint;
  killer: string;
  victimItemId: bigint;
  victimTenant: string;
  killTimestampMs: bigint;
  isShipLoss: boolean;
  signatureBytes: number[];
}): Transaction {
  const tx = new Transaction();

  const [victim] = tx.moveCall({
    target: `${args.builderPackageId}::corpse_gate_bounty::character_id`,
    arguments: [tx.pure.u64(args.victimItemId), tx.pure.string(args.victimTenant)],
  });

  const [payoutBalance] = tx.moveCall({
    target: `${args.builderPackageId}::corpse_gate_bounty::claim_bounty`,
    typeArguments: [args.coinType],
    arguments: [
      tx.object(args.extensionConfigId),
      tx.object(args.bountyId),
      tx.pure.u64(args.killmailId),
      tx.pure.address(args.killer),
      victim,
      tx.pure.u64(args.killTimestampMs),
      tx.pure.bool(args.isShipLoss),
      tx.pure.vector("u8", args.signatureBytes),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  const [payoutCoin] = tx.moveCall({
    target: `0x2::coin::from_balance`,
    typeArguments: [args.coinType],
    arguments: [payoutBalance],
  });

  tx.transferObjects([payoutCoin], tx.pure.address(args.payoutTo));
  return tx;
}
