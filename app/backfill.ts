import fs from "node:fs";
import path from "node:path";
import {AnchorProvider, Program, setProvider, Wallet, web3, workspace} from "@coral-xyz/anchor";
import type {GrowSpace} from '../target/types/grow_space_prod';
import {PublicKey} from "@solana/web3.js";
import {BN} from "bn.js";
import dotenv from "dotenv";
import {initDB, backfillVote, getLowerVote} from "../db/db";
import {votes} from "../drizzle/schema_psql.ts/schema";
import * as dbInstance from '../db/db'
import {asc, desc} from "drizzle-orm";

dotenv.config();

let db = dbInstance.default;

async function main() {
    const [, , from] = process.argv;

    const provider = AnchorProvider.env();
    setProvider(provider);

    const program = workspace.GrowSpaceProd as Program<GrowSpace>;

    console.log('Program ID', program.programId.toBase58());
    console.log('Payer', provider.wallet.publicKey.toBase58());

    db = await initDB();
    console.log('db initialized')

    const lowerVote = await db.select({
        blockId: votes.blockId,
    }).from(votes).orderBy(asc(votes.blockId)).limit(1);

    console.log('got from DB', lowerVote?.[0]?.blockId, ', param', from);

    let blockId = new BN(from || lowerVote?.[0]?.blockId);
    if (blockId.toNumber() > 100) {
        blockId = blockId.sub(new BN(100));
    }
    // let blockId = new BN(26539701);
    console.log('starting from', blockId.toNumber());
    // 1 reward period ~~ 864 blocks

    while (true) {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("pda_account"), blockId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        try {
            const state = await program.account.pdaAccount.fetch(pda);
            const finalHash = Buffer.from(state.blockIds?.[0]?.finalHashes?.[0].finalHash).toString('hex');
            console.log((state.blockIds?.[0]?.finalHashes?.[0].finalHash))
            console.log(Buffer.from(state.blockIds?.[0]?.finalHashes?.[0].finalHash))
            break;
            let updated = 0;
            let skipped = 0;
            for await (const pubkey of state.blockIds?.[0]?.finalHashes?.[0]?.pubkeys) {
                //const res = await backfillVote(blockId.toNumber(), finalHash, pubkey.toBase58())
                try {
                    await db.insert(votes).values({
                        ts: new Date().toISOString(),
                        finalHash,
                        blockId: blockId.toNumber(),
                        voter: pubkey.toBase58()
                    })
                    updated++
                } catch (e) {
                    console.log(e)
                    skipped++;
                }
            }
            console.log(`fill block=${blockId.toNumber()}, hash=${finalHash}, votes=${state.blockIds?.[0]?.finalHashes?.[0]?.pubkeys.length}, updated=${updated}, skipped=${skipped}`);
        } catch (e) {
            console.log('error', blockId.toNumber(), e.message)
        } finally {
            blockId = blockId.sub(new BN(100))
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
    }
}

main().catch(console.error)