import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';

dotenv.config();

/*
const CREATE_VOTER_CREDITS_TABLE = `
            CREATE TABLE IF NOT EXISTS Voter_Credits (
                ts DATETIMETZ DEFAULT CURRENT_TIMESTAMP,
                period INTEGER,
                user VARCHAR(44),
                voter VARCHAR(44),
                pda VARCHAR(44),
                block_id INT8,
                prev_block_id INT8,
                final_hash VARCHAR(64),
                credit INT8,
                debit INT8,
                PRIMARY KEY (period, pda, user, voter, final_hash, credit)
            );`

const CREATE_VOTERS_TABLE = `
            CREATE TABLE IF NOT EXISTS Voters (
                ts DATETIMETZ DEFAULT CURRENT_TIMESTAMP,
                voter VARCHAR(44),
                total_votes INT8 DEFAULT 1,
                last_block_id INT8,
                last_backfilled_block_id INT8,
                PRIMARY KEY (voter)
            );`

const INSERT_VOTER_CREDIT = `
    INSERT INTO Voter_Credits (ts, period, user, voter, pda, block_id, prev_block_id, final_hash, credit, debit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING;
`;

const UPSERT_VOTER = `
    INSERT INTO Voters (voter, last_block_id)
    VALUES (?, ?)
    ON CONFLICT(voter) DO UPDATE
    SET
        ts = CURRENT_TIMESTAMP,
        total_votes = CASE
            WHEN excluded.last_block_id > Voters.last_block_id
            THEN total_votes + 1
            ELSE total_votes
        END,
        last_block_id = CASE
            WHEN excluded.last_block_id > Voters.last_block_id
            THEN excluded.last_block_id
            ELSE Voters.last_block_id
        END
   ;`;

const UPSERT_BACKFILLED_VOTER = `
    INSERT INTO Voters (voter, last_backfilled_block_id)
    VALUES (?, ?)
    ON CONFLICT(voter) DO UPDATE
    SET
        ts = CURRENT_TIMESTAMP,
        total_votes = CASE
            WHEN excluded.last_backfilled_block_id < Voters.last_backfilled_block_id
            THEN total_votes + 1
            ELSE total_votes
        END,
        last_backfilled_block_id = CASE
            WHEN excluded.last_backfilled_block_id < Voters.last_backfilled_block_id
            THEN excluded.last_backfilled_block_id
            ELSE Voters.last_backfilled_block_id
        END
   ;`;

const GET_VOTERS = `
    SELECT * FROM Voters ORDER BY total_votes DESC;
`;

const GET_VOTER = `
    SELECT * FROM Voters
    WHERE voter = (?);
`;

 */

// NEW SCHEMA -- TABLES

const CREATE_VOTES_TABLE = `
            CREATE TABLE IF NOT EXISTS Votes (
                ts DATETIMETZ,
                final_hash VARCHAR(64),
                block_id INT4,
                voter VARCHAR(44),
                PRIMARY KEY (block_id, voter)
            );`;

const CREATE_REWARD_PERIODS_TABLE = `
            CREATE TABLE IF NOT EXISTS Reward_Periods (
                start_ts DATETIME,
                end_ts DATETIME,
                start_block_id INTEGER,
                end_block_id INTEGER,
                period_number INTEGER PRIMARY KEY AUTOINCREMENT,
                budget INTEGER DEFAULT 0,
                allocated INTEGER DEFAULT 0
            );`;

const CREATE_DISTRIBUTIONS_TABLE = `
            CREATE TABLE IF NOT EXISTS Reward_Distributions (
                created_ts DATETIMETZ DEFAULT CURRENT_TIMESTAMP,
                updated_ts DATETIMETZ,
                period_number INTEGER,
                voter VARCHAR(44),
                reward INTEGER DEFAULT 0,
                distributed INTEGER DEFAULT 0,
                PRIMARY KEY (period_number, voter)
            );`;

const CREATE_VOTER_BALANCES_TABLE = `
            CREATE TABLE IF NOT EXISTS Voter_Balances (
                updated_ts DATETIMETZ DEFAULT CURRENT_TIMESTAMP,
                last_period INTEGER DEFAULT 0,
                voter VARCHAR(44),
                accrued_rewards INTEGER DEFAULT 0,
                paid_rewards INTEGER DEFAULT 0,
                PRIMARY KEY (voter)
            );`;

const CREATE_VOTER_PAYOUTS_TABLE = `
            CREATE TABLE IF NOT EXISTS Voter_Payouts (
                ts DATETIMETZ DEFAULT CURRENT_TIMESTAMP,
                voter VARCHAR(44),
                amount INTEGER DEFAULT 0,
                tx_hash VARCHAR(88),
                PRIMARY KEY (voter, tx_hash)
            );`;

// NEW SCHEMA -- MUTATIONS

const UPSERT_VOTE = `
            INSERT INTO Votes 
                (ts, block_id, final_hash, voter)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(block_id, voter) DO NOTHING
            ;`;

const UPSERT_BACKFILLED_VOTE = `
            INSERT INTO Votes 
                (block_id, final_hash, voter)
                VALUES (?, ?, ?)
                ON CONFLICT(block_id, voter) DO NOTHING
            ;`;

const INSERT_PERIOD = `
            INSERT INTO Reward_Periods 
                (start_ts, end_ts, start_block_id, end_block_id, budget, allocated)
                VALUES (?, ?, ?, ?, ?, ?)
            ;`;

const UPDATE_PERIOD = `
            UPDATE Reward_Periods
                SET allocated = allocated + ?
                WHERE period_number = ?
            ;`;

const UPSERT_REWARD = `
            INSERT INTO Reward_Distributions 
                (created_ts, period_number, voter, reward, distributed)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(period_number, voter) DO NOTHING
                -- WHERE Reward_Distributions.distributed = 0   
            ;`;

const UPSERT_VOTER_ACCRUED_BALANCE = `
            INSERT INTO Voter_Balances 
                (last_period, voter, accrued_rewards)
                VALUES (?, ?, ?)
                ON CONFLICT (voter)
                DO UPDATE SET
                    last_period = EXCLUDED.last_period,
                    accrued_rewards = Voter_Balances.accrued_rewards + EXCLUDED.accrued_rewards,
                    updated_ts = CURRENT_TIMESTAMP
                WHERE EXCLUDED.last_period > Voter_Balances.last_period;
            `;


// NEW SCHEMA -- QUERIES

const GET_LOWER_VOTE = `
            SELECT block_id
                FROM Votes
                ORDER BY block_id ASC
                LIMIT 1 OFFSET 1;
`;

const GET_LAST_PROCESSED_BLOCK = `
            SELECT * FROM Reward_Periods 
                ORDER BY end_block_id DESC
                LIMIT 1
            ;`;

const GET_LAST_PROCESSED_PERIOD = `
            SELECT * FROM Reward_Periods 
                WHERE allocated < budget * 9999 / 10000
                ORDER BY period_number ASC
                LIMIT 1
            ;`;

const GET_VOTES_BATCH = `
            SELECT DISTINCT block_id FROM Votes
                WHERE block_id >= COALESCE(?, (SELECT MIN(block_id) FROM Votes))
                ORDER BY block_id ASC
                LIMIT ? 
                OFFSET ?;
            `;

const GET_VOTES_BY_PERIOD = `
            SELECT 
                rp.period_number,
                v.voter,
                COUNT(v.voter) AS vote_count,
                COUNT(v.voter) * 1.0 / SUM(COUNT(v.voter)) OVER (PARTITION BY rp.period_number) AS vote_proportion
            FROM 
                Reward_Periods rp
            JOIN 
                Votes v ON v.block_id BETWEEN rp.start_block_id AND rp.end_block_id
            WHERE    
                rp.period_number = ?
            GROUP BY 
                rp.period_number, v.voter
            ORDER BY 
                rp.period_number, v.voter;
            `;

const GET_TOTAL_VOTES_BY_PERIOD = `
            SELECT 
                rp.period_number,
                COUNT(v.voter) AS total_votes
            FROM 
                Reward_Periods rp
            LEFT JOIN 
                Votes v ON v.block_id BETWEEN rp.start_block_id AND rp.end_block_id
            WHERE    
                rp.period_number = ?
            GROUP BY 
                rp.period_number
            ORDER BY 
                rp.period_number;
            `;

let db: sqlite3.Database;

export const initDB = async (): Promise<sqlite3.Database> => {
    if (db) return Promise.resolve(db);

    db = new sqlite3.Database(process.env.DB_LOCATION);
    if (!db) return Promise.reject(new Error('DB not available'))

    try {
        // db.exec(CREATE_VOTER_CREDITS_TABLE); // old
        // db.exec(CREATE_VOTERS_TABLE); // old
        db.exec(CREATE_VOTES_TABLE);
        db.exec(CREATE_REWARD_PERIODS_TABLE);
        db.exec(CREATE_DISTRIBUTIONS_TABLE);
        db.exec(CREATE_VOTER_BALANCES_TABLE);
        db.exec(CREATE_VOTER_PAYOUTS_TABLE);
        db.run('PRAGMA journal_mode = WAL;');
        return Promise.resolve(db);
    } catch (e) {
        console.log(e)
        return Promise.reject(e)
    }
}

/*
export const insertVoterCreditRecord = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return db.run(INSERT_VOTER_CREDIT, ...params);
}

export const updateVoter = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');
    return db.run(UPSERT_VOTER, ...params);
}

export const getVoterInfo = async (id: string): Promise<any> => {
    if (!db) throw new Error('DB not initialized or unavailable');
    return new Promise((resolve, reject) => {
        db.each(GET_VOTER, id, (err, rows) => {
            if (err) reject(err);
            resolve(rows)
        });
    });
}

export const getAllVoters = async (): Promise<any> => {
    if (!db) throw new Error('DB not initialized or unavailable');
    return new Promise((resolve, reject) => {
        db.all(GET_VOTERS, (err, rows) => {
            if (err) reject(err);
            resolve(rows)
        });
    });
}

export const backfillVoter = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return db.run(UPSERT_BACKFILLED_VOTER, ...params);
}
 */

export const addVote = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return db.run(UPSERT_VOTE, ...params);
}

export const backfillVote = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    const delay = 100;
    const retries = 5;
    return new Promise((resolve, reject) => {
        const attempt = (retryCount: number) => {
            db.run(UPSERT_BACKFILLED_VOTE, ...params, function (err: any, result: any) {
                if (err) {
                    if (err.message.includes("database is locked") && retryCount > 0) {
                        setTimeout(() => attempt(retryCount - 1), delay);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(this.changes);
                }
            });
        };
        attempt(retries);
    });
}

export const insertPeriod = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return db.run(INSERT_PERIOD, ...params);
}

export const updatePeriod = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return db.run(UPDATE_PERIOD, ...params);
}

export const upsertReward = async (...params: unknown[]): Promise<number> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return new Promise((resolve, reject) => db.run(UPSERT_REWARD, ...params, function (err: any) {
        if (err) reject(err);
        else resolve(this.changes);
    }));
}

export const upsertVoterBalance = async (...params: unknown[]): Promise<number> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return new Promise((resolve, reject) => db.run(UPSERT_VOTER_ACCRUED_BALANCE, ...params, function (err: any) {
        if (err) reject(err);
        else resolve(this.changes);
    }));
}

export const getLowerVote = async (...params: unknown[]): Promise<any> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return new Promise((resolve, reject) => db.get(GET_LOWER_VOTE, ...params, (err: any, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows);
    }));
}

export const getLastProcessedBlock = async (...params: unknown[]): Promise<any> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return new Promise((resolve, reject) => db.get(GET_LAST_PROCESSED_BLOCK, ...params, (err: any, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows);
    }));
}

export const getTotalVotesByPeriod = async (...params: unknown[]): Promise<any> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return new Promise((resolve, reject) => db.all(GET_TOTAL_VOTES_BY_PERIOD, ...params, (err: any, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows);
    }));
}

export const getVotesByPeriod = async (...params: unknown[]): Promise<any> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return new Promise((resolve, reject) => db.all(GET_VOTES_BY_PERIOD, ...params, (err: any, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows);
    }));
}

export async function* fetchRecordsInBatches(startFrom: number, batchSize: number) {
    if (!db) throw new Error('DB not initialized or unavailable');

    // Promisified function to fetch a range of records
    const fetchBatch = (offset: number): Promise<any[]> =>
        new Promise((resolve, reject) => {
            db.all(GET_VOTES_BATCH, [startFrom, batchSize, offset], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

    let offset = 0;
    while (true) {
        const records = await fetchBatch(offset);
        if (records.length === 0) break;
        yield records;
        offset += batchSize;
    }
}

export async function* fetchRewardPeriods() {
    if (!db) throw new Error('DB not initialized or unavailable');

    // Promisified function to fetch a range of records
    const fetchBatch = (offset: number): Promise<any> =>
        new Promise((resolve, reject) => {
            db.get(GET_LAST_PROCESSED_PERIOD, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

    let offset = 0;
    while (true) {
        const data = await fetchBatch(offset);
        if (!data) break;
        yield data;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
}

export const closeDB = (cb: (e: Error | null) => void) => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return db.close(cb);
}

export default db