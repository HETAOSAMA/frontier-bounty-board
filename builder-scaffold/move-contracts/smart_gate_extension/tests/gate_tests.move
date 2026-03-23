#[test_only]
module smart_gate_extension::gate_tests;

use smart_gate_extension::{config, corpse_gate_bounty};
use std::unit_test::assert_eq;
use sui::{balance, clock, coin, test_scenario as ts};

// 说明：本测试文件用于验证赏金合约核心状态机。
// 合约当前接口以 tx sender + Clock 驱动（create/accept/cancel/claim 都从 ctx/clock 取时间与 sender）。

const ESCROW_AMOUNT: u64 = 1_000;
const KILLMAIL_ID: u64 = 42;

/// One-time witness for test coin minting.
public struct GATE_TESTS has drop {}

fun creator(): address {
    @0xCAFE
}

fun hunter(): address {
    @0xBEEF
}

fun hunter_b(): address {
    @0xABCD
}

fun target(): corpse_gate_bounty::CharacterId {
    corpse_gate_bounty::character_id(900000001, b"dev".to_string())
}

fun other_target(): corpse_gate_bounty::CharacterId {
    corpse_gate_bounty::character_id(900000002, b"dev".to_string())
}

/// 用于本地 Move 单测的“可信 attestor 地址”。
/// 注意：只有当测试需要走到签名验证分支时，才需要配套提供与之匹配的 signature。
fun trusted_attestor(): address {
    @0xa0ccc8bcc83f6c628340134f8546a21e0618fd1aaa02432bba454c4a2c2233da
}

/// 与 `trusted_attestor()` 配套的 Ed25519 personal message signature。
/// 签名内容为 ClaimAttestationPayload 的 BCS bytes，并带有 Sui intent 前缀（0x030000）。
///
/// 固定输入（与 debug_print_claim_inputs 输出一致）：
/// - bounty_id = 0x11c79dd6...fbb
/// - killmail_id = 42
/// - killer = 0x...beef
/// - victim = CharacterId{ item_id=900000001, tenant="dev" }
/// - kill_timestamp = 1
/// - is_ship_loss = true
const VALID_CLAIM_SIGNATURE: vector<u8> =
    x"00b5142420a4a4fefa90138b0dca8fcf9a1c2269c98be3570e5c6127bf70024dd6e1e67ba201a2b9b4697a752ebb704ed4256ca6af5f1dfdf7d9be739e2c7e880aea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";

fun init_claim_config(ctx: &mut TxContext): (config::ExtensionConfig, config::AdminCap) {
    let (mut extension_config, admin_cap) = config::new_for_testing(ctx);
    corpse_gate_bounty::set_bounty_config(&mut extension_config, &admin_cap, trusted_attestor());
    (extension_config, admin_cap)
}

fun create_test_currency(
    ctx: &mut TxContext,
): (coin::TreasuryCap<GATE_TESTS>, coin::CoinMetadata<GATE_TESTS>) {
    coin::create_currency<GATE_TESTS>(
        GATE_TESTS {},
        9,
        b"TST",
        b"Test Coin",
        b"Test coin for bounty escrow",
        option::none(),
        ctx,
    )
}

fun mint_escrow_balance(
    ctx: &mut TxContext,
    treasury_cap: &mut coin::TreasuryCap<GATE_TESTS>,
): sui::balance::Balance<GATE_TESTS> {
    let escrow_coin = coin::mint<GATE_TESTS>(treasury_cap, ESCROW_AMOUNT, ctx);
    coin::into_balance(escrow_coin)
}

/// 创建 bounty（共享对象），返回 bounty_id。
fun create_bounty_shared(ts_ref: &mut ts::Scenario, expires_at: u64): ID {
    let (mut treasury_cap, metadata) = create_test_currency(ts::ctx(ts_ref));
    let escrow_balance = mint_escrow_balance(ts::ctx(ts_ref), &mut treasury_cap);
    let clock = clock::create_for_testing(ts::ctx(ts_ref));
    let bounty_id = corpse_gate_bounty::create_bounty<GATE_TESTS>(
        target(),
        expires_at,
        escrow_balance,
        &clock,
        ts::ctx(ts_ref),
    );
    clock::destroy_for_testing(clock);
    // 清理币种元数据与 treasury cap，避免测试泄露资源。
    transfer::public_transfer(metadata, creator());
    transfer::public_transfer(treasury_cap, creator());
    bounty_id
}

#[test]
fun test_set_bounty_config_stores_trusted_attestor() {
    let mut ts = ts::begin(creator());

    ts::next_tx(&mut ts, creator());
    {
        let (extension_config, admin_cap) = init_claim_config(ts::ctx(&mut ts));
        assert_eq!(corpse_gate_bounty::trusted_attestor(&extension_config), trusted_attestor());
        config::share_for_testing(extension_config);
        transfer::public_transfer(admin_cap, creator());
    };

    ts::end(ts);
}

#[test]
fun test_cancel_before_accept_refunds_full_escrow() {
    let mut ts = ts::begin(creator());

    // tx1: creator creates bounty
    ts::next_tx(&mut ts, creator());
    let bounty_id = create_bounty_shared(&mut ts, 0);

    // tx2: creator cancels bounty (no hunters accepted)
    ts::next_tx(&mut ts, creator());
    {
        // 使用 tx1 生成并转入 creator() 的 TreasuryCap/Metadata 进行 burn，避免 supply 不足。
        let mut treasury_cap = ts::take_from_sender<coin::TreasuryCap<GATE_TESTS>>(&mut ts);
        let metadata = ts::take_from_sender<coin::CoinMetadata<GATE_TESTS>>(&mut ts);
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        // cancel returns full escrow
        let refund = corpse_gate_bounty::cancel_bounty(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        let refund_coin = coin::from_balance(refund, ts::ctx(&mut ts));
        let burned_amount = coin::burn(&mut treasury_cap, refund_coin);
        assert_eq!(burned_amount, ESCROW_AMOUNT);
        assert_eq!(corpse_gate_bounty::bounty_escrow_balance(&bounty), 0);

        corpse_gate_bounty::destroy_empty_bounty(bounty);
        ts::return_to_sender(&mut ts, metadata);
        ts::return_to_sender(&mut ts, treasury_cap);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = corpse_gate_bounty::ECancelAfterAccept)]
fun test_cancel_after_accept_aborts_with_dedicated_error() {
    let mut ts = ts::begin(creator());

    // tx1: creator creates bounty
    ts::next_tx(&mut ts, creator());
    let bounty_id = create_bounty_shared(&mut ts, 0);

    // tx2: hunter accepts
    ts::next_tx(&mut ts, hunter());
    {
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        corpse_gate_bounty::accept_bounty<GATE_TESTS>(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        ts::return_shared(bounty);
    };

    // tx3: creator tries to cancel (should abort)
    ts::next_tx(&mut ts, creator());
    {
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let refund = corpse_gate_bounty::cancel_bounty(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        balance::destroy_zero(refund);
        ts::return_shared(bounty);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = corpse_gate_bounty::EDuplicateHunterAccept)]
fun test_accept_bounty_duplicate_hunter_aborts_with_dedicated_error() {
    let mut ts = ts::begin(creator());

    // tx1: creator creates bounty
    ts::next_tx(&mut ts, creator());
    let bounty_id = create_bounty_shared(&mut ts, 0);

    // tx2: hunter accepts
    ts::next_tx(&mut ts, hunter());
    {
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        corpse_gate_bounty::accept_bounty<GATE_TESTS>(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        ts::return_shared(bounty);
    };

    // tx3: hunter accepts again (should abort)
    ts::next_tx(&mut ts, hunter());
    {
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        corpse_gate_bounty::accept_bounty<GATE_TESTS>(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        ts::return_shared(bounty);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = corpse_gate_bounty::EInvalidLossType)]
fun test_claim_rejects_structure_killmail() {
    let mut ts = ts::begin(creator());

    // tx1: creator creates bounty + config
    ts::next_tx(&mut ts, creator());
    let bounty_id = create_bounty_shared(&mut ts, 0);
    let (extension_config, admin_cap) = init_claim_config(ts::ctx(&mut ts));
    config::share_for_testing(extension_config);
    transfer::public_transfer(admin_cap, creator());

    // tx2: hunter accepts
    ts::next_tx(&mut ts, hunter());
    {
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        corpse_gate_bounty::accept_bounty<GATE_TESTS>(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        ts::return_shared(bounty);
    };

    // tx3: hunter claims with is_ship_loss=false -> must abort EInvalidLossType (before signature verification)
    ts::next_tx(&mut ts, hunter());
    {
        let extension_config = ts::take_shared<config::ExtensionConfig>(&ts);
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let kill_timestamp = corpse_gate_bounty::bounty_created_at(&bounty) + 1;
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let payout = corpse_gate_bounty::claim_bounty<GATE_TESTS>(
            &extension_config,
            &mut bounty,
            KILLMAIL_ID,
            hunter(),
            target(),
            kill_timestamp,
            false,
            x"00", // signature not reached
            &clock,
            ts::ctx(&mut ts),
        );
        clock::destroy_for_testing(clock);
        balance::destroy_zero(payout);
        ts::return_shared(bounty);
        ts::return_shared(extension_config);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = corpse_gate_bounty::EInvalidKillTimestamp)]
fun test_claim_rejects_kill_timestamp_not_after_created_at() {
    let mut ts = ts::begin(creator());

    // tx1: creator creates bounty + config
    ts::next_tx(&mut ts, creator());
    let bounty_id = create_bounty_shared(&mut ts, 0);
    let (extension_config, admin_cap) = init_claim_config(ts::ctx(&mut ts));
    config::share_for_testing(extension_config);
    transfer::public_transfer(admin_cap, creator());

    // tx2: hunter accepts
    ts::next_tx(&mut ts, hunter());
    {
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        corpse_gate_bounty::accept_bounty<GATE_TESTS>(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        ts::return_shared(bounty);
    };

    // tx3: hunter claims with kill_timestamp == created_at -> must abort
    ts::next_tx(&mut ts, hunter());
    {
        let extension_config = ts::take_shared<config::ExtensionConfig>(&ts);
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let created_at = corpse_gate_bounty::bounty_created_at(&bounty);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let payout = corpse_gate_bounty::claim_bounty<GATE_TESTS>(
            &extension_config,
            &mut bounty,
            KILLMAIL_ID,
            hunter(),
            target(),
            created_at,
            true,
            x"00", // signature not reached
            &clock,
            ts::ctx(&mut ts),
        );
        clock::destroy_for_testing(clock);
        balance::destroy_zero(payout);
        ts::return_shared(bounty);
        ts::return_shared(extension_config);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = corpse_gate_bounty::EInvalidClaimant)]
fun test_claim_rejects_claimant_differs_from_killer() {
    let mut ts = ts::begin(creator());

    // tx1: creator creates bounty + config
    ts::next_tx(&mut ts, creator());
    let bounty_id = create_bounty_shared(&mut ts, 0);
    let (extension_config, admin_cap) = init_claim_config(ts::ctx(&mut ts));
    config::share_for_testing(extension_config);
    transfer::public_transfer(admin_cap, creator());

    // tx2: hunter accepts
    ts::next_tx(&mut ts, hunter());
    {
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        corpse_gate_bounty::accept_bounty<GATE_TESTS>(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        ts::return_shared(bounty);
    };

    // tx3: hunter (tx sender) tries to claim but sets killer=hunter_b -> must abort EInvalidClaimant
    ts::next_tx(&mut ts, hunter());
    {
        let extension_config = ts::take_shared<config::ExtensionConfig>(&ts);
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let kill_timestamp = corpse_gate_bounty::bounty_created_at(&bounty) + 1;
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let payout = corpse_gate_bounty::claim_bounty<GATE_TESTS>(
            &extension_config,
            &mut bounty,
            KILLMAIL_ID,
            hunter_b(),
            target(),
            kill_timestamp,
            true,
            x"00", // signature not reached
            &clock,
            ts::ctx(&mut ts),
        );
        clock::destroy_for_testing(clock);
        balance::destroy_zero(payout);
        ts::return_shared(bounty);
        ts::return_shared(extension_config);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = corpse_gate_bounty::EKillerNotAccepted)]
fun test_claim_rejects_killer_not_in_accepted_set() {
    let mut ts = ts::begin(creator());

    // tx1: creator creates bounty + config
    ts::next_tx(&mut ts, creator());
    let bounty_id = create_bounty_shared(&mut ts, 0);
    let (extension_config, admin_cap) = init_claim_config(ts::ctx(&mut ts));
    config::share_for_testing(extension_config);
    transfer::public_transfer(admin_cap, creator());

    // tx2: hunter accepts (not hunter_b)
    ts::next_tx(&mut ts, hunter());
    {
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        corpse_gate_bounty::accept_bounty<GATE_TESTS>(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        ts::return_shared(bounty);
    };

    // tx3: hunter_b tries to claim -> must abort EKillerNotAccepted
    ts::next_tx(&mut ts, hunter_b());
    {
        let extension_config = ts::take_shared<config::ExtensionConfig>(&ts);
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let kill_timestamp = corpse_gate_bounty::bounty_created_at(&bounty) + 1;
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let payout = corpse_gate_bounty::claim_bounty<GATE_TESTS>(
            &extension_config,
            &mut bounty,
            KILLMAIL_ID,
            hunter_b(),
            target(),
            kill_timestamp,
            true,
            x"00", // signature not reached
            &clock,
            ts::ctx(&mut ts),
        );
        clock::destroy_for_testing(clock);
        balance::destroy_zero(payout);
        ts::return_shared(bounty);
        ts::return_shared(extension_config);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = corpse_gate_bounty::EInvalidClaimTarget)]
fun test_claim_rejects_victim_mismatch() {
    let mut ts = ts::begin(creator());

    // tx1: creator creates bounty + config
    ts::next_tx(&mut ts, creator());
    let bounty_id = create_bounty_shared(&mut ts, 0);
    let (extension_config, admin_cap) = init_claim_config(ts::ctx(&mut ts));
    config::share_for_testing(extension_config);
    transfer::public_transfer(admin_cap, creator());

    // tx2: hunter accepts
    ts::next_tx(&mut ts, hunter());
    {
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        corpse_gate_bounty::accept_bounty<GATE_TESTS>(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        ts::return_shared(bounty);
    };

    // tx3: hunter claims but victim != target -> must abort
    ts::next_tx(&mut ts, hunter());
    {
        let extension_config = ts::take_shared<config::ExtensionConfig>(&ts);
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let kill_timestamp = corpse_gate_bounty::bounty_created_at(&bounty) + 1;
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let payout = corpse_gate_bounty::claim_bounty<GATE_TESTS>(
            &extension_config,
            &mut bounty,
            KILLMAIL_ID,
            hunter(),
            other_target(),
            kill_timestamp,
            true,
            x"00", // signature not reached
            &clock,
            ts::ctx(&mut ts),
        );
        clock::destroy_for_testing(clock);
        balance::destroy_zero(payout);
        ts::return_shared(bounty);
        ts::return_shared(extension_config);
    };

    ts::end(ts);
}

#[test]
fun test_claim_with_valid_signature_transfers_full_escrow_once() {
    let mut ts = ts::begin(creator());

    ts::next_tx(&mut ts, creator());
    let bounty_id = create_bounty_shared(&mut ts, 0);
    let (extension_config, admin_cap) = init_claim_config(ts::ctx(&mut ts));
    config::share_for_testing(extension_config);
    transfer::public_transfer(admin_cap, creator());

    ts::next_tx(&mut ts, hunter());
    {
        // accept
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        corpse_gate_bounty::accept_bounty<GATE_TESTS>(&mut bounty, &clock, ts::ctx(&mut ts));
        clock::destroy_for_testing(clock);
        ts::return_shared(bounty);
    };

    ts::next_tx(&mut ts, hunter());
    {
        // claim
        let extension_config = ts::take_shared<config::ExtensionConfig>(&ts);
        let mut bounty = ts::take_shared_by_id<corpse_gate_bounty::Bounty<GATE_TESTS>>(
            &ts,
            bounty_id,
        );
        let kill_timestamp = corpse_gate_bounty::bounty_created_at(&bounty) + 1;
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let payout = corpse_gate_bounty::claim_bounty<GATE_TESTS>(
            &extension_config,
            &mut bounty,
            KILLMAIL_ID,
            hunter(),
            target(),
            kill_timestamp,
            true,
            VALID_CLAIM_SIGNATURE,
            &clock,
            ts::ctx(&mut ts),
        );
        clock::destroy_for_testing(clock);

        assert_eq!(corpse_gate_bounty::bounty_escrow_balance(&bounty), 0);
        assert!(corpse_gate_bounty::is_bounty_claimed(&bounty), 0);

        let payout_coin = coin::from_balance(payout, ts::ctx(&mut ts));
        assert_eq!(coin::value(&payout_coin), ESCROW_AMOUNT);

        transfer::public_transfer(payout_coin, hunter());
        ts::return_shared(bounty);
        ts::return_shared(extension_config);
    };

    ts::end(ts);
}
