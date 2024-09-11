import express from 'express';
import bodyParser from 'body-parser';
import {AnchorProvider, Program, workspace, web3, Wallet} from '@coral-xyz/anchor';
import {PublicKey, ComputeBudgetProgram} from '@solana/web3.js';
import BN from 'bn.js';
import type {GrowSpace} from '../target/types/grow_space';
import dotenv from 'dotenv';
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const provider = AnchorProvider.env();
const program = workspace.GrowSpace as Program<GrowSpace>;

const keyPairFileName = process.env.ANCHOR_WALLET || '';
const keyPairString = fs.readFileSync(path.resolve(keyPairFileName), 'utf-8');
const keyPair = web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(keyPairString)));
console.log('Using wallet', keyPair.publicKey.toBase58());
const wallet = new Wallet(keyPair);
console.log('Program ID', program.programId.toString())
console.log('Payer', provider.wallet.publicKey.toString())

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

const MAX_VOTES_BLOCKS = 10; // keep data on last 10 blocks
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

// const onVoterCredited = (e, ...rest) => console.log(e, ...rest)
program.addEventListener(
    'voterCredited',
    (e) => {
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
        console.log('credit: b=', prevBlockId, 'u=', e.user.toBase58(), 'v=', e.voter.toBase58(), 'c=', e.credit.toNumber())
    }
)

// let prevPda = null;
// let keys = new Set()
let current_block = 0;

// Endpoint to append data and initialize PDA if needed
app.post('/', async (req, res) => {
    const {first_block_id, final_hash, pubkey} = req.body;
    if (!first_block_id || !final_hash || !pubkey) {
        return res.status(400).json({
            error: "Bad request",
            details: "One or more of required params were not supplied"
        });
    }
    if (first_block_id > current_block) {
        current_block = first_block_id
    }
    // console.log('req', first_block_id, final_hash, pubkey);
    const block_id = first_block_id;
    const prev_block_id = Number(block_id) - 100;

    let uniqueId, prevUniqueId, pubkeyObj;
    try {
        uniqueId = new BN(block_id);
        prevUniqueId = new BN(prev_block_id);
        pubkeyObj = new PublicKey(pubkey);
    } catch (err) {
        return res.status(400).json({error: "Bad request", details: err.toString()});
    }

    const [treasury] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("blocks_treasury")],
        program.programId
    );
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

    let sig;
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
        // console.log(prev_block_id, 'all', allKeys.length, creditedVoters.length, filteredKeys.length)
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
                remaining
                    .map(({i}) => new BN(i))
            )
            .accountsPartial({
                treasury,
                periodCounter,
                pdaAccount: pda,
                userAccountPda: userPda,
                payer: provider.wallet.publicKey,
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
            'error', currentPeriod.toNumber(), first_block_id,
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

    const [pda] = await PublicKey.findProgramAddress(
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

    const [pda] = await PublicKey.findProgramAddress(
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
            current_block,
        });
    } catch (err) {
        console.log(err)
        res.status(500).json({error: "Failed to fetch user data", details: err.toString()});
    }
});

app.get('/votes/last_block', async (req, res) => {
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
app.get('/votes', async (req, res) => {
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


const PORT = 5555;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
