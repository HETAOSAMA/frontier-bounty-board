/// 赏金模块（Bounty Board）
///
/// 本文件是一个“最小可用”的赏金合约实现：
/// - 任意地址可发布赏金（托管 SUI）
/// - 任意地址可接取赏金（允许多人接取，拒绝重复接取）
/// - **无人接取时** 发布者可取消赏金并取回资金
/// - 只有接取过赏金且完成最终击杀的猎人可领取赏金
/// - 领取时校验 kill_timestamp 必须在赏金有效期内：
///   created_at < kill_timestamp <= expires_at（expires_at=0 表示永久）
///
/// 重要说明：
/// - 这里的“目标”使用 **目标角色 ID（TenantItemId）** 来表示（更贴近游戏语义，不要求目标钱包参与）。
/// - 这里的 kill_timestamp 约定为 **毫秒时间戳**（与 clock::timestamp_ms 一致）。
///   attestor 负责把链上的 killmail 秒级时间转换为毫秒并签名。
module smart_gate_extension::corpse_gate_bounty;

use smart_gate_extension::config::{Self, AdminCap, ExtensionConfig};
use std::{bcs, string::String};
use sui::{balance::{Self, Balance}, clock::Clock, event};
use world::sig_verify;

public struct CharacterId has copy, drop, store {
    item_id: u64,
    tenant: String,
}

public fun character_id(item_id: u64, tenant: String): CharacterId {
    CharacterId { item_id, tenant }
}

// === Errors ===
#[error(code = 0)]
const EInvalidLifecycleTransition: vector<u8> = b"Invalid bounty lifecycle transition";
#[error(code = 1)]
const EEscrowAmountExceeded: vector<u8> = b"Claim amount exceeds escrow balance";
#[error(code = 2)]
const ECancelAfterAccept: vector<u8> = b"Cannot cancel bounty after accept";
#[error(code = 3)]
const EInvalidHunterAddress: vector<u8> = b"Hunter address is zero";
#[error(code = 4)]
const EDuplicateHunterAccept: vector<u8> = b"Hunter already accepted this bounty";
#[error(code = 5)]
const EInvalidClaimSignature: vector<u8> = b"Invalid claim attestation signature";
#[error(code = 6)]
const EKillerNotAccepted: vector<u8> = b"Killer is not in accepted hunters";
#[error(code = 7)]
const EInvalidClaimTarget: vector<u8> = b"Claim victim does not match bounty target";
#[error(code = 8)]
const EInvalidKillTimestamp: vector<u8> = b"Kill timestamp must be after bounty creation";
#[error(code = 9)]
const EInvalidClaimant: vector<u8> = b"Claimant must be killer";
#[error(code = 10)]
const EInvalidAttestorAddress: vector<u8> = b"Trusted attestor address is zero";
#[error(code = 14)]
const EInvalidLossType: vector<u8> = b"Killmail loss type must be SHIP";
#[error(code = 11)]
const EInvalidExpiry: vector<u8> = b"Expiry must be 0 (never) or greater than created_at";
#[error(code = 12)]
const EBountyExpired: vector<u8> = b"Bounty is expired";
#[error(code = 13)]
const ECancelNotCreator: vector<u8> = b"Only the bounty creator can cancel";

// === Bounty Model ===
public enum BountyLifecycle has copy, drop, store {
    Open,
    Accepted,
    Cancelled,
    Claimed,
}

public struct Bounty<phantom CoinType> has key, store {
    id: UID,
    creator: address,
    target: CharacterId,
    lifecycle: BountyLifecycle,
    // 创建时间只在创建时写入，后续状态流转不可修改。
    created_at: u64,
    // 过期时间戳（毫秒）。=0 表示永久。
    expires_at: u64,
    escrow_balance: Balance<CoinType>,
    // 多猎人接单注册表：允许不同地址追加，拒绝同地址重复接单。
    accepted_hunters: vector<address>,
}

public struct BountyCreatedEvent has copy, drop {
    bounty_id: ID,
    creator: address,
    target: CharacterId,
    created_at: u64,
    expires_at: u64,
    escrow_amount: u64,
}

public struct BountyAcceptedEvent has copy, drop {
    bounty_id: ID,
    hunter: address,
    accepted_at: u64,
}

public struct BountyCancelledEvent has copy, drop {
    bounty_id: ID,
    cancelled_by: address,
    cancelled_at: u64,
    refunded_amount: u64,
}

public struct BountyClaimedEvent has copy, drop {
    bounty_id: ID,
    hunter: address,
    killmail_id: u64,
    claimed_at: u64,
    claimed_amount: u64,
}

public struct ClaimAttestationPayload has copy, drop, store {
    bounty_id: ID,
    killmail_id: u64,
    killer: address,
    victim: CharacterId,
    kill_timestamp: u64,
    // 是否为“船损失”(SHIP)。
    // 我们在链上不直接读取 killmail（成本高且耦合 world），而是让 attestor
    // 把 loss_type 映射成 bool 放进 payload，并由链上验签后再强约束。
    is_ship_loss: bool,
}

/// Stored as a dynamic field value under `ExtensionConfig`.
public struct BountyConfig has drop, store {
    trusted_attestor: address,
}

/// Dynamic-field key for `BountyConfig`.
public struct BountyConfigKey has copy, drop, store {}

// === Bounty Core Functions ===
/// 创建悬赏并锁定托管余额，初始化为 Open 状态，随后共享对象。
public fun create_bounty<CoinType>(
    target: CharacterId,
    // 过期时间（毫秒）。=0 表示永久。
    expires_at: u64,
    escrow_balance: Balance<CoinType>,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    let creator = tx_context::sender(ctx);
    let created_at = clock.timestamp_ms();
    assert!(expires_at == 0 || expires_at > created_at, EInvalidExpiry);

    let bounty = Bounty {
        id: object::new(ctx),
        creator,
        target,
        lifecycle: BountyLifecycle::Open,
        created_at,
        expires_at,
        escrow_balance,
        accepted_hunters: vector[],
    };

    let bounty_id = object::id(&bounty);

    event::emit(BountyCreatedEvent {
        bounty_id,
        creator,
        target,
        created_at,
        expires_at,
        escrow_amount: balance::value(&bounty.escrow_balance),
    });

    transfer::share_object(bounty);

    bounty_id
}

/// 记录猎人接单并更新生命周期到 Accepted。
public fun accept_bounty<CoinType>(bounty: &mut Bounty<CoinType>, clock: &Clock, ctx: &TxContext) {
    let hunter = tx_context::sender(ctx);
    let accepted_at = clock.timestamp_ms();

    assert!(
        bounty.lifecycle == BountyLifecycle::Open || bounty.lifecycle == BountyLifecycle::Accepted,
        EInvalidLifecycleTransition,
    );
    // 过期后不允许再接取（expires_at=0 表示永久）。
    if (bounty.expires_at != 0 && accepted_at > bounty.expires_at) {
        abort EBountyExpired
    };
    // 拒绝零地址猎人，避免无效接单记录污染 accepted_hunters。
    assert!(hunter != @0x0, EInvalidHunterAddress);
    // 同一猎人只能接单一次，重复接单走专用错误码。
    assert!(!contains_hunter(&bounty.accepted_hunters, hunter), EDuplicateHunterAccept);

    bounty.lifecycle = BountyLifecycle::Accepted;
    vector::push_back(&mut bounty.accepted_hunters, hunter);

    event::emit(BountyAcceptedEvent {
        bounty_id: object::id(bounty),
        hunter,
        accepted_at,
    });
}

fun contains_hunter(accepted_hunters: &vector<address>, hunter: address): bool {
    let mut idx = 0;
    let total = vector::length(accepted_hunters);
    while (idx < total) {
        if (*vector::borrow(accepted_hunters, idx) == hunter) {
            return true
        };
        idx = idx + 1;
    };
    false
}

/// 取消悬赏并返回全部托管余额。
public fun cancel_bounty<CoinType>(
    bounty: &mut Bounty<CoinType>,
    clock: &Clock,
    ctx: &TxContext,
): Balance<CoinType> {
    let cancelled_by = tx_context::sender(ctx);
    let cancelled_at = clock.timestamp_ms();

    // 仅允许 Open/Accepted 状态进入取消路径，其它状态统一走生命周期错误。
    assert!(
        bounty.lifecycle == BountyLifecycle::Open || bounty.lifecycle == BountyLifecycle::Accepted,
        EInvalidLifecycleTransition,
    );
    // 仅发布者可取消（用 tx sender 绑定，避免第三方构造交易盗取 refund）。
    assert!(cancelled_by == bounty.creator, ECancelNotCreator);
    // 只要发生过接单（含生命周期已变为 Accepted），即走专用错误路径拒绝取消。
    if (
        bounty.lifecycle == BountyLifecycle::Accepted || vector::length(&bounty.accepted_hunters) > 0
    ) {
        abort ECancelAfterAccept
    };

    bounty.lifecycle = BountyLifecycle::Cancelled;
    let refund_amount = balance::value(&bounty.escrow_balance);
    let refund = balance::split(&mut bounty.escrow_balance, refund_amount);

    event::emit(BountyCancelledEvent {
        bounty_id: object::id(bounty),
        cancelled_by,
        cancelled_at,
        refunded_amount: refund_amount,
    });

    refund
}

/// 领取悬赏时从托管余额切分奖励并发出事件。
public fun claim_bounty<CoinType>(
    extension_config: &ExtensionConfig,
    bounty: &mut Bounty<CoinType>,
    killmail_id: u64,
    killer: address,
    victim: CharacterId,
    kill_timestamp: u64,
    is_ship_loss: bool,
    claim_signature: vector<u8>,
    clock: &Clock,
    ctx: &TxContext,
): Balance<CoinType> {
    let hunter = tx_context::sender(ctx);
    let claimed_at = clock.timestamp_ms();

    // 只允许处于 Accepted 的悬赏进入领取路径，防止重复领取与非法状态领取。
    assert!(bounty.lifecycle == BountyLifecycle::Accepted, EInvalidLifecycleTransition);
    // 领取人必须与击杀者一致，避免将有效证明盗用给第三方地址。
    assert!(hunter == killer, EInvalidClaimant);
    // 必须先接单才能领取，确保 payout 只能由被授权猎人拿走。
    assert!(contains_hunter(&bounty.accepted_hunters, killer), EKillerNotAccepted);
    // 受害者必须命中悬赏目标（按 tenant + item_id 判断）。
    assert!(
        victim.item_id == bounty.target.item_id && victim.tenant == bounty.target.tenant,
        EInvalidClaimTarget,
    );
    // 击杀时间必须严格晚于悬赏创建时间。
    assert!(kill_timestamp > bounty.created_at, EInvalidKillTimestamp);
    // 击杀必须发生在悬赏有效期内：expires_at=0 表示永久。
    if (bounty.expires_at != 0 && kill_timestamp > bounty.expires_at) {
        abort EInvalidKillTimestamp
    };

    // 必须是“船”的击杀邮件，建筑物击杀不允许领取。
    assert!(is_ship_loss, EInvalidLossType);

    let bounty_cfg = config::borrow_rule<BountyConfigKey, BountyConfig>(
        extension_config,
        BountyConfigKey {},
    );
    let bounty_id = object::id(bounty);
    let claim_payload = bcs::to_bytes(
        &ClaimAttestationPayload {
            bounty_id,
            killmail_id,
            killer,
            victim,
            kill_timestamp,
            is_ship_loss,
        },
    );
    // 校验可信 attestor 对固定 payload 的签名，拒绝伪造 killmail 证明。
    assert!(
        sig_verify::verify_signature(claim_payload, claim_signature, bounty_cfg.trusted_attestor),
        EInvalidClaimSignature,
    );

    let remaining = balance::value(&bounty.escrow_balance);
    assert!(remaining > 0, EEscrowAmountExceeded);

    // 领取时一次性提走全部托管余额，状态立即终结为 Claimed。
    let payout = balance::split(&mut bounty.escrow_balance, remaining);
    bounty.lifecycle = BountyLifecycle::Claimed;

    event::emit(BountyClaimedEvent {
        bounty_id: object::id(bounty),
        hunter,
        killmail_id,
        claimed_at,
        claimed_amount: remaining,
    });

    payout
}

/// 销毁空悬赏对象，避免链上遗留无用对象。
public fun destroy_empty_bounty<CoinType>(bounty: Bounty<CoinType>) {
    let Bounty {
        id,
        creator: _,
        target: _,
        lifecycle: _,
        created_at: _,
        expires_at: _,
        escrow_balance,
        accepted_hunters: _,
    } = bounty;
    balance::destroy_zero(escrow_balance);
    object::delete(id);
}

// === View Functions ===
public fun bounty_id<CoinType>(bounty: &Bounty<CoinType>): ID {
    object::id(bounty)
}

public fun bounty_creator<CoinType>(bounty: &Bounty<CoinType>): address {
    bounty.creator
}

public fun bounty_lifecycle<CoinType>(bounty: &Bounty<CoinType>): BountyLifecycle {
    bounty.lifecycle
}

public fun is_bounty_claimed<CoinType>(bounty: &Bounty<CoinType>): bool {
    bounty.lifecycle == BountyLifecycle::Claimed
}

public fun bounty_target<CoinType>(bounty: &Bounty<CoinType>): CharacterId {
    bounty.target
}

public fun bounty_created_at<CoinType>(bounty: &Bounty<CoinType>): u64 {
    bounty.created_at
}

public fun bounty_expires_at<CoinType>(bounty: &Bounty<CoinType>): u64 {
    bounty.expires_at
}

public fun bounty_escrow_balance<CoinType>(bounty: &Bounty<CoinType>): u64 {
    balance::value(&bounty.escrow_balance)
}

public fun accepted_hunters_count<CoinType>(bounty: &Bounty<CoinType>): u64 {
    vector::length(&bounty.accepted_hunters)
}

public fun trusted_attestor(extension_config: &ExtensionConfig): address {
    extension_config.borrow_rule<BountyConfigKey, BountyConfig>(BountyConfigKey {}).trusted_attestor
}

// === Admin Functions ===
public fun set_bounty_config(
    extension_config: &mut ExtensionConfig,
    admin_cap: &AdminCap,
    trusted_attestor: address,
) {
    assert!(trusted_attestor != @0x0, EInvalidAttestorAddress);
    extension_config.set_rule<BountyConfigKey, BountyConfig>(
        admin_cap,
        BountyConfigKey {},
        BountyConfig {
            trusted_attestor,
        },
    );
}
