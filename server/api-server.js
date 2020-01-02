const ws = require('ws')
const protocol = require('../lib/protocol.js')
const axios = require('axios')
const objecthash = require('object-hash')
const { marshalTx, unmarshalTx } = require('./amino.js')
const config = require('./config.js')

const USE_DATABASE = true
if (USE_DATABASE) {
  var db = require('./database.js')
}

process.on('unhandledRejection', error => {
  if (error !== undefined) {
    console.log('unhandled promise rejection: ', error.message);
    console.log(error.stack)
  } else {
    console.log("promise rejection")
  }
  process.exit(-1)
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
      await pool.queue[pool.pendingSequenceNumber].submit(acct, pool.pendingSequenceNumber)
      delete pool.queue[pool.pendingSequenceNumber]
      pool.pendingSequenceNumber++
    }
  })
}, 100)

// Added at subsciption time: mapping event -> []id
const subscriptions = {}
// Maintained at connection: id -> client
const clients = {}
const ids = {}

const connect = async () => {
    
  const tmclient = new ws("ws://" + tendermint + "/websocket")
  
  tmclient.on('open', () => {
    console.log("Tendermint connected")
    
    const req = {
      "jsonrpc": "2.0",
      "method": "subscribe",
      "id": "0",
      "params": {
        "query": NEWBLOCK
      }
    }
    tmclient.send(JSON.stringify(req))
  })

  tmclient.on('message', msg => {
    const obj = JSON.parse(msg)
    if (obj.result === undefined) {
      console.log("Tendermint message error: " + JSON.stringify(obj, null, 2))
      tmclient.close()
      return
    }
    if (obj.result.data !== undefined) {
      handleNewBlock(obj)
    }
  })

  tmclient.on('close', () => {
    console.log("Tendermint disconnected")
    console.log("Attempting to reconnect")
    setTimeout(connect, 1000)
  })

  tmclient.on('error', err => {
    this.err = err
    console.log("Tendermint error: " + err.message)
  })
}

connect()

const dump_subscriptions = () => {
  console.log("Subscription Summary")
  Object.keys(subscriptions).map(key => {
    console.log("  " + key + ": " + JSON.stringify(subscriptions[key]))
  })
}

const subscribe = (id, event) => {
  console.log("Subscribe: " + id + ": " + event)
  if (subscriptions[event] === undefined) {
    subscriptions[event] = [id]
  } else if (!subscriptions[event].includes(id)) {
    subscriptions[event].push(id)
  }
}
  
const unsubscribe = (id, event) => {
  console.log("Unsubscribe: " + id + ": " + event)
  if (subscriptions[event] === undefined) return
  subscriptions[event] = subscriptions[event].reduce((acc, thisid) => {
    if (thisid !== id) {
      acc.push(id)
    }
    return acc
  }, [])
}

var syncing = false
var chainHeight = 0

const sendEvent = (event, payload) => {
  if (syncing) return
  if (subscriptions[event] === undefined) return
  const msg = apiProtocolQueue.createEvent(event, payload)
  //console.log("Subscriptions:[" + event + "] " + subscriptions[event])
  subscriptions[event].map(id => {
    const client = clients[id]
    if (client !== undefined) {
      console.log("Sending event: " + event + " => id "+ id)
      client.send(msg)
      return id
    }
  })
}

const sendAccountEvent = (acct, event, payload) => {
  if (syncing) return
  if (subscriptions[event] === undefined) return
  const msg = apiProtocolQueue.createEvent(event, payload)
  //console.log("Subscriptions:[" + event + "] " + subscriptions[event])
  if (ids[acct] !== undefined) {
    const client = clients[ids[acct]]
    if (client !== undefined) {
      console.log("Sending event: " + event + " => acct "+ acct)
      client.send(msg)
    }
  }
}

const handleNewBlock = async obj => {
  chainHeight = parseInt(obj.result.data.value.block.header.height, 10)
  if (USE_DATABASE) {
    if (syncing) return
    const chainid = obj.result.data.value.block.header.chain_id
    await db.init(config.mongo, chainid)
    const dbHeight = await db.height()
    if (dbHeight < chainHeight - 1) {
      console.log("Syncing...")
      syncing = true
      for (var i=dbHeight + 1; i < chainHeight; i++) {
        await processBlock(i)
      }
      console.log("Done syncing...")
      syncing = false
    }
  }
  dump_subscriptions()
  await processBlock(chainHeight)
    
  // Reset cache
  const oldcache = cache
    
  cache = {
    accounts: {}
  }
    
  if (oldcache.accounts !== undefined) {
    const keys = Object.keys(oldcache.accounts)
    for (var i=0; i<keys.length; i++) {
      const key = keys[i]
      if (Object.keys(oldcache.accounts[key].queue).length > 0) {
        console.log("Copying cache for acct: " + key)
        cache.accounts[key] = oldcache.accounts[key]
      }
    }
  }
    
  // Check pending Tx hashes
  const hashes = Object.keys(pending)
  if (hashes.length > 25) {
    console.log("Warning: " + hashes.length + " pending Txs")
  }
  hashes.map(async hash => {
    const url = "http://" + tendermint + "/tx?hash=0x" + hash
    const res = await axios.get(url)
    if (res.data.error !== undefined) {
      pending[hash].tries++
      if (pending[hash].tries > 2) {
        console.log("TX error: " + hash + " " + JSON.stringify(res.data.error))
        pending[hash].failure(res.data.error)
      }
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

const processBlock = async height => {
  //console.log(JSON.stringify(obj, null, 2))
  const block = await queryTendermint('/block?height=' + height)
  const results = await queryTendermint('/block_results?height=' + height)
  block.height = height // replace string with int 
  block.time = Date.parse(block.block.header.time)
  
  const num_txs = parseInt(block.block.header.num_txs, 10)
  console.log("Block " + block.height + ": txs=" + num_txs)
  if (USE_DATABASE) {
    await db.insertBlock(block.height, block.time)
  }
  sendEvent("blocks", {
    height: block.height,
    time: block.time,
    hash: block.block.header.last_block_id.hash
  })
  if (num_txs > 0) {
    const txs = block.block.data.txs
    for (var i=0; i<txs.length; i++) {
      //console.log("TX #" + i)
      const txb64 = txs[i]
      //var bytes = Buffer.from(txb64, 'base64')
      //var hash = crypto.createHash('sha256').update(bytes).digest('hex')
      const res64 = results.results.deliver_tx[i]
      if (res64.code === 0) {
        // Tx successful
        if (res64.data !== null) {
          var result = JSON.parse(Buffer.from(res64.data, 'base64').toString())
          //console.log(JSON.stringify(result, null, 2))
        }
        for (var j=0; j<res64.events.length; j++) {
          const event = res64.events[j]
          if (event.type === "message") {
            for (var attr = 0; attr < event.attributes.length; attr++) {
              const a = event.attributes[attr]
              const key = Buffer.from(a.key, 'base64').toString()
              if (a.value !== undefined) {
                const value = Buffer.from(a.value, 'base64').toString()
                await processEvent(block, result, key, value)
              }
            }
          }
        }
      }
    }
  }
}

const processEvent = async (block, result, key, value) => {
  //console.log("key=" + key + " value=" + value)
  if (key === "mtm.MarketTick") {
    const consensus = parseFloat(result.consensus.amount)
    if (USE_DATABASE) {
      await db.insertMarketTick(block.height, block.time, value, consensus)
    }
    sendEvent("market." + value, {
      height: block.height,
      time: block.time,
      consensus: consensus
    })
  }
  if (key.startsWith("quote.")) {
    //console.log("quote event: " + value)
    const id = parseInt(key.slice(6), 10)
    if (value === "event.update") {
      if (USE_DATABASE) {
        await db.insertQuoteEvent(block.height, id, {
          spot: parseFloat(result.spot.amount),
          premium: parseFloat(result.premium.amount),
          active: true
        })
      }
    } else if (value === "event.create") {
      const spot = parseFloat(result.spot.amount)
      const premium = parseFloat(result.premium.amount)
      if (USE_DATABASE) {
        await db.newQuote(block.height, result.market, result.duration, id)
        await db.insertQuoteEvent(db, block.height, id, {
          spot: spot,
          premium: premium,
          create: true,
          market: result.market,
          duration: result.duration,
          active: true
        })
      }
    } else if (value === "event.cancel" || value === "event.final") {
      if (USE_DATABASE) {
        await db.removeQuote(block.height, result.market, result.duration, id)
        await db.insertQuoteEvent(db, block.height, id, {
          destroy: true,
          active: false
        })
      }
    } else if (value === "event.match") {
      // do nothing
    } else if (value === "event.deposit") {
      // do nothing
    } else {
      throw new Error("Unknown event: " + value)
    }
  }
  if (key.startsWith("trade.")) {
    const id = parseInt(key.slice(6), 10)
    //console.log("trade event: " + value)
    if (value === "event.create") {
      if (USE_DATABASE) {
        await db.insertTradeEvent(block.height, id, result)
      }
    } else if (value === "event.settle") {
      if (USE_DATABASE) {
        await db.insertTradeEvent(block.height, id, result)
      }
    } else {
      throw new Error("Unknown event: " + value)
    }
  }
  if (key.startsWith("acct.")) {
    const acct = key.slice(5)
    sendAccountEvent(acct, value, result)
  }
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
  if (res.data.result.response.code !== 0) {
    //console.log("query=" + query)
    //console.log(JSON.stringify(res.data, null, 2))
    const obj = JSON.parse(res.data.result.response.log)
    throw new Error(obj.message)
  }
  if (res.data.result.response.value === null) {
    throw new Error("Received null response")
  } else {
    const data = Buffer.from(res.data.result.response.value, 'base64')
    return JSON.parse(data.toString())
  }
}

// Server

var connectionId = 1

const server = new ws.Server({
  host: config.host,
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
    delete ids[env.acct]
    Object.keys(subscriptions).map(key => {
      subscriptions[key] = subscriptions[key].reduce((acc, subid) => {
        if (subid != id) acc.push(subid)
        return acc
      }, [])
    })
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
        ids[env.acct] = env.id
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
        res = await doHistory(payload.query, payload.from, payload.to, payload.events)
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
        if (!USE_DATABASE) throw new Error('No market tick DB')
        res = await db.queryMarketHistory(payload.market, payload.startblock,
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
        res = await new Promise(async (outerResolve, outerReject) => {
          const pendingTx = {
            submitted: false,
            submit: async (acct, sequence) => {
              if (pendingTx.submitted) return
              console.log("Submitting TX: " + acct + ": sequence=" + sequence) 
              pendingTx.submitted = true
              
              const bytes = marshalTx(payload.tx)
              //console.log(JSON.stringify(bytes))
              const hex = Buffer.from(bytes).toString('hex')
              //console.log("bytes=" + hex)
              res = await queryTendermint('/broadcast_tx_sync?tx=0x' + hex)
              try {
                const txres = await new Promise((resolve, reject) => {
                  const obj = {
                    success: txres => {
                      resolve(txres)
                    },
                    failure: err => {
                      reject(err)
                    },
                    timedout: false,
                    tries: 0
                  }
                  setTimeout(() => {obj.timedout = true}, TXTIMEOUT)
                  pending[res.hash] = obj
                })
                if (txres.tx_result.data !== null) {
                  txres.tx_result.data = JSON.parse(Buffer.from(txres.tx_result.data, 'base64').toString())
                }
                if (txres.tx_result.events !== undefined) {
                  for (var i=0; i<txres.tx_result.events.length; i++) {
                    var t = txres.tx_result.events[i]
                    if (t.type === "message") {
                      t.attributes = t.attributes.map(a => {
                        return {
                          key: Buffer.from(a.key, 'base64').toString(),
                          value: Buffer.from(a.value, 'base64').toString()
                        }
                      })
                    }
                  }
                }
                outerResolve(txres)
              } catch (err) {
                console.log("TX failed: " + acct + ": sequence=" + sequence + " " + err.message) 
                outerResolve(null)
              }
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
          const seq = parseInt(payload.sequence, 10)
          cache.accounts[env.acct].queue[seq] = pendingTx
          if (cache.accounts[env.acct].pendingSequenceNumber === undefined) {
            cache.accounts[env.acct].pendingSequenceNumber = seq
          }
          if (cache.accounts[env.acct].nextSequenceNumber === undefined) {
            cache.accounts[env.acct].pendingSequenceNumber + 1
          }
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

const formatTx = (tx, whichEvents) => {
  const height = parseInt(tx.height, 10)
  
  var data = {}
  data.events = {}
  if (tx.tx_result.data !== undefined) {
    const str = Buffer.from(tx.tx_result.data, "base64").toString()
    const json = JSON.parse(str)
    data = Object.assign(data, json)
  }
  if (whichEvents != null && tx.tx_result.events !== undefined) {
    tx.tx_result.events.map(event => {
      whichEvents.map(which => {
        const key = Buffer.from(event.key, "base64").toString()
        if (which === key && event.value !== undefined) {
          data.events[key] = Buffer.from(event.value, "base64").toString()
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

const doHistory = async (query, fromBlock, toBlock, whichEvents) => {
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
        const data = formatTx(txs[i], whichEvents)
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
  
  