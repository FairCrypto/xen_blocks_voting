#!/bin/bash

echo "Removing old key file"
rm ./target/deploy/grow_space-keypair.json

anchor build

key=$(anchor keys list | grep "grow_space" | awk -F': ' '{print $2}')
echo "Replacing key= $key"
gsed -i 's/declare_id!("\(.*\)");/declare_id!("'$key'");/' ./programs/grow_space/src/lib.rs

anchor build

echo
echo "Done"
echo
