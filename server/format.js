module.exports = {
  fullTx: {
    "deposit": rec => {
      //console.log("rec=" + JSON.stringify(rec, null, 2))
      const obj = {
        event: "deposit",
        height: rec.height,
        time: rec.time,
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
        time: rec.time,
        account: rec.account,
        to: rec.to,
        amount: rec.amount,
        memo: rec.memo,
        hash: rec.hash
      }
      return obj
    },
    "trade.start": rec => {
      console.log("rec=" + JSON.stringify(rec, null, 2))
      const obj = {
        event: "trade.start",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.trade.id,
        market: rec.market,
        duration: rec.duration,
        order: rec.trade.order,
        taker: rec.trade.taker,
        start: Date.parse(rec.trade.start),
        expiration: Date.parse(rec.trade.expiration),
        strike: parseFloat(rec.trade.strike.amount),
        commission: parseFloat(rec.trade.commission.amount),
        settleincentive: parseFloat(rec.trade.settleIncentive.amount),
        legs: rec.trade.legs.map(leg => {
          return {
            leg_id: leg.leg_id,
            type: leg.type ? "call" : "put",
            long: leg.long,
            short: leg.short,
            final: leg.final,
            backing: parseFloat(leg.backing.amount),
            premium: parseFloat(leg.premium.amount),
            quantity: parseFloat(leg.quantity.amount),
            quoted: {
              id: leg.quoted.id,
              premium: parseFloat(leg.quoted.premium.amount),
              quantity: parseFloat(leg.quoted.quantity.amount),
              spot: parseFloat(leg.quoted.spot.amount)
            }
          }
        })
      }
      return obj
    },
    "trade.end": rec => {
      console.log(JSON.stringify(rec, null, 2))
      const obj = {
        event: "trade.end",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.id,
        long: rec.long,
        final: parseFloat(rec.final.amount),
        settlements: rec.settlements.map(s => {
          return {
            leg_id: s.leg_id,
            settle: {
              account: s.settle_account,
              amount: parseFloat(s.settle.amount)
            },
            refund: {
              account: s.refund_account,
              amount: parseFloat(s.refund.amount)
            }
          }
        })
      }
      return obj
    },
    "settle.finalize": rec => {
      const obj = {  
        event: "settle.finalize",
        incentive: parseFloat(rec.incentive.amount),
        commission: parseFloat(rec.commission.amount)
      }
      return obj
    },
    "quote.create": rec => {
      const obj = {
        event: "quote.create",
        backing: parseFloat(rec.backing.amount),
        commission: parseFloat(rec.commission.amount)
      }
      return obj
    },
    "quote.deposit": rec => {
      const obj = {
        event: "quote.deposit",
        backing: parseFloat(rec.backing.amount),
        commission: parseFloat(rec.commission.amount)
      }
      return obj
    },
    "quote.update": rec => {
      const obj = {
        event: "quote.update",
        commission: parseFloat(rec.commission.amount)
      }
      return obj
    },
    "quote.withdraw": rec => {
      const obj = {
        event: "quote.withdraw",
        backing: parseFloat(rec.backing.amount),
        commission: parseFloat(rec.commission.amount)
      }
      return obj
    }
  },
  ledgerTx: {
    "deposit": (acct, rec) => {
      //console.log("rec=" + JSON.stringify(rec, null, 2))
      const obj = {
        event: "deposit",
        height: rec.height,
        time: rec.time,
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
        time: rec.time,
        amount: rec.amount,
        commission: 0,
        debit: rec.amount,
        credit: 0,
        balance: rec.balance
      }
      return obj
    },
    "quote.cancel": (acct, rec) => {
      const refund = parseFloat(rec.refund.amount)
      const obj = {
        event: "quote.cancel",
        height: rec.height,
        time: Date.parse(rec.time),
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
      const backing = parseFloat(rec.backing.amount)
      const commission = parseFloat(rec.commission.amount)
      const obj = {
        event: "quote.create",
        height: rec.height,
        time: Date.parse(rec.time),
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
      const backing = parseFloat(rec.backing.amount)
      const commission = parseFloat(rec.commission.amount)
      return {
        event: "quote.deposit",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.id,
        amount: backing,
        debit: backing + commission,
        credit: 0,
        commission: commission,
        balance: rec.balance[acct]
      }
    },
    "quote.update": (acct, rec) => {
      const commission = parseFloat(rec.commission.amount)
      return {
        event: "quote.update",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.id,
        amount: 0,
        debit: commission,
        commission: commission,
        balance: rec.balance[acct]
      }
    },
    "quote.withdraw": (acct, rec) => {
      const backing = parseFloat(rec.backing.amount)
      const commission = parseFloat(rec.commission.amount)
      return {
        event: "quote.withdraw",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.id,
        amount: backing,
        debit: 0,
        credit: backing + commission,
        commission: commission,
        balance: rec.balance[acct]
      }
    },
    "trade.start": (acct, rec) => {
      const cost = parseFloat(rec.trade.cost.amount)
      const commission = parseFloat(rec.trade.commission.amount) + parseFloat(rec.trade.settleIncentive.amount)
      const obj = {
        event: "trade.start",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.trade.id,
        market: rec.trade.market,
        duration: rec.trade.duration,
        amount: cost,
        premium: cost,
        option: rec.trade.type,
        commission: commission,
        debit: cost + commission,
        credit: 0,
        balance: rec.balance[acct]
      }
      return obj 
    },
    "trade.end": (acct, rec) => {
      const settle = parseFloat(rec.settle.amount)
      var commission = 0
      var credit = settle
      if (rec.settler === acct) {
        credit += parseFloat(rec.incentive.amount) - parseFloat(rec.commission.amount)
      }
      const obj = {
        event: "trade.end",
        height: rec.height,
        time: Date.parse(rec.time),
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
