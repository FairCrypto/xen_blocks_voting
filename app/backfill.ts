import fs from "node:fs";
import path from "node:path";
import {AnchorProvider, Program, setProvider, Wallet, web3, workspace} from "@coral-xyz/anchor";
import type {GrowSpace} from '../target/types/grow_space_prod';
import {PublicKey} from "@solana/web3.js";
import {BN} from "bn.js";
import dotenv from "dotenv";
import {initDB, backfillVote} from "../db/db";

dotenv.config();

async function main() {
    const [, , from] = process.argv;

    const provider = AnchorProvider.env();
    setProvider(provider);

    const program = workspace.GrowSpaceProd as Program<GrowSpace>;

    console.log('Program ID', program.programId.toBase58());
    console.log('Payer', provider.wallet.publicKey.toBase58());

    await initDB().then(() => console.log('db initialized'));

    let blockId = new BN(from || 30321001);
    // let blockId = new BN(26539701);
    console.log('from', blockId.toNumber());
    // 1 reward period ~~ 864 blocks

    while (true) {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("pda_account"), blockId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        try {
            const state = await program.account.pdaAccount.fetch(pda);
            const finalHash = Buffer.from(state.blockIds?.[0]?.finalHashes?.[0].finalHash).toString('hex');
            console.log('fill', blockId.toNumber(), pda.toBase58(), 'pubkeys', state.blockIds?.[0]?.finalHashes?.[0]?.pubkeys.length)
            for await (const pubkey of state.blockIds?.[0]?.finalHashes?.[0]?.pubkeys) {
                // await backfillVoter(pubkey.toBase58(), blockId.toNumber());
                await backfillVote(blockId.toNumber(), finalHash, pubkey.toBase58())
            }
        } catch (e) {
            console.log('error', blockId.toNumber(), e.message)
        } finally {
            blockId = blockId.sub(new BN(100))
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
    }
}

main().catch(console.error)