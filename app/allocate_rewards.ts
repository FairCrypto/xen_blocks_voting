import dotenv from "dotenv";
import Db, {
    initDB,
    getLastProcessedBlock,
    fetchRewardPeriods,
    getVotesByPeriod, upsertReward, updatePeriod, upsertVoterBalance,
} from "../db/db";
import sqlite3 from "sqlite3";
import {assert} from "chai";

dotenv.config();

let db: sqlite3.Database | void;

const RETRY_PERIOD = 20_000;

async function main() {
    db = await initDB().then(() => console.log('db initialized'));

    const {period_number, end_block_id} = await getLastProcessedBlock() || {};
    console.log('last period', period_number, 'end block_id', end_block_id)

    try {
        // until interrupted
        while (true) {
            for await (const period of fetchRewardPeriods()) {
                console.log(period)
                if (!period) {
                    console.log(`no new periods; will retry in ${RETRY_PERIOD / 1_000}`);
                    break
                }

                const {period_number, budget, allocated} = period;
                const votesByPeriod = await getVotesByPeriod(period_number);

                for await (const voterInfo of votesByPeriod) {
                    const {period_number: p, voter, vote_proportion} = voterInfo;
                    assert.ok(p === period_number, 'bad record?');
                    const amount = Math.min(budget - allocated, vote_proportion * budget);
                    // (created_ts, period_number, voter, reward, distributed)
                    const res = await upsertReward(new Date().toISOString(), period_number, voter, amount, 0);
                    if (res > 0) {
                        // (last_period, voter, accrued_rewards)
                        await upsertVoterBalance(period_number, voter, amount);
                        await updatePeriod(amount, period_number);
                        console.log(`updated distribution and voter: period=${period_number}, voter=${voter}, pct=${vote_proportion}, amount=${amount}`);
                    } else {
                        console.log(`skipped distribution (double?): period=${period_number}, voter=${voter}, pct=${vote_proportion}, amount=${amount}`);
                    }
                    await new Promise((resolve) => setTimeout(resolve, 10))
                }

                await new Promise((resolve) => setTimeout(resolve, 100))
            }

            // retry in ...
            await new Promise((resolve) => setTimeout(resolve, RETRY_PERIOD))
        }

    } catch (err: any) {
        console.error('Error allocating rewards:', err);
    }
}

main().then(_ => {
    if (db) db.close()
}).catch(console.error)