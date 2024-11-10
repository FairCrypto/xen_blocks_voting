import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import {initDB, closeDB, addVote} from "../db/db";

dotenv.config();

const app = express();
app.use(bodyParser.json());

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


// let prevPda = null;
// let keys = new Set()
let currentBlock = 0;

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
    // console.log('req', first_block_id, final_hash, pubkey);
    const blockId = Number(first_block_id);
    // const prevBlockId = Number(blockId) - 100;

    try {
        await addVote(Date.now(), blockId, final_hash, pubkey)
        console.log(`fill block: ${blockId}, hash: ${final_hash}, voter: ${pubkey}`)

    } catch (err) {
        // blacklist.add(pubkey);
        console.error(
            'error', currentBlock - blockId,
            final_hash?.slice(0, 8), pubkey, err.message || '?'
        );
        res.status(500).json({error: "Failed to add vote", details: err.toString()});
    }
});

// Endpoint to fetch and display data
app.get('/fetch_data_short/:block_id', async (_req, res) => {
    try {
        res.status(405).json({error: 'Not implemented'});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
});

app.get('/fetch_data/:block_id', async (_req, res) => {
    try {
        res.status(405).json({error: 'Not implemented'});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
});

app.get('/fetch_user/:pubkey/:period', async (_req, res) => {
    try {
        res.status(405).json({error: 'Not implemented'});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
});

app.get('/votes/last_block', async (_req, res) => {
    try {
        res.status(405).json({error: 'Not implemented'});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})
app.get('/votes/:block_id', async (_req, res) => {
    try {
        res.status(405).json({error: 'Not implemented'});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})
app.get('/votes', async (_req, res) => {
    try {
        res.status(405).json({error: 'Not implemented'});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

app.get('/stats/:period', async (_req, res) => {
    try {
        res.status(405).json({error: 'Not implemented'});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

app.get('/voters', async (_req, res) => {
    try {
        res.status(405).json({error: 'Not implemented'});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

app.get('/voter/:pubkey', async (_req, res) => {
    try {
        res.status(405).json({error: 'Not implemented'});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

const PORT = Number(process.env.SERVER_PORT || '') || 5555;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
