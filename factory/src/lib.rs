//! Bolsillos factory: deploys a household contract per home as `<name>.<factory>`.
//!
//! The creator attaches enough NEAR to cover account creation + wasm storage
//! (~3 NEAR recommended). The new household is initialized with the caller as
//! owner. Pocket setup is a follow-up `set_pockets` call by the owner (two-tx
//! flow so the factory never needs to impersonate the owner).
#![allow(clippy::needless_pass_by_value)]

use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    env, near, require, serde_json,
};

/// Embedded household wasm (built into `factory/res/bolsillos.wasm` before compile).
const HOUSEHOLD_WASM: &[u8] = include_bytes!("../res/bolsillos.wasm");
/// Gas for `new` on the fresh household.
const INIT_GAS: Gas = Gas::from_tgas(30);
/// Gas for the factory callback.
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// ~1e19 yoctoNEAR per byte of storage staking.
const YOCTO_PER_BYTE: u128 = 10_000_000_000_000_000_000;
/// Extra buffer on top of wasm storage (account overhead + leftover for 1-yocto FT outs).
const EXTRA_DEPOSIT: NearToken = NearToken::from_millinear(200); // 0.2 NEAR

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Households,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct HouseholdRecord {
    pub account_id: AccountId,
    pub owner: AccountId,
    pub token_id: AccountId,
    pub created_at_ns: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Quote {
    pub wasm_bytes: u64,
    pub min_deposit: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    households: IterableMap<String, HouseholdRecord>,
    household_count: u64,
}

fn validate_name(name: &str) {
    require!(!name.is_empty(), "name cannot be empty");
    require!(name.len() <= 32, "name longer than 32 chars");
    require!(
        name.bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_'),
        "name: only a-z 0-9 - _"
    );
    require!(!name.starts_with('-') && !name.ends_with('-'), "name cannot start/end with -");
}

fn min_deposit() -> NearToken {
    let storage = YOCTO_PER_BYTE.saturating_mul(HOUSEHOLD_WASM.len() as u128);
    NearToken::from_yoctonear(storage).saturating_add(EXTRA_DEPOSIT)
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: Option<AccountId>) -> Self {
        Self {
            owner: owner.unwrap_or_else(env::predecessor_account_id),
            households: IterableMap::new(StorageKey::Households),
            household_count: 0,
        }
    }

    /// How much NEAR to attach to `create_household`.
    pub fn get_min_deposit(&self) -> Quote {
        Quote {
            wasm_bytes: HOUSEHOLD_WASM.len() as u64,
            min_deposit: U128(min_deposit().as_yoctonear()),
        }
    }

    pub fn get_household(&self, name: String) -> Option<HouseholdRecord> {
        self.households.get(&name).cloned()
    }

    pub fn list_households(&self) -> Vec<HouseholdRecord> {
        self.households.values().cloned().collect()
    }

    pub fn get_household_count(&self) -> u64 {
        self.household_count
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    /// Create `<name>.<factory>` , deploy the household wasm, call `new(owner, token_id, timelock_ns)`.
    #[payable]
    pub fn create_household(
        &mut self,
        name: String,
        token_id: AccountId,
        timelock_ns: Option<u64>,
    ) -> Promise {
        validate_name(&name);
        require!(
            self.households.get(&name).is_none(),
            "household name already taken"
        );

        let attached = env::attached_deposit();
        let needed = min_deposit();
        require!(
            attached >= needed,
            format!(
                "attach at least {} yoctoNEAR (~{:.2} NEAR)",
                needed.as_yoctonear(),
                needed.as_yoctonear() as f64 / 1e24
            )
        );

        let factory_id = env::current_account_id();
        let sub: AccountId = format!("{name}.{factory_id}")
            .parse()
            .unwrap_or_else(|_| env::panic_str("invalid subaccount id"));
        require!(
            env::is_valid_account_id(sub.as_bytes()),
            "invalid subaccount id"
        );

        let owner = env::predecessor_account_id();
        let init_args = serde_json::to_vec(&serde_json::json!({
            "owner": owner,
            "token_id": token_id,
            "timelock_ns": timelock_ns,
        }))
        .unwrap();

        // Record optimistically; rollback in callback on failure.
        let record = HouseholdRecord {
            account_id: sub.clone(),
            owner: owner.clone(),
            token_id: token_id.clone(),
            created_at_ns: env::block_timestamp(),
        };
        self.households.insert(name.clone(), record);
        self.household_count = self.household_count.saturating_add(1);

        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "bolsillos-factory",
                "version": "1.0.0",
                "event": "create_household",
                "data": [{
                    "name": name,
                    "account_id": sub,
                    "owner": owner,
                }]
            })
        ));

        Promise::new(sub.clone())
            .create_account()
            .transfer(attached)
            .deploy_contract(HOUSEHOLD_WASM.to_vec())
            .function_call("new".to_string(), init_args, NearToken::from_yoctonear(0), INIT_GAS)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_create_callback(name, owner, attached),
            )
    }

    #[private]
    pub fn on_create_callback(
        &mut self,
        name: String,
        refund_to: AccountId,
        attached: NearToken,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            env::log_str(&format!(
                "EVENT_JSON:{}",
                serde_json::json!({
                    "standard": "bolsillos-factory",
                    "version": "1.0.0",
                    "event": "create_household_ok",
                    "data": [{ "name": name }]
                })
            ));
            return true;
        }
        // Roll back registry and refund the creator.
        if self.households.remove(&name).is_some() {
            self.household_count = self.household_count.saturating_sub(1);
        }
        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "bolsillos-factory",
                "version": "1.0.0",
                "event": "create_household_fail",
                "data": [{ "name": name, "refund_to": refund_to }]
            })
        ));
        let _ = Promise::new(refund_to).transfer(attached);
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, AccountId};

    fn ctx(predecessor: AccountId, deposit: NearToken) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0))
            .predecessor_account_id(predecessor)
            .attached_deposit(deposit)
            .account_balance(NearToken::from_near(100));
        b
    }

    #[test]
    fn min_deposit_covers_wasm() {
        testing_env!(ctx(accounts(1), NearToken::from_near(0)).build());
        let c = Contract::new(Some(accounts(1)));
        let q = c.get_min_deposit();
        assert_eq!(q.wasm_bytes, HOUSEHOLD_WASM.len() as u64);
        assert!(q.min_deposit.0 >= YOCTO_PER_BYTE * HOUSEHOLD_WASM.len() as u128);
    }

    #[test]
    #[should_panic(expected = "name cannot be empty")]
    fn rejects_empty_name() {
        testing_env!(ctx(accounts(1), min_deposit()).build());
        let mut c = Contract::new(Some(accounts(1)));
        let _ = c.create_household("".into(), accounts(2), None);
    }

    #[test]
    #[should_panic(expected = "name: only a-z 0-9 - _")]
    fn rejects_bad_chars() {
        testing_env!(ctx(accounts(1), min_deposit()).build());
        let mut c = Contract::new(Some(accounts(1)));
        let _ = c.create_household("Casa!".into(), accounts(2), None);
    }

    #[test]
    #[should_panic(expected = "attach at least")]
    fn rejects_low_deposit() {
        testing_env!(ctx(accounts(1), NearToken::from_millinear(1)).build());
        let mut c = Contract::new(Some(accounts(1)));
        let _ = c.create_household("home1".into(), accounts(2), None);
    }

    #[test]
    fn create_registers_and_schedules() {
        testing_env!(ctx(accounts(1), min_deposit()).build());
        let mut c = Contract::new(Some(accounts(1)));
        let _ = c.create_household("home1".into(), accounts(2), Some(1_000_000));
        let rec = c.get_household("home1".into()).expect("registered");
        assert_eq!(rec.owner, accounts(1));
        assert_eq!(rec.token_id, accounts(2));
        assert!(rec.account_id.to_string().starts_with("home1."));
        assert_eq!(c.get_household_count(), 1);
    }

    #[test]
    #[should_panic(expected = "household name already taken")]
    fn rejects_duplicate_name() {
        testing_env!(ctx(accounts(1), min_deposit()).build());
        let mut c = Contract::new(Some(accounts(1)));
        let _ = c.create_household("home1".into(), accounts(2), None);
        // Same env again — still registered
        let _ = c.create_household("home1".into(), accounts(2), None);
    }

    #[test]
    fn list_and_owner() {
        testing_env!(ctx(accounts(1), min_deposit()).build());
        let mut c = Contract::new(Some(accounts(3)));
        assert_eq!(c.get_owner(), accounts(3));
        let _ = c.create_household("a".into(), accounts(2), None);
        assert_eq!(c.list_households().len(), 1);
    }
}
