import path from "node:path";
import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import {initDB, closeDB, addVote} from "../db/db";
import {and, asc, desc, eq} from 'drizzle-orm';
import {
    votes,
    rewardDistributions,
    rewardPeriods,
    voterBalances,
    voterPayouts
} from '../drizzle/schema.ts/schema';
import {groupBy} from 'lodash'
import redoc from 'redoc-express'
import {drizzle} from 'drizzle-orm/libsql';

// import oasGenerator from 'express-oas-generator'

dotenv.config();


const db = drizzle(process.env.DB_FILE_NAME!);
const schemaPath = path.resolve('.', 'static', 'openapi-schema.json');

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

/**
 * @deprecated. use ... instead
 */
app.get('/fetch_data/:block_id', async (req, res) => {
    const blockId = Number(req.params.block_id) || 0;
    try {
        // const data = await db.select().from(votes).where(eq(votes.blockId, blockId));
        const data = await db
            .select({
                finalHash: votes.finalHash,
                voter: votes.voter,
            })
            .from(votes)
            .where(eq(votes.blockId, blockId));
        const grouped = groupBy(data, 'finalHash')
        res.status(200).json({
            blockId,
            entries: [
                {
                    blockId,
                    finalHashes: Object.entries(grouped)
                        .reduce((acc, [finalHash, entries]: [string, any[]]) => {
                            acc.push({
                                finalHash,
                                count: entries.length,
                                pubkeys: entries.map((e) => e.voter)
                            });
                            return acc;
                        }, [])
                }
            ]
        });
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
});


app.get('/fetch_user/:pubkey/:period', async (req, res) => {
    const {pubkey, period} = req.params;
    const periodNumber = Number(period) || 0;
    try {
        const data = await db.select()
            .from(rewardDistributions)
            .where(and(eq(rewardDistributions.periodNumber, periodNumber), eq(rewardDistributions.voter, pubkey)))
        res.status(200).json(data);
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
});

app.get('/votes/last_block', async (_req, res) => {
    try {
        const data = await db
            .select({
                blockId: votes.blockId,
            })
            .from(votes).orderBy(desc(votes.blockId)).limit(1);
        res.status(200).json({blockId: data?.[0]?.blockId});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

/*
    blocks
        last
    votes
        last
        by block
        by block and user
        by user
    periods
        last
        by number
        by user
        by user and period
    users

 */


app.get('/periods', async (req, res) => {
    const {from, limit} = req.query;
    const fromNumber = Number(from) || 0;
    const limitNumber = Number(limit) || 100;
    try {
        const count = await db.$count(rewardPeriods);
        const data = await db
            .select({
                periodNumber: rewardPeriods.periodNumber,
                startBlockId: rewardPeriods.startBlockId,
                endBlockId: rewardPeriods.endBlockId,
                allocated: rewardPeriods.allocated,
                budget: rewardPeriods.budget,
            })
            .from(rewardPeriods)
            .orderBy(asc(rewardPeriods.periodNumber))
            .offset(fromNumber)
            .limit(limitNumber);
        res.status(200).json({count, periods: data});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})
app.get('/periods/:period', async (req, res) => {
    try {
        const {period} = req.params;
        const periodNumber = Number(period) || 0;
        const data = await db
            .select({
                startBlockId: rewardPeriods.startBlockId,
                endBlockId: rewardPeriods.endBlockId,
                allocated: rewardPeriods.allocated,
                budget: rewardPeriods.budget,
            })
            .from(rewardPeriods)
            .where(eq(rewardPeriods.periodNumber, periodNumber));
        res.status(405).json({period: data});
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

app.get('/voters', async (req, res) => {
    try {
        const {from, limit} = req.query;
        const fromNumber = Number(from) || 0;
        const limitNumber = Number(limit) || 100;
        const count = await db.$count(db.selectDistinct({voter: votes.voter}).from(votes));
        const distinctVoters = db
            .select({voter: votes.voter})
            .from(votes)
            .offset(fromNumber)
            .limit(limitNumber)
            .groupBy(votes.voter).as('sq');
        const data = await db
            .select()
            .from(distinctVoters)
            .leftJoin(rewardDistributions, eq(distinctVoters.voter, rewardDistributions.voter))
        const grouped = groupBy(data
            .filter((e) => !!e.Reward_Distributions)
            .map((e) => {
                const {voter, periodNumber, reward, distributed, ...rest} = e.Reward_Distributions;
                return {periodNumber, reward, distributed, voter}
            }), 'voter')
        res.status(200).json({count, voters: grouped})
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

app.get('/voter/:pubkey', async (req, res) => {
    const {pubkey} = req.params;
    try {
        const data = await db
            .select({
                periodNumber: rewardDistributions.periodNumber,
                reward: rewardDistributions.reward,
                distributed: rewardDistributions.distributed,
            })
            .from(rewardDistributions)
            .where(eq(rewardDistributions.voter, pubkey))
        res.status(200).json(data)
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

app.get('/voter/:pubkey/balance', async (req, res) => {
    const {pubkey} = req.params;
    try {
        const data = await db
            .select({
                voter: voterBalances.voter,
                accruedRewards: voterBalances.accruedRewards,
                paidRewards: voterBalances.paidRewards,
                lastPeriod: voterBalances.lastPeriod,
            })
            .from(voterBalances)
            .where(eq(voterBalances.voter, pubkey))
        res.status(200).json(data?.[0])
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

app.get('/voter/:pubkey/payouts', async (req, res) => {
    const {pubkey} = req.params;
    try {
        const data = await db
            .select({
                voter: voterPayouts.voter,
                amount: voterPayouts.amount,
                txHash: voterPayouts.txHash,
                ts: voterPayouts.ts,
            })
            .from(voterPayouts)
            .where(eq(voterPayouts.voter, pubkey))
        res.status(200).json(data)
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
})

app.get('/schema', (req, res) => {
    res.sendFile(schemaPath);
});

// Serve ReDoc documentation
app.get('/docs', redoc({
    title: 'API Docs',
    specUrl: '/schema',
    // Optional: Redoc options for customization
    redocOptions: {
        theme: {
            colors: {primary: {main: '#6EC5AB'}},
            typography: {fontFamily: '"museo-sans", "Helvetica Neue", Helvetica, Arial, sans-serif'}
        }
    }
}));

// oasGenerator.handleRequests();

const PORT = Number(process.env.SERVER_PORT || '') || 5555;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
