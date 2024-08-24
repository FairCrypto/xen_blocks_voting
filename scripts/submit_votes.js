import {Keypair} from "@solana/web3.js";

async function main() {
    const users = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(_ => Keypair.generate().publicKey)

    for await (const round of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        console.log('round', round)
        for await (const u of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
            const data = {
                first_block_id: u.toString(),
                final_hash: '1',
                pubkey: users[round]
            }
            const res = await fetch('http://localhost:4444', {
                method: 'POST',
                body: JSON.stringify(data),
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            if (res.ok) {
                console.log(await res.json())
            } else {
                console.log(await res.json())
            }
        }
    }
}

main().catch(console.log)