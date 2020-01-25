module.exports = {
  fullTx: {
    "deposit": rec => {
      //console.log("rec=" + JSON.stringify(rec, null, 2))
      const obj = {
        event: "deposit",
        height: rec.height,
        time: rec.time,
        account: rec.account,
        amount: rec.amount
      }
      return obj
    },
    "withdraw": rec => {
      const obj = {
        event: "withdraw",
        height: rec.height,
        time: rec.time,
        account: rec.account,
        amount: rec.amount
      }
      return obj
    },
    "trade.long": rec => {
      //console.log("rec=" + JSON.stringify(rec, null, 2))
      const obj = {
        event: "trade.long",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.trade.id,
        market: rec.market,
        duration: rec.duration,
        option: rec.trade.type ? "put" : "call",
        long: rec.trade.long,
        start: Date.parse(rec.trade.start),
        expiration: Date.parse(rec.trade.expiration),
        strike: parseFloat(rec.trade.strike.amount),
        backing: parseFloat(rec.trade.backing.amount),
        cost: parseFloat(rec.trade.cost.amount),
        quantity: parseFloat(rec.trade.quantity.amount),
        commission: parseFloat(rec.trade.commission.amount),
        settleincentive: parseFloat(rec.trade.settleIncentive.amount),
        counterparties: rec.trade.counterparties.map(cp => {
          return {
            short: cp.short,
            final: cp.final,
            backing: parseFloat(cp.backing.amount),
            premium: parseFloat(cp.premium.amount),
            quantity: parseFloat(cp.quantity.amount),
            quoted: {
              id: cp.quoted.id,
              premium: parseFloat(cp.quoted.premium.amount),
              quantity: parseFloat(cp.quoted.quantity.amount),
              spot: parseFloat(cp.quoted.spot.amount)
            }
          }
        })
      }
      return obj
    },
    "trade.short": rec => {
      const obj = {
        event: "trade.short",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.trade.id,
        market: rec.market,
        duration: rec.duration,
        option: rec.trade.type ? "put" : "call",
        long: rec.trade.long,
        start: Date.parse(rec.trade.start),
        expiration: Date.parse(rec.trade.expiration),
        strike: parseFloat(rec.trade.strike.amount),
        backing: parseFloat(rec.trade.backing.amount),
        cost: parseFloat(rec.trade.cost.amount),
        quantity: parseFloat(rec.trade.quantity.amount),
        commission: parseFloat(rec.trade.commission.amount),
        settleincentive: parseFloat(rec.trade.settleIncentive.amount),
        counterparties: rec.trade.counterparties.map(cp => {
          return {
            short: cp.short,
            final: cp.final,
            backing: parseFloat(cp.backing.amount),
            premium: parseFloat(cp.premium.amount),
            quantity: parseFloat(cp.quantity.amount),
            quoted: {
              id: cp.quoted.id,
              premium: parseFloat(cp.quoted.premium.amount),
              quantity: parseFloat(cp.quoted.quantity.amount),
              spot: parseFloat(cp.quoted.spot.amount)
            }
          }
        })
      }
      return obj
    },
    "settle.long": rec => {
      const obj = {
        event: "settle.long",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.id,
        long: rec.long,
        final: parseFloat(rec.final.amount),
        settle: parseFloat(rec.settle.amount),
        counterparties: rec.counterparties.map(cp => {
          return {
            short: cp.short,
            settle: parseFloat(cp.settle.amount),
            refund: parseFloat(cp.refund.amount)
          }
        }),
        settler: rec.settler,
        incentive: parseFloat(rec.incentive.amount),
        commission: parseFloat(rec.commission.amount)
      }
      return obj
    },
    "settle.short": rec => {
      const obj = {
        event: "settle.short",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.id,
        long: rec.long,
        final: parseFloat(rec.final.amount),
        settle: parseFloat(rec.settle.amount),
        counterparties: rec.counterparties.map(cp => {
          return {
            short: cp.short,
            settle: parseFloat(cp.settle.amount),
            refund: parseFloat(cp.refund.amount)
          }
        }),
        settler: rec.settler,
        incentive: parseFloat(rec.incentive.amount),
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
    "trade.long": (acct, rec) => {
      const cost = parseFloat(rec.trade.cost.amount)
      const commission = parseFloat(rec.trade.commission.amount) + parseFloat(rec.trade.settleIncentive.amount)
      const obj = {
        event: "trade.long",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.trade.id,
        market: rec.trade.market,
        duration: rec.trade.duration,
        amount: cost,
        premium: cost,
        option: rec.trade.type ? "put" : "call",
        commission: commission,
        debit: cost + commission,
        credit: 0,
        balance: rec.balance[acct]
      }
      return obj 
    },
    "trade.short": (acct, rec) => {
      const cost = parseFloat(rec.trade.cost.amount)
      const obj = {
        event: "trade.short",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.trade.id,
        market: rec.trade.market,
        duration: rec.trade.duration,
        amount: cost,
        premium: cost,
        option: rec.trade.type ? "put" : "call",
        commission: 0,
        debit: 0,
        credit: cost,
        balance: rec.balance[acct]
      }
      return obj 
    },
    "settle.long": (acct, rec) => {
      const settle = parseFloat(rec.settle.amount)
      var commission = 0
      var credit = settle
      if (rec.settler === acct) {
        credit += parseFloat(rec.incentive.amount) - parseFloat(rec.commission.amount)
      }
      const obj = {
        event: "settle.long",
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
    },
    "settle.short": (acct, rec) => {
      const refund = rec.counterparties.reduce((acc, cp) => {
          if (cp.short === acct) {
            acc += parseFloat(cp.refund.amount)
          }
          return acc
        }, 0)
      var commission = 0
      var credit = refund
      if (rec.settler === acct) {
        credit += parseFloat(rec.incentive.amount) - parseFloat(rec.commission.amount)
      }
      const obj = {
        event: "settle.short",
        height: rec.height,
        time: Date.parse(rec.time),
        id: rec.id,
        amount: refund,
        debit: 0,
        credit: credit,
        commission: commission,
        balance: rec.balance[acct]
      }
      return obj
    }
  }
}
