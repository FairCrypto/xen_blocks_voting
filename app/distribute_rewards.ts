import dotenv from "dotenv";
import {drizzle} from "drizzle-orm/libsql";
import {rewardPeriods, voterBalances, voterPayouts} from "../drizzle/schema.ts/schema";
import {eq, gt, sql} from "drizzle-orm";
import {initDB} from "../db/db";
import {Connection, LAMPORTS_PER_SOL, SystemProgram, Transaction} from "@solana/web3.js";
import {web3, AnchorProvider, setProvider, AnchorError, Wallet} from "@coral-xyz/anchor";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const db = drizzle(process.env.DB_FILE_NAME!);

const main = async () => {
    const keyPairFileName = process.env.ANCHOR_WALLET || '';
    const keyPairString = fs.readFileSync(path.resolve(keyPairFileName), 'utf-8');
    const keyPair = web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(keyPairString)));

    console.log('Using admin wallet', keyPair.publicKey.toBase58());

    const wallet = new Wallet(keyPair);
    const connection = new Connection(process.env.ANCHOR_PROVIDER_URL);
    const provider = new AnchorProvider(connection, wallet);
    setProvider(provider);
    const balance = await connection.getBalance(keyPair.publicKey);
    console.log('Wallet balance', balance);

    await initDB().then(() => console.log('db initialized'));

    const periods = await db.$count(rewardPeriods);

    const sum = await db
        .select({
            outstandingBalance: sql<number>`sum(${voterBalances.accruedRewards}-${voterBalances.paidRewards})`
        })
        .from(voterBalances)
        .where(gt(voterBalances.accruedRewards, voterBalances.paidRewards))

    const data = await db
        .select({
            voter: voterBalances.voter,
            lastPeriod: voterBalances.lastPeriod,
            outstandingBalance: sql<number>`${voterBalances.accruedRewards}-${voterBalances.paidRewards}`
        })
        .from(voterBalances)
        .where(gt(voterBalances.accruedRewards, voterBalances.paidRewards))

    console.log('periods', periods, 'outstanding', sum?.[0]?.outstandingBalance || 0)
    if ((sum?.[0]?.outstandingBalance || 0) < 1) {
        console.log('nothing to do')
        process.exit(0)
    }
    if ((sum?.[0]?.outstandingBalance || 0) > (balance / LAMPORTS_PER_SOL)) {
        console.log('not enough balance: need', (sum?.[0]?.outstandingBalance || 0), 'has', balance / LAMPORTS_PER_SOL)
        process.exit(0)
    }
    process.exit(0)

    for await (const record of data) {
        try {
            const fundTx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: provider.wallet.publicKey,
                    toPubkey: new web3.PublicKey(record.voter),
                    lamports: record.outstandingBalance * LAMPORTS_PER_SOL,
                })
            );
            const txHash = await provider.sendAndConfirm(fundTx, [], {commitment: 'confirmed'});
            await db.transaction(async (tx) => {
                await tx
                    .insert(voterPayouts)
                    .values({
                        lastPeriod: record.lastPeriod,
                        voter: record.voter,
                        amount: record.outstandingBalance,
                        txHash,
                        ts: new Date().toISOString()
                    });
                await tx
                    .update(voterBalances)
                    .set({paidRewards: sql`${record.outstandingBalance}`})
                    .where(eq(voterBalances.voter, record.voter));
            });
            console.log(`Processed voter=${record.voter}, paid balance=${record.outstandingBalance}, last period=${record.lastPeriod}`)
        } catch (e) {
            console.error(`Error processed voter=${record.voter}`, e)
        }
    }
}

main().catch(console.error)