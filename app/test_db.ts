import {initDB} from "../db/db";

async function main() {
    await initDB().then(() => console.log('db initialized'));
    // await getVoterInfo('FwznmVkDsvf3v56Y4vV8MtGUNQ8PJGUVMLT5demygHwV').then(console.log);
    console.log("\n\n");
    // await getAllVoters().then(console.log);
}

main().catch(console.error)