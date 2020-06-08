const bip39 = require(`bip39`)
const bip32 = require(`bip32`)
const bech32 = require(`bech32`)
const secp256k1 = require(`secp256k1`)
const sha256 = require("crypto-js/sha256")
const ripemd160 = require("crypto-js/ripemd160")
const CryptoJS = require("crypto-js")

const hdPathAtom = `m/44'/118'/256'/0/0`

const standardRandomBytesFunc = x => CryptoJS.lib.WordArray.random(x).toString()

async function generateWalletFromSeed(mnemonic) {
  const masterKey = await deriveMasterKey(mnemonic)
  const { privateKey, publicKey } = deriveKeypair(masterKey)
  const cosmosAddress = createCosmosAddress(publicKey)
  return {
    privateKey: privateKey.toString(`hex`),
    publicKey: publicKey.toString(`hex`),
    cosmosAddress: cosmosAddress
  }
}

function generateSeed(randomBytesFunc = standardRandomBytesFunc) {
  const randomBytes = Buffer.from(randomBytesFunc(32), `hex`)
  if (randomBytes.length !== 32) throw Error(`Entropy has incorrect length`)
  const mnemonic = bip39.entropyToMnemonic(randomBytes.toString(`hex`))

  return mnemonic
}

async function generateWallet(randomBytesFunc = standardRandomBytesFunc) {
  const mnemonic = generateSeed(randomBytesFunc)
  return await generateWalletFromSeed(mnemonic)
}

// NOTE: this only works with a compressed public key (33 bytes)
function createCosmosAddress(publicKey) {
  const message = CryptoJS.enc.Hex.parse(publicKey.toString(`hex`))
  const hash = ripemd160(sha256(message)).toString()
  const address = Buffer.from(hash, `hex`)
  const cosmosAddress = bech32ify(address, `micro`)

  return cosmosAddress
}

async function deriveMasterKey(mnemonic) {
  // throws if mnemonic is invalid
  bip39.validateMnemonic(mnemonic)

  const seed = await bip39.mnemonicToSeed(mnemonic)
  const masterKey = await bip32.fromSeed(seed)
  return masterKey
}

function deriveKeypair(masterKey) {
  const cosmosHD = masterKey.derivePath(hdPathAtom)
  const privateKey = cosmosHD.privateKey
  const publicKey = secp256k1.publicKeyCreate(privateKey, true)

  return {
    privateKey,
    publicKey
  }
}

 function bech32ify(address, prefix) {
  const words = bech32.toWords(address)
  return bech32.encode(prefix, words)
}

// Transactions often have amino decoded objects in them {type, value}.
// We need to strip this clutter as we need to sign only the values.
function prepareSignBytes(jsonTx) {
  if (Array.isArray(jsonTx)) {
    return jsonTx.map(prepareSignBytes)
  }

  // string or number
  if (typeof jsonTx !== `object`) {
    return jsonTx
  }
  
  let sorted = {}
  Object.keys(jsonTx)
    .sort()
    .forEach(key => {
      if (jsonTx[key] === undefined || jsonTx[key] === null) return
  
      sorted[key] = prepareSignBytes(jsonTx[key])
    })
  return sorted
}

/*
The SDK expects a certain message format to serialize and then sign.

type StdSignMsg struct {
ChainID       string      `json:"chain_id"`
AccountNumber uint64      `json:"account_number"`
Sequence      uint64      `json:"sequence"`
Fee           auth.StdFee `json:"fee"`
Msgs          []sdk.Msg   `json:"msgs"`
Memo          string      `json:"memo"`
}
*/
function createSignMessage(jsonTx, sequence, account_number, chain_id) {
  // sign bytes need amount to be an array
  const fee = {
    amount: jsonTx.fee.amount || [],
    gas: jsonTx.fee.gas
  }

  const msg = JSON.stringify(
    prepareSignBytes({
      fee,
      memo: jsonTx.memo,
      msgs: jsonTx.msg, // weird msg vs. msgs
      sequence,
      account_number,
      chain_id
    })
  )
  return msg
}

// produces the signature for a message (returns Buffer)
function signWithPrivateKey(signMessage, privateKey) {
  const signHash = Buffer.from(sha256(signMessage).toString(), `hex`)
  const { signature } = secp256k1.sign(signHash, Buffer.from(privateKey, `hex`))
  return signature
}

function createSignature(signature, publicKey) {
  const aminokey = Buffer.concat([ Buffer.from("eb5ae98721", "hex"), publicKey ])
  return {
    signature: signature.toString(`base64`),
    pub_key: aminokey.toString(`base64`)
  }
}

// main function to sign a jsonTx using the local keystore wallet
// returns the complete signature object to add to the tx
function sign(jsonTx, wallet, requestMetaData) {
  const now = Date.now()
  var sequence = parseInt(requestMetaData.sequence, 10)
  if (now < wallet.lastSequenceTime + 1000) {
    //console.log("incrementing " + sequence + " to " + (wallet.lastSequence+1))
    if (sequence <= wallet.lastSequence) sequence = wallet.lastSequence + 1
  }
  //console.log("signing with: " + sequence)
  //console.log("TX=" + JSON.stringify(jsonTx))
  const signMessage = createSignMessage(jsonTx, '' + sequence,
    requestMetaData.account_number, requestMetaData.chain_id)
  //console.log("signMessage=" + signMessage)
  const signatureBuffer = signWithPrivateKey(signMessage, wallet.privateKey)
  const pubKeyBuffer = Buffer.from(wallet.publicKey, `hex`)
  wallet.lastSequence = sequence
  wallet.lastSequenceTime = now
  return createSignature(
    signatureBuffer,
    pubKeyBuffer
  )
}

// adds the signature object to the tx
function createSignedTx(tx, signature) {
  return Object.assign({}, tx, {
    signatures: [signature]
  })
}

// the broadcast body consists of the signed tx and a return type
function createBroadcastBody(signedTx) {
  return JSON.stringify({
    tx: signedTx,
    return: `block`
  })
}

module.exports = {
  seed: generateSeed,
  generate: generateWalletFromSeed,
  prepare: createSignMessage,
  sign: (tx, wallet, params) => {
    const signature = sign(tx, wallet, params)
    return {
      type: "cosmos-sdk/StdTx",
      value: createSignedTx(tx, signature)
    }
  },
  
}
