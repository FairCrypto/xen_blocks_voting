import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';

dotenv.config();

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

const UPSERT_VOTE = `
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

const UPSERT_BACKFILLED_VOTE = `
    INSERT INTO Voters (voter, last_backfilled_block_id)
    VALUES (?, ?)
    ON CONFLICT(voter) DO UPDATE
    SET
        ts = CURRENT_TIMESTAMP,
        total_votes = CASE 
            WHEN excluded.last_backfilled_block_id > Voters.last_backfilled_block_id 
            THEN total_votes + 1
            ELSE total_votes
        END,     
        last_backfilled_block_id = CASE
            WHEN excluded.last_backfilled_block_id > Voters.last_backfilled_block_id 
            THEN excluded.last_backfilled_block_id
            ELSE Voters.last_backfilled_block_id
        END
   ;`;

let db: sqlite3.Database;

export const initDB = async (): Promise<sqlite3.Database> => {
    if (db) return Promise.resolve(db);

    db = new sqlite3.Database(process.env.DB_LOCATION);
    if (!db) return Promise.reject(new Error('DB not available'))

    try {
        db.exec(CREATE_VOTER_CREDITS_TABLE);
        db.exec(CREATE_VOTERS_TABLE);
        return Promise.resolve(db);
    } catch (e) {
        console.log(e)
        return Promise.reject(e)
    }
}

export const insertVoterCreditRecord = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return db.run(INSERT_VOTER_CREDIT, ...params);
}

export const updateVoter = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');
    return db.run(UPSERT_VOTE, ...params);
}

export const backfillVoter = async (...params: unknown[]): Promise<sqlite3.Database> => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return db.run(UPSERT_BACKFILLED_VOTE, ...params);
}

export const closeDB = (cb: (e: Error | null) => void) => {
    if (!db) throw new Error('DB not initialized or unavailable');

    return db.close(cb);
}