import { sqliteTable, AnySQLiteColumn, primaryKey, numeric, integer, text } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const voterCredits = sqliteTable("Voter_Credits", {
	ts: numeric().default(sql`(CURRENT_TIMESTAMP)`),
	period: integer(),
	user: text({ length: 44 }),
	voter: text({ length: 44 }),
	pda: text({ length: 44 }),
	blockId: integer("block_id"),
	prevBlockId: integer("prev_block_id"),
	finalHash: text("final_hash", { length: 64 }),
	credit: integer(),
	debit: integer(),
},
(table) => {
	return {
		pk0: primaryKey({ columns: [table.period, table.user, table.voter, table.pda, table.finalHash, table.credit], name: "Voter_Credits_period_user_voter_pda_final_hash_credit_pk"})
	}
});

export const voters = sqliteTable("Voters", {
	ts: numeric().default(sql`(CURRENT_TIMESTAMP)`),
	voter: text({ length: 44 }).primaryKey(),
	totalVotes: integer("total_votes").default(1),
	lastBlockId: integer("last_block_id"),
	lastBackfilledBlockId: integer("last_backfilled_block_id"),
});

export const names = sqliteTable("Names", {
	pubkey: text({ length: 44 }).primaryKey(),
	name: text(),
});

export const votes = sqliteTable("Votes", {
	ts: numeric(),
	finalHash: text("final_hash", { length: 64 }),
	blockId: integer("block_id"),
	voter: text({ length: 44 }),
},
(table) => {
	return {
		pk0: primaryKey({ columns: [table.blockId, table.voter], name: "Votes_block_id_voter_pk"})
	}
});

export const voterPayouts = sqliteTable("Voter_Payouts", {
	ts: numeric().default(sql`(CURRENT_TIMESTAMP)`),
	voter: text({ length: 44 }),
	amount: integer().default(0),
	txHash: text("tx_hash", { length: 88 }),
},
(table) => {
	return {
		pk0: primaryKey({ columns: [table.voter, table.txHash], name: "Voter_Payouts_voter_tx_hash_pk"})
	}
});

export const voterBalances = sqliteTable("Voter_Balances", {
	updatedTs: numeric("updated_ts").default(sql`(CURRENT_TIMESTAMP)`),
	lastPeriod: integer("last_period").default(0),
	voter: text({ length: 44 }).primaryKey(),
	accruedRewards: integer("accrued_rewards").default(0),
	paidRewards: integer("paid_rewards").default(0),
});

export const rewardPeriods = sqliteTable("Reward_Periods", {
	startTs: numeric("start_ts"),
	endTs: numeric("end_ts"),
	startBlockId: integer("start_block_id"),
	endBlockId: integer("end_block_id"),
	periodNumber: integer("period_number").primaryKey({ autoIncrement: true }),
	budget: integer().default(0),
	allocated: integer().default(0),
});

export const rewardDistributions = sqliteTable("Reward_Distributions", {
	createdTs: numeric("created_ts").default(sql`(CURRENT_TIMESTAMP)`),
	updatedTs: numeric("updated_ts"),
	periodNumber: integer("period_number"),
	voter: text({ length: 44 }),
	reward: integer().default(0),
	distributed: integer().default(0),
},
(table) => {
	return {
		pk0: primaryKey({ columns: [table.periodNumber, table.voter], name: "Reward_Distributions_period_number_voter_pk"})
	}
});

