#!/bin/sh

# Build the dist directory

rm -rf dist
mkdir dist

VERSION=`git describe --tags`
echo "version=$VERSION"

cat <<EOF > dist/package.json
{
  "name": "microtick",
  "version": "$VERSION",
  "description": "Microtick API",
  "main": "index.js",
  "type": "module",
  "dependencies": {
    "bech32": "^1.1.3",
    "bip32": "^2.0.3",
    "bip39": "^3.0.2",
    "crypto-js": "^3.1.9-1",
    "secp256k1": "^3.7.1",
    "websocket": "^1.0.29"
  },
  "devDependencies": {},
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "author": "Microtick",
  "license": "MIT"
}
EOF

(cd dist && yarn install)

cp client/api.js dist/index.js
cp client/wallet.js dist
cp lib/protocol.js dist
