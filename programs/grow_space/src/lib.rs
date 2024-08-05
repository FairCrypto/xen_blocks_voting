use anchor_lang::prelude::*;
use solana_program::program::invoke;
use solana_program::system_instruction;


declare_id!("7KvbAAK7kP72zcdC24vDn9L51TDV8v9he4hNJ3S7ZU51");

#[program]
pub mod grow_space {
    use super::*;

    pub fn initialize_pda(ctx: Context<InitializePDA>, _unique_id: u64) -> Result<()> {
        let pda_account = &mut ctx.accounts.pda_account;
        pda_account.block_ids = Vec::new();
        pda_account.data_size = 0;
        Ok(())
    }

    pub fn initialize_pubkey_count_account(ctx: Context<InitializePubkeyCountAccount>, _start_block_id: u64, _end_block_id: u64) -> Result<()> {
        let pubkey_count_account = &mut ctx.accounts.pubkey_count_account;
        pubkey_count_account.pubkey_counts = Vec::new();
        Ok(())
    }

pub fn aggregate_pubkey_counts(ctx: Context<CountReference_2>, start_block_id: u64) -> Result<()> {
    let (pda, _bump) = Pubkey::find_program_address(&[b"pda_account", &start_block_id.to_le_bytes()], ctx.program_id);
    msg!("PDA Account for block ID {}: {}", start_block_id, pda);

    // Load the PDA account
    let pda_account = &ctx.accounts.pda_account;

    // Pre-allocate vector capacity
    let estimated_size = 10; // Adjust based on your estimates
    let mut pubkey_counts: Vec<(Pubkey, u64)> = Vec::with_capacity(estimated_size);

    // Use a HashMap to efficiently count unique pubkeys
    let mut pubkey_counter: std::collections::HashMap<Pubkey, u64> = std::collections::HashMap::new();

    // Set the maximum number of iterations
    let mut iteration_count = 0;
    let max_iterations = 5;

    // Iterate through block entries and their final_hashes to collect pubkeys
    for block_entry in &pda_account.block_ids {
        for final_hash_entry in &block_entry.final_hashes {
            for pubkey in &final_hash_entry.pubkeys {
                // Efficiently count pubkeys
                let counter = pubkey_counter.entry(*pubkey).or_insert(0);
                *counter += 1;
            }
            iteration_count += 1;
            if iteration_count >= max_iterations {
                break;
            }
        }
        if iteration_count >= max_iterations {
            break;
        }
    }

    // Convert HashMap to vector for storage
    pubkey_counts.extend(pubkey_counter.into_iter());

    msg!("Unique pubkey counts: {:?}", pubkey_counts);

    // Load the CountAccount associated with count_pda_key
    let count_account = &mut ctx.accounts.count_account;
    count_account.pubkey_counts = pubkey_counts;

    Ok(())
}


    pub fn append_data(ctx: Context<AppendData>, block_id: u64, final_hash: String, pubkey: Pubkey) -> Result<()> {
        let pda_account = &mut ctx.accounts.pda_account;

        // Log the current data size before modification
        let current_data_before = pda_account.data_size;
        msg!("Data size before in bytes: {}", current_data_before);
        msg!("Current data length allocation: {}", pda_account.to_account_info().data_len());
        msg!("block_id: {}", block_id);

        // Convert the final_hash string to bytes and truncate to 64 bits (8 bytes)
        let final_hash_bytes: [u8; 8] = {
            let mut bytes = final_hash.as_bytes().to_vec();
            bytes.resize(8, 0); // Ensure it has at least 8 bytes
            bytes[..8].try_into().expect("slice with incorrect length")
        };

        // Convert truncated bytes back to string for logging
        let final_hash_truncated_str = String::from_utf8_lossy(&final_hash_bytes);

        // Log the incoming final_hash string and its truncated byte representation
        msg!("Incoming final_hash string: {}", final_hash);
        msg!("Truncated final_hash bytes as string: {}", final_hash_truncated_str);

        let mut found = false;
        for block_entry in &mut pda_account.block_ids {
            if block_entry.block_id == block_id {
                found = true;
                let mut hash_found = false;
                for hash_entry in &mut block_entry.final_hashes {
                    if hash_entry.final_hash == final_hash_bytes {
                        if !hash_entry.pubkeys.contains(&pubkey) {
                            hash_entry.pubkeys.push(pubkey);
                            hash_entry.count = hash_entry.pubkeys.len() as u64; // Set count to the number of unique pubkeys
                        }
                        hash_found = true;
                        break;
                    }
                }
                if !hash_found {
                    block_entry.final_hashes.push(FinalHashEntry {
                        final_hash: final_hash_bytes,
                        pubkeys: vec![pubkey],
                        count: 1,
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
                    pubkeys: vec![pubkey],
                    count: 1,
                }],
            });
        }

        // Log the new data size after modification
        let current_data_after = calculate_data_size(&pda_account.block_ids);
        msg!("New length of pda_account.entries: {}", pda_account.block_ids.len());
        msg!("Data size after in bytes: {}", current_data_after);
        msg!("Current data length allocation: {}", pda_account.to_account_info().data_len());

        // Check if the data size exceeds 80% of the allocated space
        let data_len = pda_account.to_account_info().data_len();
        if current_data_after > (data_len as usize) * 90 / 100 {
            let rent = Rent::get()?;
            let new_size = data_len + data_len / 3; // add 30% space space
            let lamports_needed = rent.minimum_balance(new_size as usize).saturating_sub(pda_account.to_account_info().lamports());

            if lamports_needed > 0 {
                // Transfer lamports to cover the additional rent
                invoke(
                    &system_instruction::transfer(
                        &ctx.accounts.payer.key(),
                        &pda_account.to_account_info().key(),
                        lamports_needed,
                    ),
                    &[
                        ctx.accounts.payer.to_account_info(),
                        pda_account.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                )?;
            }

            pda_account.to_account_info().realloc(new_size as usize, false)?;
            msg!("Reallocated PDA account to new size: {}", new_size);
        }

        // Update data size in the PDA
        pda_account.data_size = current_data_after as u32;

        Ok(())
    }
}

fn calculate_data_size(entries: &Vec<BlockEntry>) -> usize {
    let mut total_size = 0;
    for entry in entries {
        // Size of block_id
        total_size += 8;
        // Size of each FinalHashEntry in final_hashes
        for hash_entry in &entry.final_hashes {
            total_size += 8 + 8; // Assuming 8 bytes for final_hash and 8 bytes for count
            total_size += hash_entry.pubkeys.len() * 32; // Each Pubkey is 32 bytes
        }
    }
    total_size
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BlockEntry {
    pub block_id: u64,
    pub final_hashes: Vec<FinalHashEntry>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FinalHashEntry {
    pub final_hash: [u8; 8],
    pub pubkeys: Vec<Pubkey>,
    pub count: u64,
}

#[derive(Accounts)]
#[instruction(unique_id: u64)]
pub struct InitializePDA<'info> {
    #[account(init, seeds = [b"pda_account", unique_id.to_le_bytes().as_ref()], bump, payer = payer, space = 8 + 5 * (8 + 5 * (8 + 8 + 3 * 10)))]
    pub pda_account: Account<'info, PDAAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(start_block_id: u64, end_block_id: u64)]
pub struct InitializePubkeyCountAccount<'info> {
    #[account(init, seeds = [b"result_account", start_block_id.to_le_bytes().as_ref(), end_block_id.to_le_bytes().as_ref()], bump, payer = payer, space = 50000)]
    pub pubkey_count_account: Account<'info, PubkeyCountAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PubkeyCount<'info> {
    #[account(init_if_needed, seeds = [b"pubkey_count"], bump, payer = payer, space = 16)]
    pub pubkey_count_account: Account<'info, CountAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/*
#[derive(Accounts)]
#[instruction(start_block_id: u64, end_block_id: u64)]
pub struct AggregatePubkeyCounts<'info> {
    #[account(mut)]
    pub pda_accounts: Vec<Account<'info, PDAAccount>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
*/
#[derive(Accounts)]
pub struct AppendData<'info> {
    #[account(mut)]
    pub pda_account: Account<'info, PDAAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(start_block_id: u64)]
pub struct CountReference_2<'info> {
    #[account(mut)]
    pub pda_account: Account<'info, PDAAccount>,
    #[account(init_if_needed, seeds = [b"pubkey_count_2", start_block_id.to_le_bytes().as_ref()], bump, payer = payer, space = 8 + 32 * 101)] // Adjust space as needed
    pub count_account: Account<'info, PubkeyCountAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(start_block_id: u64)]
pub struct CountReference<'info> {
    #[account(mut)]
    pub pda_account: Account<'info, PDAAccount>,
    #[account(init_if_needed, seeds = [b"pubkey_count", start_block_id.to_le_bytes().as_ref()], bump, payer = payer, space = 8 + 32 * 101)] // Adjust space as needed
    pub count_account: Account<'info, PubkeyCountAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct PubkeyCountAccount {
    pub pubkey_counts: Vec<(Pubkey, u64)>,
}
#[account]
pub struct CountAccount {
    pub count: u64,
}

#[account]
pub struct PDAAccount {
    pub block_ids: Vec<BlockEntry>,
    pub data_size: u32,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Maximum number of entries reached.")]
    MaxEntriesReached,
}

