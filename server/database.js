const mongodb = require('mongodb').MongoClient

var mongo = null
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
  
  init: async (url, chainid) => {
    if (this.inited) return
    
    console.log("Initializing database module")
    
    this.url = url
    this.chainid = chainid
    this.inited = true
    
    await mongo_reconnect(this.url)
    const db = mongo.db(this.chainid)
    
    await db.createCollection('meta', { capped: true, max: 1, size: 4096 })
    await db.createCollection('counters', { capped: true, max: 1, size: 4096 })
    await db.createCollection('blocks')
    await db.createCollection('ticks')
    await db.createCollection('quotes')
    await db.createCollection('trades')
    await db.createCollection('books')
    
    const counters = await db.collection('counters')
    if (await counters.find().count() === 0) {
      await counters.insertOne({ 
        ticks: 1,
        quotes: 1,
        trades: 1
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
  
    const hasQuoteIndex = await db.collection('quotes').indexExists('history')
    if (!hasQuoteIndex) {
      console.log("Creating quote index")
      await db.collection('quotes').createIndex({
        index: 1,
        height: 1,
        id: 1
      }, {
        name: 'history'
      })
    }
    
    const hasTradeIndex = await db.collection('trades').indexExists('history')
    if (!hasTradeIndex) {
      console.log("Creating trade index")
      await db.collection('trades').createIndex({
        index: 1,
        height: 1,
        id: 1
      }, {
        name: 'history'
      })
    }
    
    const hasBookIndex = await db.collection('books').indexExists('history')
    if (!hasBookIndex) {
      console.log("Creating book index")
      await db.collection('books').createIndex({
        height: 1
      }, {
        name: 'history'
      })
    }
  },
  
  height: async () => {
    const db = mongo.db(this.chainid)
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
    }
    // HACK
    
    const db = mongo.db(this.chainid)
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
    const db = mongo.db(this.chainid)
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
  
  insertQuoteEvent: async (height, id, attrs) => {
    const db = mongo.db(this.chainid)
    const counters = await db.collection('counters').find().next()
    
    const insertData = Object.assign({
      index: counters.quotes++,
      height: height,
      id: id
    }, attrs)
    await db.collection('quotes').replaceOne({
      index: insertData.index
    }, insertData, {
      upsert: true
    })
    
    await db.collection('counters').insertOne({
      ticks: counters.ticks,
      quotes: counters.quotes,
      trades: counters.trades
    })
  },
  
  newQuote: async (height, market, dur, id) => {
    const db = mongo.db(this.chainid)
    var books = await db.collection('books').find({
      market: market, 
      duration: dur 
    }).sort({height:-1}).next()
    if (books === null) {
      books = {
        height: height,
        market: market,
        duration: dur,
        quotes: [ id ]
      }
    } else {
      const quotes = books.quotes
      quotes.push(id)
      books = {
        height: height,
        market: market,
        duration: dur,
        quotes: quotes
      }
    }
    await db.collection('books').replaceOne({
      height: height,
      market: market,
      duration: dur
    }, books, {
      upsert: true
    })
  },
  
  removeQuote: async (height, market, dur, id) => {
    const db = mongo.db(this.chainid)
    var books = await db.collection('books').find({
      market: market, 
      duration: dur 
    }).sort({height:-1}).next()
    books = {
      height: height,
      market: market,
      duration: dur,
      quotes: books.quotes.filter(el => {
        if (el !== id) return true
        return false
      })
    }
    await db.collection('books').replaceOne({
      height: height,
      market: market,
      duration: dur
    }, books, {
      upsert: true
    })
  },
  
  insertTradeEvent: async (height, id, data) => {
    const db = mongo.db(this.chainid)
    const counters = await db.collection('counters').find().next()
    
    const insertData = Object.assign({
      index: counters.trades++,
      height: height,
      id: id
    }, data)
    await db.collection('trades').replaceOne({
      index: insertData.index
    }, insertData, {
      upsert: true
    })
    
    await db.collection('counters').insertOne({
      ticks: counters.ticks,
      quotes: counters.quotes,
      trades: counters.trades
    })
  },
  
  queryMarketHistory: async (market, startblock, endblock, target) => {
    const db = mongo.db(this.chainid)
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
    const total = hist.length
    //console.log("total=" + total)
    //console.log("target=" + target)
    const skip = Math.floor(total / target) 
    const res = hist.reduce((acc, el, index) => {
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
    //console.log("reduced=" + res.length)
    return res
  }
  
}

module.exports = DB