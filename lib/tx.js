const sha256 = require('js-sha256')
const BN = require('bignumber.js')

const base = require('./protoc_js/cosmos/base/v1beta1/coin_pb.js')
const pb_tx = require('./protoc_js/cosmos/tx/v1beta1/tx_pb.js')

const Util = require('../lib/util.js')

// Chain transactions
  
const any = require('google-protobuf/google/protobuf/any_pb.js')
const banktx = require('./protoc_js/cosmos/bank/v1beta1/tx_pb.js')
const cryptosecp = require('./protoc_js/cosmos/crypto/secp256k1/keys_pb.js')

const mt_create = require('./protoc_js/microtick/msg/TxCreateQuote_pb.js')
const mt_cancel = require('./protoc_js/microtick/msg/TxCancelQuote_pb.js')
const mt_deposit = require('./protoc_js/microtick/msg/TxDepositQuote_pb.js')
const mt_withdraw = require('./protoc_js/microtick/msg/TxWithdrawQuote_pb.js')
const mt_update = require('./protoc_js/microtick/msg/TxUpdateQuote_pb.js')
const mt_trade = require('./protoc_js/microtick/msg/TxMarketTrade_pb.js')
const mt_pick = require('./protoc_js/microtick/msg/TxPickTrade_pb.js')
const mt_settle = require('./protoc_js/microtick/msg/TxSettleTrade_pb.js')

class MsgSend {
  
  constructor(from, to, amount) {
    this.fromAddress = from,
    this.toAddress = to,
    this.amountList = [
      Util.convertCoinString(amount)
    ]
  }
  
  toBase64() {
    return MsgSend.objectToBuffer(this).toString("base64")
  }
  
  typeName() {
    return "/cosmos.bank.v1beta1.MsgSend"
  }
  
  static objectToBuffer(obj) {
    const msg = new banktx.MsgSend()
    msg.setFromAddress(Util.convertBech32ToRaw(obj.fromAddress))
    msg.setToAddress(Util.convertBech32ToRaw(obj.toAddress))
    for (var i=0; i<obj.amountList.length; i++) {
      const amount = obj.amountList[i]
      const coin = new base.Coin()
      coin.setDenom(amount.denom)
      coin.setAmount(amount.amount)
      msg.addAmount(coin)
    }
    return Buffer.from(msg.serializeBinary())
  }
  
  static bufferToObject(buff) {
    const raw = banktx.MsgSend.deserializeBinary(buff).toObject()
    raw.fromAddress = Util.convertRawToBech32(raw.fromAddress)
    raw.toAddress = Util.convertRawToBech32(raw.toAddress)
    return raw
  }
  
}

class MT_CancelQuote {
  
  constructor(id, requester) {
    this.id = id
    this.requester = requester
  }
  
  toBase64() {
    return MT_CancelQuote.objectToBuffer(this).toString('base64')
  }
  
  typeName() {
    return "/microtick.msg.TxCancelQuote"
  }      
  
  static objectToBuffer(obj) {
    const msg = new mt_cancel.TxCancelQuote()
    msg.setId(obj.id)
    msg.setRequester(Util.convertBech32ToRaw(obj.requester))
    return Buffer.from(msg.serializeBinary())
  }
  
  static bufferToObject(buff) {
    const raw = mt_cancel.TxCancelQuote.deserializeBinary(buff).toObject()
    raw.requester = Util.convertRawToBech32(raw.requester)
    return raw
  } 
  
}

class MT_CreateQuote {
  
  constructor(market, duration, provider, backing, spot, ask, bid) {
    this.market = market
    this.duration = duration
    this.provider = provider
    this.backing = backing
    this.spot = spot
    this.ask = ask
    this.bid = bid
  }
  
  toBase64() {
    return MT_CreateQuote.objectToBuffer(this).toString('base64')
  }
    
  typeName() {
    return "/microtick.msg.TxCreateQuote"
  }
  
  static objectToBuffer(obj) {
    const msg = new mt_create.TxCreateQuote()
    msg.setMarket(obj.market)
    msg.setDuration(obj.duration)
    msg.setProvider(Util.convertBech32ToRaw(obj.provider))
    msg.setBacking(Util.convertCoinStringToCoin(obj.backing))
    msg.setSpot(Util.convertCoinStringToCoin(obj.spot))
    msg.setAsk(Util.convertCoinStringToCoin(obj.ask))
    msg.setBid(Util.convertCoinStringToCoin(obj.bid))
    return Buffer.from(msg.serializeBinary())
  }
  
  static bufferToObject(buff) {
    const raw = mt_create.TxCreateQuote.deserializeBinary(buff).toObject()
    raw.provider = Util.convertRawToBech32(raw.provider)
    raw.backing = Util.convertCoinAmount(raw.backing)
    raw.spot = Util.convertCoinAmount(raw.spot)
    raw.ask = Util.convertCoinAmount(raw.ask)
    raw.bid = Util.convertCoinAmount(raw.bid)
    return raw
  }
  
}

class MT_DepositQuote {
  
  constructor(id, requester, deposit) {
    this.id = id
    this.requester = requester
    this.deposit = deposit
  }
  
  toBase64() {
    return MT_DepositQuote.objectToBuffer(this).toString('base64')
  }
  
  typeName() {
    return "/microtick.msg.TxDepositQuote"
  }      
  
  static objectToBuffer(obj) {
    const msg = new mt_deposit.TxDepositQuote()
    msg.setId(obj.id)
    msg.setRequester(Util.convertBech32ToRaw(obj.requester))
    msg.setDeposit(Util.convertCoinStringToCoin(obj.deposit))
    return Buffer.from(msg.serializeBinary())
  }
  
  static bufferToObject(buff) {
    const raw = mt_deposit.TxDepositQuote.deserializeBinary(buff).toObject()
    raw.requester = Util.convertRawToBech32(raw.requester)
    raw.deposit = Util.convertCoinAmount(raw.deposit)
    return raw
  } 
  
}

class MT_MarketTrade {
  
  constructor(market, duration, taker, order, quantity) {
    this.market = market
    this.duration = duration
    this.taker = taker
    this.order = order
    this.quantity = quantity
  }
  
  toBase64() {
    return MT_MarketTrade.objectToBuffer(this).toString('base64')
  }
    
  typeName() {
    return "/microtick.msg.TxMarketTrade"
  }
  
  static objectToBuffer(obj) {
    const msg = new mt_trade.TxMarketTrade()
    msg.setMarket(obj.market)
    msg.setDuration(obj.duration)
    msg.setTaker(Util.convertBech32ToRaw(obj.taker))
    msg.setOrderType(obj.order)
    msg.setQuantity(Util.convertCoinStringToCoin(obj.quantity))
    return Buffer.from(msg.serializeBinary())
  }
  
  static bufferToObject(buff) {
    const raw = mt_trade.TxMarketTrade.deserializeBinary(buff).toObject()
    raw.taker = Util.convertRawToBech32(raw.taker)
    raw.quantity = Util.convertCoinAmount(raw.quantity)
    return raw
  }
  
}

class MT_PickTrade {
  
  constructor(id, taker, order) {
    this.id = id
    this.taker = taker
    this.order = order
  }
  
  toBase64() {
    return MT_PickTrade.objectToBuffer(this).toString('base64')
  }
    
  typeName() {
    return "/microtick.msg.TxPickTrade"
  }
  
  static objectToBuffer(obj) {
    const msg = new mt_pick.TxPickTrade()
    msg.setId(obj.id)
    msg.setTaker(Util.convertBech32ToRaw(obj.taker))
    msg.setOrderType(obj.order)
    return Buffer.from(msg.serializeBinary())
  }
  
  static bufferToObject(buff) {
    const raw = mt_pick.TxPickTrade.deserializeBinary(buff).toObject()
    raw.taker = Util.convertRawToBech32(raw.taker)
    return raw
  }
  
}

class MT_SettleTrade {
  
  constructor(id, requester) {
    this.id = id
    this.requester = requester
  }
  
  toBase64() {
    return MT_SettleTrade.objectToBuffer(this).toString('base64')
  }
  
  typeName() {
    return "/microtick.msg.TxSettleTrade"
  }      
  
  static objectToBuffer(obj) {
    const msg = new mt_settle.TxSettleTrade()
    msg.setId(obj.id)
    msg.setRequester(Util.convertBech32ToRaw(obj.requester))
    return Buffer.from(msg.serializeBinary())
  }
  
  static bufferToObject(buff) {
    const raw = mt_settle.TxSettleTrade.deserializeBinary(buff).toObject()
    raw.requester = Util.convertRawToBech32(raw.requester)
    return raw
  } 
  
}

class MT_UpdateQuote {
  
  constructor(id, requester, spot, ask, bid) {
    this.id = id
    this.requester = requester
    this.spot = spot
    this.ask = ask
    this.bid = bid
  }
  
  toBase64() {
    return MT_UpdateQuote.objectToBuffer(this).toString('base64')
  }
    
  typeName() {
    return "/microtick.msg.TxUpdateQuote"
  }
  
  static objectToBuffer(obj) {
    const msg = new mt_update.TxUpdateQuote()
    msg.setId(obj.id)
    msg.setRequester(Util.convertBech32ToRaw(obj.requester))
    msg.setNewSpot(Util.convertCoinStringToCoin(obj.spot))
    msg.setNewAsk(Util.convertCoinStringToCoin(obj.ask))
    msg.setNewBid(Util.convertCoinStringToCoin(obj.bid))
    return Buffer.from(msg.serializeBinary())
  }
  
  static bufferToObject(buff) {
    const raw = mt_update.TxUpdateQuote.deserializeBinary(buff).toObject()
    raw.requester = Util.convertRawToBech32(raw.requester)
    raw.spot = Util.convertCoinAmount(raw.spot)
    raw.ask = Util.convertCoinAmount(raw.ask)
    raw.bid = Util.convertCoinAmount(raw.bid)
    return raw
  }
  
}

class MT_WithdrawQuote {
  
  constructor(id, requester, withdraw) {
    this.id = id
    this.requester = requester
    this.withdraw = withdraw
  }
  
  toBase64() {
    return MT_WithdrawQuote.objectToBuffer(this).toString('base64')
  }
  
  typeName() {
    return "/microtick.msg.TxWithdrawQuote"
  }      
  
  static objectToBuffer(obj) {
    const msg = new mt_withdraw.TxWithdrawQuote()
    msg.setId(obj.id)
    msg.setRequester(Util.convertBech32ToRaw(obj.requester))
    msg.setWithdraw(Util.convertCoinStringToCoin(obj.withdraw))
    return Buffer.from(msg.serializeBinary())
  }
  
  static bufferToObject(buff) {
    const raw = mt_withdraw.TxWithdrawQuote.deserializeBinary(buff).toObject()
    raw.requester = Util.convertRawToBech32(raw.requester)
    raw.withdraw = Util.convertCoinAmount(raw.withdraw)
    return raw
  } 
  
}

// Any
    
const classMapping = {}
classMapping['/cosmos.bank.v1beta1.MsgSend'] = MsgSend
classMapping['/microtick.msg.TxCreateQuote'] = MT_CreateQuote
classMapping['/microtick.msg.TxCancelQuote'] = MT_CancelQuote
classMapping['/microtick.msg.TxDepositQuote'] = MT_DepositQuote
classMapping['/microtick.msg.TxWithdrawQuote'] = MT_WithdrawQuote
classMapping['/microtick.msg.TxUpdateQuote'] = MT_UpdateQuote
classMapping['/microtick.msg.TxMarketTrade'] = MT_MarketTrade
classMapping['/microtick.msg.TxPickTrade'] = MT_PickTrade
classMapping['/microtick.msg.TxSettleTrade'] = MT_SettleTrade

class AnyTx {
  
  /*
  {
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: 'base64 bytes'
  }
  */
  
  static toObject(any) {
    return classMapping[any.typeUrl].bufferToObject(Buffer.from(any.value, "base64"))
  }
  
  static fromObject(obj) {
    const msg = new any.Any()
    msg.setTypeUrl(obj.typeName())
    msg.setValue(obj.toBase64())
    return msg
  }
  
}

class Tx {
  
  constructor(msg) {
    this.body = new pb_tx.TxBody()
    this.body.addMessages(AnyTx.fromObject(msg))
  }
  
  createSigningHash(publicKey, chainid, account, sequence, gas) {
    const pubkey = new cryptosecp.PubKey()
    pubkey.setKey(publicKey)
    
    const key = new any.Any()
    key.setTypeUrl("/cosmos.crypto.secp256k1.PubKey")
    key.setValue(pubkey.serializeBinary())
    
    const signmode = new pb_tx.ModeInfo()
    const single = new pb_tx.ModeInfo.Single()
    single.setMode(1)
    signmode.setSingle(single)
    
    const fee = new pb_tx.Fee()
    fee.setGasLimit(gas)
    const si = new pb_tx.SignerInfo()
    si.setSequence(sequence)
    si.setPublicKey(key)
    si.setModeInfo(signmode)
    
    this.authInfo = new pb_tx.AuthInfo()
    this.authInfo.addSignerInfos(si)
    this.authInfo.setFee(fee)
    
    const signDoc = new pb_tx.SignDoc()
    signDoc.setBodyBytes(this.body.serializeBinary())
    signDoc.setAuthInfoBytes(this.authInfo.serializeBinary())
    signDoc.setAccountNumber(account)
    signDoc.setChainId(chainid)
    return Buffer.from(sha256(signDoc.serializeBinary()), 'hex')
  }
    
  generateBroadcastBytes(sig) {
    const rawtx = new pb_tx.Tx()
    rawtx.setBody(this.body)
    rawtx.setAuthInfo(this.authInfo)
    rawtx.addSignatures(sig)
    return Buffer.from(rawtx.serializeBinary())
  }
  
  static deserialize(b64) {
    const bytes = Buffer.from(b64, "base64")
    return pb_tx.Tx.deserializeBinary(bytes).toObject()
  }
  
  static getTransactionObjects(b64) {
    const rawTx = Tx.deserialize(b64)
    const txs = rawTx.body.messagesList.map(any => {
      return AnyTx.toObject(any)
    })
    return txs
  }
  
}

module.exports = {
  Send: MsgSend,
  Create: MT_CreateQuote,
  Cancel: MT_CancelQuote,
  Deposit: MT_DepositQuote,
  Withdraw: MT_WithdrawQuote,
  Update: MT_UpdateQuote,
  Trade: MT_MarketTrade,
  Pick: MT_PickTrade,
  Settle: MT_SettleTrade,
  Tx: Tx
}
