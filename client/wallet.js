const bech32 = require('bech32')
const bip32 = require(`bip32`)
const bip39 = require(`bip39`)
const CryptoJS = require("crypto-js")
const ripemd160 = require('crypto-js/ripemd160')
const secp256k1 = require(`secp256k1`)
const sha256 = require('js-sha256')
const BN = require('bignumber.js')

const standardRandomBytesFunc = x => CryptoJS.lib.WordArray.random(x).toString()

class Wallet {
  
  static newFromHD(prefix, account, index) {
    const wallet = new Wallet()
    wallet.hdpath = "m/44'/118'/" + account + "'/0/" + index
    console.log("path=" + wallet.hdpath)
    wallet.prefix = prefix
    return wallet
  }
  
  static newFromLedger() {
    const wallet = new Wallet()
    return wallet
  }
  
  static newFromKey(prefix, priv) {
    const wallet = new Wallet()
    wallet.priv = priv
    wallet.pub = Buffer.from(secp256k1.publicKeyCreate(priv, true))
    
    const enc = CryptoJS.enc.Hex.parse(sha256(wallet.pub).toString('hex'))
    const hash = ripemd160(enc).toString()
    const address = Buffer.from(hash, `hex`)
    const words = bech32.toWords(address)
    
    wallet.address = bech32.encode(prefix, words)
    return wallet
  }
  
  static async generateNewMnemonic() {
    const randomBytes = Buffer.from(standardRandomBytesFunc(32), `hex`)
    if (randomBytes.length !== 32) throw Error(`Entropy has incorrect length`)
    return bip39.entropyToMnemonic(randomBytes.toString(`hex`))
  }
  
  async init(mnemonic) {
    bip39.validateMnemonic(mnemonic)
    
    const seed = await bip39.mnemonicToSeed(mnemonic)
    this.masterKey = await bip32.fromSeed(seed)
    const hd = this.masterKey.derivePath(this.hdpath)
    
    this.priv = hd.privateKey
    this.pub = Buffer.from(secp256k1.publicKeyCreate(this.priv, true))
    
    const enc = CryptoJS.enc.Hex.parse(sha256(this.pub).toString('hex'))
    const hash = ripemd160(enc).toString()
    const address = Buffer.from(hash, `hex`)
    const words = bech32.toWords(address)
    
    this.address = bech32.encode(this.prefix, words)
  }
  
  sign(hash) {
    if (!(hash instanceof Buffer)) {
      throw new Error("signing requires Buffer input hash")
    }
    const { signature } = secp256k1.ecdsaSign(hash, this.priv)
    return Buffer.from(signature)
  }
  
}

module.exports = Wallet
