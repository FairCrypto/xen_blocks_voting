import {workspace, web3, AnchorProvider, setProvider, AnchorError, Wallet,} from "@coral-xyz/anchor";
import type {Program} from "@coral-xyz/anchor";
import {GrowSpace} from "../target/types/grow_space";
import {assert} from "chai";
import {BN} from "bn.js";
import {
    ComputeBudgetProgram, Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    StakeProgram,
    SystemProgram,
    Transaction
} from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const formatUserPda = (a) => ({
    // user: a.user.toString(),
    credit: a.credit.toNumber(),
    debit: a.debit.toNumber(),
    redeemed: a.redeemed.toNumber(),
    inblock: a.inblock.toNumber()
});

const formatPeriodStats = (a) => ({
    // user: a.user.toString(),
    credit: a.credit.toNumber(),
    debit: a.debit.toNumber(),
    redeemed: a.redeemed.toNumber(),
});

const keyPairFileName = process.env.ANCHOR_WALLET || '';
const keyPairString = fs.readFileSync(path.resolve(keyPairFileName), 'utf-8');
const adminKeyPair = web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(keyPairString)));
console.log('Using admin wallet', adminKeyPair.publicKey.toBase58());

const wallet = new Wallet(adminKeyPair);
const connection = new Connection(process.env.ANCHOR_PROVIDER_URL);
const provider = new AnchorProvider(connection, wallet);
setProvider(provider);

describe("grow_space_combined", () => {
    // Configure the client to use the local cluster.
    // const provider = AnchorProvider.env();
    // setProvider(provider);

    const program = workspace.GrowSpace as Program<GrowSpace>;
    // program.addEventListener('voterCredited', console.log)

    const TREASURY_FUNDING = 0.2 * LAMPORTS_PER_SOL;
    const SINGLE_ACCOUNT_FUNDING = 0.02 * LAMPORTS_PER_SOL;
    const MIN_STAKE = 0.01 * LAMPORTS_PER_SOL;

    // test state vars
    const keypairs: Keypair[] = []
    const KEYS = 3;
    let treasury, periodCounter, currentPeriod = new BN(0);
    // @ts-ignore
    const userAccounts = new Map<number, Set<string>>();
    let newPeriodListener;
    const blockIds = new Set<string>();
    const stakingAccounts = new Map<string, PublicKey>();

    // @ts-ignore
    const getUserPda = (publicKey: PublicKey, period: BN) => {
        if (!userAccounts.has(period.toNumber()) ||
            !userAccounts.get(period.toNumber()).has(publicKey.toBase58())
        ) return null;
        const [userPda] = web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("user_account_pda"),
                publicKey.toBytes(),
                period.toArrayLike(Buffer, "le", 8)
            ],
            program.programId
        )
        return userPda;
    }

    const createAndFundAccount = async () => {
        const keypair = web3.Keypair.generate();
        const fundTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: provider.wallet.publicKey,
                toPubkey: keypair.publicKey,
                lamports: SINGLE_ACCOUNT_FUNDING, // TODO: refactor to separate instance !!!
            })
        );
        await provider.sendAndConfirm(fundTx, [], {commitment: 'finalized'});

        const stakingAccount = await web3.PublicKey.createWithSeed(
            keypair.publicKey,
            "1",
            StakeProgram.programId
        );
        const instruction = await program.methods.createStakeAccount(new BN(MIN_STAKE))
            .accounts({
                staker: keypair.publicKey,
                stakingAccount,
                // systemProgram: SystemProgram.programId,
                // stakeProgram: StakeProgram.programId
            })
            //.signers([])
            .instruction();
        const recentBlockhash = await provider.connection.getLatestBlockhash();
        const transaction = new web3.Transaction({
            feePayer: keypair.publicKey,
            recentBlockhash: recentBlockhash.blockhash
        }).add(instruction)
        transaction.partialSign(keypair);
        const ss = await provider.connection.sendRawTransaction(transaction.serialize(), {
            preflightCommitment: 'finalized',
            skipPreflight: true,
            // maxRetries: 1
        })
        process.stdout.write('+')
        stakingAccounts.set(keypair.publicKey.toBase58(), stakingAccount)

        return keypair;
    }

    before(async () => {
        const stakingAccount = await web3.PublicKey.createWithSeed(
            wallet.publicKey,
            "1",
            StakeProgram.programId
        );
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
        transaction.partialSign(adminKeyPair);
        const ss = await provider.connection.sendRawTransaction(transaction.serialize(), {
            preflightCommitment: 'finalized',
            skipPreflight: true,
            // maxRetries: 1
        })
        console.log('created admin staking account', ss)

        newPeriodListener = program.addEventListener('newPeriod', ({newPeriod}) => {
            console.log('New Period', newPeriod.toNumber());
            // currentPeriod = newPeriod;
        })

        process.stdout.write(`generating ${KEYS} keypairs `)
        for await (const i of Array.from({length: KEYS + 1}, (_, i) => i)) {
            const keypair = await createAndFundAccount();
            process.stdout.write('.')

            keypairs.push(keypair)
        }
        process.stdout.write('\n');

        [treasury] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("blocks_treasury")],
            program.programId
        )
        assert.ok(treasury);
    });

    it("Should initialize Treasury account", async () => {
        const [treasury] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("blocks_treasury")],
            program.programId
        )
        console.log('Treasury PDA', treasury.toBase58())

        try {
            const sig = await program.methods.initialize(new BN(TREASURY_FUNDING), new BN(MIN_STAKE))
                .accounts({
                    admin: provider.wallet.publicKey,
                })
                .signers([])
                .rpc({commitment: "finalized", skipPreflight: false});
            console.log("Initialized treasury account", 'sig:', sig);


        } catch (err) {
            console.error("Failed to initialize treasury -- already initialized", err.message);
        } finally {
            const balance = await provider.connection.getBalance(treasury)
            console.log("Treasury balance", balance);
        }

    });

    it("Appends multiple final hashes, including repeats, to random block IDs in the PDA with repeated pubkeys", async () => {
        let pda: web3.PublicKey;
        let prevPda: web3.PublicKey;

        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
            units: 1_400_000
        });

        let randomBlockId = Math.floor(Math.random() * 10_000);
        const treasuryState = await program.account.treasuryAccount.fetch(treasury);
        currentPeriod = treasuryState.currentPeriod;

        for await (const i of [0, 1, 2]) { // Limiting to N for testing purposes
            randomBlockId += Math.floor(Math.random() * 100_000);
            blockIds.add(randomBlockId.toString())
            const uniqueId = new BN(randomBlockId); // Use the block ID as the unique ID
            console.log("\n\nLoop: " + i + ", Block ID: " + randomBlockId);

            let bump: number;

            // Initialize a new PDA for each block ID
            [pda, bump] = web3.PublicKey.findProgramAddressSync(
                [
                    Buffer.from("pda_account"),
                    uniqueId.toArrayLike(Buffer, "le", 8)]
                ,
                program.programId
            )
            console.log('PDA', pda.toString(), 'prev', prevPda?.toString())

            try {
                const sig = await program.methods.initializePda(uniqueId)
                    .accounts({
                        payer: provider.wallet.publicKey,
                    })
                    .signers([])
                    .rpc({commitment: "confirmed", skipPreflight: true});
                console.log("Initialized PDA account public key:", pda.toString(), "with bump:", bump, 'sig:', sig);
            } catch (err) {
                console.error("Failed to initialize PDA:", err.message);
            }

            // Append repeating final hashes with repeated pubkeys
            const repeatingHashes = [`${randomBlockId}_r1`, `${randomBlockId}_r1`, `${randomBlockId}_r1`];
            for await (const _ of Array(KEYS).fill(0).map((_, i) => i)) { // Reduced to 3 for testing purposes
                for await (const repeatingHash of repeatingHashes) {
                    try {
                        const keypair = keypairs[Math.floor(Math.random() * (KEYS + 1))];

                        const treasuryState = await program.account.treasuryAccount.fetch(treasury);
                        currentPeriod = treasuryState.currentPeriod;

                        [periodCounter] = web3.PublicKey.findProgramAddressSync(
                            [
                                Buffer.from("period_counter"),
                                currentPeriod.toArrayLike(Buffer, "le", 8)
                            ],
                            program.programId
                        )
                        assert.ok(periodCounter);

                        const [userPda] = web3.PublicKey.findProgramAddressSync(
                            [
                                Buffer.from("user_account_pda"),
                                keypair.publicKey.toBytes(),
                                currentPeriod.toArrayLike(Buffer, "le", 8)
                            ],
                            program.programId
                        );

                        const prevPDAData = prevPda
                            ? await program.account.pdaAccount.fetch(prevPda)
                            : null;
                        const shuffled = (prevPDAData ? prevPDAData.blockIds[0].finalHashes[0].pubkeys : [])
                            .map((k, i) => ({i, k}))
                            .sort(() => 0.5 - Math.random());

                        const sig = await program.methods.appendData(uniqueId, repeatingHash, keypair.publicKey, currentPeriod, shuffled.slice(0, 5).map(({i}) => new BN(i)))
                            .accountsPartial({
                                treasury,
                                periodCounter,
                                pdaAccount: pda,
                                payer: keypair.publicKey,
                                userAccountPda: userPda,
                                prevPdaAccount: prevPda || null,
                                stakingAccount: stakingAccounts.get(keypair.publicKey.toBase58()),
                                // stakeProgram: StakeProgram.programId
                            })
                            .remainingAccounts([...shuffled.slice(0, 5)
                                .map(({k}) => ({
                                    pubkey: getUserPda(k, currentPeriod),
                                    isSigner: false,
                                    isWritable: true
                                }))].filter(({pubkey}) => !!pubkey)
                            )
                            .preInstructions([modifyComputeUnits])
                            .signers([keypair])
                            .rpc({commitment: "confirmed", skipPreflight: false});

                        if (!userAccounts.has(currentPeriod.toNumber())) {
                            userAccounts.set(currentPeriod.toNumber(), new Set<string>())
                        }
                        const newSet = userAccounts.get(currentPeriod.toNumber()).add(keypair.publicKey.toBase58())
                        userAccounts.set(currentPeriod.toNumber(), newSet);

                        console.log("  Hash:", repeatingHash, "period:", currentPeriod.toNumber(), "payer:", keypair.publicKey.toString(), "sig:", sig);
                    } catch (err) {
                        console.error(`Failed to append data for Block ID ${randomBlockId}:`, err);
                    }
                }
            }

            // Append unique final hashes
            for await (const k of [0, 1, 2]) { // Reduced to 3 for testing purposes
                randomBlockId += Math.floor(Math.random() * 100_000);
                blockIds.add(randomBlockId.toString())
                const uniqueHash = `hash_${randomBlockId}_unique${k}`;

                try {
                    const keypair = keypairs[Math.floor(Math.random() * (KEYS + 1))];
                    const treasuryState = await program.account.treasuryAccount.fetch(treasury);
                    currentPeriod = treasuryState.currentPeriod;

                    [periodCounter] = web3.PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("period_counter"),
                            currentPeriod.toArrayLike(Buffer, "le", 8)
                        ],
                        program.programId
                    )
                    assert.ok(periodCounter);
                    console.log('Period Counter PDA, p=', currentPeriod.toNumber(), periodCounter.toBase58())

                    const prevPDAData = prevPda
                        ? await program.account.pdaAccount.fetch(prevPda)
                        : null;
                    const shuffled = (prevPDAData ? prevPDAData.blockIds[0].finalHashes[0].pubkeys : [])
                        .map((k, i) => ({i, k}))
                        .sort(() => 0.5 - Math.random());

                    const sig = await program.methods.appendData(new BN(randomBlockId), uniqueHash, keypair.publicKey, currentPeriod, shuffled.slice(0, 5).map(({i}) => new BN(i)))
                        .accountsPartial({
                            treasury,
                            periodCounter,
                            pdaAccount: pda,
                            prevPdaAccount: prevPda || null,
                            payer: keypair.publicKey,
                            stakingAccount: stakingAccounts.get(keypair.publicKey.toBase58()),
                        })
                        .signers([keypair])
                        .remainingAccounts([...shuffled.slice(0, 5)
                            .map(({k}) => ({
                                pubkey: getUserPda(k, currentPeriod),
                                isSigner: false,
                                isWritable: true
                            }))].filter(({pubkey}) => !!pubkey)
                        )
                        .preInstructions([modifyComputeUnits])
                        .rpc({commitment: "confirmed", skipPreflight: false});

                    if (!userAccounts.has(currentPeriod.toNumber())) {
                        userAccounts.set(currentPeriod.toNumber(), new Set<string>())
                    }
                    const newSet = userAccounts.get(currentPeriod.toNumber()).add(keypair.publicKey.toBase58())
                    userAccounts.set(currentPeriod.toNumber(), newSet);

                    console.log("  Hash:", uniqueHash, "period:", currentPeriod.toNumber(), "payer:", keypair.publicKey.toString(), "sig:", sig);
                } catch (err) {
                    console.error(`Failed to append data for Block ID ${randomBlockId}:`, err.message);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 5_000));

            prevPda = pda;
        }

        // Verify that the values are unique Block IDs
        const blockIdsSet = new Set(Array.from(blockIds));
        assert.equal(blockIdsSet.size, blockIds.size, "Block IDs should be unique");
        console.log("Total unique block IDs added: ", blockIds.size);
    });

    it("Should print blocks info", async () => {
        console.log('\n\nBlocks', [...blockIds].join(", "), '\n\n');
        // Fetch the PDA and print the stored data
        for await (const blockId of [...blockIds]) {
            const uniqueId = new BN(parseInt(blockId));
            const [pda] = web3.PublicKey.findProgramAddressSync(
                [Buffer.from("pda_account"), uniqueId.toArrayLike(Buffer, "le", 8)],
                program.programId
            );

            try {
                const account = await program.account.pdaAccount.fetch(pda);
                if (account.blockIds.length > 0) {
                    account.blockIds.forEach((entry: any, index: number) => {
                        // printPdaAccountInfo(blockId.toString());
                        console.log(`  Block ID ${entry.blockId.toString()}`);
                        entry.finalHashes.forEach((hashEntry: any) => {
                            console.log(`    Final Hash: ${Buffer.from(hashEntry.finalHash).toString()} (pubkeys count: ${hashEntry.pubkeys.length})`);
                            hashEntry.pubkeys.forEach((pubkey: any, pubkeyIndex: number) => {
                                console.log(`      Pubkey ${pubkeyIndex}: ${pubkey.toString()}`);
                            });
                        });
                    });
                } else {
                    console.log(`PDA ${pda}: No blockIds`)
                }
            } catch (e) {
                // console.log(e.message)
            }
        }
    })

    it("Should print period and users accounts", async () => {
        console.log('\n\n');
        // const treasuryState = await program.account.treasuryAccount.fetch(treasury);
        // console.log(userAccounts)
        for await (const period of [...userAccounts.keys()]) {
            const [periodCounter] = web3.PublicKey.findProgramAddressSync(
                [
                    Buffer.from("period_counter"),
                    new BN(period).toArrayLike(Buffer, "le", 8)
                ],
                program.programId
            )
            const periodStats = await program.account.periodCounter.fetch(periodCounter);
            console.log(
                'period: p',
                period,
                formatPeriodStats(periodStats),
            );

            for await (const pubkey of [...userAccounts.get(period)]) {
                const keypair = keypairs
                    .find((keypair) => keypair.publicKey.toBase58() === pubkey);
                if (!keypair) continue;

                const [userPda] = web3.PublicKey.findProgramAddressSync(
                    [
                        Buffer.from("user_account_pda"),
                        keypair.publicKey.toBytes(),
                        new BN(period).toArrayLike(Buffer, "le", 8)
                    ],
                    program.programId
                )
                try {
                    const userAccount = await program.account.userPeriodCounter.fetch(userPda);
                    console.log(
                        '  user: p',
                        period,
                        formatUserPda(userAccount),
                        keypair.publicKey.toString(),
                    )
                } catch (e) {
                    console.log(e.message)
                }
            }
        }
    })

    it("Should allow withdraw from Treasury account", async () => {
        // wait for next period
        // console.log('With treasury PDA', treasury.toBase58())

        for await (const period of [...userAccounts.keys()].slice(0, -1)) {
            const [periodCounter] = web3.PublicKey.findProgramAddressSync(
                [
                    Buffer.from("period_counter"),
                    new BN(period).toArrayLike(Buffer, "le", 8)
                ],
                program.programId
            )

            for await (const pubkey of [...userAccounts.get(period)]) {
                const keypair = keypairs
                    .find((keypair) => keypair.publicKey.toBase58() === pubkey);
                if (!keypair) continue;
                // const balance = await provider.connection.getBalance(keypair.publicKey)
                // console.log(`User ${keypair.publicKey.toBase58()} pre balance ${balance}`);

                const userAccountPda = getUserPda(keypair.publicKey, new BN(period));
                if (!userAccountPda) continue;

                const userAccount = await program.account.userPeriodCounter.fetch(userAccountPda);
                if (userAccount.credit.toNumber() === 0) continue;

                try {
                    // const treasuryState = await program.account.treasuryAccount.fetch(treasury);
                    const sig = await program.methods.claimReward(new BN(period))
                        .accounts({
                            treasury,
                            periodCounter,
                            userAccountPda,
                            user: keypair.publicKey,
                        })
                        .signers([keypair])
                        .rpc({commitment: "confirmed", skipPreflight: false});

                    console.log("Claimed reward: p=", period, 'u=', keypair.publicKey.toBase58(), 'sig:', sig);

                } catch (err) {
                    console.error("Failed to claim reward", err.message);
                } finally {
                    // const balance = await provider.connection.getBalance(keypair.publicKey)
                    // console.log("User post balance", balance);
                }
            }
        }

    });

    it("Should NOT allow double withdraw from Treasury account", async () => {
        for await (const period of [...userAccounts.keys()].slice(0, -1)) {
            const [periodCounter] = web3.PublicKey.findProgramAddressSync(
                [
                    Buffer.from("period_counter"),
                    new BN(period).toArrayLike(Buffer, "le", 8)
                ],
                program.programId
            )

            for await (const pubkey of [...userAccounts.get(period)]) {
                const keypair = keypairs
                    .find((keypair) => keypair.publicKey.toBase58() === pubkey);
                if (!keypair) continue;
                // const balance = await provider.connection.getBalance(keypair.publicKey)
                // console.log(`User ${keypair.publicKey.toBase58()} pre balance ${balance}`);
                const userAccountPda = getUserPda(keypair.publicKey, new BN(period));
                if (!userAccountPda) continue;

                const userAccount = await program.account.userPeriodCounter.fetch(userAccountPda);
                if (userAccount.credit.toNumber() === userAccount.redeemed.toNumber()) continue;

                try {
                    // const treasuryState = await program.account.treasuryAccount.fetch(treasury);
                    const sig = await program.methods.claimReward(new BN(period))
                        .accounts({
                            treasury,
                            periodCounter,
                            userAccountPda,
                            user: keypair.publicKey,
                        })
                        .signers([keypair])
                        .rpc({commitment: "confirmed", skipPreflight: false});

                    console.log("Claimed reward: p=", period, 'u=', keypair.publicKey.toBase58(), 'sig:', sig);
                    assert.ok(false);
                } catch (err) {
                    assert.isTrue(err instanceof AnchorError);
                    assert.strictEqual(err.error.errorCode.code, 'NoRedeemableCredit');
                } finally {
                    const balance = await provider.connection.getBalance(keypair.publicKey)
                    // console.log("User post balance", balance);
                }
            }
        }
    });

    it("Should show data on Treasury and Period Counters", async () => {
        console.log(await program.account.treasuryAccount.fetch(treasury))
    });

    after(async () => {
        await program.removeEventListener(newPeriodListener);
    })

});

