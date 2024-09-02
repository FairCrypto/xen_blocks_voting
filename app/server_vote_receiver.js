const express = require('express');
const bodyParser = require('body-parser');
const anchor = require('@coral-xyz/anchor');
const {PublicKey, ComputeBudgetProgram, Keypair} = require('@solana/web3.js');
const {Program, web3} = require('@coral-xyz/anchor');
const {BN} = require('bn.js');
require("dotenv").config();

// const GrowSpace = require("../target/types/grow_space");

const app = express();
app.use(bodyParser.json());

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.GrowSpace;

console.log('program ID', program.programId.toString())
console.log('payer', provider.wallet.payer.publicKey.toString())
// console.log('connection', provider.connection)

// Function to check if a PDA account already exists
async function pdaExists(pda) {
    try {
        const accountInfo = await provider.connection.getAccountInfo(pda);
        return accountInfo !== null;
    } catch (_) {
        return false
    }
}

// caching of user PDAs
const userPDAs = new Map()

const getUserPda = (pubkey) => {
    if (userPDAs.has(pubkey.toBase58())) {
        return userPDAs.get(pubkey.toBase58());
    }
    const [userPda] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user_account_pda"), pubkey.toBytes()],
        program.programId
    )
    userPDAs.set(pubkey.toBase58(), userPda)
    return userPda;
}

const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000
});

const MAX_VOTES_BLOCKS = 10; // keep data on last 10 blocks
let votes = new Map();

const getVoters = (prevUniqueId) => {
    return (votes.has(prevUniqueId.toNumber()) ? votes.get(prevUniqueId.toNumber()) : [])
        .map(v => v.pubkey)
}

const getVoterCredit = (blockId, pubkey) => {
    if (votes.has(blockId)) {
        return votes.get(blockId)[pubkey.toString()]?.credit
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
            votes.set(prevBlockId, [...voters, {pubkey: e.voter.toString(), credit: e.credit.toNumber()}])
        } else {
            votes.set(prevBlockId, [{pubkey: e.voter.toString(), credit: e.credit.toNumber()}])
        }
        // Step 1: Extract keys and sort them in descending order
        const sortedKeys = Array.from(votes.keys()).sort((a, b) => b - a);

        // Step 2: Iterate through the keys and delete the ones we don't need
        for (let i = MAX_VOTES_BLOCKS; i < sortedKeys.length; i++) {
            votes.delete(sortedKeys[i]);
        }
        // console.log(votes)
        console.log('credit: b=', prevBlockId, 'u=', e.user.toString(), 'v=', e.voter.toString(), 'c=', e.credit.toNumber())
    }
)

// let prevPda = null;
// let keys = new Set()
let current_block = 0;

// Endpoint to append data and initialize PDA if needed
app.post('/', async (req, res) => {
    const {first_block_id, final_hash, pubkey} = req.body;
    if (first_block_id > current_block) {
        current_block = first_block_id
    }
    // console.log('req', first_block_id, final_hash, pubkey);
    const block_id = first_block_id;
    const prev_block_id = Number(block_id) - 100;

    const uniqueId = new BN(block_id);
    const prevUniqueId = new BN(prev_block_id);
    const pubkeyObj = new PublicKey(pubkey);

    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pda_account"), uniqueId.toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const [prevPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pda_account"), prevUniqueId.toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const [userPda] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user_account_pda"), pubkeyObj.toBytes()],
        program.programId
    )

    let sig;
    try {
        // Check if the PDA already exists
        const exists = await pdaExists(pda);
        if (!exists) {
            // Initialize the PDA if it does not exist
            try {
                await program.methods.initializePda(uniqueId).accounts({
                    pdaAccount: pda,
                    payer: provider.wallet.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                    .signers([provider.wallet.payer])
                    .rpc({commitment: "confirmed", skipPreflight: false});
                // console.log("Initialized PDA account public key:", pda.toString(), "with bump:", bump);
            } catch (err) {
                // throw new Error(`Failed to initialize PDA: ${err.message}`);
            }
        } else {
            // console.log("PDA already initialized, proceeding to append data.");
        }

        // console.log('keys', keys.size)
        // if (keys.size > 5) {
        //    keys = new Set([...keys].slice(-5))
        // }

        const prevExists = prevPda && await pdaExists(prevPda);
        const prevPDAData = prevExists
            ? await program.account.pdaAccount.fetch(prevPda)
            : null;
        const creditedVoters = getVoters(prevUniqueId);
        const allKeys = (prevPDAData?.blockIds?.[0]?.finalHashes?.[0]?.pubkeys || [])
            .map((k, i) => ({i, k}));
        const filteredKeys = allKeys.filter(({k}) => !creditedVoters.includes(k.toBase58()));
        // console.log(prev_block_id, 'all', allKeys.length, creditedVoters.length, filteredKeys.length)
        const shuffled = filteredKeys.sort(() => 0.5 - Math.random());

        const remaining = shuffled
            .filter(({k}) => !!k)
            .slice(0, 5)
            .map(({k}) => ({
                pubkey: getUserPda(k),
                isSigner: false,
                isWritable: true
            }))

        // Append the data
        const instruction = await program.methods
            .appendData(uniqueId, final_hash, pubkeyObj, shuffled.filter(({k}) => !!k).slice(0, 5).map(({i}) => new BN(i)))
            .accountsPartial({
                pdaAccount: pda,
                userAccountPda: userPda,
                payer: provider.wallet.publicKey,
                prevPdaAccount: prevExists ? prevPda : null, // [...pdas].slice(-1)[0] || null,
                systemProgram: anchor.web3.SystemProgram.programId,
                programId: program.programId
            })
            .remainingAccounts(remaining)
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
            .signers([provider.wallet.payer])
            .rpc({commitment: "processed", skipPreflight: false});
        console.log('processed', first_block_id, final_hash?.slice(0, 8), pubkey, pda?.toString(), instruction);
        res.status(200).json({
            message: "Appended data",
            pda: pda.toString(),
            sig: instruction,
            user: pubkeyObj.toString()
        });
        // pdas.add(pda);
        // keys.add(pubkeyObj)
    } catch (err) {
        console.error('error', first_block_id, final_hash?.slice(0, 8), pubkey, pda?.toString(), err.message);
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
                    count: parseInt(hashEntry.count, 10) || hashEntry.pubkeys.length,
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
                    count: parseInt(hashEntry.count, 10) || hashEntry.pubkeys?.length,
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

app.get('/fetch_user/:pubkey', async (req, res) => {

    const pubkeyObj = new PublicKey(req.params.pubkey);

    const userPda = getUserPda(pubkeyObj)

    try {
        // console.log(`Fetching user data for pubkey: ${pubkeyObj.toString()}, PDA: ${userPda.toString()}`);
        const account = await program.account.userAccountPda.fetch(userPda);
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
            inblock: parseInt(account.inblock, 10),
            current_block,
        });
    } catch (err) {
        res.status(500).json({error: "Failed to fetch user data", details: err.toString()});
    }
});

app.get('/stats', async (req, res) => {
    res.status(200).json({
        userPDAs: [...userPDAs],
        userPDAsCount: [...userPDAs].length,
        votes: [...votes].map(([k, v]) => [k, v.length])
    });
})

const PORT = 5555;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
