module.exports = {
  fullTx: {
    "deposit": rec => {
      const obj = {
        event: "deposit",
        height: rec.height,
        time: new Date(rec.time * 1000),
        account: rec.account,
        from: rec.from,
        amount: rec.amount,
        memo: rec.memo,
        hash: rec.hash
      }
      return obj
    },
    "withdraw": rec => {
      const obj = {
        event: "withdraw",
        height: rec.height,
        time: new Date(rec.time * 1000),
        account: rec.account,
        to: rec.to,
        amount: rec.amount,
        memo: rec.memo,
        hash: rec.hash
      }
      return obj
    },
    "trade.start": rec => {
      const obj = {
        event: "trade.start",
        height: rec.height,
        time: new Date(rec.time * 1000),
        id: rec.trade.id,
        market: rec.market,
        duration: rec.duration,
        order: rec.trade.order,
        taker: rec.trade.taker,
        quantity: rec.trade.quantity.amount,
        start: new Date(rec.trade.start * 1000),
        expiration: new Date(rec.trade.expiration * 1000),
        strike: rec.trade.strike.amount,
        commission: rec.trade.commission.amount,
        settleincentive: rec.trade.settleIncentive.amount,
        legs: rec.trade.legsList.map(leg => {
          return {
            leg_id: leg.leg_id,
            type: leg.type ? "call" : "put",
            long: leg.long,
            short: leg.short,
            final: leg.final,
            backing: leg.backing.amount,
            premium: leg.premium.amount,
            cost: leg.cost.amount,
            quantity: leg.quantity.amount,
            quoted: {
              id: leg.quoted.id,
              premium: leg.quoted.premium.amount,
              spot: leg.quoted.spot.amount
            }
          }
        })
      }
      return obj
    },
    "trade.end": rec => {
      const obj = {
        event: "trade.end",
        height: rec.height,
        time: new Date(rec.time * 1000),
        id: rec.id,
        long: rec.long,
        final: rec.pb_final.amount,
        settlements: rec.settlementsList.map(s => {
          return {
            leg_id: s.legId,
            settle: {
              account: s.settleAccount,
              amount: s.settle.amount
            },
            refund: {
              account: s.refundAccount,
              amount: s.refund.amount
            }
          }
        })
      }
      return obj
    },
    "settle.finalize": rec => {
      const obj = {  
        event: "settle.finalize",
        incentive: rec.incentive.amount,
        commission: rec.commission.amount
      }
      return obj
    },
    "quote.create": rec => {
      const obj = {
        event: "quote.create",
        backing: rec.backing.amount,
        commission: rec.commission.amount
      }
      return obj
    },
    "quote.deposit": rec => {
      const obj = {
        event: "quote.deposit",
        backing: rec.backing.amount,
        commission: rec.commission.amount
      }
      return obj
    },
    "quote.update": rec => {
      const obj = {
        event: "quote.update",
        commission: rec.commission.amount
      }
      return obj
    },
    "quote.withdraw": rec => {
      const obj = {
        event: "quote.withdraw",
        backing: rec.backing.amount,
        commission: rec.commission.amount
      }
      return obj
    }
  },
  ledgerTx: {
    "deposit": (acct, rec) => {
      const obj = {
        event: "deposit",
        height: rec.height,
        time: new Date(rec.time * 1000),
        amount: rec.amount,
        commission: 0,
        debit: 0,
        credit: rec.amount,
        balance: rec.balance
      }
      return obj
    },
    "withdraw": (acct, rec) => {
      const obj = {
        event: "withdraw",
        height: rec.height,
        time: new Date(rec.time * 1000),
        amount: rec.amount,
        commission: 0,
        debit: rec.amount,
        credit: 0,
        balance: rec.balance
      }
      return obj
    },
    "quote.cancel": (acct, rec) => {
      const refund = rec.refund.amount
      const obj = {
        event: "quote.cancel",
        height: rec.height,
        time: new Date(rec.time * 1000),
        id: rec.id,
        market: rec.market,
        duration: rec.duration,
        amount: refund,
        debit: 0,
        credit: refund,
        balance: rec.balance[acct]
      }
      return obj
    },
    "quote.create": (acct, rec) => {
      const backing = rec.backing.amount
      const commission = rec.commission.amount
      const obj = {
        event: "quote.create",
        height: rec.height,
        time: new Date(rec.time * 1000),
        id: rec.id,
        market: rec.market,
        duration: rec.duration,
        amount: backing,
        backing: backing,
        debit: backing + commission,
        credit: 0,
        commission: commission,
        balance: rec.balance[acct]
      }
      return obj
    },
    "quote.deposit": (acct, rec) => {
      const backing = rec.backing.amount
      const commission = rec.commission.amount
      return {
        event: "quote.deposit",
        height: rec.height,
        time: new Date(rec.time * 1000),
        id: rec.id,
        amount: backing,
        debit: backing + commission,
        credit: 0,
        commission: commission,
        balance: rec.balance[acct]
      }
    },
    "quote.update": (acct, rec) => {
      const commission = rec.commission.amount
      return {
        event: "quote.update",
        height: rec.height,
        time: new Date(rec.time * 1000),
        id: rec.id,
        amount: 0,
        debit: commission,
        commission: commission,
        balance: rec.balance[acct]
      }
    },
    "quote.withdraw": (acct, rec) => {
      const backing = rec.backing.amount
      const commission = rec.commission.amount
      return {
        event: "quote.withdraw",
        height: rec.height,
        time: new Date(rec.time * 1000),
        id: rec.id,
        amount: backing,
        debit: 0,
        credit: backing + commission,
        commission: commission,
        balance: rec.balance[acct]
      }
    },
    "trade.start": (acct, rec) => {
      const cost = rec.trade.cost.amount
      const commission = rec.trade.commission.amount + rec.trade.settleIncentive.amount
      const obj = {
        event: "trade.start",
        height: rec.height,
        time: new Date(rec.time * 1000),
        id: rec.trade.id,
        market: rec.trade.market,
        duration: rec.trade.duration,
        quantity: rec.trade.quantity,
        amount: cost,
        premium: rec.trade.premium.amount,
        cost: cost,
        option: rec.trade.type,
        commission: commission,
        debit: cost + commission,
        credit: 0,
        balance: rec.balance[acct]
      }
      return obj 
    },
    "trade.end": (acct, rec) => {
      const settle = rec.settle.amount
      var commission = 0
      var credit = settle
      if (rec.settler === acct) {
        credit += rec.incentive.amount - rec.commission.amount
      }
      const obj = {
        event: "trade.end",
        height: rec.height,
        time: new Date(rec.time * 1000),
        id: rec.id,
        amount: settle,
        settle: settle,
        debit: 0,
        credit: credit,
        commission: commission,
        balance: rec.balance[acct]
      }
      return obj
    }
  }
}
