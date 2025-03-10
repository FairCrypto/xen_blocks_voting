import path from "node:path";
import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import {initDB, closeDB} from "../db/db";
import * as dbInstance from '../db/db'
import {votes} from "../drizzle/schema_psql.ts/schema";

dotenv.config();

let db = dbInstance.default;

initDB()
    .then((newDb) => {
        db = newDb
        console.log('db initialized')
    })
    .catch(e => {
        console.error(e);
        process.exit(1)
    });


const app = express();
app.use(bodyParser.json());
// Global error handler to catch timeout errors
app.use((err: any, _req: any, res: any, _next: any) => {
    console.error(err.message);
    if (!res.headersSent) {
        res.status(500).send({error: err.message});
    }
    // Optionally force the app to fail (exit the process)
    process.exit(1);
});


initDB()
    .then(() => console.log('db initialized'))
    .catch(e => {
        console.error(e);
        process.exit(1)
    });

const closeServer = () => {
    console.log('closing server');
    closeDB(() => console.log('db closed'));
    process.exit(1)
};

process.on("SIGINT", closeServer);
process.on("SIGABRT", closeServer);

let currentBlock = 0;

// oasGenerator.handleResponses(app, {});

// Endpoint to append data and initialize PDA if needed
app.post('/', async (req, res) => {
    const {first_block_id, final_hash, pubkey}: {
        first_block_id: string,
        final_hash: string,
        pubkey: string
    } = req.body;
    if (!first_block_id || !final_hash || !pubkey) {
        return res.status(400).json({
            error: "Bad request",
            details: "One or more of required params were not supplied"
        });
    }
    if (Number(first_block_id) > currentBlock) {
        currentBlock = Number(first_block_id)
    }
    const blockId = Number(first_block_id);

    try {

        // Run the handler and race it against the timeout
        // await addVote(Date.now(), blockId, final_hash, pubkey),
        //     console.log(`fill block: ${blockId}, hash: ${final_hash}, voter: ${pubkey}`);

        await db.insert(votes).values({
            ts: new Date().toISOString(),
            finalHash: final_hash,
            blockId,
            voter: pubkey
        })
        console.log(`fill block: ${blockId}, hash: ${final_hash}, voter: ${pubkey}`);
        return res.sendStatus(200)

    } catch (err) {
        // blacklist.add(pubkey);
        console.error(
            'error', currentBlock - blockId,
            final_hash?.slice(0, 8), pubkey, err.message || '?'
        );
        res.status(500).json({error: "Failed to add vote", details: err.toString()});
    }
});

// oasGenerator.handleRequests();

const PORT = Number(process.env.SERVER_PORT || '') || 4444;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
