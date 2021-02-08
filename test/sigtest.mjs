// This is a Stargate javascript offline signing module that can use software or ledger
// signers. Note: it depends on the legacy amino signatures.

import bip32 from 'bip32'
import bip39 from 'bip39'
import cryptojs from 'crypto-js'
import ripemd160 from 'crypto-js/ripemd160.js'
import secp256k1 from 'secp256k1'
import sha256 from 'js-sha256'
import bech32 from 'bech32'

// Use this for node.js
//import Transport from '@ledgerhq/hw-transport-node-hid'
// Use this for browser
//import Transport from '@ledgerhq/hw-transport-webusb'

//import CosmosApp from 'ledger-cosmos-js'

class SoftwareSigner {
  
  static async generateNewMnemonic() {
    const standardRandomBytesFunc = x => cryptojs.lib.WordArray.random(x).toString()
    
    const randomBytes = Buffer.from(standardRandomBytesFunc(32), `hex`)
    if (randomBytes.length !== 32) throw Error(`Entropy has incorrect length`)
    return bip39.entropyToMnemonic(randomBytes.toString(`hex`))
  }  
  
  async initFromMnemonic(mnemonic, prefix, account, index) {
    const hdpath = "m/44'/118'/" + account + "'/0/" + index
    
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error("Invalid mnemonic")
    }
    
    const seed = await bip39.mnemonicToSeed(mnemonic)
    const masterKey = await bip32.fromSeed(seed)
    const hd = masterKey.derivePath(hdpath)
    
    this.priv = hd.privateKey
    this.pub = Buffer.from(secp256k1.publicKeyCreate(this.priv, true))
    
    const enc = cryptojs.enc.Hex.parse(sha256(this.pub).toString('hex'))
    const hash = ripemd160(enc).toString()
    const address = Buffer.from(hash, `hex`)
    const words = bech32.toWords(address)    
    
    this.address = bech32.encode(prefix, words)
  }
  
  async initFromPrivateKey(prefix, priv) {
    this.priv = priv
    this.pub = Buffer.from(secp256k1.publicKeyCreate(this.priv, true))
    
    const enc = cryptojs.enc.Hex.parse(sha256(this.pub).toString('hex'))
    const hash = ripemd160(enc).toString()
    const address = Buffer.from(hash, `hex`)
    const words = bech32.toWords(address)    
    
    this.address = bech32.encode(prefix, words)
  }

  getAddress() {
    return this.address
  }
  
  getPubKey() {
    return this.pub.toString('base64')
  }
  
  async sign(tx) {
    const str = JSON.stringify(tx)
    const hash = Buffer.from(sha256(str).toString(), 'hex')
    const { signature } = secp256k1.ecdsaSign(hash, this.priv)
    return Buffer.from(signature).toString('base64')
  }
  
}

class LedgerSigner {
  
  async init(prefix, account, index) {
    const usb = await Transport.default.create()
    this.app = new CosmosApp.default(usb)
    this.path = [44, 118, account, 0, index]
    const response = await this.app.getAddressAndPubKey(this.path, prefix)
    if (response.return_code !== 0x9000) {
      throw new Error("Ledger initialization failed")
    }
    this.pub = response.compressed_pk
    this.address = response.bech32_address
  }
  
  getAddress() {
    return this.address
  }
  
  getPubKey() {
    return this.pub.toString('base64')
  }
  
  async sign(tx) {
    const response = await this.app.sign(this.path, JSON.stringify(tx))
    if (response.return_code !== 0x9000) {
      throw new Error("Ledger transaction rejected")
    }
    var sig = response.signature
    var sigBuf = Buffer.from(response.signature)
    if (sigBuf[0] !== 0x30) {
      throw new Error("ASN: invalid encoding")
    }
    sigBuf = sigBuf.slice(2, sigBuf[1] + 2)
    if (sigBuf[0] !== 0x02) {
      throw new Error("ASN: invalid encoding")
    }
    var r = sigBuf.slice(2, sigBuf[1] + 2)
    if (r.length === 33) r = r.slice(1) // remove sign byte
    const sIndex = sigBuf[1] + 2
    if (sigBuf[sIndex] !== 2) {
      throw new Error("ASN: invalid encoding")
    }
    var s = sigBuf.slice(sIndex+2, sIndex + sigBuf[sIndex+1] + 2)
    if (s.length === 33) s = s.slice(1) // remove sign byte
    sigBuf = Buffer.concat([r, s])
    
    return sigBuf.toString('base64')
  }
  
}

const txLookup = {
  cancel: {
    proto: "/microtick.msg.TxCancelQuote",
    legacy: "microtick/Cancel"
  },
  create: {
    proto: "/microtick.msg.TxCreateQuote",
    legacy: "microtick/Create"
  },
  deposit: {
    proto: "/microtick.msg.TxDepositQuote",
    legacy: "/microtick/Deposit"
  },
  withdraw: {
    proto: "/microtick.msg.TxWithdrawQuote",
    legacy: "/microtick/Withdraw"
  },
  update: {
    proto: "/microtick.msg.TxUpdateQuote",
    legacy: "/microtick/Update"
  },
  trade: {
    proto: "/microtick.msg.TxMarketTrade",
    legacy: "/microtick/Trade"
  },
  pick: {
    proto: "/microtick.msg.TxPickTrade",
    legacy: "/microtick/Pick"
  },
  settle: {
    proto: "/microtick.msg.TxSettleTrade",
    legacy: "/microtick/Settle"
  }
}

class TxFactory {
  
  constructor(chainId, account, sequence, type, payload, gas) {
    this.type = type
    this.payload = payload
    this.chainId = chainId
    // make strings
    this.account = "" + account
    this.sequence = "" + sequence
    if (gas !== undefined) {
      this.gas = "" + gas
    } else {
      this.gas = "500000"
    }
  }
  
  build() {
    // Legacy envelope
    const tx = {
      msgs: [],
      memo: "",
      fee: {
        amount: [],
        gas: this.gas
      }
    }
    
    tx.msgs.push({
      type: txLookup[this.type].legacy,
      value: this.payload
    })

    // Canonicalize object
    return this._canonicalize(tx, this.chainId, this.account, this.sequence)
  }
  
  publish(pubkey, sig) {
    // Protobuf envelope
    const tx = {
      body: {
        messages: [],
        memo: "",
        timeout_height: "0",
        extension_options: [],
        non_critical_extension_options: []
      },
      auth_info: {
        signer_infos: [],
        fee: {
          amount: [],
          gas_limit: this.gas,
          payer: "",
          granter: ""
        }
      }
    }
    
    // add payload
    tx.body.messages.push(Object.assign({
      "@type": txLookup[this.type].proto,
    }, this.payload))
    
    // add signer info
    const si = {
      public_key: {
        '@type': "/cosmos.crypto.secp256k1.PubKey",
        key: pubkey
      },
      mode_info: {
        single: {
          mode: "SIGN_MODE_LEGACY_AMINO_JSON"
        }
      },
      sequence: this.sequence
    }
    tx.auth_info.signer_infos.push(si)
  
    // add signature
    tx.signatures = [ sig ]
  
    return tx
  }
  
  _canonicalize(jsonTx, chain, account, sequence) {
    // create deep copy
    const obj = JSON.parse(JSON.stringify(jsonTx))
  
    // add transient fields
    obj.chain_id = chain
    obj.account_number = account
    obj.sequence = sequence
    return this._sort(obj)
  }

  _sort(obj) {
    if (Array.isArray(obj)) {
      return obj.map(this._sort.bind(this))
    }
    if (typeof obj !== `object`) {
      return obj
    }
    let sorted = {}
    Object.keys(obj).sort().forEach(key => {
      if (obj[key] === undefined || obj[key] === null) return
      sorted[key] = this._sort(obj[key])
    })
    return sorted
  }
}

async function main() {
  const bech_prefix = "micro"
  const hd_account = 0
  const hd_index = 0
  
  // Use this for a software signer
  const mnemonic = "pudding winter merge gadget destroy answer predict crime book pudding rack robust east test write analyst cloud vapor song october swap flower birth nature"
  //console.log("mnemonic='" + mnemonic + "'")
  const signer = new SoftwareSigner()
  await signer.initFromMnemonic(mnemonic, bech_prefix, hd_account, hd_index)
  
  // Use this for a ledger hardware wallet signer
  // (uncomment the appropriate import for node.js or browser at the top)
  //const signer = new LedgerSigner()
  //await signer.init(bech_prefix, hd_account, hd_index)
  
  const account_number = 11
  const sequence = 0
  const gas = 500000
  
  const factory = new TxFactory("microtick", account_number, sequence, "create", {
    market: "ETHUSD",
    duration: "5minute",
    provider: signer.getAddress(),
    backing: "1backing",
    spot: "1700spot",
    ask: "5.1premium",
    bid: "1premium"
  })
  
  // Sign it
  const tx = factory.build()
  const sig = await signer.sign(tx)
  console.log(JSON.stringify(tx))
  const res = factory.publish(signer.getPubKey(), sig)
  console.log(JSON.stringify(res))
}

main()
