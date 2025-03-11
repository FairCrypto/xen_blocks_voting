import dotenv from "dotenv";
import fs from "node:fs";
import Redis from "ioredis";
import csv from "fast-csv"

dotenv.config();

type XenBlock = {
    counter: number;
    pubkeys: string[];
};

type Vote = {
    pubkey: string,
    firstBlock: number,
    lastBlock: number,
    hash: string
}

const redis = new Redis(); // Adjust connection settings if needed

async function getAllKeys() {
    let cursor = '0';
    let keys = [];

    do {
        const result = await redis.scan(cursor, "MATCH", "*", "COUNT", 100);
        cursor = result[0];
        keys.push(...result[1]);
    } while (cursor !== '0');

    return keys;
}

async function getKeyValues(keys: string[]): Promise<Vote[]> {
    const values = await redis.mget(keys); // Fetch multiple values at once
    return keys.flatMap((key: string, index: number) => {
        const [firstBlock, lastBlock, hash] = key.split("_")
        const xenBlock = JSON.parse(values[index]) as XenBlock;
        return xenBlock.pubkeys.flatMap(pubkey => ({
                pubkey,
                firstBlock: Number(firstBlock),
                lastBlock: Number(lastBlock),
                hash
            })
        );
    })
}

async function saveToCSV(data: Vote[]) {
    const filePath = "redis_data.csv";
    const fileStream = fs.createWriteStream(filePath);
    const csvStream = csv.format({headers: false});

    csvStream.pipe(fileStream).on('end', () => console.log('done'));

    for (const row of data) {
        csvStream.write(row);
    }
    csvStream.end();

    console.log(`Data saved to ${filePath}`);
}

async function exportRedisToCSV() {
    try {
        const keys = await getAllKeys();
        if (keys.length === 0) {
            console.log("No keys found in Redis.");
            return;
        }

        const data = await getKeyValues(keys.slice(0, 1));
        await saveToCSV(data);
    } catch (error) {
        console.error("Error:", error);
    } finally {
        redis.disconnect();
    }
}

async function main() {

    const [, , from] = process.argv;
    await exportRedisToCSV()

}

main().then(_ => {
    redis.disconnect()
}).catch(console.error)