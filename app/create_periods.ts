import {BN} from "bn.js";
import dotenv from "dotenv";
import {
    initDB,
    getLastProcessedBlock,
    fetchRecordsInBatches,
    insertPeriod
} from "../db/db";
import sqlite3 from "sqlite3";

dotenv.config();

let db: sqlite3.Database | void;

const BATCH = 864;
const BUDGET = 1000;
const RETRY_PERIOD = 60_000;

async function main() {

    const [, , from] = process.argv;

    db = await initDB().then(() => console.log('db initialized'));

    const lastProcessed = await getLastProcessedBlock();
    console.log('last', lastProcessed?.end_block_id)
    const blockId = new BN(from || lastProcessed?.end_block_id);
    console.log('from', blockId.toNumber());
    // NB: 1 reward period ~~ 864 blocks

    try {
        // until interrupted
        while (true) {
            for await (const batch of fetchRecordsInBatches(blockId.toNumber(), BATCH)) {
                if (batch.length < BATCH) {
                    // console.log(`incomplete batch: got ${batch.length}, expected: ${BATCH}; will retry in ${RETRY_PERIOD / 1_000}`);
                    break
                }
                // Process each batch as needed
                // UPSERT_PERIOD (start_ts, end_ts, start_block_id, end_block_id, budget, allocated)
                await insertPeriod(null, null, batch[0].block_id, batch[batch.length - 1].block_id, BUDGET, 0);
                console.log('added period', batch[0].block_id, '..', batch[batch.length - 1].block_id)
                // pause 0.5s
                await new Promise((resolve) => setTimeout(resolve, 100))
            }

            // retry in ...
            await new Promise((resolve) => setTimeout(resolve, RETRY_PERIOD))
        }
    } catch (err) {
        console.error('Error fetching records:', err);
    }
}

main().then(_ => {
    if (db) db.close()
}).catch(console.error)