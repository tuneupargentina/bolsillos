//! Bolsillos ("pockets"): household USDC splitter.
//!
//! Incoming NEP-141 mock-USDC is split atomically across named pockets by
//! basis-point shares. Each pocket has an owner, an allowlisted set of
//! recipients and a daily withdrawal cap. Rule changes go through a
//! propose + timelock path so an agent with a limited key cannot drain funds.
#![allow(clippy::needless_pass_by_value)]

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, PromiseOrValue, Promise,
    env, near, require, serde_json,
};

/// One basis point = 0.01%. Shares across pockets must sum to this.
pub const BPS_DENOMINATOR: u16 = 10_000;
/// Default rule-change timelock: 24 hours, in nanoseconds.
pub const DEFAULT_TIMELOCK_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
/// Gas attached when forwarding FT transfers out of a pocket.
const FT_TRANSFER_GAS: Gas = Gas::from_tgas(15);
/// One yoctoNEAR required by NEP-141 `ft_transfer`.
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// Nanoseconds in one UTC day (for daily-cap bucketing).
const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Pockets,
    Allowlists,
    Allowlist { pocket: String },
}

/// On-chain pocket state (compact Borsh).
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Pocket {
    pub share_bps: u16,
    pub owner: AccountId,
    pub balance: u128,
    /// 0 means unlimited.
    pub daily_cap: u128,
    pub spent_today: u128,
    pub day_bucket: u64,
}

/// JSON view of a pocket (for frontends / agents).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PocketView {
    pub id: String,
    pub share_bps: u16,
    pub owner: AccountId,
    pub balance: U128,
    pub daily_cap: U128,
    pub spent_today: U128,
    pub remaining_today: U128,
    pub allowlist: Vec<AccountId>,
}

/// Input used to create or replace a pocket definition.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PocketInput {
    pub id: String,
    pub share_bps: u16,
    pub owner: AccountId,
    pub daily_cap: U128,
    pub allowlist: Vec<AccountId>,
}

/// Pending rule-change proposal (replaces all pocket definitions after timelock).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct RuleProposal {
    pub proposed_by: AccountId,
    pub proposed_at_ns: u64,
    pub execute_after_ns: u64,
    pub pockets: Vec<PocketInput>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct HouseholdView {
    pub owner: AccountId,
    pub token_id: AccountId,
    pub timelock_ns: u64,
    pub total_received: U128,
    pub pockets: Vec<PocketView>,
    pub pending_proposal: Option<RuleProposal>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    token_id: AccountId,
    /// Configurable so unit tests / demos can use a short delay.
    timelock_ns: u64,
    pockets: IterableMap<String, Pocket>,
    pocket_order: Vec<String>,
    allowlists: IterableMap<String, IterableSet<AccountId>>,
    total_received: u128,
    pending: Option<RuleProposal>,
}

fn validate_pocket_id(id: &str) {
    require!(!id.is_empty(), "pocket id cannot be empty");
    require!(id.len() <= 32, "pocket id longer than 32 chars");
    require!(
        id.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')),
        "pocket id: only A-Z a-z 0-9 - _"
    );
}

fn validate_inputs(inputs: &[PocketInput]) {
    require!(!inputs.is_empty(), "need at least one pocket");
    require!(inputs.len() <= 32, "at most 32 pockets");
    let mut sum: u32 = 0;
    let mut seen = std::collections::BTreeSet::new();
    for p in inputs {
        validate_pocket_id(&p.id);
        require!(seen.insert(p.id.clone()), "duplicate pocket id");
        require!(p.share_bps > 0, "share_bps must be > 0");
        sum += u32::from(p.share_bps);
        require!(!p.allowlist.is_empty(), "allowlist cannot be empty");
    }
    require!(
        sum == u32::from(BPS_DENOMINATOR),
        "share_bps must sum to 10000"
    );
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, token_id: AccountId, timelock_ns: Option<u64>) -> Self {
        Self {
            owner,
            token_id,
            timelock_ns: timelock_ns.unwrap_or(DEFAULT_TIMELOCK_NS),
            pockets: IterableMap::new(StorageKey::Pockets),
            pocket_order: Vec::new(),
            allowlists: IterableMap::new(StorageKey::Allowlists),
            total_received: 0,
            pending: None,
        }
    }

    /// Owner-only bootstrap: replace pocket definitions immediately (no balances yet).
    /// After funds exist, use propose_rule_change + execute_rule_change instead.
    pub fn set_pockets(&mut self, pockets: Vec<PocketInput>) {
        self.assert_owner();
        require!(
            self.total_received == 0,
            "funds already received: use propose_rule_change"
        );
        self.apply_pocket_defs(pockets, true);
    }

    /// Propose a full replacement of pocket definitions. Anyone the owner trusts
    /// (e.g. agent with a function-call key) can propose; execution waits `timelock_ns`.
    pub fn propose_rule_change(&mut self, pockets: Vec<PocketInput>) {
        validate_inputs(&pockets);
        let now = env::block_timestamp();
        let proposal = RuleProposal {
            proposed_by: env::predecessor_account_id(),
            proposed_at_ns: now,
            execute_after_ns: now.saturating_add(self.timelock_ns),
            pockets,
        };
        self.pending = Some(proposal.clone());
        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "bolsillos",
                "version": "1.0.0",
                "event": "propose_rule_change",
                "data": [{
                    "proposed_by": proposal.proposed_by,
                    "execute_after_ns": proposal.execute_after_ns.to_string(),
                }]
            })
        ));
    }

    /// Execute a pending proposal after the timelock. Preserves balances of
    /// pockets that keep the same id; new ids start at 0; removed ids' leftover
    /// balance is moved to the first pocket (documented behaviour).
    pub fn execute_rule_change(&mut self) {
        let proposal = self
            .pending
            .take()
            .unwrap_or_else(|| env::panic_str("no pending proposal"));
        require!(
            env::block_timestamp() >= proposal.execute_after_ns,
            "timelock not elapsed"
        );
        self.apply_pocket_defs(proposal.pockets, false);
        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "bolsillos",
                "version": "1.0.0",
                "event": "execute_rule_change",
                "data": [{}]
            })
        ));
    }

    pub fn cancel_proposal(&mut self) {
        self.assert_owner();
        require!(self.pending.is_some(), "no pending proposal");
        self.pending = None;
    }

    /// Owner can shorten / lengthen the timelock (also useful in tests).
    pub fn set_timelock_ns(&mut self, timelock_ns: u64) {
        self.assert_owner();
        self.timelock_ns = timelock_ns;
    }

    /// Withdraw from a pocket. Caller must be the pocket owner. Recipient must
    /// be allowlisted. Amount must fit the remaining daily cap (if any).
    pub fn withdraw_pocket(
        &mut self,
        pocket_id: String,
        amount: U128,
        recipient: AccountId,
    ) -> Promise {
        let amount = amount.0;
        require!(amount > 0, "amount must be > 0");

        let mut pocket = self
            .pockets
            .get(&pocket_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown pocket"));
        require!(
            env::predecessor_account_id() == pocket.owner,
            "only pocket owner can withdraw"
        );

        let allow = self
            .allowlists
            .get(&pocket_id)
            .unwrap_or_else(|| env::panic_str("missing allowlist"));
        require!(allow.contains(&recipient), "recipient not allowlisted");

        self.refresh_day(&mut pocket);
        if pocket.daily_cap > 0 {
            let remaining = pocket.daily_cap.saturating_sub(pocket.spent_today);
            require!(amount <= remaining, "exceeds daily cap");
        }
        require!(amount <= pocket.balance, "insufficient pocket balance");

        pocket.balance -= amount;
        pocket.spent_today = pocket.spent_today.saturating_add(amount);
        self.pockets.insert(pocket_id.clone(), pocket);

        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "bolsillos",
                "version": "1.0.0",
                "event": "withdraw_pocket",
                "data": [{
                    "pocket_id": pocket_id,
                    "amount": amount.to_string(),
                    "recipient": recipient,
                }]
            })
        ));

        // NEP-141 ft_transfer to the recipient.
        // Args: receiver_id, amount, memo
        let token = self.token_id.clone();
        Promise::new(token).function_call(
            "ft_transfer".to_string(),
            serde_json::to_vec(&serde_json::json!({
                "receiver_id": recipient,
                "amount": U128(amount),
                "memo": format!("bolsillos:{}", pocket_id),
            }))
            .unwrap(),
            ONE_YOCTO,
            FT_TRANSFER_GAS,
        )
    }

    // ---------- views ----------

    pub fn get_household(&self) -> HouseholdView {
        HouseholdView {
            owner: self.owner.clone(),
            token_id: self.token_id.clone(),
            timelock_ns: self.timelock_ns,
            total_received: U128(self.total_received),
            pockets: self.list_pockets(),
            pending_proposal: self.pending.clone(),
        }
    }

    pub fn list_pockets(&self) -> Vec<PocketView> {
        self.pocket_order
            .iter()
            .filter_map(|id| self.view_pocket(id))
            .collect()
    }

    pub fn get_pocket(&self, pocket_id: String) -> Option<PocketView> {
        self.view_pocket(&pocket_id)
    }

    pub fn get_proposal(&self) -> Option<RuleProposal> {
        self.pending.clone()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_token_id(&self) -> AccountId {
        self.token_id.clone()
    }

    pub fn get_timelock_ns(&self) -> u64 {
        self.timelock_ns
    }

    // ---------- internals ----------

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only owner"
        );
    }

    fn refresh_day(&self, pocket: &mut Pocket) {
        let today = env::block_timestamp() / DAY_NS;
        if pocket.day_bucket != today {
            pocket.day_bucket = today;
            pocket.spent_today = 0;
        }
    }

    fn view_pocket(&self, id: &str) -> Option<PocketView> {
        let mut p = self.pockets.get(id)?.clone();
        self.refresh_day(&mut p);
        let remaining = if p.daily_cap == 0 {
            U128(u128::MAX)
        } else {
            U128(p.daily_cap.saturating_sub(p.spent_today))
        };
        let allowlist = self
            .allowlists
            .get(id)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();
        Some(PocketView {
            id: id.to_string(),
            share_bps: p.share_bps,
            owner: p.owner,
            balance: U128(p.balance),
            daily_cap: U128(p.daily_cap),
            spent_today: U128(p.spent_today),
            remaining_today: remaining,
            allowlist,
        })
    }

    fn apply_pocket_defs(&mut self, inputs: Vec<PocketInput>, wipe_balances: bool) {
        validate_inputs(&inputs);

        // Snapshot old balances by id.
        let mut old_balances: std::collections::BTreeMap<String, u128> =
            std::collections::BTreeMap::new();
        if !wipe_balances {
            for id in &self.pocket_order {
                if let Some(p) = self.pockets.get(id) {
                    old_balances.insert(id.clone(), p.balance);
                }
            }
        }

        // Clear existing.
        let old_ids: Vec<String> = self.pocket_order.clone();
        for id in &old_ids {
            self.pockets.remove(id);
            if let Some(mut set) = self.allowlists.remove(id) {
                set.clear();
            }
        }
        self.pocket_order.clear();

        let mut leftover: u128 = 0;
        if !wipe_balances {
            let kept: std::collections::BTreeSet<&str> =
                inputs.iter().map(|p| p.id.as_str()).collect();
            for (id, bal) in &old_balances {
                if !kept.contains(id.as_str()) {
                    leftover = leftover.saturating_add(*bal);
                }
            }
        }

        for (i, input) in inputs.into_iter().enumerate() {
            let mut balance = if wipe_balances {
                0
            } else {
                old_balances.get(&input.id).copied().unwrap_or(0)
            };
            if i == 0 {
                balance = balance.saturating_add(leftover);
                leftover = 0;
            }
            let pocket = Pocket {
                share_bps: input.share_bps,
                owner: input.owner,
                balance,
                daily_cap: input.daily_cap.0,
                spent_today: 0,
                day_bucket: env::block_timestamp() / DAY_NS,
            };
            let mut set = IterableSet::new(StorageKey::Allowlist {
                pocket: input.id.clone(),
            });
            for a in input.allowlist {
                set.insert(a);
            }
            self.allowlists.insert(input.id.clone(), set);
            self.pockets.insert(input.id.clone(), pocket);
            self.pocket_order.push(input.id);
        }
    }

    /// Split `amount` across pockets by share_bps. Dust (remainder from integer
    /// division) goes to the last pocket so the sum of balances increases by
    /// exactly `amount`.
    fn split_incoming(&mut self, amount: u128) {
        require!(!self.pocket_order.is_empty(), "pockets not configured");
        require!(amount > 0, "zero amount");

        let mut distributed: u128 = 0;
        let last = self.pocket_order.len() - 1;
        let order = self.pocket_order.clone();
        for (i, id) in order.iter().enumerate() {
            let mut pocket = self
                .pockets
                .get(id)
                .cloned()
                .unwrap_or_else(|| env::panic_str("missing pocket"));
            let share = if i == last {
                amount.saturating_sub(distributed)
            } else {
                amount * u128::from(pocket.share_bps) / u128::from(BPS_DENOMINATOR)
            };
            pocket.balance = pocket.balance.saturating_add(share);
            distributed = distributed.saturating_add(share);
            self.pockets.insert(id.clone(), pocket);
        }
        self.total_received = self.total_received.saturating_add(amount);

        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "bolsillos",
                "version": "1.0.0",
                "event": "split",
                "data": [{
                    "amount": amount.to_string(),
                    "total_received": self.total_received.to_string(),
                }]
            })
        ));
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Called by the mock-USDC contract via `ft_transfer_call`. Only the
    /// configured `token_id` is accepted. The whole amount is split; we return
    /// `U128(0)` so nothing is refunded to the sender.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.token_id,
            "only the household token may call ft_on_transfer"
        );
        let _ = (sender_id, msg);
        self.split_incoming(amount.0);
        PromiseOrValue::Value(U128(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, AccountId};

    fn aid(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn household() -> AccountId { aid("household.test.near") }
    fn owner() -> AccountId { aid("owner.test.near") }
    fn mom() -> AccountId { aid("mom.test.near") }
    fn token() -> AccountId { aid("musdc.test.near") }
    fn agent() -> AccountId { aid("agent.test.near") }
    fn landlord() -> AccountId { aid("landlord.test.near") }
    fn mom_dest() -> AccountId { aid("mom-dest.test.near") }
    fn taxman() -> AccountId { aid("afip.test.near") }
    fn payer() -> AccountId { aid("payer.test.near") }
    fn stranger() -> AccountId { aid("stranger.test.near") }

    fn context(predecessor: AccountId, timestamp_ns: u64) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(household());
        b.predecessor_account_id(predecessor);
        b.block_timestamp(timestamp_ns);
        b.attached_deposit(NearToken::from_yoctonear(0));
        b
    }

    fn sample_pockets() -> Vec<PocketInput> {
        // 40/25/15/10/10 = spend / rent / mom / taxes / savings
        vec![
            PocketInput {
                id: "spend".into(),
                share_bps: 4000,
                owner: owner(),
                daily_cap: U128(50_000_000),
                allowlist: vec![owner()],
            },
            PocketInput {
                id: "rent".into(),
                share_bps: 2500,
                owner: owner(),
                daily_cap: U128(0),
                allowlist: vec![landlord()],
            },
            PocketInput {
                id: "mom".into(),
                share_bps: 1500,
                owner: mom(),
                daily_cap: U128(20_000_000),
                allowlist: vec![mom(), mom_dest()],
            },
            PocketInput {
                id: "taxes".into(),
                share_bps: 1000,
                owner: owner(),
                daily_cap: U128(0),
                allowlist: vec![taxman()],
            },
            PocketInput {
                id: "savings".into(),
                share_bps: 1000,
                owner: owner(),
                daily_cap: U128(1_000_000),
                allowlist: vec![owner()],
            },
        ]
    }

    fn setup() -> Contract {
        testing_env!(context(owner(), 1_000_000_000_000).build());
        let mut c = Contract::new(owner(), token(), Some(1_000_000_000));
        testing_env!(context(owner(), 1_000_000_000_000).build());
        c.set_pockets(sample_pockets());
        c
    }

    #[test]
    fn init_and_list_pockets() {
        let c = setup();
        let h = c.get_household();
        assert_eq!(h.owner, owner());
        assert_eq!(h.pockets.len(), 5);
        assert_eq!(h.pockets[0].id, "spend");
        assert_eq!(h.pockets[0].share_bps, 4000);
        assert_eq!(h.pockets[2].owner, mom());
    }

    #[test]
    #[should_panic(expected = "share_bps must sum to 10000")]
    fn rejects_bad_share_sum() {
        testing_env!(context(owner(), 0).build());
        let mut c = Contract::new(owner(), token(), None);
        let mut p = sample_pockets();
        p[0].share_bps = 3999;
        c.set_pockets(p);
    }

    #[test]
    #[should_panic(expected = "only owner")]
    fn non_owner_cannot_set_pockets() {
        testing_env!(context(owner(), 0).build());
        let mut c = Contract::new(owner(), token(), None);
        testing_env!(context(mom(), 0).build());
        c.set_pockets(sample_pockets());
    }

    #[test]
    fn split_200_usdc() {
        let mut c = setup();
        // Simulate ft_on_transfer from the token contract.
        testing_env!(context(token(), 2_000_000_000_000).build());
        let amount = 200_000_000u128; // 200 USDC, 6 decimals
        let _ = c.ft_on_transfer(payer(), U128(amount), String::new());
        let pockets = c.list_pockets();
        assert_eq!(pockets[0].balance.0, 80_000_000); // 40%
        assert_eq!(pockets[1].balance.0, 50_000_000); // 25%
        assert_eq!(pockets[2].balance.0, 30_000_000); // 15%
        assert_eq!(pockets[3].balance.0, 20_000_000); // 10%
        assert_eq!(pockets[4].balance.0, 20_000_000); // 10%
        assert_eq!(c.get_household().total_received.0, amount);
    }

    #[test]
    fn dust_goes_to_last_pocket() {
        let mut c = setup();
        testing_env!(context(token(), 2_000_000_000_000).build());
        // 1 unit cannot be split evenly across 40/25/15/10/10 — remainder to last.
        let _ = c.ft_on_transfer(payer(), U128(1), String::new());
        let pockets = c.list_pockets();
        let sum: u128 = pockets.iter().map(|p| p.balance.0).sum();
        assert_eq!(sum, 1);
        assert_eq!(pockets.last().unwrap().balance.0, 1);
    }

    #[test]
    fn mom_can_withdraw_allowlisted() {
        let mut c = setup();
        testing_env!(context(token(), 2_000_000_000_000).build());
        let _ = c.ft_on_transfer(payer(), U128(200_000_000), String::new());
        // Mom (account 2) withdraws 10 USDC to herself (allowlisted).
        testing_env!(context(mom(), 3_000_000_000_000)
            .attached_deposit(ONE_YOCTO)
            .build());
        let _ = c.withdraw_pocket("mom".into(), U128(10_000_000), mom());
        let mom = c.get_pocket("mom".into()).unwrap();
        assert_eq!(mom.balance.0, 20_000_000); // 30 - 10
        assert_eq!(mom.spent_today.0, 10_000_000);
    }

    #[test]
    #[should_panic(expected = "only pocket owner can withdraw")]
    fn non_owner_cannot_withdraw() {
        let mut c = setup();
        testing_env!(context(token(), 2_000_000_000_000).build());
        let _ = c.ft_on_transfer(payer(), U128(200_000_000), String::new());
        // Agent (account 4) tries to drain mom's pocket.
        testing_env!(context(agent(), 3_000_000_000_000)
            .attached_deposit(ONE_YOCTO)
            .build());
        let _ = c.withdraw_pocket("mom".into(), U128(1_000_000), mom());
    }

    #[test]
    #[should_panic(expected = "recipient not allowlisted")]
    fn rejects_non_allowlisted_recipient() {
        let mut c = setup();
        testing_env!(context(token(), 2_000_000_000_000).build());
        let _ = c.ft_on_transfer(payer(), U128(200_000_000), String::new());
        testing_env!(context(mom(), 3_000_000_000_000)
            .attached_deposit(ONE_YOCTO)
            .build());
        // agent() is not on mom's allowlist
        let _ = c.withdraw_pocket("mom".into(), U128(1_000_000), agent());
    }

    #[test]
    #[should_panic(expected = "exceeds daily cap")]
    fn rejects_over_daily_cap() {
        let mut c = setup();
        testing_env!(context(token(), 2_000_000_000_000).build());
        let _ = c.ft_on_transfer(payer(), U128(200_000_000), String::new());
        // savings daily_cap = 1 USDC; try to withdraw 2
        testing_env!(context(owner(), 3_000_000_000_000)
            .attached_deposit(ONE_YOCTO)
            .build());
        let _ = c.withdraw_pocket("savings".into(), U128(2_000_000), owner());
    }

    #[test]
    #[should_panic(expected = "exceeds daily cap")]
    fn agent_cannot_drain_savings_past_cap() {
        let mut c = setup();
        testing_env!(context(token(), 2_000_000_000_000).build());
        let _ = c.ft_on_transfer(payer(), U128(200_000_000), String::new());
        // Even the owner (who owns savings) cannot yank more than the daily cap.
        testing_env!(context(owner(), 3_000_000_000_000)
            .attached_deposit(ONE_YOCTO)
            .build());
        let _ = c.withdraw_pocket("savings".into(), U128(20_000_000), owner());
    }

    #[test]
    #[should_panic(expected = "only the household token may call ft_on_transfer")]
    fn rejects_foreign_token() {
        let mut c = setup();
        testing_env!(context(stranger(), 2_000_000_000_000).build());
        let _ = c.ft_on_transfer(payer(), U128(1), String::new());
    }

    #[test]
    fn propose_and_execute_after_timelock() {
        let mut c = setup();
        testing_env!(context(agent(), 5_000_000_000_000).build()); // agent proposes
        let mut new_pockets = sample_pockets();
        new_pockets[0].share_bps = 3500;
        new_pockets[1].share_bps = 3000;
        c.propose_rule_change(new_pockets.clone());
        assert!(c.get_proposal().is_some());

        // Too early
        testing_env!(context(owner(), 5_000_000_000_000 + 500_000_000).build());
        // execute should panic — test via separate should_panic below

        // After timelock (1s = 1e9 ns)
        testing_env!(context(owner(), 5_000_000_000_000 + 1_000_000_001).build());
        c.execute_rule_change();
        assert!(c.get_proposal().is_none());
        assert_eq!(c.get_pocket("spend".into()).unwrap().share_bps, 3500);
        assert_eq!(c.get_pocket("rent".into()).unwrap().share_bps, 3000);
    }

    #[test]
    #[should_panic(expected = "timelock not elapsed")]
    fn execute_before_timelock_fails() {
        let mut c = setup();
        testing_env!(context(agent(), 5_000_000_000_000).build());
        c.propose_rule_change(sample_pockets());
        testing_env!(context(owner(), 5_000_000_000_000 + 1).build());
        c.execute_rule_change();
    }

    #[test]
    fn owner_cancels_proposal() {
        let mut c = setup();
        testing_env!(context(agent(), 5_000_000_000_000).build());
        c.propose_rule_change(sample_pockets());
        testing_env!(context(owner(), 5_000_000_000_000).build());
        c.cancel_proposal();
        assert!(c.get_proposal().is_none());
    }

    #[test]
    #[should_panic(expected = "funds already received: use propose_rule_change")]
    fn set_pockets_blocked_after_funds() {
        let mut c = setup();
        testing_env!(context(token(), 2_000_000_000_000).build());
        let _ = c.ft_on_transfer(payer(), U128(1), String::new());
        testing_env!(context(owner(), 3_000_000_000_000).build());
        c.set_pockets(sample_pockets());
    }

    #[test]
    fn daily_cap_resets_next_day() {
        let mut c = setup();
        testing_env!(context(token(), DAY_NS).build());
        let _ = c.ft_on_transfer(payer(), U128(200_000_000), String::new());
        // Spend the 1 USDC savings cap on day 1.
        testing_env!(context(owner(), DAY_NS + 1)
            .attached_deposit(ONE_YOCTO)
            .build());
        let _ = c.withdraw_pocket("savings".into(), U128(1_000_000), owner());
        // Next day: cap refreshed, another 1 USDC ok.
        testing_env!(context(owner(), 2 * DAY_NS + 1)
            .attached_deposit(ONE_YOCTO)
            .build());
        let _ = c.withdraw_pocket("savings".into(), U128(1_000_000), owner());
        let s = c.get_pocket("savings".into()).unwrap();
        assert_eq!(s.balance.0, 18_000_000);
        assert_eq!(s.spent_today.0, 1_000_000);
    }
}
