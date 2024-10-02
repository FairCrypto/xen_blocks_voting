import fs from "node:fs";
import path from "node:path";
import {AnchorProvider, Program, setProvider, Wallet, web3, workspace} from "@coral-xyz/anchor";
import type {GrowSpace} from '../target/types/grow_space_prod';
import {PublicKey} from "@solana/web3.js";
import {BN} from "bn.js";
import dotenv from "dotenv";
import {initDB, backfillVoter} from "../db/db";

dotenv.config();

async function main() {
    // const keyPairFileName = process.env.ANCHOR_WALLET || '';
    // const keyPairString = fs.readFileSync(path.resolve(keyPairFileName), 'utf-8');
    // const keyPair = web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(keyPairString)));
    // console.log('Using wallet', keyPair.publicKey.toBase58());

    // const wallet = new Wallet(keyPair);

    const [, , from] = process.argv;

    const provider = AnchorProvider.env();
    setProvider(provider);

    const program = workspace.GrowSpaceProd as Program<GrowSpace>;

    console.log('Program ID', program.programId.toBase58());
    console.log('Payer', provider.wallet.publicKey.toBase58());

    await initDB().then(() => console.log('db initialized'));

    let blockId = new BN(from || 30325501);
    // let blockId = new BN(26539701);
    console.log('from', blockId.toNumber());

    while (true) {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("pda_account"), blockId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        try {
            const state = await program.account.pdaAccount.fetch(pda);
            console.log(blockId.toNumber(), pda.toBase58(), 'pubkeys', state.blockIds?.[0]?.finalHashes?.[0]?.pubkeys.length)
            for await (const pubkey of state.blockIds?.[0]?.finalHashes?.[0]?.pubkeys) {
                await backfillVoter(pubkey.toBase58(), blockId.toNumber());
            }
        } catch (e) {
            console.log(blockId.toNumber(), e.message)
        } finally {
            blockId = blockId.sub(new BN(100))
            await new Promise((resolve) => setTimeout(resolve, 500))
        }
    }
}

main().catch(console.error)