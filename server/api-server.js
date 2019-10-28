const ws = require('ws')
const protocol = require('../lib/protocol.js')
const axios = require('axios')
const objecthash = require('object-hash')
const { marshalTx, unmarshalTx } = require('./amino.js')
const config = require('./config.js')

const USE_MONGO = false

process.on('unhandledRejection', error => {
  if (error !== undefined) {
    console.log('unhandled promise rejection: ', error.message);
    console.log(error.stack)
  } else {
    console.log("promise rejection")
  }
});

// Subscriptions (websocket)
const tendermint = config.tendermint

// Transactions
const NEWBLOCK = "tm.event='NewBlock'"
const TXTIMEOUT = config.timeout
const pending = {}

// Caching
var cache = {}

const nextSequenceNumber = (acct, res) => {
  if (cache.accounts === undefined) {
    cache.accounts = {}
  }
  if (cache.accounts[acct] === undefined) {
    cache.accounts[acct] = {}
  }
  if (cache.accounts[acct].nextSequenceNumber === undefined) {
    cache.accounts[acct].pendingSequenceNumber = parseInt(res.sequence, 10)
    cache.accounts[acct].queue = {}
  } else {
    res.sequence = cache.accounts[acct].nextSequenceNumber.toString()
  }
  cache.accounts[acct].nextSequenceNumber = parseInt(res.sequence, 10) + 1
  console.log("Generating TX: " + acct + ": sequence=" + res.sequence)
}

setInterval(async () => {
  if (cache === undefined || cache.accounts === undefined) {
    return
  }
  const accts = Object.keys(cache.accounts)
  accts.map(async acct => {
    const pool = cache.accounts[acct]
    if (pool.queue === undefined || pool.pendingSequenceNumber === undefined) {
      return
    }
    if (pool.queue[pool.pendingSequenceNumber] !== undefined) {
      console.log("Submitting TX: " + acct + ": sequence=" + pool.pendingSequenceNumber)
      await pool.queue[pool.pendingSequenceNumber++].submit()
    }
  })
}, 100)

// One tendermint subscription per socket
const tmsockets = {}
// Added at subsciption time: mapping event -> []id
const subscriptions = {}
// Maintained at connection: id -> client
const clients = {}

const subscribe = (id, event) => {
  
  const connect = () => {
    
    var tmclient = tmsockets[event]
    if (tmclient === undefined) {
      //console.log("Tendermint connecting")
      tmclient = new ws("ws://" + tendermint + "/websocket")
      tmsockets[event] = tmclient
    }
  
    tmclient.on('open', () => {
      //console.log("Tendermint connected")
      
      console.log("Tendermint subscribe: " + event)
      const req = {
        "jsonrpc": "2.0",
        "method": "subscribe",
        "id": "0",
        "params": {
          "query": event
        }
      }
      tmclient.send(JSON.stringify(req))
    })

    tmclient.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.result === undefined) {
        console.log("Tendermint message error: " + event + ": " + JSON.stringify(obj, null, 2))
        tmclient.close()
        return
      }
      //console.log("Tendermint message: " + event)
      sendEvent(obj.result.query, {
        data: obj.result.data
      })
      if (USE_MONGO && event === NEWBLOCK && obj.result.data !== undefined) {
        handleNewBlock(obj)
      } else if (event === NEWBLOCK && obj.result.data !== undefined) {
        const height = parseInt(obj.result.data.value.block.header.height, 10)
        //console.log("Block: " + height)
      }
    })

    tmclient.on('close', () => {
      console.log("Tendermint disconnected: " + event)
      if (subscriptions[event].length > 0) {
        console.log("Attempting to reconnect")
        setTimeout(connect, 1000)
      }
      delete tmsockets[event]
    })
  
    tmclient.on('error', err => {
      this.err = err
      console.log("Tendermint error: " + err.message)
    })
  }
  
  if (tmsockets[event] === undefined) {
    connect()
  }
  
  if (subscriptions[event] === undefined) {
    subscriptions[event] = [ id ]
  } else {
    subscriptions[event].push(id)
  }
}

subscribe(0, NEWBLOCK)

const unsubscribe = (id, event) => {
  if (subscriptions[event] === undefined) return
  subscriptions[event] = subscriptions[event].reduce((acc, thisid) => {
    if (thisid !== id) {
      acc.push(id)
    }
    return acc
  }, [])
  if (subscriptions[event].length === 0 && tmsockets[event] !== undefined) {
    tmsockets[event].close()
    delete tmsockets[event]
  }
}

const sendEvent = (event, payload) => {
  if (event === NEWBLOCK) {
    console.log("Block")
    
    // Reset cache
    cache = {}
    
    // Check pending Tx hashes
    const hashes = Object.keys(pending)
    if (hashes.length > 25) {
      console.log("Warning: " + hashes.length + " pending Txs")
    }
    hashes.map(async hash => {
      const url = "http://" + tendermint + "/tx?hash=0x" + hash
      const res = await axios.get(url)
      if (res.data.error !== undefined) {
        console.log("TX error: " + hash + " " + JSON.stringify(res.data.error))
        pending[hash].failure(res.data.error)
        pending[hash].timedout = true
      } else if (res.data.result !== undefined) {
        console.log("TX success: " + hash)
        pending[hash].success(res.data.result)
        pending[hash].timedout = true
      }
      if (pending[hash].timedout) {
        //console.log("Deleting pending TX: " + hash)
        delete pending[hash]
      }
    })
  }
  if (subscriptions[event] === undefined) return
  const msg = apiProtocolQueue.createEvent(event, payload)
  subscriptions[event].map(id => {
    const client = clients[id]
    if (client !== undefined) {
      client.send(msg)
    //} else if (id !== 0) {
      //unsubscribe(id, event)
    }
  })
}

// Client (REST calls to Tendermint and Cosmos through ABCI)

const queryTendermint = async url => {
  const query = "http://" + tendermint + url
  const res = await axios.get(query)
  return res.data.result
}

const queryCosmos = async path => {
  const query = "http://" + tendermint + '/abci_query?path="/custom' + path + '"'
  const res = await axios.get(query)
  if (res.data.result.response.code !== undefined) {
    console.log("query=" + query)
    const obj = JSON.parse(res.data.result.response.log)
    throw new Error(obj.message)
  }
  const data = Buffer.from(res.data.result.response.value, 'base64')
  return JSON.parse(data.toString())
}

// Server

var connectionId = 1

const server = new ws.Server({
  port: config.port,
})

server.on('connection', async client => {
  
  const env = {
    id: connectionId++
  }
  
  console.log("  Connect " + env.id)
  clients[env.id] = client
  
  client.on('message', async msg => {
    const response = await apiProtocolQueue.process(env, msg)
    if (response !== undefined) {
      client.send(response)
    }
  })
  
  client.on('close', () => {
    console.log("  Disconnect " + env.id)
    const id = env.id
    delete clients[id]
    //const acct = env.acct
  })
  
})

const apiProtocolQueue = new protocol(10000, async (env, name, payload) => {
  return await handleMessage(env, name, payload)
})

const handleMessage = async (env, name, payload) => {
  //console.log("  COMMAND " + env.id + " " + name + " " + JSON.stringify(payload))
  
  const hash = objecthash({
    name: name,
    payload: payload
  }) 
  
  if (cache[hash] !== undefined) {
    //console.log("Responding from cache: " + hash)
    return cache[hash]
  }
  
  var returnObj
  var res
  try {
    switch (name) {
      case 'connect':
        env.acct = payload.acct
        return {
          status: true
        }
      case 'subscribe':
        subscribe(env.id, payload.key)
        return {
          status: true
        }
      case 'unsubscribe':
        unsubscribe(env.id, payload.key)
        return {
          status: true
        }
      case 'blockinfo':
        res = await queryTendermint('/status')
        returnObj = {
          status: true,
          block: parseInt(res.sync_info.latest_block_height, 10),
          timestamp: Math.floor(new Date(res.sync_info.latest_block_time).getTime() / 1000)
        }
        break
      case 'getblock':
        res = await queryTendermint('/block?height=' + payload.blockNumber)
        returnObj = {
          status: true,
          block: res.block_meta
        }
        break
      case 'getacctinfo':
        res = await queryCosmos('/microtick/account/' + payload.acct)
        returnObj = {
          status: true,
          info: res
        }
        break
      case 'getmarketinfo':
        res = await queryCosmos('/microtick/market/' + payload.market)
        returnObj = {
          status: true,
          info: res
        }
        break
      case 'getorderbookinfo':
        res = await queryCosmos('/microtick/orderbook/' + payload.market + "/" + 
          payload.duration)
        returnObj = {
          status: true,
          info: res
        }
        break
      case 'getmarketspot':
        res = await queryCosmos('/microtick/consensus/' + payload.market)
        returnObj = {
          status: true,
          info: res
        }
        break
      case 'getquote':
        res = await queryCosmos('/microtick/quote/' + payload.id)
        returnObj = {
          status: true,
          info: res
        }
        break
      case 'gettrade':
        res = await queryCosmos('/microtick/trade/' + payload.id)
        returnObj = {
          status: true,
          info: res
        }
        break
      case 'history':
        res = await doHistory(payload.query, payload.from, payload.to, payload.tags)
        returnObj = {
          status: true,
          history: res
        }
        break
      case 'totalevents':
        res = await queryTendermint("/tx_search?query=\"acct." + env.acct + 
          " CONTAINS '.'\"&page=1&per_page=1")
        returnObj = {
          status: true,
          total: res.total_count
        }
        break
      case 'pagehistory':
        res = await pageHistory(env.acct, payload.page, payload.inc)
        returnObj = {
          status: true,
          history: res
        }
        break
      case 'markethistory':
        if (!USE_MONGO) throw new Error('No market tick DB')
        res = await queryMarketHistory(payload.market, payload.startblock,
          payload.endblock, payload.target)
        return {
          status: true,
          history: res
        }
      case 'createmarket':
        res = await queryCosmos("/microtick/generate/createmarket/" + 
          env.acct + "/" + payload.market)
        nextSequenceNumber(env.acct, res)
        return {
          status: true,
          msg: res
        }
      case 'createquote':
        res = await queryCosmos("/microtick/generate/createquote/" +
          env.acct + "/" + 
          payload.market + "/" +
          payload.duration + "/" +
          payload.backing + "/" + 
          payload.spot + "/" +
          payload.premium)
        nextSequenceNumber(env.acct, res)
        return {
          status: true,
          msg: res
        }
      case 'cancelquote':
        res = await queryCosmos("/microtick/generate/cancelquote/" +
          env.acct + "/" + 
          payload.id)
        nextSequenceNumber(env.acct, res)
        return {
          status: true,
          msg: res
        }
      case 'depositquote':
        res = await queryCosmos("/microtick/generate/depositquote/" +
          env.acct + "/" +
          payload.id + "/" + 
          payload.deposit)
        nextSequenceNumber(env.acct, res)
        return {
          status: true,
          msg: res
        }
      case 'updatequote':
        res = await queryCosmos("/microtick/generate/updatequote/" + 
          env.acct + "/" +
          payload.id + "/" + 
          payload.newspot + "/" +
          payload.newpremium)
        nextSequenceNumber(env.acct, res)
        return {
          status: true,
          msg: res
        }
      case 'markettrade':
        res = await queryCosmos("/microtick/generate/markettrade/" + 
          env.acct + "/" +
          payload.market + "/" + 
          payload.duration + "/" +
          payload.tradetype + "/" + 
          payload.quantity)
        nextSequenceNumber(env.acct, res)
        return {
          status: true,
          msg: res
        }
      case 'limittrade':
        res = await queryCosmos("/microtick/generate/limittrade/" +
          env.acct +"/" +
          payload.market + "/" +
          payload.duration + "/" +
          payload.tradetype + "/" + 
          payload.limit + "/" +
          payload.maxcost)
        nextSequenceNumber(env.acct, res)
        return {
          status: true,
          msg: res
        }
      case 'settletrade':
        res = await queryCosmos("/microtick/generate/settletrade/" +
          env.acct + "/" +
          payload.id)
        nextSequenceNumber(env.acct, res)
        return {
          status: true,
          msg: res
        }
      case 'posttx':
        res = await new Promise(async outerResolve => {
          const pendingTx = {
            submitted: false,
            submit: async () => {
              if (pendingTx.submitted) return
              pendingTx.submitted = true
              
              const bytes = marshalTx(payload.tx)
              //console.log(JSON.stringify(bytes))
              const hex = Buffer.from(bytes).toString('hex')
              //console.log("bytes=" + hex)
              res = await queryTendermint('/broadcast_tx_sync?tx=0x' + hex)
              console.log("  Hash=" + res.hash)
              const txres = await new Promise((resolve, reject) => {
                const obj = {
                  success: txres => {
                    resolve(txres)
                  },
                  failure: err => {
                    reject(err)
                  },
                  timedout: false
                }
                setTimeout(() => {obj.timedout = true}, TXTIMEOUT)
                pending[res.hash] = obj
              })
              if (txres.tx_result.data !== undefined) {
                txres.tx_result.data = JSON.parse(Buffer.from(txres.tx_result.data, 'base64').toString())
              }
              if (txres.tx_result.tags !== undefined) {
                txres.tx_result.tags = txres.tx_result.tags.map(t => {
                  return {
                    key: Buffer.from(t.key, 'base64').toString(),
                    value: Buffer.from(t.value, 'base64').toString()
                  }
                })
              }
        
              outerResolve(txres)
            }
          }
          if (cache.accounts === undefined) {
            cache.accounts = {}
          }
          if (cache.accounts[env.acct] === undefined) {
            cache.accounts[env.acct] = {
              queue: {}
            }
          }
          cache.accounts[env.acct].queue[parseInt(payload.sequence, 10)] = pendingTx
        })
        return {
          status: true,
          info: res
        }
    }
    
    // Save in cache
    cache[hash] = returnObj
    
    return returnObj
    
  } catch (err) {
    console.log(err.stack)
    return {
      status: false,
      error: err.message
    }
  }
}

const formatTx = (tx, whichTags) => {
  const height = parseInt(tx.height, 10)
  
  var data = {}
  data.tags = {}
  if (tx.tx_result.data !== undefined) {
    const str = Buffer.from(tx.tx_result.data, "base64").toString()
    const json = JSON.parse(str)
    data = Object.assign(data, json)
  }
  if (whichTags != null && tx.tx_result.tags !== undefined) {
    tx.tx_result.tags.map(tag => {
      whichTags.map(which => {
        const key = Buffer.from(tag.key, "base64").toString()
        if (which === key && tag.value !== undefined) {
          data.tags[key] = Buffer.from(tag.value, "base64").toString()
        }
      })
    })
  }
  data.hash = tx.hash
  data.txindex = tx.index
  data.block = height
  data.time = new Date(data.time).getTime()
  return data
}

const doHistory = async (query, fromBlock, toBlock, whichTags) => {
  var page = 0
  var count = 0
  const perPage = 100
  const history = []
  var total_count = 0
  
  const baseurl = "/tx_search?query=\"" + query + " AND tx.height>" + fromBlock + " AND tx.height<" + toBlock + "\""
  try {
    do {
      page++
      const url = baseurl + "&page=" + page + "&per_page=" + perPage
  
      //const start = Date.now()
      //console.log("query=" + url)
      const res = await queryTendermint(url)
      //const end = Date.now()
      //console.log("done: " + (end - start) + "ms")
      //console.log("res=" + JSON.stringify(res, null, 2))
      //console.log("date=" + res.headers.date)
      
      total_count = res.total_count
      //console.log("count=" + count + " total_count=" + total_count)
      
      const txs = res.txs
      //console.log("txs=" + JSON.stringify(txs, null, 2))
      //console.log("txs.length=" + txs.length)
      
      for (var i=0; i<txs.length; i++) {
        const data = formatTx(txs[i], whichTags)
        data.index = count++
        history.push(data)
      } 
      
    } while (count < total_count)
    
    //console.log("cache range " + query + "=[" + cache.startBlock + "," + cache.endBlock + "]")
    
    return history
    
  } catch (err) {
    console.log(err.stack)
    console.log("Error in fetching history: " + err.message)
    return null
  }
}

const pageHistory = async (acct, page, inc) => {
  //console.log("Fetching page " + page + "(" + inc + ")" + " for account " + acct)
  const url = "/tx_search?query=\"acct." + acct + " CONTAINS '.'\"&page=" + page + 
    "&per_page=" + inc
    try {
      const res = await queryTendermint(url)
      const txs = res.txs
      //console.log("txs=" + JSON.stringify(txs, null, 2))
      //console.log("txs.length=" + txs.length)
      
      const ret = []
      const which = [
        "acct." + acct
      ]
      
      for (var i=0; i<txs.length; i++) {
        const data = formatTx(txs[i], which)
        ret.push(data)
      } 
      return ret
    } catch (err) {
      console.log("Error fetching total account events: " + err.message)
    }
    return null
}
  
// MongoDB - slurp up market ticks into database

var handleNewBlock
var queryMarketHistory

if (USE_MONGO) {
  
  const mongodb = require('mongodb').MongoClient
  const crypto = require('crypto')

  var mongo = null
  var syncing = false
  var chainid
  
  var do_reconnect = false
  
  const reconnect = async () => {
    if (mongo !== null) {
      await mongo.close()
    }
    mongodb.connect(config.mongo, { 
      useNewUrlParser: true,
      useUnifiedTopology: true
    }, (err, client) => {
      if (err === null) {
        console.log("Connected to MongoDB")
        mongo = client
      }
    })
  }
  
  reconnect()
  
  setInterval(() => {
    do_reconnect = true
  }, 300000) // close and flag reconnect every 5 minutes
  
  handleNewBlock = async obj => {
    chainid = obj.result.data.value.block.header.chain_id
    const height = parseInt(obj.result.data.value.block.header.height, 10)
    //console.log(JSON.stringify(obj, null, 2))
    
    // Handle reconnect inline to prevent stepping on DB operations
    if (do_reconnect) {
      do_reconnect = false
      await reconnect()
    }
    
    if (mongo !== null && mongo.isConnected()) {
      const db = mongo.db(chainid)
      
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
      
      const synced = await isSynced(db, height)
      if (synced) {
        const block = await queryTendermint('/block?height=' + height)
        insertBlock(db, block.block)
      } else if (!syncing) {
        sync(db)
      }
    }
  }
  
  const isSynced = async (db, height) => {
    const curs = await db.collection('meta').find()
    if (await curs.hasNext()) {
      const doc = await curs.next()
      if (height === doc.syncHeight + 1) {
        return true
      }
    } 
    return false
  }
  
  const sync = async db => {
    syncing = true
    console.log("syncing...")
    
    var block
    do {
      try {
        const doc = await db.collection('meta').find().next()
      
        if (doc !== null) {
          var curBlock = doc.syncHeight + 1
        } else {
          curBlock = 1
        }
        block = await queryTendermint('/block?height=' + curBlock)
        if (block !== undefined) {
          await insertBlock(db, block.block)
        }
      } catch (err) {
        // try again... (could have reset the db connection while syncing)
        console.log("error: " + err)
        syncing = false
        return
      }
    } while (block !== undefined)
    
    console.log("done syncing...")
    syncing = false
  }
  
  const insertBlock = async (db, block) => {
    const height = parseInt(block.header.height, 10)
    const time = Date.parse(block.header.time)
    
    db.collection('blocks').replaceOne({
      height: height
    }, {
      height: height,
      time: time
    }, {
      upsert: true
    })
    
    const num_txs = parseInt(block.header.num_txs, 10)
    //console.log("Block " + height + ": txs=" + num_txs)
    if (num_txs > 0) {
      const results = await queryTendermint('/block_results?height=' + height)
      const txs = block.data.txs
      for (var i=0; i<txs.length; i++) {
        const txb64 = txs[i]
        var bytes = Buffer.from(txb64, 'base64')
        var hash = crypto.createHash('sha256').update(bytes).digest('hex')
        const stdtx = unmarshalTx(bytes)
        //console.log(JSON.stringify(stdtx, null, 2))
        const res64 = results.results.DeliverTx[i]
        //console.log(JSON.stringify(res64, null, 2))
        if (res64.code === undefined) {
          if (res64.data !== undefined) {
            var result = JSON.parse(Buffer.from(res64.data, 'base64').toString())
            //console.log(JSON.stringify(result, null, 2))
          }
          //console.log("Tx: " + stdtx.value.msg[0].type + " " + hash)
          for (var j=0; j<res64.tags.length; j++) {
            const tag = res64.tags[j]
            const key = Buffer.from(tag.key, 'base64').toString()
            if (tag.value !== undefined) {
              var value = Buffer.from(tag.value, 'base64').toString()
            }
            //console.log("  '" + key + "': " + value)
            if (key === "mtm.MarketTick") {
              await addMarketTick(db, height, time, value, parseFloat(result.consensus.amount))
            }
            if (key.startsWith("quote.")) {
              //console.log("quote event: " + value)
              const id = parseInt(key.slice(6), 10)
              if (value === "event.update") {
                await addQuoteEvent(db, height, id, {
                  spot: parseFloat(result.spot.amount),
                  premium: parseFloat(result.premium.amount),
                  active: true
                })
              } else if (value === "event.create") {
                const spot = parseFloat(result.spot.amount)
                const premium = parseFloat(result.premium.amount)
                await addQuoteEvent(db, height, id, {
                  spot: spot,
                  premium: premium,
                  create: true,
                  market: result.market,
                  duration: result.duration,
                  active: true
                })
                var books = await db.collection('books').find({
                  market: result.market, 
                  duration: result.duration 
                }).sort({height:-1}).next()
                if (books === null) {
                  books = {
                    height: height,
                    market: result.market,
                    duration: result.duration,
                    quotes: [ id ]
                  }
                } else {
                  const quotes = books.quotes
                  quotes.push(id)
                  books = {
                    height: height,
                    market: result.market,
                    duration: result.duration,
                    quotes: quotes
                  }
                }
                await db.collection('books').replaceOne({
                  height: height,
                  market: result.market,
                  duration: result.duration
                }, books, {
                  upsert: true
                })
              } else if (value === "event.cancel" || value === "event.final") {
                const quote = await db.collection('quotes').find({id:id,create:true}).next()
                await addQuoteEvent(db, height, id, {
                  destroy: true,
                  active: false
                })
                var books = await db.collection('books').find({
                  market: quote.market, 
                  duration: quote.duration 
                }).sort({height:-1}).next()
                books = {
                  height: height,
                  market: quote.market,
                  duration: quote.duration,
                  quotes: books.quotes.filter(el => {
                    if (el !== id) return true
                    return false
                  })
                }
                await db.collection('books').replaceOne({
                  height: height,
                  market: quote.market,
                  duration: quote.duration
                }, books, {
                  upsert: true
                })
              } else if (value === "event.match") {
                // do nothing
              } else if (value === "event.deposit") {
                // do nothing
              } else {
                console.log("need to handle: " + value)
                process.exit()
              }
            }
            if (key.startsWith("trade.")) {
              const id = parseInt(key.slice(6), 10)
              //console.log("trade event: " + value)
              if (value === "event.create") {
                await addTradeEvent(db, height, id, result)
              } else if (value === "event.settle") {
                await addTradeEvent(db, height, id, result)
              } else {
                console.log("need to handle: " + value)
                process.exit()
              }
            }
          }
        }
      }
    }
    
    const meta = await db.collection('meta').insertOne({ 
      syncHeight: height,
      syncTime: block.header.time
    })
  }
  
  const addMarketTick = async (db, height, time, market, consensus) => {
    //console.log("SLURP MarketTick: " + market + " " + consensus)
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
  }
  
  const addQuoteEvent = async (db, height, id, data) => {
    //console.log("SLURP quote event: " + id)
    const counters = await db.collection('counters').find().next()
    
    const insertData = Object.assign({
      index: counters.quotes++,
      height: height,
      id: id
    }, data)
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
  }
  
  const addTradeEvent = async (db, height, id, data) => {
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
  }
  
  queryMarketHistory = async (market, startblock, endblock, target) => {
    const db = mongo.db(chainid)
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
