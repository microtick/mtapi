const axios = require('axios')
const bech32 = require('bech32')

// Messages
const auth_pb = require('./protoc_js/cosmos/auth/v1beta1/auth_pb.js')
const msg_queryAuth = require("./protoc_js/cosmos/auth/v1beta1/query_pb.js")
const msg_queryAccount = require("./protoc_js/microtick/msg/QueryAccount_pb.js")
const msg_queryConsensus = require("./protoc_js/microtick/msg/QueryConsensus_pb.js")
const msg_queryMarket = require("./protoc_js/microtick/msg/QueryMarket_pb.js")
const msg_queryOrderBook = require("./protoc_js/microtick/msg/QueryOrderBook_pb.js")
const msg_querySynthetic = require("./protoc_js/microtick/msg/QuerySynthetic_pb.js")
const msg_queryParams = require("./protoc_js/microtick/msg/QueryParams_pb.js")
const msg_queryQuote = require("./protoc_js/microtick/msg/QueryQuote_pb.js")
const msg_queryTrade = require("./protoc_js/microtick/msg/QueryTrade_pb.js")

const Util = require('./util.js')

class GRPC {
  
  constructor(url) {
    this.url = url
  }
  
  async queryAuthAccount(acct) {
    const request = new msg_queryAuth.QueryAccountRequest()
    request.setAddress(Util.convertBech32ToRaw(acct))
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(request.serializeBinary()).toString('hex'),
        height: "0",
        path: "/cosmos.auth.v1beta1.Query/Account",
        prove: false
      }
    }
    const res = await axios.post(this.url, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    const response = msg_queryAuth.QueryAccountResponse.deserializeBinary(Buffer.from(res.data.result.response.value, 'base64'))
    const obj = response.toObject()
    const resp = auth_pb.BaseAccount.deserializeBinary(Buffer.from(obj.account.value, 'base64'))
    const obj2 = resp.toObject()
    obj2.address = Util.convertRawToBech32(obj2.address)
    delete obj2.pubKey
    return obj2
  }
  
  async queryAccount(acct) {
    const request = new msg_queryAccount.QueryAccountRequest()
    request.setAccount(Util.convertBech32ToRaw(acct))
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(request.serializeBinary()).toString('hex'),
        height: "0",
        path: "/microtick.msg.GRPC/Account",
        prove: false
      }
    }
    const res = await axios.post(this.url, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    const response = msg_queryAccount.QueryAccountResponse.deserializeBinary(Buffer.from(res.data.result.response.value, 'base64'))
    const obj = response.toObject()
    obj.account = Util.convertRawToBech32(obj.account)
    obj.balancesList = response.getBalancesList().reduce((acc, el) => {
      acc[el.getDenom()] = Util.convertDecToFloat(el.getAmount())
      return acc
    }, {})
    obj.quoteBacking.amount = Util.convertDecToFloat(obj.quoteBacking.amount)
    obj.tradeBacking.amount = Util.convertDecToFloat(obj.tradeBacking.amount)
    obj.settleBacking.amount = Util.convertDecToFloat(obj.settleBacking.amount)
    return obj
  }
  
  async queryConsensus(market) {
    const request = new msg_queryConsensus.QueryConsensusRequest()
    request.setMarket(market)
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(request.serializeBinary()).toString('hex'),
        height: "0",
        path: "/microtick.msg.GRPC/Consensus",
        prove: false
      }
    }
    const res = await axios.post(this.url, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    const response = msg_queryConsensus.QueryConsensusResponse.deserializeBinary(Buffer.from(res.data.result.response.value, 'base64'))
    const obj = response.toObject()
    obj.consensus.amount = Util.convertDecToFloat(obj.consensus.amount)
    obj.totalBacking.amount = Util.convertDecToFloat(obj.totalBacking.amount)
    obj.totalWeight.amount = Util.convertDecToFloat(obj.totalWeight.amount)
    return obj
  }
  
  async queryMarket(market) {
    const request = new msg_queryMarket.QueryMarketRequest()
    request.setMarket(market)
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(request.serializeBinary()).toString('hex'),
        height: "0",
        path: "/microtick.msg.GRPC/Market",
        prove: false
      }
    }
    const res = await axios.post(this.url, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    const response = msg_queryMarket.QueryMarketResponse.deserializeBinary(Buffer.from(res.data.result.response.value, 'base64'))
    const obj = response.toObject()
    obj.consensus.amount = Util.convertDecToFloat(obj.consensus.amount)
    obj.totalBacking.amount = Util.convertDecToFloat(obj.totalBacking.amount)
    obj.totalWeight.amount = Util.convertDecToFloat(obj.totalWeight.amount)
    obj.orderBooksList = obj.orderBooksList.map(el => {
      el.sumBacking.amount = Util.convertDecToFloat(el.sumBacking.amount)
      el.sumWeight.amount = Util.convertDecToFloat(el.sumWeight.amount)
      el.insideAsk.amount = Util.convertDecToFloat(el.insideAsk.amount)
      el.insideBid.amount = Util.convertDecToFloat(el.insideBid.amount)
      el.insideCallAsk.amount = Util.convertDecToFloat(el.insideCallAsk.amount)
      el.insideCallBid.amount = Util.convertDecToFloat(el.insideCallBid.amount)
      el.insidePutAsk.amount = Util.convertDecToFloat(el.insidePutAsk.amount)
      el.insidePutBid.amount = Util.convertDecToFloat(el.insidePutBid.amount)
      return el
    })
    return obj
  }
  
  async queryOrderBook(market, duration) {
    const request = new msg_queryOrderBook.QueryOrderBookRequest()
    request.setMarket(market)
    request.setDuration(duration)
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(request.serializeBinary()).toString('hex'),
        height: "0",
        path: "/microtick.msg.GRPC/OrderBook",
        prove: false
      }
    }
    const res = await axios.post(this.url, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    const response = msg_queryOrderBook.QueryOrderBookResponse.deserializeBinary(Buffer.from(res.data.result.response.value, 'base64'))
    const obj = response.toObject()
    obj.consensus.amount = Util.convertDecToFloat(obj.consensus.amount)
    obj.sumBacking.amount = Util.convertDecToFloat(obj.sumBacking.amount)
    obj.sumWeight.amount = Util.convertDecToFloat(obj.sumWeight.amount)
    obj.callAsksList = obj.callAsksList.map(el => {
      el.premium.amount = Util.convertDecToFloat(el.premium.amount)
      el.quantity.amount = Util.convertDecToFloat(el.quantity.amount)
      return el
    })
    obj.callBidsList = obj.callBidsList.map(el => {
      el.premium.amount = Util.convertDecToFloat(el.premium.amount)
      el.quantity.amount = Util.convertDecToFloat(el.quantity.amount)
      return el
    })
    obj.putAsksList = obj.putAsksList.map(el => {
      el.premium.amount = Util.convertDecToFloat(el.premium.amount)
      el.quantity.amount = Util.convertDecToFloat(el.quantity.amount)
      return el
    })
    obj.putBidsList = obj.putBidsList.map(el => {
      el.premium.amount = Util.convertDecToFloat(el.premium.amount)
      el.quantity.amount = Util.convertDecToFloat(el.quantity.amount)
      return el
    })
    return obj
  }
  
  async querySynthetic(market, duration) {
    const request = new msg_querySynthetic.QuerySyntheticRequest()
    request.setMarket(market)
    request.setDuration(duration)
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(request.serializeBinary()).toString('hex'),
        height: "0",
        path: "/microtick.msg.GRPC/Synthetic",
        prove: false
      }
    }
    const res = await axios.post(this.url, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    const response = msg_querySynthetic.QuerySyntheticResponse.deserializeBinary(Buffer.from(res.data.result.response.value, 'base64'))
    const obj = response.toObject()
    obj.consensus.amount = Util.convertDecToFloat(obj.consensus.amount)
    obj.weight.amount = Util.convertDecToFloat(obj.weight.amount)
    for (var i=0; i<obj.asksList.length; i++) {
      const ask = obj.asksList[i]
      ask.spot.amount = Util.convertDecToFloat(ask.spot.amount)
      ask.quantity.amount = Util.convertDecToFloat(ask.quantity.amount)
    }
    for (var i=0; i<obj.bidsList.length; i++) {
      const bid = obj.bidsList[i]
      bid.spot.amount = Util.convertDecToFloat(bid.spot.amount)
      bid.quantity.amount = Util.convertDecToFloat(bid.quantity.amount)
    }
    return obj
  }
  
  async queryParams() {
    const request = new msg_queryParams.QueryParamsRequest()
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(request.serializeBinary()).toString('hex'),
        height: "0",
        path: "/microtick.msg.GRPC/Params",
        prove: false
      }
    }
    const res = await axios.post(this.url, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    const response = msg_queryParams.QueryParamsResponse.deserializeBinary(Buffer.from(res.data.result.response.value, 'base64'))
    const obj = response.toObject()
    obj.commissionQuotePercent = Util.convertDecToFloat(response.getCommissionQuotePercent())
    obj.commissionTradeFixed = Util.convertDecToFloat(response.getCommissionTradeFixed())
    obj.commissionUpdatePercent = Util.convertDecToFloat(response.getCommissionUpdatePercent())
    obj.commissionSettleFixed = Util.convertDecToFloat(response.getCommissionSettleFixed())
    obj.commissionCancelPercent = Util.convertDecToFloat(response.getCommissionCancelPercent())
    obj.settleIncentive = Util.convertDecToFloat(response.getSettleIncentive())
    obj.mintRatio = Util.convertDecToFloat(response.getMintRatio())
    obj.cancelSlashRate = Util.convertDecToFloat(response.getCancelSlashRate())
    return obj
  }
  
  async queryQuote(id) {
    const request = new msg_queryQuote.QueryQuoteRequest()
    request.setId(id)
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(request.serializeBinary()).toString('hex'),
        height: "0",
        path: "/microtick.msg.GRPC/Quote",
        prove: false
      }
    }
    const res = await axios.post(this.url, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    const response = msg_queryQuote.QueryQuoteResponse.deserializeBinary(Buffer.from(res.data.result.response.value, 'base64'))
    const obj = response.toObject()
    obj.provider = Util.convertRawToBech32(obj.provider)
    obj.backing.amount = Util.convertDecToFloat(obj.backing.amount)
    obj.ask.amount = Util.convertDecToFloat(obj.ask.amount)
    obj.bid.amount = Util.convertDecToFloat(obj.bid.amount)
    obj.quantity.amount = Util.convertDecToFloat(obj.quantity.amount)
    obj.consensus.amount = Util.convertDecToFloat(obj.consensus.amount)
    obj.spot.amount = Util.convertDecToFloat(obj.spot.amount)
    obj.delta = Util.convertDecToFloat(obj.delta)
    obj.callAsk.amount = Util.convertDecToFloat(obj.callAsk.amount)
    obj.callBid.amount = Util.convertDecToFloat(obj.callBid.amount)
    obj.putAsk.amount = Util.convertDecToFloat(obj.putAsk.amount)
    obj.putBid.amount = Util.convertDecToFloat(obj.putBid.amount)
    return obj
  }
  
  async queryTrade(id) {
    const request = new msg_queryTrade.QueryTradeRequest()
    request.setId(id)
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(request.serializeBinary()).toString('hex'),
        height: "0",
        path: "/microtick.msg.GRPC/Trade",
        prove: false
      }
    }
    const res = await axios.post(this.url, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    const response = msg_queryTrade.QueryTradeResponse.deserializeBinary(Buffer.from(res.data.result.response.value, 'base64'))
    const obj = response.toObject()
    obj.quantity.amount = Util.convertDecToFloat(obj.quantity.amount)
    obj.strike.amount = Util.convertDecToFloat(obj.strike.amount)
    obj.commission.amount = Util.convertDecToFloat(obj.commission.amount)
    obj.settleIncentive.amount = Util.convertDecToFloat(obj.settleIncentive.amount)
    obj.consensus.amount = Util.convertDecToFloat(obj.consensus.amount)
    obj.currentValue = Util.convertDecToFloat(obj.currentValue)
    obj.taker = Util.convertRawToBech32(obj.taker)
    for (var i=0; i<obj.legsList.length; i++) {
      const ll = obj.legsList[i]
      ll.long = Util.convertRawToBech32(ll.pb_long)
      ll.short = Util.convertRawToBech32(ll.pb_short)
      delete ll.pb_long
      delete ll.pb_short
      ll.backing.amount = Util.convertDecToFloat(ll.backing.amount)
      ll.premium.amount = Util.convertDecToFloat(ll.premium.amount)
      ll.cost.amount = Util.convertDecToFloat(ll.cost.amount)
      ll.quantity.amount = Util.convertDecToFloat(ll.quantity.amount)
      ll.quoted.premium.amount = Util.convertDecToFloat(ll.quoted.premium.amount)
      ll.quoted.spot.amount = Util.convertDecToFloat(ll.quoted.spot.amount)
    }
    return obj
  }
  
}

module.exports = GRPC

