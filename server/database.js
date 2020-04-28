const mongodb = require('mongodb').MongoClient

var mongo = null
var db = null
var do_mongo_reconnect = false

// HACK: mongo driver appears to have a memory leak
const mongo_reconnect = async url => {
  return new Promise(async res => {
    if (mongo !== null) {
      await mongo.close()
    }
    mongodb.connect(url, { 
      useNewUrlParser: true,
      useUnifiedTopology: true
    }, (err, client) => {
      if (err === null) {
        console.log("Connected to MongoDB")
        mongo = client
        res()
      } else {
        console.log("Mongo connection failed")
        process.exit(-1)
      }
    })
  })
}

setInterval(() => {
  do_mongo_reconnect = true
}, 300000) // close and flag reconnect every 5 minutes
// HACK: mongo driver appears to have a memory leak
  
const DB = {
  
  inited: false,
  
  init: async (url, chainid, chainheight) => {
    if (this.inited) return
    
    console.log("Initializing database module")
    
    this.url = url
    this.chainid = chainid
    this.inited = true
    
    await mongo_reconnect(this.url)
    db = mongo.db(this.chainid)
    
    const maxHeight = await db.collection('blocks').findOne({},{sort:[['height',-1]]})
    if (maxHeight !== null) {
      if (maxHeight.height > chainheight) {
        // must have restarted chain
        console.log("DB height (" + maxHeight.height + ") > chain height (" + chainheight + ")")
        console.log("Dropping database...")
        await db.dropDatabase()
      }
    }
    
    await db.createCollection('meta', { capped: true, max: 1, size: 4096 })
    await db.createCollection('counters', { capped: true, max: 1, size: 4096 })
    await db.createCollection('blocks')
    await db.createCollection('ticks')
    await db.createCollection('account')
    await db.createCollection('quotes')
    await db.createCollection('trades')
    await db.createCollection('actions')
    
    const counters = await db.collection('counters')
    if (await counters.find().count() === 0) {
      await counters.insertOne({ 
        ticks: 0
      })
    }
    
    const hasBlockIndex = await db.collection('blocks').indexExists('history')
    if (!hasBlockIndex) {
      console.log("Creating block index")
      await db.collection('blocks').createIndex({
        height: 1
      }, {
        name: 'history'
      })
      await db.collection('blocks').createIndex({
        time: 1
      }, {
        name: 'time'
      })
    }
    
    const hasTickIndex = await db.collection('ticks').indexExists('history')
    if (!hasTickIndex) {
      console.log("Creating tick index")
      await db.collection('ticks').createIndex({
        index: 1,
        height: 1,
        market: 1
      }, {
        name: 'history'
      })
    }
  
    const hasAccountIndex = await db.collection('account').indexExists('history')
    if (!hasAccountIndex) {
      console.log("Creating account index")
      await db.collection('account').createIndex({
        account: 1,
        height: 1
      }, {
        name: 'history'
      })
    }
    
    const hasQuoteIndex = await db.collection('quotes').indexExists('history')
    if (!hasQuoteIndex) {
      console.log("Creating quotes index")
      await db.collection('quotes').createIndex({
        id: 1,
        height: 1
      }, {
        name: 'history'
      })
    }
  
    const hasTradeIndex = await db.collection('trades').indexExists('history')
    if (!hasTradeIndex) {
      console.log("Creating trades index")
      await db.collection('trades').createIndex({
        id: 1,
        height: 1
      }, {
        name: 'history'
      })
    }
    
    const hasActionsIndex = await db.collection('actions').indexExists('history')
    if (!hasActionsIndex) {
      console.log("Creating actions index")
      await db.collection('actions').createIndex({
        id: 1,
        account: 1,
        start: 1,
        end: 1
      }, {
        name: 'history'
      })
    }
    
    console.log("Database initialization complete")
  },
  
  height: async () => {
    const curs = await db.collection('meta').find()
    if (await curs.hasNext()) {
      const doc = await curs.next()
      return doc.syncHeight
    } 
    return 0
  },
  
  insertBlock: async (height, time) => {
    // HACK
    if (do_mongo_reconnect) {
      do_mongo_reconnect = false
      await mongo_reconnect(this.url)
      db = mongo.db(this.chainid)
    }
    // HACK
    
    await db.collection('blocks').replaceOne({
      height: height
    }, {
      height: height,
      time: time
    }, {
      upsert: true
    })
    
    await db.collection('meta').insertOne({
      syncHeight: height,
      syncTime: time
    })
  },
  
  insertMarketTick: async (height, time, market, consensus) => {
    const counters = await db.collection('counters').find().next()
    
    const index = counters.ticks++
    await db.collection('ticks').replaceOne({
      index: index
    }, {
      index: index,
      height: height,
      market: market,
      consensus: consensus
    }, {
      upsert: true
    })
    
    await db.collection('counters').insertOne({
      ticks: counters.ticks,
      quotes: counters.quotes,
      trades: counters.trades
    })
  },
  
  insertAccountEvent: async (height, acct, type, data) => {
    await db.collection('account').insertOne({
      height: height,
      account: acct,
      type: type,
      data: data
    })
  },
  
  insertQuoteEvent: async (height, id, type, data) => {
    await db.collection('quotes').insertOne({
      height: height,
      id: id,
      type: type,
      data: data
    })
  },
  
  insertTradeEvent: async (height, id, type, data) => {
    await db.collection('trades').insertOne({
      height: height,
      id: id,
      type: type,
      data: data
    })
  },
  
  insertAction: async (id, cp, account, start, end, debit, credit) => {
    const obj = {
      id: id, 
      account: account,
      position: cp,
      start: start,
      end: end,
      debit: debit,
      credit: credit
    }
    // handle duplicate short trade entries
    const curs = await db.collection('actions').find({
      id: id,
      account: account
    })
    if (await curs.hasNext()) {
      const rec = curs.next()
      obj.debit += debit
      obj.credit += credit
    }
    await db.collection('actions').updateOne({
      id: id,
      account: account
    }, {
      $set: obj
    }, {
      upsert: true
    })
  },
  
  updateAction: async (id, account, debit, credit) => {
    const obj = {}
    if (debit !== 0) obj.debit = debit
    if (credit !== 0) obj.credit = credit
    await db.collection('actions').updateOne({
      id: id,
      account: account
    }, {
      $set: obj
    })
  },
  
  queryAccountPerformance: async (account, start, end) => {
    const curs = await db.collection('actions').aggregate([
      {
        $match: {
          $and: [
            { account: account },
            { start: { "$gte": start }},
            { end: { "$lte": end }}
          ]
        }
      },
      {
        $group: {
          _id: null,
          debit: { $sum: "$debit" },
          credit: { $sum: "$credit" },
          count: { $sum: 1 }
        }
      }
    ])
    if (await curs.hasNext()) {
      const rec = await curs.next()
      if (rec.debit > 0) {
        return {
          debit: rec.debit,
          credit: rec.credit,
          count: rec.count
        }
      }
    }
    return {
      debit: 0,
      credit: 0,
      count: 0,
    }
  },
  
  queryMarketHistory: async (market, startblock, endblock, target) => {
    //console.log("market=" + market)
    //console.log("startblock=" + startblock)
    //console.log("endblock=" + endblock)
    //console.log("target=" + target)
    const curs = await db.collection('ticks').aggregate([
      {
        $match: {
          $and: [
            { market: market },
            { height: { $gte: startblock }},
            { height: { $lte: endblock }}
          ]
        }
      },
      {
        $lookup: {
          from: 'blocks',
          localField: 'height',
          foreignField: 'height',
          as: 'time'
        }
      }
    ])
    const hist = await curs.toArray()
    if (target !== undefined) {
      const total = hist.length
      //console.log("total=" + total)
      //console.log("target=" + target)
      const skip = Math.floor(total / target) 
      var res = hist.reduce((acc, el, index) => {
        if (skip === 0 || (index % skip) === 0) {
          if (el.time[0] !== undefined) {
            acc.push({
              height: el.height,
              time: el.time[0].time,
              consensus: el.consensus
            })
          }
        }
        return acc
      }, [])
    } else {
      res = hist.map(el => {
        return {
          height: el.height,
          time: el.time[0].time,
          consensus: el.consensus
        }
      })
    }
    //console.log("reduced=" + res.length)
    return res
  },

  queryAccountHistory: async (acct, startblock, endblock, target) => {
    //console.log("account=" + acct)
    //console.log("startblock=" + startblock)
    //console.log("endblock=" + endblock)
    const curs = await db.collection('account').aggregate([
      {
        $match: {
          $and: [
            { account: acct },
            { height: { $gte: startblock }},
            { height: { $lte: endblock }}
          ]
        }
      },
      {
        $lookup: {
          from: 'blocks',
          localField: 'height',
          foreignField: 'height',
          as: 'time'
        }
      }
    ])
    return await curs.toArray()
  },
  
  queryAccountTotalEvents: async acct => {
    const count = await db.collection('account').find({
      account: acct
    }).count()
    return count
  },
  
  queryAccountLedger: async (acct, page, perPage) => {
    //console.log("acct=" + acct)
    //console.log("page=" + page)
    //console.log("perPage=" + perPage)
    const pageResult = await db.collection('account').find({
      account: acct
    }).skip((page-1)*perPage).limit(perPage)
    return await pageResult.toArray()
  },
  
  queryHistQuote: async (id, startblock, endblock) => {
    var curs = await db.collection('quotes').aggregate([
      {
        $match: { id: id }
      },
      {
        $match: {
          $or: [
            { type: 'event.create' },
            { type: 'event.cancel' },
            { type: 'event.final' }
          ]
        }
      }
    ])
    const lifecycle = await curs.toArray()
    //console.log(JSON.stringify(lifecycle, null, 2))
    const obj = {
      range: {
        startHeight: startblock,
        endHeight: endblock
      }
    }
    for (var i=0; i<lifecycle.length; i++) {
      const el = lifecycle[i]
      if (el.type === 'event.create') {
        obj.id = el.id
        obj.lifecycle = {
          create: el.height
        },
        obj.account = el.account
        obj.market = el.data.market
        obj.duration = el.data.duration
      }
      if (el.type === 'event.cancel' || el.type === 'event.final') {
        obj.lifecycle.destroy = el.height
      }
    }
    if (obj.lifecycle.create !== undefined && startblock < obj.lifecycle.create) {
      startblock = obj.lifecycle.create
    }
    if (obj.lifecycle.destroy !== undefined && endblock > obj.lifecycle.destroy) {
      endblock = obj.lifecycle.destroy
    }
    if (obj.range.startHeight < obj.lifecycle.create) {
      obj.range.startHeight = obj.lifecycle.create
      if (obj.range.endHeight < obj.range.startHeight) {
        obj.range.endHeight = obj.lifecycle.destroy
      }
    }
    if (obj.range.endHeight > obj.lifecycle.destroy) {
      obj.range.endHeight = obj.lifecycle.destroy
      if (obj.range.startHeight > obj.range.endHeight) {
        obj.range.startHeight = obj.lifecycle.create
      }
    }
    // Query for last update
    curs = await db.collection('quotes').aggregate([
      {
        $match: {
          $and: [
            { id: id },
            { type: { $ne: "event.final" }},
            { height: { $lte: obj.range.startHeight }},
          ]
        }
      },
      {
        $sort: { height: -1 }
      },
      { $limit: 1 }
    ])
    const lastUpdate = await curs.toArray()
    obj.updates = []
    if (lastUpdate.length > 0) {
      obj.updates.push({
        height: obj.range.startHeight,
        spot: parseFloat(lastUpdate[0].data.spot.amount),
        premium: parseFloat(lastUpdate[0].data.premium.amount)
      })
    }
    // Query for last tick
    curs = await db.collection('ticks').aggregate([
      {
        $match: {
          $and: [
            { market: obj.market },
            { height: { $lte: obj.range.startHeight }},
          ]
        }
      },
      {
        $sort: { height: -1 }
      },
      { $limit: 1 }
    ])
    const lastTick = await curs.toArray()
    obj.ticks = [
      {
        height: obj.range.startHeight,
        consensus: lastTick[0].consensus
      }
    ]
    curs = await db.collection('quotes').aggregate([
      {
        $match: {
          $and: [
            { id: id },
            { type: 'event.update' },
            { height: { $gte: startblock }},
            { height: { $lte: endblock }}
          ]
        }
      }
    ])
    const updates = await curs.toArray()
    obj.updates = updates.reduce((acc, el) => {
      acc.push({
        height: el.height,
        spot: parseFloat(el.data.spot.amount),
        premium: parseFloat(el.data.premium.amount)
      })
      return acc
    }, obj.updates)
    obj.updates.push({
      height: obj.range.endHeight,
      spot: obj.updates[obj.updates.length-1].spot,
      premium: obj.updates[obj.updates.length-1].premium
    })
    curs = await db.collection('ticks').aggregate([
      {
        $match: {
          $and: [
            { market: obj.market },
            { height: { $gte: startblock }},
            { height: { $lte: obj.range.endHeight }}
          ]
        }
      },
    ])
    const consensus = await curs.toArray()
    obj.ticks = consensus.reduce((acc, el) => {
      acc.push({
        height: el.height,
        consensus: el.consensus
      })
      return acc
    }, obj.ticks)
    obj.ticks.push({
      height: obj.range.endHeight,
      consensus: obj.ticks[obj.ticks.length-1].consensus
    })
    return obj
  },
  
  queryHistTrade: async id => {
    var curs = await db.collection('trades').find({id:id})
    const events = await curs.toArray()
    const start = events[0]
    const end = events[1]
    const endblock = end !== undefined ? end.height : -1
    const data = {
      startBlock: start.height,
      start: Date.parse(start.data.time),
      endBlock: endblock,
      end: end !== undefined ? Date.parse(end.data.time) : -1,
      state: end !== undefined ? "settled" : "active",
      trade: {
        market: start.data.trade.market,
        duration: start.data.trade.duration,
        type: start.data.trade.type,
        long: start.data.trade.long,
        counterparties: start.data.trade.counterparties.map(cp => {
          return {
            backing: parseFloat(cp.backing.amount),
            premium: parseFloat(cp.premium.amount),
            quantity: parseFloat(cp.quantity.amount),
            final: cp.final,
            short: cp.short,
            quoted: {
              id: cp.quoted.id,
              premium: parseFloat(cp.quoted.premium.amount),
              quantity: parseFloat(cp.quoted.quantity.amount),
              spot: parseFloat(cp.quoted.spot.amount)
            },
            balance: start.data.balance[cp.short]
          }
        }),
        backing: parseFloat(start.data.trade.backing.amount),
        cost: parseFloat(start.data.trade.cost.amount),
        quantity: parseFloat(start.data.trade.quantity.amount),
        start: start.data.trade.start,
        expiration: start.data.trade.expiration,
        strike: parseFloat(start.data.trade.strike.amount),
        commission: parseFloat(start.data.trade.commission.amount),
        settleIncentive: parseFloat(start.data.trade.settleIncentive.amount),
        balance: start.data.balance[start.data.trade.long]
      }
    }
    if (end !== undefined) {
      data.trade.final = parseFloat(end.data.final.amount)
      data.trade.settle = parseFloat(end.data.settle.amount)
      for (var i=0; i<data.trade.counterparties.length; i++) {
        data.trade.counterparties[i].settle = parseFloat(end.data.counterparties[i].settle.amount)
        data.trade.counterparties[i].refund = parseFloat(end.data.counterparties[i].refund.amount)
      }
    }
    // Query for last tick
    curs = await db.collection('ticks').aggregate([
      {
        $match: {
          $and: [
            { market: data.trade.market },
            { height: { $lte: data.startBlock }},
          ]
        }
      },
      {
        $sort: { height: -1 }
      },
      { $limit: 1 }
    ])
    const lastTick = await curs.toArray()
    data.ticks = [
      {
        height: data.startBlock,
        consensus: lastTick[0].consensus,
        time: data.start,
      }
    ]
    var tickEnd = data.endBlock
    if (tickEnd === -1) { 
      curs = await db.collection('meta').find()
      if (await curs.hasNext()) {
        const doc = await curs.next()
        tickEnd = doc.syncHeight
      } 
    }
    curs = await db.collection('ticks').aggregate([
      {
        $match: {
          $and: [
            { market: data.trade.market },
            { height: { $gte: data.startBlock }},
            { height: { $lte: tickEnd }}
          ]
        }
      },
      {
        $lookup: {
          from: 'blocks',
          localField: 'height',
          foreignField: 'height',
          as: 'time'
        }
      }
    ])
    const ticks = await curs.toArray()
    ticks.reduce((acc, el) => {
      acc.push({
        height: el.height,
        consensus: el.consensus,
        time: el.time[0].time
      })
      return acc
    }, data.ticks)
    data.ticks.push({
      height: tickEnd,
      consensus: data.ticks[data.ticks.length-1].consensus,
      time: data.end === -1 ? Date.now() : data.end
    })
    return data
  }
  
}

module.exports = DB