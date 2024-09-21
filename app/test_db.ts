import {initDB, insertVoterCreditRecord} from "../db/db";
import {Keypair} from "@solana/web3.js";


async function main() {
    await initDB().then(() => console.log('db initialized'));
    await insertVoterCreditRecord(
        null, // ts
        0,
        Keypair.generate().publicKey.toBase58(),
        Keypair.generate().publicKey.toBase58(),
        Keypair.generate().publicKey.toBase58(),
        BigInt(0),
        BigInt(0),
        Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,]).toString('hex'),
        1,
        0
    ).then(() => console.log('data inserted'))
}

main().catch(console.error)