-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE `Voter_Credits` (
	`ts` numeric DEFAULT (CURRENT_TIMESTAMP),
	`period` integer,
	`user` text(44),
	`voter` text(44),
	`pda` text(44),
	`block_id` integer,
	`prev_block_id` integer,
	`final_hash` text(64),
	`credit` integer,
	`debit` integer,
	PRIMARY KEY(`period`, `user`, `voter`, `pda`, `final_hash`, `credit`)
);
--> statement-breakpoint
CREATE TABLE `Voters` (
	`ts` numeric DEFAULT (CURRENT_TIMESTAMP),
	`voter` text(44) PRIMARY KEY,
	`total_votes` integer DEFAULT 1,
	`last_block_id` integer,
	`last_backfilled_block_id` integer
);
--> statement-breakpoint
CREATE TABLE `Names` (
	`pubkey` text(44) PRIMARY KEY,
	`name` text
);
--> statement-breakpoint
CREATE TABLE `Votes` (
	`ts` numeric,
	`final_hash` text(64),
	`block_id` integer,
	`voter` text(44),
	PRIMARY KEY(`block_id`, `voter`)
);
--> statement-breakpoint
CREATE TABLE `Voter_Payouts` (
	`ts` numeric DEFAULT (CURRENT_TIMESTAMP),
	`voter` text(44),
	`amount` integer DEFAULT 0,
	`tx_hash` text(88),
	PRIMARY KEY(`voter`, `tx_hash`)
);
--> statement-breakpoint
CREATE TABLE `Voter_Balances` (
	`updated_ts` numeric DEFAULT (CURRENT_TIMESTAMP),
	`last_period` integer DEFAULT 0,
	`voter` text(44) PRIMARY KEY,
	`accrued_rewards` integer DEFAULT 0,
	`paid_rewards` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `Reward_Periods` (
	`start_ts` numeric,
	`end_ts` numeric,
	`start_block_id` integer,
	`end_block_id` integer,
	`period_number` integer PRIMARY KEY AUTOINCREMENT,
	`budget` integer DEFAULT 0,
	`allocated` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `Reward_Distributions` (
	`created_ts` numeric DEFAULT (CURRENT_TIMESTAMP),
	`updated_ts` numeric,
	`period_number` integer,
	`voter` text(44),
	`reward` integer DEFAULT 0,
	`distributed` integer DEFAULT 0,
	PRIMARY KEY(`period_number`, `voter`)
);

*/