module.exports = {
    apps: [
        {
            name: "webserver",
            cwd: "../grow_space",
            script: "./app/server_vote_receiver.js",
            interpreter_args: "--max-old-space-size=512 --expose-gc",
            mode: "cluster",
            instances: 4,
            env: {
                NODE_ENV: "production",
                ANCHOR_WALLET: "/mnt/ledger/build/.config/solana/id.json",
                ANCHOR_PROVIDER_URL: "https://xolana-devnet.xen.network"
            }
        },
        {
            name: "voter_crediter",
            script: "./app/server_vote_receiver.js",
            interpreter_args: "--max-old-space-size=512 --expose-gc",
            env: {
                NODE_ENV: "production",
                DB_LOCATION: './.db',
                ANCHOR_PROVIDER_URL: "https://xolana-devnet.xen.network"
            }
        },
        {
            name: "create_periods",
            script: "./app/create_periods.js",
            env: {
                NODE_ENV: "production",
                DB_LOCATION: './.db',
            }
        },
        {
            name: "allocate_rewards",
            script: "./app/allocate_rewards.js",
            env: {
                NODE_ENV: "production",
                DB_LOCATION: './.db',
            }
        },
    ]
};