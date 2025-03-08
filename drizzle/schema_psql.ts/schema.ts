import {pgTable, AnyPgColumn, primaryKey, numeric, integer, text, varchar} from "drizzle-orm/pg-core"
import {sql} from "drizzle-orm"

export const voterCredits = pgTable("Voter_Credits", {
        ts: numeric().default(sql`(CURRENT_TIMESTAMP)`),
        period: integer(),
        user: varchar({length: 44}),
        voter: varchar({length: 44}),
        pda: varchar({length: 44}),
        blockId: integer("block_id"),
        prevBlockId: integer("prev_block_id"),
        finalHash: varchar("final_hash", {length: 64}),
        credit: integer(),
        debit: integer(),
    },
    (table) => {
        return {
            pk0: primaryKey({
                columns: [table.period, table.user, table.voter, table.pda, table.finalHash, table.credit],
                name: "Voter_Credits_period_user_voter_pda_final_hash_credit_pk"
            })
        }
    });

export const voters = pgTable("Voters", {
    ts: numeric().default(sql`(CURRENT_TIMESTAMP)`),
    voter: varchar({length: 44}).primaryKey(),
    totalVotes: integer("total_votes").default(1),
    lastBlockId: integer("last_block_id"),
    lastBackfilledBlockId: integer("last_backfilled_block_id"),
});

export const names = pgTable("Names", {
    pubkey: varchar({length: 44}).primaryKey(),
    name: text(),
});

export const votes = pgTable("Votes", {
        ts: numeric(),
        finalHash: varchar("final_hash", {length: 64}),
        blockId: integer("block_id"),
        voter: varchar({length: 44}),
    },
    (table) => {
        return {
            pk0: primaryKey({columns: [table.blockId, table.voter], name: "Votes_block_id_voter_pk"})
        }
    });

export const voterBalances = pgTable("Voter_Balances", {
    updatedTs: numeric("updated_ts").default(sql`(CURRENT_TIMESTAMP)`),
    lastPeriod: integer("last_period").default(0),
    voter: varchar({length: 44}).primaryKey(),
    accruedRewards: integer("accrued_rewards").default(0),
    paidRewards: integer("paid_rewards").default(0),
});

export const rewardPeriods = pgTable("Reward_Periods", {
    startTs: numeric("start_ts"),
    endTs: numeric("end_ts"),
    startBlockId: integer("start_block_id"),
    endBlockId: integer("end_block_id"),
    periodNumber: integer("period_number").primaryKey(),
    budget: integer().default(0),
    allocated: integer().default(0),
});

export const rewardDistributions = pgTable("Reward_Distributions", {
        createdTs: numeric("created_ts").default(sql`(CURRENT_TIMESTAMP)`),
        updatedTs: numeric("updated_ts"),
        periodNumber: integer("period_number"),
        voter: varchar({length: 44}),
        reward: integer().default(0),
        distributed: integer().default(0),
    },
    (table) => {
        return {
            pk0: primaryKey({
                columns: [table.periodNumber, table.voter],
                name: "Reward_Distributions_period_number_voter_pk"
            })
        }
    });

export const voterPayouts = pgTable("Voter_Payouts", {
        ts: numeric().default(sql`(CURRENT_TIMESTAMP)`),
        voter: varchar({length: 44}),
        lastPeriod: integer("last_period").default(0),
        amount: integer().default(0),
        txHash: varchar("tx_hash", {length: 88}),
    },
    (table) => {
        return {
            pk0: primaryKey({columns: [table.voter, table.txHash], name: "Voter_Payouts_voter_tx_hash_pk"})
        }
    });

