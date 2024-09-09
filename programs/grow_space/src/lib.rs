mod bpf_writer;

use anchor_lang::prelude::*;
use bpf_writer::BpfWriter;
use solana_program::program::invoke;
use solana_program::system_instruction;

declare_id!("HiibPQGL8ShZKsz2s7gDHahRk7R1Y8LhhF4HVpx7AZyQ");

const TREASURY_SEED: &[u8; 15] = b"blocks_treasury";
const PDA_ACCOUNT_SEED: &[u8; 11] = b"pda_account";
const PERIOD_COUNTER_SEED: &[u8; 14] = b"period_counter";
const USER_ACCOUNT_PDA_SEED: &[u8; 16] = b"user_account_pda";
// TODO: change for production !!!
const REWARD_PERIOD_DURATION: u64 = 10; // 3_600 * 24; // 1 day in seconds
                                        // TODO: change for production !!!
const REWARD_PER_PERIOD: u64 = 1_000_000; // lamports

/*
   Rewards:
   Jack Levin, [Sep 2, 2024 at 3:23:53PM]: Let me put out some numbers
   1000 XNT per day, divided by number of users and multiplied by their weight
*/

#[program]
pub mod grow_space {
    use super::*;

    pub fn initialize_treasury(ctx: Context<InitializeTreasury>, amount: u64) -> Result<()> {
        // init genesis timestamp for rewards
        ctx.accounts.treasury.genesis_ts = Clock::get().unwrap().unix_timestamp as u64;
        // init counter for the first day
        ctx.accounts.treasury.current_period = 1;
        // fund the treasury
        invoke(
            &system_instruction::transfer(
                &ctx.accounts.admin.key(),
                &ctx.accounts.treasury.key(),
                amount,
            ),
            &[
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )
        .expect("Err: Treasury funding failed");

        Ok(())
    }

    pub fn initialize_pda(_ctx: Context<InitializePDA>, _unique_id: u64) -> Result<()> {
        Ok(())
    }

    pub fn append_data(
        ctx: Context<AppendData>,
        block_id: u64,
        final_hash: String,
        pubkey: Pubkey,
        _period: u64,
        voters: Vec<u64>,
    ) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;

        let pda_account = &mut ctx.accounts.pda_account;

        // init user account if necessary
        let user_account_pda = &mut ctx.accounts.user_account_pda;
        if user_account_pda.user == Pubkey::default() {
            // TODO: flip the lines when we're ready for users' txs
            // user_account_pda.user = ctx.accounts.payer.key();
            user_account_pda.user = pubkey;
        }

        msg!("Block Id: {} PDA: {}", block_id, pda_account.key(),);

        // Ensure there is at least one BlockEntry and one FinalHashEntry in the first BlockEntry
        if ctx.accounts.prev_pda_account.is_some() {
            let prev_pda_account = ctx.accounts.prev_pda_account.clone().unwrap();
            // Log some details about the previous PDA account for debugging
            msg!("Previous PDA: {}", prev_pda_account.key(),);

            // for each BlockEntry of previous block
            for entry in prev_pda_account.block_ids.iter() {
                // calculate total count of votes
                let total_count: u64 = entry
                    .final_hashes
                    .iter()
                    .map(|h| h.pubkeys.len() as u64)
                    .sum();
                // sort hashes by votes count in reverse order
                let mut hashes_sorted = entry.final_hashes.clone();
                hashes_sorted.sort_by_key(|h| std::cmp::Reverse(h.pubkeys.len()));

                // check if the highest score gets over 50% of total votes
                if hashes_sorted[0].pubkeys.len() as u64 > total_count / 2 {
                    // for each voter in the voting vector
                    for idx in voters.iter() {
                        if *idx as usize >= hashes_sorted[0].pubkeys.len() {
                            break;
                        }
                        let voter = hashes_sorted[0].pubkeys[*idx as usize];
                        // for voter in hashes_sorted[0].pubkeys.iter() {
                        // find voter's PDA
                        let (voter_pda, _) = Pubkey::find_program_address(
                            &[
                                USER_ACCOUNT_PDA_SEED,
                                voter.as_ref(),
                                treasury.current_period.to_le_bytes().as_ref(),
                            ],
                            ctx.program_id,
                        );
                        // find account info
                        for user_account in ctx.remaining_accounts.iter() {
                            // serialize voter's PDA
                            if voter_pda == *user_account.key {
                                let buf: &mut [u8] =
                                    &mut user_account.try_borrow_mut_data().unwrap();
                                let mut voter_account: UserPeriodCounter =
                                    UserPeriodCounter::try_deserialize(&mut &*buf)?;

                                // prevent self-voting
                                if voter_account.user != pubkey {
                                    // if voter_account.user != ctx.accounts.payer.key() {
                                    // perform accounting on voter's PDA
                                    if voter_account.inblock < block_id {
                                        let prev_block = voter_account.inblock;
                                        voter_account.credit += 1;
                                        voter_account.inblock = block_id;
                                        emit!(VoterCredited {
                                            user: pubkey,
                                            voter,
                                            pda: pda_account.key(),
                                            block_id,
                                            prev_block_id: prev_block,
                                            credit: voter_account.credit,
                                            final_hash: hashes_sorted[0].final_hash
                                        });
                                        let mut writer = BpfWriter::new(&mut *buf);
                                        voter_account.try_serialize(&mut writer)?;
                                        // increase period counter
                                        ctx.accounts.period_counter.credit += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        msg!(
            "User PDA: {} {} {} {}",
            user_account_pda.user,
            user_account_pda.credit,
            user_account_pda.debit,
            user_account_pda.inblock
        );

        // Convert the final_hash string to bytes and truncate to 64 bits (8 bytes)
        let final_hash_bytes: [u8; 8] = {
            let mut bytes = final_hash.as_bytes().to_vec();
            bytes.resize(8, 0); // Ensure it has at least 8 bytes
            bytes[..8].try_into().expect("Err: slice bad length")
        };

        let mut found = false;
        let mut add_size: usize = 0;
        // let user_pubkey = ctx.accounts.payer.key;
        let user_pubkey = &pubkey;
        for block_entry in &mut pda_account.block_ids {
            if block_entry.block_id == block_id {
                found = true;
                let mut hash_found = false;
                for hash_entry in &mut block_entry.final_hashes {
                    if hash_entry.final_hash == final_hash_bytes {
                        if !hash_entry.pubkeys.contains(user_pubkey) {
                            hash_entry.pubkeys.push(*user_pubkey);
                            add_size += 32;
                        }
                        hash_found = true;
                        break;
                    }
                }
                if !hash_found {
                    let final_hashes = &mut block_entry.final_hashes;
                    add_size += 32 + 8 + 8;
                    final_hashes.push(FinalHashEntry {
                        final_hash: final_hash_bytes,
                        pubkeys: vec![*user_pubkey],
                        // count: 1,
                    });
                }
                break;
            }
        }

        if !found {
            pda_account.block_ids.push(BlockEntry {
                block_id,
                final_hashes: vec![FinalHashEntry {
                    final_hash: final_hash_bytes,
                    pubkeys: vec![*user_pubkey],
                    // count: 1,
                }],
            });
            add_size += 64;
        }

        msg!(
            "PDA size: {} +delta: {}",
            pda_account.to_account_info().data_len(),
            add_size
        );

        // Check if the data size exceeds 80% of the allocated space
        grow_account(
            &pda_account.to_account_info(),
            &ctx.accounts.payer.key(),
            &pda_account.to_account_info().key(),
            &[
                ctx.accounts.payer.to_account_info(),
                pda_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            add_size,
        )?;

        msg!("PDA new size: {}", pda_account.to_account_info().data_len());

        // update global period counters and start new period if necessary
        let now = Clock::get().unwrap().unix_timestamp as u64;
        let delta = now - treasury.genesis_ts;
        let new_current_period = delta / REWARD_PERIOD_DURATION;
        if new_current_period > treasury.current_period {
            treasury.current_period = new_current_period;
            emit!(NewPeriod {
                new_period: new_current_period,
                ts: now,
                prev_credit: ctx.accounts.period_counter.credit,
                prev_debit: ctx.accounts.period_counter.debit,
            })
        }

        Ok(())
    }

    pub fn claim_reward(ctx: Context<ClaimReward>, period: u64) -> Result<()> {
        // check userPDA account owner
        require!(
            ctx.accounts.user_account_pda.user == ctx.accounts.user.key(),
            ErrorCode::BadAccountOwner
        );
        require!(
            period < ctx.accounts.treasury.current_period,
            ErrorCode::BadPeriod
        );
        // check if userPDA has redeemable credit
        require!(
            ctx.accounts.user_account_pda.credit > ctx.accounts.user_account_pda.redeemed,
            ErrorCode::NoRedeemableCredit
        );
        let credit_to_redeem =
            ctx.accounts.user_account_pda.credit - ctx.accounts.user_account_pda.redeemed;
        // calculate reward
        if ctx.accounts.period_counter.credit > 0 {
            let reward = REWARD_PER_PERIOD * credit_to_redeem / ctx.accounts.period_counter.credit;
            // redeem credit
            ctx.accounts.user_account_pda.redeemed += credit_to_redeem;
            ctx.accounts.period_counter.redeemed += credit_to_redeem;
            // make "transfer" from treasury
            **ctx
                .accounts
                .treasury
                .to_account_info()
                .lamports
                .borrow_mut() -= reward;
            **ctx.accounts.user.to_account_info().lamports.borrow_mut() += reward;
        }

        Ok(())
    }
}

fn grow_account(
    account: &AccountInfo,
    payer: &Pubkey,
    recipient: &Pubkey,
    accounts: &[AccountInfo],
    add_size: usize,
) -> Result<()> {
    // calc due rent
    let rent = Rent::get()?;
    let len = account.data_len();
    let lamports_needed = rent
        .minimum_balance(len + add_size)
        .saturating_sub(account.lamports());
    // pay rent
    if lamports_needed > 0 {
        // Transfer lamports to cover the additional rent
        invoke(
            &system_instruction::transfer(payer, recipient, lamports_needed),
            accounts,
        )
        .expect("Err: Rent pmt failed");
    }
    // grow size
    account
        .realloc(len + add_size, false)
        .expect("Err: Realloc failed");

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(
        init,
        seeds = [TREASURY_SEED],
        bump,
        payer = admin,
        space = 8 + TreasuryAccount::INIT_SPACE,
    )]
    pub treasury: Account<'info, TreasuryAccount>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(_unique_id: u64)]
pub struct InitializePDA<'info> {
    #[account(
        init_if_needed,
        seeds = [
            PDA_ACCOUNT_SEED,
            _unique_id.to_le_bytes().as_ref()
        ],
        bump,
        payer = payer,
        space = 8 + PDAAccount::INIT_SPACE,
    )]
    pub pda_account: Account<'info, PDAAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(block_id: u64, final_hash: String, pubkey: Pubkey, period: u64)]
pub struct AppendData<'info> {
    #[account(mut)]
    pub treasury: Account<'info, TreasuryAccount>,
    #[account(mut)]
    pub pda_account: Account<'info, PDAAccount>,
    #[account(mut)]
    pub prev_pda_account: Option<Account<'info, PDAAccount>>,
    #[account(
        init_if_needed,
        seeds = [
            PERIOD_COUNTER_SEED,
            treasury.current_period.to_le_bytes().as_ref(), // TODO: use param instead ???
            // period.to_le_bytes().as_ref()
        ],
        bump,
        payer = payer,
        space = 8 + PeriodCounter::INIT_SPACE,
        // constraint = user_account_pda.user == payer.key()
    )]
    pub period_counter: Account<'info, PeriodCounter>,
    #[account(
        init_if_needed,
        seeds = [
            USER_ACCOUNT_PDA_SEED,
            pubkey.as_ref(),
            // payer.key().as_ref()
            treasury.current_period.to_le_bytes().as_ref(), // TODO: use param instead ???
            // period.to_le_bytes().as_ref()
        ],
        bump,
        payer = payer,
        space = 8 + UserPeriodCounter::INIT_SPACE,
        // constraint = user_account_pda.user == payer.key()
    )]
    pub user_account_pda: Account<'info, UserPeriodCounter>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(period: u64)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub treasury: Account<'info, TreasuryAccount>,
    #[account(mut)]
    pub period_counter: Account<'info, PeriodCounter>,
    #[account(mut)]
    pub user_account_pda: Account<'info, UserPeriodCounter>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct BlockEntry {
    pub block_id: u64,
    #[max_len(0)]
    pub final_hashes: Vec<FinalHashEntry>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct FinalHashEntry {
    pub final_hash: [u8; 8],
    #[max_len(0)]
    pub pubkeys: Vec<Pubkey>,
    // pub count: u64,
}

#[account]
#[derive(Debug, InitSpace)]
pub struct TreasuryAccount {
    pub genesis_ts: u64,
    pub current_period: u64,
}

#[account]
#[derive(InitSpace, Default)]
pub struct PeriodCounter {
    pub credit: u64,
    pub debit: u64,
    pub redeemed: u64,
}
#[account]
#[derive(InitSpace, Default)]
pub struct UserPeriodCounter {
    pub user: Pubkey,
    pub inblock: u64,
    pub credit: u64,
    pub debit: u64,
    pub redeemed: u64,
}

#[account]
#[derive(Debug, InitSpace, Default)]
pub struct PDAAccount {
    #[max_len(0)]
    pub block_ids: Vec<BlockEntry>,
}

#[event]
pub struct NewPeriod {
    pub new_period: u64,
    pub ts: u64,
    pub prev_credit: u64,
    pub prev_debit: u64,
}

#[event]
pub struct VoterCredited {
    pub user: Pubkey,
    pub voter: Pubkey,
    pub pda: Pubkey,
    pub block_id: u64,
    pub prev_block_id: u64,
    pub final_hash: [u8; 8],
    pub credit: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Block entry not found.")]
    BlockEntryNotFound,
    #[msg("Final hash entry not found.")]
    FinalHashEntryNotFound,
    #[msg("Invalid UTF-8 sequence.")]
    InvalidUtf8,
    #[msg("Insufficient pubkeys available.")]
    InsufficientPubkeys,
    #[msg("Serialization error.")]
    SerializationError,
    #[msg("Bad account owner")]
    BadAccountOwner,
    #[msg("No redeemable credit")]
    NoRedeemableCredit,
    #[msg("Cannot claim in current period")]
    BadPeriod,
    // Add other error codes as needed
}
