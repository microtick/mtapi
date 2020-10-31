const abci = require('./protoc_js/cosmos/base/abci/v1beta1/abci_pb.js')

const mt_create = require('./protoc_js/microtick/msg/TxCreateQuote_pb.js')
const mt_cancel = require('./protoc_js/microtick/msg/TxCancelQuote_pb.js')
const mt_deposit = require('./protoc_js/microtick/msg/TxDepositQuote_pb.js')
const mt_withdraw = require('./protoc_js/microtick/msg/TxWithdrawQuote_pb.js')
const mt_update = require('./protoc_js/microtick/msg/TxUpdateQuote_pb.js')
const mt_trade = require('./protoc_js/microtick/msg/TxMarketTrade_pb.js')
const mt_pick = require('./protoc_js/microtick/msg/TxPickTrade_pb.js')
const mt_settle = require('./protoc_js/microtick/msg/TxSettleTrade_pb.js')

const Util = require('./util.js')

const decodeResult = res64 => {
  const resData = abci.TxMsgData.deserializeBinary(Buffer.from(res64, 'base64')).toObject()
  const decoded = resData.dataList.reduce((acc, item) => {
    switch (item.msgType) {
    case "quote_create":
      var data = mt_create.CreateQuoteData.deserializeBinary(item.data).toObject()
      data.account = Util.convertRawToBech32(data.account)
      data.spot.amount = Util.convertDecToFloat(data.spot.amount)
      data.ask.amount = Util.convertDecToFloat(data.ask.amount)
      data.bid.amount = Util.convertDecToFloat(data.bid.amount)
      data.consensus.amount = Util.convertDecToFloat(data.consensus.amount)
      data.backing.amount = Util.convertDecToFloat(data.backing.amount)
      data.commission.amount = Util.convertDecToFloat(data.commission.amount)
      break
    case "quote_cancel":
      data = mt_cancel.CancelQuoteData.deserializeBinary(item.data).toObject()
      data.account = Util.convertRawToBech32(data.account)
      data.consensus.amount = Util.convertDecToFloat(data.consensus.amount)
      data.refund.amount = Util.convertDecToFloat(data.refund.amount)
      data.slash.amount = Util.convertDecToFloat(data.slash.amount)
      data.commission.amount = Util.convertDecToFloat(data.commission.amount)
      break
    case "quote_deposit":
      data = mt_deposit.DepositQuoteData.deserializeBinary(item.data).toObject()
      data.account = Util.convertRawToBech32(data.account)
      data.consensus.amount = Util.convertDecToFloat(data.consensus.amount)
      data.backing.amount = Util.convertDecToFloat(data.backing.amount)
      data.quoteBacking.amount = Util.convertDecToFloat(data.quoteBacking.amount)
      data.commission.amount = Util.convertDecToFloat(data.commission.amount)
      break
    case "quote_withdraw":
      data = mt_withdraw.WithdrawQuoteData.deserializeBinary(item.data).toObject()
      data.account = Util.convertRawToBech32(data.account)
      data.consensus.amount = Util.convertDecToFloat(data.consensus.amount)
      data.backing.amount = Util.convertDecToFloat(data.backing.amount)
      data.quoteBacking.amount = Util.convertDecToFloat(data.quoteBacking.amount)
      data.commission.amount = Util.convertDecToFloat(data.commission.amount)
      break
    case "quote_update":
      data = mt_update.UpdateQuoteData.deserializeBinary(item.data).toObject()
      data.account = Util.convertRawToBech32(data.account)
      data.spot.amount = Util.convertDecToFloat(data.spot.amount)
      data.ask.amount = Util.convertDecToFloat(data.ask.amount)
      data.bid.amount = Util.convertDecToFloat(data.bid.amount)
      data.consensus.amount = Util.convertDecToFloat(data.consensus.amount)
      data.commission.amount = Util.convertDecToFloat(data.commission.amount)
      break
    case "trade_market":
      data = mt_trade.MarketTradeData.deserializeBinary(item.data).toObject()
      data.consensus.amount = Util.convertDecToFloat(data.consensus.amount)
      data.trade.taker = Util.convertRawToBech32(data.trade.taker)
      data.trade.quantity.amount = Util.convertDecToFloat(data.trade.quantity.amount)
      data.trade.strike.amount = Util.convertDecToFloat(data.trade.strike.amount)
      data.trade.commission.amount = Util.convertDecToFloat(data.trade.commission.amount)
      data.trade.settleIncentive.amount = Util.convertDecToFloat(data.trade.settleIncentive.amount)
      for (var i=0; i<data.trade.legsList.length; i++) {
        const leg = data.trade.legsList[i]
        leg.backing.amount = Util.convertDecToFloat(leg.backing.amount)
        leg.premium.amount = Util.convertDecToFloat(leg.premium.amount)
        leg.cost.amount = Util.convertDecToFloat(leg.cost.amount)
        leg.quantity.amount = Util.convertDecToFloat(leg.quantity.amount)
        leg.pb_long = Util.convertRawToBech32(leg.pb_long)
        leg.pb_short = Util.convertRawToBech32(leg.pb_short)
        leg.quoted.premium.amount = Util.convertDecToFloat(leg.quoted.premium.amount)
        leg.quoted.spot.amount = Util.convertDecToFloat(leg.quoted.spot.amount)
      }
      break
    case "trade_pick":
      data = mt_pick.PickTradeData.deserializeBinary(item.data).toObject()
      data.consensus.amount = Util.convertDecToFloat(data.consensus.amount)
      data.trade.taker = Util.convertRawToBech32(data.trade.taker)
      data.trade.quantity.amount = Util.convertDecToFloat(data.trade.quantity.amount)
      data.trade.strike.amount = Util.convertDecToFloat(data.trade.strike.amount)
      data.trade.commission.amount = Util.convertDecToFloat(data.trade.commission.amount)
      data.trade.settleIncentive.amount = Util.convertDecToFloat(data.trade.settleIncentive.amount)
      for (var i=0; i<data.trade.legsList.length; i++) {
        const leg = data.trade.legsList[i]
        leg.backing.amount = Util.convertDecToFloat(leg.backing.amount)
        leg.premium.amount = Util.convertDecToFloat(leg.premium.amount)
        leg.cost.amount = Util.convertDecToFloat(leg.cost.amount)
        leg.quantity.amount = Util.convertDecToFloat(leg.quantity.amount)
        leg.pb_long = Util.convertRawToBech32(leg.pb_long)
        leg.pb_short = Util.convertRawToBech32(leg.pb_short)
        leg.quoted.premium.amount = Util.convertDecToFloat(leg.quoted.premium.amount)
        leg.quoted.spot.amount = Util.convertDecToFloat(leg.quoted.spot.amount)
      }
      break
    case "trade_settle":
      data = mt_settle.TradeSettlementData.deserializeBinary(item.data).toObject()
      data.pb_final.amount = Util.convertDecToFloat(data.pb_final.amount)
      data.incentive.amount = Util.convertDecToFloat(data.incentive.amount)
      data.commission.amount = Util.convertDecToFloat(data.commission.amount)
      data.settler = Util.convertRawToBech32(data.settler)
      for (var i=0; i<data.settlementsList.length; i++) {
        const leg = data.settlementsList[i]
        leg.settleAccount = Util.convertRawToBech32(leg.settleAccount)
        leg.settle.amount = Util.convertDecToFloat(leg.settle.amount)
        leg.refundAccount = Util.convertRawToBech32(leg.refundAccount)
        leg.refund.amount = Util.convertDecToFloat(leg.refund.amount)
      }
      break
    }
    acc = Object.assign(acc, data)
    return acc
  }, {})
  return decoded
}

module.exports = decodeResult