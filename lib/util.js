const bech32 = require('bech32')
const base = require('./protoc_js/cosmos/base/v1beta1/coin_pb.js')
const BN = require('bignumber.js')

class Util {
  
  static convertRawToBech32(raw) {
    const words = bech32.toWords(Buffer.from(raw, "base64"))
    return bech32.encode('micro', words)
  }
  
  static convertBech32ToRaw(addr) {
    const decoded = bech32.decode(addr)
    return Buffer.from(bech32.fromWords(decoded.words))
  }
  
  static convertDecToFloat(amount) {
    const trunc = amount.slice(0, -12)
    return parseFloat(trunc / 1000000)
  }
  
  static convertCoinString(str) {
    const arr = str.match(/^([0-9]+)([a-zA-Z]+)$/)
    if (arr === null) {
      throw new Error("Invalid coin string: " + str)
    }
    return {
      denom: arr[2],
      amount: arr[1]
    }
  }
  
  static convertCoinAmount(coin) {
    const amt = new BN(coin.amount).dividedBy("1000000000000000000") + coin.denom
    return amt
  }
  
  static convertCoinStringToCoin(str) {
    const arr = str.match(/^([0-9]+(?:\.[0-9]+)?)([a-zA-Z]+)$/)
    if (arr === null) {
      throw new Error("Invalid coin string: " + str)
    }
    const obj = {
      denom: arr[2],
      amount: arr[1]
    }
    const coin = new base.Coin()
    coin.setDenom(obj.denom)
    coin.setAmount(new BN(obj.amount).multipliedBy("1000000000000000000").toFixed())
    return coin
  }
  
}

module.exports = Util
