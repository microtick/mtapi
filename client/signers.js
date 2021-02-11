import bip32 from 'bip32'
import bip39 from 'bip39'
import cryptojs from 'crypto-js'
import ripemd160 from 'crypto-js/ripemd160.js'
import secp256k1 from 'secp256k1'
import sha256 from 'js-sha256'
import bech32 from 'bech32'

export class SoftwareSigner {
  
  getType() {
    return "software"
  }
  
  async generateNewMnemonic() {
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

export class LedgerSigner {
  
  constructor(app) {
    // Pass in Cosmos app created like this:
    //
    // --- start code ---
    // import CosmosApp from 'ledger-cosmos-js'
    //
    // Use this import for node.js applications
    // import Transport from '@ledgerhq/hw-transport-node-hid'
    //
    // Use this for browser-based applications
    // import Transport from '@ledgerhq/hw-transport-webusb'
    //
    // const usb = await Transport.default.create()
    // const app = new CosmosApp.default(usb)
    //
    // import MTAPI from 'mtapi'
    // const signer = new MTAPI.LedgerSigner(app)
    // --- end code ---

    this.app = app
  }
  
  getType() {
    return "ledger"
  }
  
  async init(prefix, account, index) {
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
