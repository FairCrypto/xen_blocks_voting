/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/grow_space.json`.
 */
export type GrowSpace = {
    "address": "7KvbAAK7kP72zcdC24vDn9L51TDV8v9he4hNJ3S7ZU51",
    "metadata": {
        "name": "growSpace",
        "version": "0.1.0",
        "spec": "0.1.0",
        "description": "Created with Anchor"
    },
    "instructions": [
        {
            "name": "aggregatePubkeyCounts",
            "discriminator": [
                121,
                178,
                175,
                91,
                254,
                93,
                86,
                126
            ],
            "accounts": [
                {
                    "name": "pdaAccount",
                    "writable": true
                },
                {
                    "name": "voterAccounting",
                    "writable": true,
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const",
                                "value": [
                                    97,
                                    99,
                                    99,
                                    111,
                                    117,
                                    110,
                                    116,
                                    105,
                                    110,
                                    103
                                ]
                            }
                        ]
                    }
                },
                {
                    "name": "userPdaAccount",
                    "writable": true,
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const",
                                "value": [
                                    117,
                                    115,
                                    101,
                                    114,
                                    95,
                                    112,
                                    100,
                                    97
                                ]
                            },
                            {
                                "kind": "account",
                                "path": "payer"
                            }
                        ]
                    }
                },
                {
                    "name": "payer",
                    "writable": true,
                    "signer": true
                },
                {
                    "name": "systemProgram",
                    "address": "11111111111111111111111111111111"
                }
            ],
            "args": [
                {
                    "name": "startBlockId",
                    "type": "u64"
                }
            ]
        },
        {
            "name": "appendData",
            "discriminator": [
                253,
                252,
                83,
                74,
                115,
                63,
                140,
                142
            ],
            "accounts": [
                {
                    "name": "pdaAccount",
                    "writable": true
                },
                {
                    "name": "payer",
                    "writable": true,
                    "signer": true
                },
                {
                    "name": "systemProgram",
                    "address": "11111111111111111111111111111111"
                }
            ],
            "args": [
                {
                    "name": "blockId",
                    "type": "u64"
                },
                {
                    "name": "finalHash",
                    "type": "string"
                },
                {
                    "name": "pubkey",
                    "type": "pubkey"
                }
            ]
        },
        {
            "name": "getVoterAccountingChunk",
            "discriminator": [
                174,
                138,
                196,
                124,
                237,
                41,
                65,
                77
            ],
            "accounts": [
                {
                    "name": "voterAccounting"
                }
            ],
            "args": [
                {
                    "name": "offset",
                    "type": "u64"
                },
                {
                    "name": "limit",
                    "type": "u64"
                }
            ]
        },
        {
            "name": "initializePda",
            "discriminator": [
                178,
                254,
                136,
                212,
                127,
                85,
                171,
                210
            ],
            "accounts": [
                {
                    "name": "pdaAccount",
                    "writable": true,
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const",
                                "value": [
                                    112,
                                    100,
                                    97,
                                    95,
                                    97,
                                    99,
                                    99,
                                    111,
                                    117,
                                    110,
                                    116
                                ]
                            },
                            {
                                "kind": "arg",
                                "path": "uniqueId"
                            }
                        ]
                    }
                },
                {
                    "name": "payer",
                    "writable": true,
                    "signer": true
                },
                {
                    "name": "systemProgram",
                    "address": "11111111111111111111111111111111"
                }
            ],
            "args": [
                {
                    "name": "uniqueId",
                    "type": "u64"
                }
            ]
        }
    ],
    "accounts": [
        {
            "name": "count",
            "discriminator": [
                116,
                199,
                152,
                236,
                90,
                156,
                182,
                0
            ]
        },
        {
            "name": "pdaAccount",
            "discriminator": [
                45,
                144,
                246,
                42,
                88,
                234,
                93,
                2
            ]
        },
        {
            "name": "userPdaAccount",
            "discriminator": [
                221,
                144,
                134,
                88,
                100,
                215,
                128,
                54
            ]
        },
        {
            "name": "voterAccounting",
            "discriminator": [
                179,
                104,
                195,
                140,
                39,
                8,
                113,
                184
            ]
        }
    ],
    "errors": [
        {
            "code": 6000,
            "name": "blockEntryNotFound",
            "msg": "Block entry not found."
        },
        {
            "code": 6001,
            "name": "finalHashEntryNotFound",
            "msg": "Final hash entry not found."
        },
        {
            "code": 6002,
            "name": "invalidUtf8",
            "msg": "Invalid UTF-8 sequence."
        },
        {
            "code": 6003,
            "name": "insufficientPubkeys",
            "msg": "Insufficient pubkeys available."
        },
        {
            "code": 6004,
            "name": "serializationError",
            "msg": "Serialization error."
        }
    ],
    "types": [
        {
            "name": "blockEntry",
            "type": {
                "kind": "struct",
                "fields": [
                    {
                        "name": "blockId",
                        "type": "u64"
                    },
                    {
                        "name": "finalHashes",
                        "type": {
                            "vec": {
                                "defined": {
                                    "name": "finalHashEntry"
                                }
                            }
                        }
                    }
                ]
            }
        },
        {
            "name": "count",
            "type": {
                "kind": "struct",
                "fields": [
                    {
                        "name": "user",
                        "type": "pubkey"
                    },
                    {
                        "name": "credit",
                        "type": "u64"
                    },
                    {
                        "name": "debit",
                        "type": "u64"
                    },
                    {
                        "name": "inblock",
                        "type": "u64"
                    }
                ]
            }
        },
        {
            "name": "finalHashEntry",
            "type": {
                "kind": "struct",
                "fields": [
                    {
                        "name": "finalHash",
                        "type": {
                            "array": [
                                "u8",
                                8
                            ]
                        }
                    },
                    {
                        "name": "pubkeys",
                        "type": {
                            "vec": "pubkey"
                        }
                    },
                    {
                        "name": "count",
                        "type": "u64"
                    }
                ]
            }
        },
        {
            "name": "pdaAccount",
            "type": {
                "kind": "struct",
                "fields": [
                    {
                        "name": "blockIds",
                        "type": {
                            "vec": {
                                "defined": {
                                    "name": "blockEntry"
                                }
                            }
                        }
                    },
                    {
                        "name": "dataSize",
                        "type": "u32"
                    }
                ]
            }
        },
        {
            "name": "userPdaAccount",
            "type": {
                "kind": "struct",
                "fields": [
                    {
                        "name": "user",
                        "type": "pubkey"
                    },
                    {
                        "name": "credit",
                        "type": "u64"
                    },
                    {
                        "name": "debit",
                        "type": "u64"
                    },
                    {
                        "name": "inblock",
                        "type": "u64"
                    }
                ]
            }
        },
        {
            "name": "voterAccounting",
            "type": {
                "kind": "struct",
                "fields": [
                    {
                        "name": "pubkeyCounts",
                        "type": {
                            "vec": {
                                "defined": {
                                    "name": "count"
                                }
                            }
                        }
                    }
                ]
            }
        }
    ]
};
