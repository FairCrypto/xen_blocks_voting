import express from 'express';
import bodyParser from 'body-parser';
import {AnchorProvider, Program, workspace, web3, Wallet, setProvider} from '@coral-xyz/anchor';
import {PublicKey, ComputeBudgetProgram, Connection, StakeProgram, LAMPORTS_PER_SOL} from '@solana/web3.js';
import BN from 'bn.js';
import type {GrowSpace} from '../target/types/grow_space';
import dotenv from 'dotenv';
import fs from "node:fs";
import path from "node:path";
import {initDB, insertVoterCreditRecord, closeDB, updateVoter} from "../db/db";

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

const keyPairFileName = process.env.ANCHOR_WALLET || '';
const keyPairString = fs.readFileSync(path.resolve(keyPairFileName), 'utf-8');
const keyPair = web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(keyPairString)));
console.log('Using wallet', keyPair.publicKey.toBase58());

const wallet = new Wallet(keyPair);
const provider = AnchorProvider.env();
setProvider(provider);

const program = workspace.GrowSpace as Program<GrowSpace>;

console.log('Program ID', program.programId.toBase58());
console.log('Payer', provider.wallet.publicKey.toBase58());

let stakingAccount;
const MIN_STAKE = 0.01 * LAMPORTS_PER_SOL;

web3.PublicKey.createWithSeed(
    wallet.publicKey,
    "1",
    StakeProgram.programId
).then(a => {
    stakingAccount = a;
    console.log('Staking account addr', stakingAccount.toBase58());
    return a;
}).then(async a => {
    const instruction = await program.methods.createStakeAccount(new BN(MIN_STAKE))
        .accounts({
            staker: wallet.publicKey,
            stakingAccount,
            // systemProgram: SystemProgram.programId,
            // stakeProgram: StakeProgram.programId
        })
        //.signers([])
        .instruction();
    const recentBlockhash = await provider.connection.getLatestBlockhash();
    const transaction = new web3.Transaction({
        feePayer: wallet.publicKey,
        recentBlockhash: recentBlockhash.blockhash
    }).add(instruction)
    transaction.partialSign(keyPair);
    const ss = await provider.connection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: 'finalized',
        skipPreflight: true,
        // maxRetries: 1
    })
    console.log('created admin staking account', ss)
});

// Function to check if a PDA account already exists
async function pdaExists(pda: PublicKey) {
    try {
        const accountInfo = await provider.connection.getAccountInfo(pda);
        return accountInfo !== null;
    } catch (_) {
        return false
    }
}

// caching of user PDAs
const userPDAs = new Map<number, Map<string, string>>();
// const blacklist = new Set<string>();

const getUserPda = (pubkey: PublicKey, period: BN) => {
    if (userPDAs.has(period.toNumber()) && userPDAs.get(period.toNumber()).has(pubkey.toBase58())) {
        return new PublicKey(userPDAs.get(period.toNumber()).get(pubkey.toBase58()));
    }
    const pdas = userPDAs.has(period.toNumber()) ? userPDAs.get(period.toNumber()) : new Map<string, string>();
    const [userPda] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("user_account_pda"),
            pubkey.toBytes(),
            period.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
    )
    pdas.set(pubkey.toBase58(), userPda.toBase58())
    userPDAs.set(period.toNumber(), pdas)
    return userPda;
}

const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000
});

const MAX_VOTES_BLOCKS = 20; // keep data on last 10 blocks
let votes = new Map<number, Array<{ pubkey: string, credit: number }>>();

const getVoters = (prevUniqueId: BN) => {
    return (votes.has(prevUniqueId.toNumber()) ? votes.get(prevUniqueId.toNumber()) : [])
        .map(v => v.pubkey)
}

const getVoterCredit = (blockId: number, pubkey: PublicKey) => {
    if (votes.has(blockId)) {
        const data = votes.get(blockId).find((v) => v.pubkey === pubkey.toBase58());
        return data?.credit
    } else {
        return null
    }
}

const [treasury] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("blocks_treasury")],
    program.programId
);

let period = 0;

program.account.treasuryAccount.fetch(treasury).then((t) => {
    period = t.currentPeriod.toNumber()
})

program.addEventListener(
    'newPeriod', e => {
        period = e.newPeriod.toNumber();
        console.log('new period', e.newPeriod.toNumber(), 'prev.cred', e.prevCredit.toNumber())
    })

program.addEventListener(
    'voterCredited',
    async (e) => {
        const prevBlockId = e.blockId.toNumber() - 100;
        if (votes.has(prevBlockId)) {
            const voters = votes.get(prevBlockId) || [];
            votes.set(prevBlockId, [...voters, {pubkey: e.voter.toBase58(), credit: e.credit.toNumber()}])
        } else {
            votes.set(prevBlockId, [{pubkey: e.voter.toBase58(), credit: e.credit.toNumber()}])
        }
        // Step 1: Extract keys and sort them in descending order
        const sortedKeys = Array.from(votes.keys()).sort((a, b) => b - a);

        // Step 2: Iterate through the keys and delete the ones we don't need
        for (let i = MAX_VOTES_BLOCKS; i < sortedKeys.length; i++) {
            votes.delete(sortedKeys[i]);
        }
        // console.log(votes)
        // ts, period, user, voter, pda, block_id, prev_block_id, final_hash, credit, debit
        await insertVoterCreditRecord(
            Date.now() / 1_000,
            Number(((e as any).period || period).toString()), // TODO: stub before we add period to the Program even
            e.user.toBase58(),
            e.voter.toBase58(),
            e.pda.toBase58(),
            e.blockId.toString(),
            prevBlockId.toString(),
            Buffer.from(e.finalHash).toString(),
            1,
            0
        );
        await updateVoter(
            e.voter.toBase58(),
            prevBlockId > 0 ? prevBlockId.toString() : '0'
        );
        console.log('credit: b=', prevBlockId, 'u=', e.user.toBase58(), 'v=', e.voter.toBase58(), 'c=', e.credit.toNumber())
    }
)

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
    const prevBlockId = Number(blockId) - 100;

    let uniqueId: BN, prevUniqueId: BN, pubkeyObj: PublicKey;
    try {
        uniqueId = new BN(blockId);
        prevUniqueId = new BN(prevBlockId);
        pubkeyObj = new PublicKey(pubkey);
    } catch (err) {
        return res.status(400).json({error: "Bad request", details: err.toString()});
    }

    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pda_account"), uniqueId.toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const [prevPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pda_account"), prevUniqueId.toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const treasuryState = await program.account.treasuryAccount.fetch(treasury);
    const currentPeriod = treasuryState.currentPeriod;

    const [periodCounter] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("period_counter"),
            currentPeriod.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
    )
    const [userPda] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("user_account_pda"),
            pubkeyObj.toBytes(),
            currentPeriod.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
    );

    // let sig;
    try {
        // Check if the PDA already exists
        const exists = await pdaExists(pda);
        if (!exists) {
            // Initialize the PDA if it does not exist
            try {
                await program.methods.initializePda(uniqueId).accounts({
                    // pdaAccount: pda,
                    payer: provider.wallet.publicKey,
                    // systemProgram: web3.SystemProgram.programId,
                })
                    .signers([wallet.payer])
                    .rpc({commitment: "confirmed", skipPreflight: false});
                // console.log("Initialized PDA account public key:", pda.toString(), "with bump:", bump);
            } catch (err) {
                // throw new Error(`Failed to initialize PDA: ${err.message}`);
            }
        } else {
            // console.log("PDA already initialized, proceeding to append data.");
        }

        const prevExists = prevPda && await pdaExists(prevPda);
        const prevPDAData = prevExists
            ? await program.account.pdaAccount.fetch(prevPda)
            : null;
        const creditedVoters = getVoters(prevUniqueId);
        const allKeys = (prevPDAData?.blockIds?.[0]?.finalHashes?.[0]?.pubkeys || [])
            .map((k, i) => ({i, k}));
        const filteredKeys = allKeys
            // .filter(({k}) => !blacklist.has(k.toBase58()))
            .filter(({k}) => !creditedVoters.includes(k.toBase58()));
        const shuffled = filteredKeys.sort(() => 0.5 - Math.random());

        const remaining = shuffled
            .filter(({k}) => !!k)
            .slice(0, 3)
            .map(({k, i}) => ({
                i,
                pubkey: getUserPda(k, currentPeriod),
                isSigner: false,
                isWritable: true
            })).filter(({pubkey}) => !!pubkey)

        // Append the data
        const instruction = await program.methods
            .appendData(
                uniqueId,
                final_hash,
                pubkeyObj,
                currentPeriod,
                remaining.map(({i}) => new BN(i))
            )
            .accountsPartial({
                treasury,
                periodCounter,
                pdaAccount: pda,
                userAccountPda: userPda,
                payer: provider.wallet.publicKey,
                stakingAccount,
                prevPdaAccount: prevExists ? prevPda : null, // [...pdas].slice(-1)[0] || null,
                systemProgram: web3.SystemProgram.programId,
                // programId: program.programId
            })
            .remainingAccounts(remaining.map(({i, ...rest}) => ({...rest})))
            .preInstructions([modifyComputeUnits])
            /*
            .instruction();

            const recentBlockhash = await provider.connection.getLatestBlockhash();
            const transaction = new web3.Transaction({
                feePayer: provider.wallet.publicKey,
                recentBlockhash: recentBlockhash.blockhash
            }).add(instruction);

            transaction.partialSign(provider.wallet.payer);

            const sig = await provider.connection.sendRawTransaction(transaction.serialize(), {
                preflightCommitment: 'processed',
                skipPreflight: false,
                maxRetries: 1
            })
             */
            .signers([wallet.payer])
            .rpc({commitment: "processed", skipPreflight: false});

        console.log(
            'processed', currentPeriod.toNumber(), first_block_id, remaining?.length || '-',
            final_hash?.slice(0, 8), pubkey, pda?.toString(), instruction
        );
        await updateVoter(
            pubkeyObj.toBase58(),
            blockId
        );
        res.status(200).json({
            message: "Appended data",
            pda: pda.toString(),
            sig: instruction,
            user: pubkeyObj.toString(),
            period: currentPeriod.toNumber()
        });
        // pdas.add(pda);
        // keys.add(pubkeyObj)
    } catch (err) {
        // blacklist.add(pubkey);
        console.error(
            'error', currentPeriod.toNumber(), currentBlock - blockId,
            final_hash?.slice(0, 8), pubkey, pda?.toString(), err.message || '?'
        );
        res.status(500).json({error: "Failed to append data", details: err.toString()});
    }
});

// Endpoint to fetch and display data
app.get('/fetch_data_short/:block_id', async (req, res) => {
    const block_id = parseInt(req.params.block_id);
    if (isNaN(block_id)) {
        return res.status(400).json({error: "Invalid block_id"});
    }

    const uniqueId = new BN(block_id);

    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pda_account"), uniqueId.toArrayLike(Buffer, "le", 8)],
        program.programId
    );

    try {
        // console.log(`Fetching data for block_id: ${block_id}, PDA: ${pda.toString()}`);
        const account = await program.account.pdaAccount.fetch(pda);
        const blockInfo = {
            blockId: block_id,
            entries: account.blockIds.map(entry => ({
                blockId: entry.blockId.toString(),
                finalHashes: entry.finalHashes.map(hashEntry => ({
                    finalHash: Buffer.from(hashEntry.finalHash).toString('utf8'),  // Convert finalHash bytes to string
                    count: hashEntry.pubkeys.length,
                    pubkeys: hashEntry.pubkeys.length,
                    creditedVoters: (votes.get(uniqueId.toNumber()) || []).length
                }))
            })),
        };
        res.status(200).json(blockInfo);
    } catch (err) {
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
});

app.get('/fetch_data/:block_id', async (req, res) => {
    const block_id = parseInt(req.params.block_id);
    if (isNaN(block_id)) {
        return res.status(400).json({error: "Invalid block_id"});
    }

    const uniqueId = new BN(block_id);

    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pda_account"), uniqueId.toArrayLike(Buffer, "le", 8)],
        program.programId
    );

    try {
        // console.log(`Fetching data for block_id: ${block_id}, PDA: ${pda.toString()}`);
        const account = await program.account.pdaAccount.fetch(pda);
        const blockInfo = {
            blockId: block_id,
            entries: account.blockIds.map(entry => ({
                blockId: entry.blockId.toString(),
                finalHashes: entry.finalHashes.map(hashEntry => ({
                    finalHash: Buffer.from(hashEntry.finalHash).toString('utf8'),  // Convert finalHash bytes to string
                    count: hashEntry.pubkeys?.length,
                    pubkeys: (hashEntry.pubkeys || []).reduce((acc, pubkey) => {
                        acc[pubkey.toBase58()] = getVoterCredit(block_id, pubkey)
                        return acc;
                    }, {}),
                    creditedVoters: (votes.get(uniqueId.toNumber()) || []).length
                }))
            })),
        };
        res.status(200).json(blockInfo);
    } catch (err) {
        res.status(500).json({error: "Failed to fetch data", details: err.toString()});
    }
});

app.get('/fetch_user/:pubkey/:period', async (req, res) => {

    try {
        // console.log(`Fetching user data for pubkey: ${pubkeyObj.toString()}, PDA: ${userPda.toString()}`);
        const pubkeyObj = new PublicKey(req.params.pubkey);

        const userPda = getUserPda(pubkeyObj, new BN(req.params.period || 0))
        if (!userPda) {
            return res.status(404)
        }

        const account = await program.account.userPeriodCounter.fetch(userPda);
        /*
        const blockInfo = {
            blockId: block_id,
            entries: account.blockIds.map(entry => ({
                blockId: entry.blockId.toString(),
                finalHashes: entry.finalHashes.map(hashEntry => ({
                    finalHash: Buffer.from(hashEntry.finalHash).toString('utf8'),  // Convert finalHash bytes to string
                    count: parseInt(hashEntry.count, 10),
                    pubkeys: hashEntry.pubkeys.map(pubkey => pubkey.toString())
                }))
            }))
        };
        */
        res.status(200).json({
            ...account,
            inblock: parseInt(account.inblock.toString(), 10),
            currentBlock: currentBlock,
        });
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch user data", details: err.toString()});
    }
});

app.get('/votes/last_block', async (_req, res) => {
    const sortedKeys = Object.keys(Object.fromEntries(votes)).sort();
    const sortedVotes = {};
    sortedKeys.forEach(key => {
        sortedVotes[key] = Object.fromEntries(votes)[key];
    });

    res.status(200).json({
        [Object.keys(sortedVotes).slice(-1)[0]]: Object.values(sortedVotes).slice(-1)[0]
    });
})
app.get('/votes/:block_id', async (req, res) => {
    res.status(200).json({
        votes: Object.fromEntries(votes)[Number(req.params.block_id)]
    });
})
app.get('/votes', async (_req, res) => {
    const sortedKeys = Object.keys(Object.fromEntries(votes)).sort();
    const sortedVotes = {};
    sortedKeys.forEach(key => {
        sortedVotes[key] = Object.fromEntries(votes)[key];
    });

    res.status(200).json({
        votes: sortedVotes
    });
})

app.get('/stats/:period', async (req, res) => {
    if (!userPDAs.has(Number(req.params?.period))) {
        return res.status(404)
    }
    res.status(200).json({
        userPDAs: Object.fromEntries(Object.fromEntries(userPDAs)[Number(req.params.period)]),
        userPDAsCount: Object.keys(Object.fromEntries(Object.fromEntries(userPDAs)[Number(req.params.period)])).length,
    });
})

const PORT = Number(process.env.SERVER_PORT || '') || 5555;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
