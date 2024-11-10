import fs from "node:fs";
import path from "node:path";
import {AnchorProvider, Program, setProvider, Wallet, web3, workspace} from "@coral-xyz/anchor";
import type {GrowSpace} from '../target/types/grow_space_prod';
import {PublicKey} from "@solana/web3.js";
import {BN} from "bn.js";
import dotenv from "dotenv";
import {initDB, backfillVote, getLowerVote} from "../db/db";

dotenv.config();

async function main() {
    const [, , from] = process.argv;

    const provider = AnchorProvider.env();
    setProvider(provider);

    const program = workspace.GrowSpaceProd as Program<GrowSpace>;

    console.log('Program ID', program.programId.toBase58());
    console.log('Payer', provider.wallet.publicKey.toBase58());

    await initDB().then(() => console.log('db initialized'));

    const lowerVote = await getLowerVote();
    console.log('got from DB', lowerVote?.block_id, ', param', from);

    let blockId = new BN(from || lowerVote?.block_id);
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
            let updated = 0;
            let skipped = 0;
            for await (const pubkey of state.blockIds?.[0]?.finalHashes?.[0]?.pubkeys) {
                const res = await backfillVote(blockId.toNumber(), finalHash, pubkey.toBase58())
                if (res) updated++
                else skipped++
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