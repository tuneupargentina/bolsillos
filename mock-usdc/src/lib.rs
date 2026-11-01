//! Mock USDC (NEP-141) for Bolsillos testnet demos. 6 decimals. Owner can mint.
//! Minimal hand-rolled implementation (avoids a known storage macro type mismatch
//! in near-contract-standards 5.29/5.30 between U128 and NearToken).
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    env, near, require, serde_json,
};

const FT_RESOLVE_GAS: Gas = Gas::from_tgas(5);
const FT_TRANSFER_CALL_GAS: Gas = Gas::from_tgas(25);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Balances,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct FungibleTokenMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    total_supply: u128,
    balances: LookupMap<AccountId, u128>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            total_supply: 0,
            balances: LookupMap::new(StorageKey::Balances),
        }
    }

    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only owner can mint"
        );
        let amount = amount.0;
        require!(amount > 0, "amount must be > 0");
        let bal = self.balances.get(&account_id).copied().unwrap_or(0);
        self.balances.insert(account_id, bal + amount);
        self.total_supply = self.total_supply.saturating_add(amount);
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(
            env::attached_deposit() >= ONE_YOCTO,
            "requires attached deposit of at least 1 yoctoNEAR"
        );
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> Promise {
        require!(
            env::attached_deposit() >= ONE_YOCTO,
            "requires attached deposit of at least 1 yoctoNEAR"
        );
        let sender = env::predecessor_account_id();
        let amount = amount.0;
        self.internal_transfer(&sender, &receiver_id, amount, memo);

        let receiver = receiver_id.clone();
        Promise::new(receiver_id)
            .function_call(
                "ft_on_transfer".to_string(),
                serde_json::to_vec(&serde_json::json!({
                    "sender_id": sender,
                    "amount": U128(amount),
                    "msg": msg,
                }))
                .unwrap(),
                NearToken::from_yoctonear(0),
                FT_TRANSFER_CALL_GAS,
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "ft_resolve_transfer".to_string(),
                    serde_json::to_vec(&serde_json::json!({
                        "sender_id": env::predecessor_account_id(),
                        "receiver_id": receiver,
                        "amount": U128(amount),
                    }))
                    .unwrap(),
                    NearToken::from_yoctonear(0),
                    FT_RESOLVE_GAS,
                ),
            )
    }

    /// NEP-141 resolve: refund unused amount to sender. Returns used amount.
    #[private]
    pub fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let unused = match env::promise_result(0) {
            near_sdk::PromiseResult::Successful(value) => {
                serde_json::from_slice::<U128>(&value)
                    .map(|u| u.0.min(amount.0))
                    .unwrap_or(0)
            }
            _ => amount.0, // on failure, refund everything
        };
        if unused > 0 {
            let recv_bal = self.balances.get(&receiver_id).copied().unwrap_or(0);
            let refund = unused.min(recv_bal);
            if refund > 0 {
                self.balances.insert(receiver_id, recv_bal - refund);
                let send_bal = self.balances.get(&sender_id).copied().unwrap_or(0);
                self.balances.insert(sender_id, send_bal + refund);
            }
        }
        U128(amount.0.saturating_sub(unused))
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: "ft-1.0.0".into(),
            name: "Mock USDC".into(),
            symbol: "mUSDC".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }

    fn internal_transfer(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        amount: u128,
        memo: Option<String>,
    ) {
        require!(amount > 0, "amount must be > 0");
        require!(sender != receiver, "sender and receiver must differ");
        let send_bal = self.balances.get(sender).copied().unwrap_or(0);
        require!(send_bal >= amount, "insufficient balance");
        self.balances.insert(sender.clone(), send_bal - amount);
        let recv_bal = self.balances.get(receiver).copied().unwrap_or(0);
        self.balances.insert(receiver.clone(), recv_bal + amount);
        if let Some(m) = memo {
            env::log_str(&format!("Transfer memo: {m}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn aid(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(pred: AccountId, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(pred);
        b.current_account_id(aid("musdc.test.near"));
        b.attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }

    #[test]
    fn mint_and_balance() {
        ctx(aid("owner.test.near"), 0);
        let mut c = Contract::new(aid("owner.test.near"));
        c.mint(aid("payer.test.near"), U128(1_000_000));
        assert_eq!(c.ft_balance_of(aid("payer.test.near")).0, 1_000_000);
        assert_eq!(c.ft_total_supply().0, 1_000_000);
    }

    #[test]
    #[should_panic(expected = "only owner can mint")]
    fn non_owner_cannot_mint() {
        ctx(aid("owner.test.near"), 0);
        let mut c = Contract::new(aid("owner.test.near"));
        ctx(aid("other.test.near"), 0);
        c.mint(aid("other.test.near"), U128(1));
    }

    #[test]
    fn transfer_moves_balance() {
        ctx(aid("owner.test.near"), 0);
        let mut c = Contract::new(aid("owner.test.near"));
        c.mint(aid("payer.test.near"), U128(10));
        ctx(aid("payer.test.near"), 1);
        c.ft_transfer(aid("household.test.near"), U128(4), None);
        assert_eq!(c.ft_balance_of(aid("payer.test.near")).0, 6);
        assert_eq!(c.ft_balance_of(aid("household.test.near")).0, 4);
    }
}
