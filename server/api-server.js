const ws = require('ws')
const protocol = require('../lib/protocol.js')
const axios = require('axios')
const objecthash = require('object-hash')
const mongodb = require('mongodb').MongoClient
const { marshalTx, unmarshalTx } = require('./amino.js')

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
const tendermint = "localhost:26657"

// Transactions
const NEWBLOCK = "tm.event='NewBlock'"
const TXTIMEOUT = 30000
const pending = {}

// Caching
var cache = {}

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
        console.log("TX error: " + hash + " " + res.data.error)
        pending[hash].failure(res.data.error)
        pending[hash].timedout = true
      } else if (res.data.result !== undefined) {
        console.log("TX success: " + hash)
        pending[hash].success(res.data.result)
        pending[hash].timedout = true
      }
      if (pending[hash].timedout) {
        console.log("Deleting pending TX: " + hash)
        delete pending[hash]
      }
    })
  }
  if (subscriptions[event] === undefined) return
  const msg = queue.createEvent(event, payload)
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
  port: 1320,
})

server.on('connection', async client => {
  
  const env = {
    id: connectionId++
  }
  
  console.log("  Connect " + env.id)
  clients[env.id] = client
  
  client.on('message', async msg => {
    const response = await queue.process(env, msg)
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

const queue = new protocol(10000, async (env, name, payload) => {
  return await handleMessage(env, name, payload)
})

const handleMessage = async (env, name, payload) => {
  console.log("  COMMAND " + env.id + " " + name + " " + JSON.stringify(payload))
  
  const hash = objecthash({
    name: name,
    payload: payload
  }) 
  
  if (cache[hash] !== undefined) {
    console.log("Responding from cache: " + hash)
    return cache[hash]
  }
  
  var returnObj
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
        var res = await queryTendermint('/status')
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
      case 'createmarket':
        res = await queryCosmos("/microtick/generate/createmarket/" + 
          env.acct + "/" + payload.market)
        return {
          status: true,
          msg: res
        }
        break
      case 'createquote':
        res = await queryCosmos("/microtick/generate/createquote/" +
          env.acct + "/" + 
          payload.market + "/" +
          payload.duration + "/" +
          payload.backing + "/" + 
          payload.spot + "/" +
          payload.premium)
        return {
          status: true,
          msg: res
        }
      case 'cancelquote':
        res = await queryCosmos("/microtick/generate/cancelquote/" +
          env.acct + "/" + 
          payload.id)
        return {
          status: true,
          msg: res
        }
      case 'depositquote':
        res = await queryCosmos("/microtick/generate/depositquote/" +
          env.acct + "/" +
          payload.id + "/" + 
          payload.deposit)
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
        return {
          status: true,
          msg: res
        }
      case 'settletrade':
        res = await queryCosmos("/microtick/generate/settletrade/" +
          env.acct + "/" +
          payload.id)
        return {
          status: true,
          msg: res
        }
      case 'markethistory':
        if (!USE_MONGO) throw new Error('No market tick DB')
        res = await queryMarketHistory(payload.market, payload.startblock,
          payload.endblock, payload.target)
        return {
          status: true,
          history: res
        }
      case 'posttx' :
        const bytes = marshalTx(payload.tx)
        //console.log(JSON.stringify(bytes))
        const hex = Buffer.from(bytes).toString('hex')
        //console.log("bytes=" + hex)
        res = await queryTendermint('/broadcast_tx_sync?tx=0x' + hex)
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
        return {
          status: true,
          info: txres
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
        if (which === key) {
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
    
    console.log("cache range " + query + "=[" + cache.startBlock + "," + cache.endBlock + "]")
    
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
  
  mongodb.connect("mongodb://localhost:27017", { 
    useNewUrlParser: true,
    useUnifiedTopology: true
  }, (err, client) => {
    if (err === null) {
      console.log("Connected to MongoDB")
      mongo = client
    }
  })
  
  handleNewBlock = async obj => {
    chainid = obj.result.data.value.block.header.chain_id
    const height = parseInt(obj.result.data.value.block.header.height, 10)
    //console.log(JSON.stringify(obj, null, 2))
    
    if (mongo !== null && mongo.isConnected()) {
      const db = mongo.db(chainid)
      
      await db.createCollection('meta', { capped: true, max: 1, size: 4096 })
      await db.createCollection('counters', { capped: true, max: 1, size: 4096 })
      await db.createCollection('ticks')
      
      const counters = await db.collection('counters')
      if (await counters.find().count() === 0) {
        await counters.insertOne({ 
          ticks: 1
        })
      }
      
      const hasIndex = await db.collection('ticks').indexExists('history')
      if (!hasIndex) {
        console.log("Creating index")
        await db.collection('ticks').createIndex({
          index: 1,
          height: 1,
          market: 1
        }, {
          name: 'history'
        })
      }
      
      const synced = await isSynced(db, height)
      //console.log("synced = " + synced)
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
    } while (block !== undefined)
    
    console.log("done syncing...")
    syncing = false
  }
  
  const insertBlock = async (db, block) => {
    const height = parseInt(block.header.height, 10)
    const time = block.header.time
    
    const num_txs = parseInt(block.header.num_txs, 10)
    console.log("Block " + height + ": txs=" + num_txs)
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
            const value = Buffer.from(tag.value, 'base64').toString()
            //console.log("  '" + key + "': " + value)
            if (key === "mtm.MarketTick") {
              await addMarketTick(db, height, time, value, parseFloat(result.consensus.amount))
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
    console.log("SLURP MarketTick: " + market + " " + consensus)
    const counters = await db.collection('counters').find().next()
    
    await db.collection('ticks').insertOne({
      index: counters.ticks++,
      height: height,
      time: time,
      market: market,
      consensus: consensus
    })
    const curs = await db.collection('ticks').find()
    if (await curs.hasNext()) {
      const doc = await curs.next()
      if (height === doc.syncHeight + 1) {
        return true
      }
    } 
    
    await db.collection('counters').insertOne({
      ticks: counters.ticks
    })
  }
  
  queryMarketHistory = async (market, startblock, endblock, target) => {
    const db = mongo.db(chainid)
    //console.log("startblock=" + startblock)
    //console.log("endblock=" + endblock)
    //console.log("target=" + target)
    const curs = await db.collection('ticks').find({
      $and: [
        { market: market },
        { height: { $gte: startblock }},
        { height: { $lte: endblock }}
      ]
    })
    const total = await curs.count()
    //console.log("total=" + total)
    const skip = Math.floor(total / target) - 1
    if (skip > 0) {
      //console.log("skip=" + skip)
      var res = []
      while (await curs.hasNext()) {
        res.push(await curs.next())
        for (var i=0; i<skip; i++) {
          if (await curs.hasNext()) await curs.next()
        }
      }
    } else {
      res = await curs.toArray()
    }
    return res
  }
  
}
