const express = require('express');
const bodyParser = require('body-parser');
const anchor = require('@coral-xyz/anchor');
const {PublicKey, ComputeBudgetProgram, Keypair} = require('@solana/web3.js');
const {Program, web3} = require('@coral-xyz/anchor');
const {BN} = require('bn.js');

// const GrowSpace = require("../target/types/grow_space");

const app = express();
app.use(bodyParser.json());

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.GrowSpace;

console.log('program ID', program.programId.toString())
console.log('payer', provider.wallet.payer.publicKey.toString())

// Function to check if a PDA account already exists
async function pdaExists(pda) {
    try {
        const accountInfo = await provider.connection.getAccountInfo(pda);
        return accountInfo !== null;
    } catch (_) {
        return false
    }
}

const getUserPda = (pubkey) => {
    const [userPda] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user_account_pda"), pubkey.toBytes()],
        program.programId
    )
    return userPda;
}

const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000
});

// let prevPda = null;
let keys = new Set()

// Endpoint to append data and initialize PDA if needed
app.post('/', async (req, res) => {
    const {first_block_id, final_hash, pubkey} = req.body;
    // console.log('req', first_block_id, final_hash, pubkey);
    const block_id = first_block_id;
    const prev_block_id = Number(block_id) - 100;

    const uniqueId = new BN(block_id);
    const prevUniqueId = new BN(prev_block_id);
    const pubkeyObj = new PublicKey(pubkey);

    const [pda] = await PublicKey.findProgramAddress(
        [Buffer.from("pda_account"), uniqueId.toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const [prevPda] = await PublicKey.findProgramAddress(
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
                    .rpc({commitment: "confirmed", skipPreflight: true});
                // console.log("Initialized PDA account public key:", pda.toString(), "with bump:", bump);
            } catch (err) {
                throw new Error(`Failed to initialize PDA: ${err.message}`);
            }
        } else {
            // console.log("PDA already initialized, proceeding to append data.");
        }

        // console.log('keys', keys.size)
        if (keys.size > 5) {
            keys = new Set([...keys].slice(-5))
        }

        const remaining = [...keys].map(k => ({
            pubkey: getUserPda(k),
            isSigner: false,
            isWritable: true
        }))
        // Append the data
        const sig = await program.methods
            .appendData(uniqueId, final_hash, pubkeyObj)
            .accountsPartial({
                pdaAccount: pda,
                userAccountPda: userPda,
                // payer: provider.wallet.publicKey,
                prevPdaAccount: prevPda || null, // [...pdas].slice(-1)[0] || null,
                payer: provider.wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .remainingAccounts(remaining)
            .preInstructions([modifyComputeUnits])
            // .signers([provider.wallet])
            .rpc({commitment: "confirmed", skipPreflight: false});
        console.log('processed', first_block_id, final_hash?.slice(0, 8), pubkey, pda?.toString(), sig);
        res.status(200).json({message: "Appended data", pda: pda.toString(), sig, user: pubkeyObj.toString()});
        // pdas.add(pda);
        keys.add(pubkeyObj)
    } catch (err) {
        console.error('error', first_block_id, final_hash?.slice(0, 8), pubkey, pda?.toString(), err);
        res.status(500).json({error: "Failed to append data", details: err.toString()});
    }
});

// Endpoint to fetch and display data
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
                    count: parseInt(hashEntry.count, 10) || hashEntry.pubkeys.length,
                    pubkeys: hashEntry.pubkeys.map(pubkey => pubkey.toString())
                }))
            }))
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
        res.status(200).json(account);
    } catch (err) {
        res.status(500).json({error: "Failed to fetch user data", details: err.toString()});
    }
});

const PORT = 5555;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
