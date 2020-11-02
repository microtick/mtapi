const fs = require('fs')
const https = require('https')
const ws = require('ws')
const axios = require('axios')
const objecthash = require('object-hash')
const crypto = require('crypto')
const format = require('./format.js')

const protocol = require('../lib/protocol.js')
const config = JSON.parse(fs.readFileSync('./config.json'))

const GRPC = require ('../lib/grpc.js')
const grpc = new GRPC("http://" + config.tendermint)

const decodeTx = require('../lib/tx.js')
const decodeResult = require('../lib/result.js')
const util = require('../lib/util.js')

// Set to true if you want blocks and events stored in mongo
const USE_DATABASE = config.use_database 

// This seems to work regardless so disabling with default to true
const PRUNING_OFF = true

const LOG_API = false
const LOG_TX = false
const LOG_TRANSFERS = true

var chainid = null

if (USE_DATABASE) {
  var db = require('./database.js')
}

process.on('unhandledRejection', error => {
  if (error !== undefined) {
    console.log('unhandled promise rejection: ', error.message)
    console.log(error.stack)
  } else {
    console.log("promise rejection")
  }
  //process.exit(-1)
})

// Subscriptions (websocket)
const tendermint = config.tendermint

// Transactions
const NEWBLOCK = "tm.event='NewBlock'"
const TXTIMEOUT = config.timeout
const pending = {}

const globals = {}

// REST calls to Tendermint and Cosmos through ABCI

const queryTendermint = async url => {
  const query = "http://" + tendermint + url
  const res = await axios.get(query)
  return res.data.result
}

// API query caching
var cache = {}
var txcounter = 0
var curheight = 0

const shortHash = hash => {
  // uncomment this for shorthand hashes in logs
  //return hash.slice(0,6)
  return "'" + hash + "'"
}

setInterval(async () => {
  if (cache === undefined || cache.accounts === undefined) {
    return
  }
  const accts = Object.keys(cache.accounts)
  accts.map(async acct => {
    const pool = cache.accounts[acct]
    if (pool.queue === undefined || pool.queue.length === 0) return
    const lowestSequence = pool.queue.reduce((acc, item) => {
      if (acc === null) return item
      if (acc.sequence < item.sequence) return acc
      return item
    }, [])
    pool.queue = pool.queue.filter(el => {
      if (el.sequence === lowestSequence.sequence) return false
      return true
    })
    await lowestSequence.submit(acct)
  })
}, 100)

// Added at subsciption time: mapping market -> []id
const marketSubscriptions = {}
// Maintained at connection: id -> client
const clients = {}
const ids = {}

const connect = async () => {
    
  const tmclient = new ws("ws://" + tendermint + "/websocket")
  
  tmclient.on('open', async () => {
    console.log("Tendermint connected")
    
    // query markets
    const res = await queryTendermint("/genesis")
    globals.markets = res.genesis.app_state.microtick.markets
    globals.durations = res.genesis.app_state.microtick.durations
    console.log("Markets = " + globals.markets.map(m => m.name))
    console.log("Durations = " + globals.durations.map(d => d.name))
    
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
  const accts = Object.keys(ids)
  console.log(accts.length + " Active Connection(s):")
  if (accts.length > 0) {
    accts.map(acct => {
      ids[acct].map(id => {
        console.log("  Connection ID: [" + id + "] account: " + acct)
      })
    })
  }
  const keys = Object.keys(marketSubscriptions)
  console.log(keys.length + " Market Subscription(s):")
  if (keys.length > 0) {
    keys.map(key => {
      if (marketSubscriptions[key].length > 0) {
        console.log("  " + key + " => " + JSON.stringify(marketSubscriptions[key]))
      }
    })
  }
}

// Connected API clients

const subscribeMarket = (id, event) => {
  console.log("Subscribe: connection " + id + " => " + event)
  if (marketSubscriptions[event] === undefined) {
    marketSubscriptions[event] = [id]
  } else if (!marketSubscriptions[event].includes(id)) {
    marketSubscriptions[event].push(id)
  }
}
  
const unsubscribeMarket = (id, event) => {
  console.log("Unsubscribe: connection " + id + " => " + event)
  if (marketSubscriptions[event] === undefined) return
  marketSubscriptions[event] = marketSubscriptions[event].reduce((acc, thisid) => {
    if (thisid !== id) {
      acc.push(thisid)
    }
    return acc
  }, [])
}

var processing = false
var syncing = false
var chainHeight = 0

const broadcastBlock = block => {
  if (syncing) return
  const msg = apiProtocol.createEvent('block', block.height, block)
  Object.keys(clients).map(id => {
    const client = clients[id] 
    if (client !== undefined) {
      console.log("  Event New Block => [" + id + "]")
      client.send(msg)
    }
  })
}

const broadcastTick = (market, consensus) => {
  if (syncing) return
  if (marketSubscriptions[market] === undefined) return
  const msg = apiProtocol.createEvent('tick', market, consensus)
  //console.log("marketSubscriptions:[" + event + "] " + marketSubscriptions[event])
  marketSubscriptions[market].map(id => {
    const client = clients[id]
    if (client !== undefined) {
      console.log("  Event Market Tick: " + market + " => ["+ id + "]")
      client.send(msg)
    }
  })
}

const sendAccountEvent = (acct, event, payload) => {
  if (syncing) return
  if (format.fullTx[event] === undefined) return
  const formatted = format.fullTx[event](payload)
  const msg = apiProtocol.createEvent('account', event, formatted)
  if (ids[acct] !== undefined) {
    ids[acct].map(id => {
      const client = clients[id]
      if (client !== undefined) {
        console.log("  Account Event: " + event + " => [" + id + "]")
        client.send(msg)
      }
    })
  }
}

const handleNewBlock = async obj => {
  if (processing) return
  if (syncing) return

  processing = true

  chainHeight = parseInt(obj.result.data.value.block.header.height, 10)
  if (chainid === null) {
    chainid = obj.result.data.value.block.header.chain_id
    console.log("Setting chain ID=" + chainid)
  }
  if (USE_DATABASE) {
    if (!db.inited) {
      syncing = true
      await db.init(config.mongo, chainid, chainHeight)
      syncing = false
    }
    
    const dbHeight = await db.height()
    if (dbHeight < chainHeight - 1) {
      syncing = true
      //console.log("dbHeight=" + dbHeight)
      //console.log("chainHeight=" + chainHeight)
      console.log("Syncing...")
      for (var i=dbHeight + 1; i < chainHeight; i++) {
        await processBlock(i)
      }
      console.log("Done syncing...")
      syncing = false
    }
  }
    
  cache = {
    accounts: {}
  }
  
  await processBlock(chainHeight)
    
  // Check pending Tx hashes
  const hashes = Object.keys(pending)
  console.log(hashes.length + " Pending TXs")

  processing = false
}

const processBlock = async (height) => {
  curheight = height
  //console.log(JSON.stringify(obj, null, 2))
  const block = await queryTendermint('/block?height=' + height)
  const results = await queryTendermint('/block_results?height=' + height)
  block.height = height // replace string with int 
  block.time = Date.parse(block.block.header.time)
  
  const num_txs = block.block.data.txs === null ? 0 : block.block.data.txs.length
  if (!syncing) {
    console.log()
  }
  console.log("Block " + block.height + ": txs=" + num_txs)
  if (!syncing) {
    dump_subscriptions()
  }
  if (!syncing) console.log("Events:")
  broadcastBlock({
    height: block.height,
    time: block.time,
    hash: block.block.header.last_block_id.hash,
    chainid: chainid
  })
  if (num_txs > 0) {
    const txs = block.block.data.txs
    for (var i=0; i<txs.length; i++) {
      //console.log("TX #" + i)
      const txb64 = txs[i]
      var hash = crypto.createHash('sha256').update(Buffer.from(txb64, 'base64')).digest('hex').toUpperCase()
      const txr = results.txs_results[i]
      if (pending[hash] !== undefined) {
        if (txr.code !== 0) {
          if (LOG_TX) {
            console.log("  hash " + hash + " unsuccessful")
          }
          pending[hash].failure(new Error(txr.log))
        } else {
          if (LOG_TX) {
            console.log("  hash " + hash + " successful")
          }
          pending[hash].success({ tx_result: txr, height: block.height, hash: hash })
        }
        delete pending[hash]
      }
      if (txr.code === 0) {
        // Tx successful
        try {
          const txstruct = {
            events: {},
            transfers: []
          }
          if (txr.data !== null) {
            txstruct.result = decodeResult(txr.data)
          }
          for (var j=0; j<txr.events.length; j++) {
            const event = txr.events[j]
            if (event.type === "message") {
              for (var attr = 0; attr < event.attributes.length; attr++) {
                const a = event.attributes[attr]
                const key = Buffer.from(a.key, 'base64').toString()
                if (a.value !== undefined) {
                  const value = Buffer.from(a.value, 'base64').toString()
                  if (Array.isArray(txstruct.events[key])) {
                    if (!txstruct.events[key].includes(value)) txstruct.events[key].push(value)
                  } else if (txstruct.events[key] === undefined) {
                    txstruct.events[key] = value
                  } else if (txstruct.events[key] !== value) {
                    txstruct.events[key] = [ txstruct.events[key], value ]
                  }
                }
              }
            }
            if (event.type === "transfer") {
              const transfer = {}
              for (var attr = 0; attr < event.attributes.length; attr++) {
                const a = event.attributes[attr]
                const key = Buffer.from(a.key, 'base64').toString()
                const value = Buffer.from(a.value, 'base64').toString()
                transfer[key] = value
              }
              txstruct.transfers.push(transfer)
            }
          }
          
          // Update account balances from any transfers
          if (!syncing && LOG_TRANSFERS) {
            console.log("Transfers:")
            txstruct.transfers.map(transfer => {
              console.log("  " + transfer.amount + " " + transfer.sender + " -> " + transfer.recipient)
            })
          }
          if (USE_DATABASE) {
            txstruct.transfers.map(async transfer => {
              const amt = util.convertCoinString(transfer.amount)
              const value = parseFloat(amt.amount)
              await db.updateAccountBalance(transfer.sender, amt.denom, -1 * value)
              await db.updateAccountBalance(transfer.recipient, amt.denom, value)
            })
          }
          
          //console.log("Result " + txstruct.module + " / " + txstruct.action + ": hash=" + shortHash(hash))
          if (txstruct.events.module === "microtick") {
            await processMicrotickTx(block, txstruct)
          } 
          if (txstruct.events.module === "bank" && txstruct.events.action === "send") {
            const baseTx = decodeTx.Tx.deserialize(Buffer.from(txb64, "base64"))
            const from = txstruct.events.sender
            const to = txstruct.events.recipient
            const amt = parseFloat(txstruct.events.amount) / 1000000.0
            const depositPayload = {
              type: "deposit",
              from: from,
              account: to,
              height: block.height,
              amount: amt,
              time: block.time,
              memo: baseTx.memo,
              hash: hash
            }
            const withdrawPayload = {
              type: "withdraw",
              account: from,
              to: to,
              height: block.height,
              amount: amt,
              time: block.time,
              memo: baseTx.memo,
              hash: hash
            }
            if (USE_DATABASE) {
              await db.insertAccountEvent(block.height, txstruct.events.recipient, "deposit", depositPayload)
              await db.insertAccountEvent(block.height, txstruct.events.sender, "withdraw", withdrawPayload)
              withdrawPayload.balance = await db.getAccountBalance(from, "udai")
              depositPayload.balance = await db.getAccountBalance(to, "udai")
            }
            sendAccountEvent(txstruct.events.recipient, "deposit", depositPayload)
            sendAccountEvent(txstruct.events.sender, "withdraw", withdrawPayload)
          }
        } catch (err) {
          console.log(err)
          console.log("UNKNOWN TX TYPE")
          //process.exit()
        }
      }
    }
  }
  if (USE_DATABASE) {
    await db.insertBlock(block.height, block.time)
  }
}

const processMicrotickTx = async (block, tx) => {
  if (tx.result !== undefined) {
    tx.result.height = block.height
    tx.result.balance = {}
  }
  if (tx.events['mtm.MarketTick'] !== undefined) {
    const market = tx.events['mtm.MarketTick']
    const consensus = parseFloat(tx.result.consensus.amount)
    if (USE_DATABASE) {
      await db.insertMarketTick(block.height, block.time, market, consensus)
    }
    broadcastTick(market, {
      height: block.height,
      time: block.time,
      consensus: consensus
    })
  }
  Promise.all(Object.keys(tx.events).map(async e => {
    if (e.startsWith("acct.")) {
      const account = e.slice(5)
      if (USE_DATABASE) {
        tx.result.balance[account] = await db.getAccountBalance(account, "udai")
        await db.insertAccountEvent(block.height, account, tx.events[e], tx.result)
      }
      if (Array.isArray(tx.events[e])) {
        tx.events[e].map(x => {
          sendAccountEvent(account, x, tx.result)
        })
      } else {
        sendAccountEvent(account, tx.events[e], tx.result)
      }
    }
  }))
  Promise.all(Object.keys(tx.events).map(async e => {
    if (e.startsWith("quote.")) {
      const id = parseInt(e.slice(6), 10)
      if (USE_DATABASE) {
        await db.insertQuoteEvent(block.height, id, tx.events[e], tx.result)
      }
    }
    if (e.startsWith("trade.")) {
      const id = parseInt(e.slice(6), 10)
      const type = tx.events[e]
      if (USE_DATABASE) {
        await db.insertTradeEvent(block.height, id, type, tx.result)
        if (type === "event.create") {
          const trade = tx.result.trade
          const start = Math.floor(Date.parse(trade.start) / 1000)
          const end = Math.floor(Date.parse(trade.expiration) / 1000)
          for (var i=0; i<trade.legsList.length; i++) {
            const leg = trade.legsList[i]
            await db.insertAction(id, "long", leg.lonr, start, end, 0, parseFloat(leg.premium.amount))
            await db.insertAction(id, "short", leg.short, start, end, 0, parseFloat(leg.premium.amount))
          }
        }
        if (type === "event.settle") {
          const trade = tx.result
          for (var i=0; i<trade.settlementsList.length; i++) {
            const s = trade.settlementsList[i]
            const amt = parseFloat(s.settle.amount)
            if (amt > 0) {
              await db.updateAction(id, s.long, 0, amt) 
              await db.updateAction(id, s.short, amt, 0)
            }
          }
        }
      }
    }
  }))
}

// API Server Listener

var connectionId = 1

if (config.host_ssl) {
  console.log("Starting wss:// protocol")
  
  const secure = https.createServer({
    cert: fs.readFileSync(config.cert),
    key: fs.readFileSync(config.key)
  })

  var server = new ws.Server({ server: secure })
  secure.listen(config.secureport)
} else {
  server = new ws.Server({ port: config.secureport })
}

server.on('connection', async client => {

  const env = {
    id: connectionId++
  }

  clients[env.id] = client

  client.on('message', async msg => {
    const response = await apiProtocol.process(env, msg)
    if (response !== undefined) {
      client.send(response)
    }
  })

  client.on('close', () => {
    console.log("Disconnect " + env.id)
    const id = env.id
    delete clients[id]
    if (ids[env.acct] !== undefined) {
      ids[env.acct] = ids[env.acct].reduce((acc, arrid) => {
        if (arrid !== id) {
          acc.push(arrid)
        }
        return acc
      }, [])
      if (ids[env.acct].length === 0) {
        delete ids[env.acct]
      }
    }
    Object.keys(marketSubscriptions).map(key => {
      marketSubscriptions[key] = marketSubscriptions[key].reduce((acc, subid) => {
        if (subid != id) acc.push(subid)
        return acc
      }, [])
    })
    //const acct = env.acct
  })

})

const localServer = new ws.Server({
  host: "localhost",
  port: config.localport
})

localServer.on('connection', async client => {
  
  const env = {
    id: connectionId++
  }
  
  clients[env.id] = client
  
  client.on('message', async msg => {
    const response = await apiProtocol.process(env, msg)
    if (response !== undefined) {
      client.send(response)
    }
  })

  client.on('close', () => {
    console.log("Disconnect " + env.id)
    const id = env.id
    delete clients[id]
    if (ids[env.acct] !== undefined) {
      ids[env.acct] = ids[env.acct].reduce((acc, arrid) => {
        if (arrid !== id) {
          acc.push(arrid)
        }
        return acc
      }, [])
      if (ids[env.acct].length === 0) {
        delete ids[env.acct]
      }
    }
    Object.keys(marketSubscriptions).map(key => {
      marketSubscriptions[key] = marketSubscriptions[key].reduce((acc, subid) => {
        if (subid != id) acc.push(subid)
        return acc
      }, [])
    })
    //const acct = env.acct
  })
  
})

const apiProtocol = new protocol(10000, async (env, name, payload) => {
  return await handleMessage(env, name, payload)
})

const handleMessage = async (env, name, payload) => {
  if (name !== "posttx") {
    var hash = objecthash({
      name: name,
      payload: payload
    }) 
  
    if (cache[hash] !== undefined) {
      if (LOG_API) console.log("Responding from cache: [" + env.id + "] " + name + " " + JSON.stringify(payload))
      return cache[hash]
    } else {
      if (LOG_API) console.log("API call: [" + env.id + "] " + name + " " + JSON.stringify(payload))
    }
  }
  
  var returnObj
  var res
  try {
    switch (name) {
      case 'connect':
        env.acct = payload.acct
        console.log("Incoming connection [" + env.id + "] account=" + env.acct)
        if (ids[env.acct] === undefined) {
          ids[env.acct] = []
        }
        ids[env.acct].push(env.id)
        return {
          status: true,
          markets: globals.markets,
          durations: globals.durations
        }
      case 'subscribe':
        subscribeMarket(env.id, payload.key)
        return {
          status: true
        }
      case 'unsubscribe':
        unsubscribeMarket(env.id, payload.key)
        return {
          status: true
        }
      case 'blockinfo':
        res = await queryTendermint('/status')
        returnObj = {
          status: true,
          chainid: chainid,
          block: parseInt(res.sync_info.latest_block_height, 10),
          timestamp: Math.floor(new Date(res.sync_info.latest_block_time).getTime() / 1000)
        }
        break
      case 'getacctinfo':
        var res = await grpc.queryAccount(payload.acct)
        returnObj = {
          status: true,
          info: {
            account: res.account,
            balance: res.balancesList.dai,
            stake: res.balancesList.tick,
            placedquotes: res.placedQuotes,
            placedtrades: res.placedTrades,
            activeQuotes: res.activeQuotesList,
            activeTrades: res.activeTradesList,
            quoteBacking: res.quoteBacking.amount,
            tradeBacking: res.tradeBacking.amount,
            settleBacking: res.settleBacking.amount
          }
        }
        break
      case 'getmarketinfo':
        res = await grpc.queryMarket(payload.market)
        if (res.orderBooks === null) res.orderBooks = []
        returnObj = {
          status: true,
          info: {
            market: res.market,
            consensus: res.consensus.amount,
            totalBacking: res.totalBacking.amount,
            totalWeight: res.totalWeight.amount,
            orderBooks: res.orderBooksList.map(ob => {
              return {
                name: ob.name,
                sumBacking: ob.sumBacking.amount,
                sumWeight: ob.sumWeight.amount,
                insideAsk: ob.insideAsk.amount,
                insideBid: ob.insideBid.amount,
                insideCallAsk: ob.insideCallAsk.amount,
                insideCallBid: ob.insideCallBid.amount,
                insidePutAsk: ob.insidePutAsk.amount,
                insidePutBid: ob.insidePutBid.amount
              }
            })
          }
        }
        break
      case 'getmarketspot':
        res = await grpc.queryConsensus(payload.market)
        returnObj = {
          status: true,
          info: {
            market: res.market,
            consensus: res.consensus.amount,
            sumbacking: res.totalBacking.amount,
            sumweight: res.totalWeight.amount
          }
        }
        break
      case 'getorderbookinfo':
        res = await grpc.queryOrderBook(payload.market, payload.duration)
        const quoteListParser = q => {
          return {
            id: q.id,
            premium: q.premium.amount,
            quantity: q.quantity.amount
          }
        }
        returnObj = {
          status: true,
          info: {
            sumBacking: res.sumBacking.amount,
            sumWeight: res.sumWeight.amount,
            callAsks: res.callAsksList.map(quoteListParser),
            putAsks: res.putAsksList.map(quoteListParser),
            callBids: res.callBidsList.map(quoteListParser),
            putBids: res.putBidsList.map(quoteListParser)
          }
        }
        break
      case 'getsyntheticinfo':
        res = await grpc.querySynthetic(payload.market, payload.duration)
        const synListParser = q => {
          return {
            askId: q.askId,
            bidId: q.bidId,
            spot: q.spot.amount,
            quantity: q.quantity.amount
          }
        }
        returnObj = {
          status: true,
          info: {
            consensus: res.consensus.amount,
            weight: res.weight.amount,
            asks: res.asksList.map(synListParser),
            bids: res.bidsList.map(synListParser),
          }
        }
        break
      case 'getlivequote':
        res = await grpc.queryQuote(payload.id)
        returnObj = {
          status: true,
          info: {
            id: res.id,
            market: res.market,
            duration: res.duration,
            provider: res.provider,
            backing: res.backing.amount,
            ask: res.ask.amount,
            bid: res.bid.amount,
            quantity: res.quantity.amount,
            consensus: res.consensus.amount,
            spot: res.spot.amount,
            delta: res.delta,
            callAsk: res.callAsk.amount,
            callBid: res.callBid.amount,
            putAsk: res.putAsk.amount,
            putBid: res.putBid.amount,
            modified: res.modified * 1000,
            canModify: res.canModify * 1000
          }
        }
        break
      case 'getlivetrade':
        res = await grpc.queryTrade(payload.id)
        returnObj = {
          status: true,
          info: {
            id: res.id,
            market: res.market,
            duration: res.duration,
            order: res.order,
            taker: res.taker,
            quantity: res.quantity.amount,
            start: res.start * 1000,
            expiration: res.expiration * 1000,
            strike: res.strike.amount,
            currentSpot: res.consensus.amount,
            currentValue: res.currentValue,
            commission: res.commission.amount,
            settleIncentive: res.settleIncentive.amount,
            legs: res.legsList.map(leg => {
              return {
                leg_id: leg.leg_id,
                type: leg.type,
                backing: leg.backing.amount,
                premium: leg.premium.amount,
                quantity: leg.quantity.amount,
                cost: leg.cost.amount,
                long: leg.long,
                short: leg.short,
                quoted: {
                  id: leg.quoted.id,
                  premium: leg.quoted.premium.amount,
                  spot: leg.quoted.spot.amount
                }
              }
            })
          }
        }
        break
      case 'gethistquote':
        if (USE_DATABASE) {
          res = await db.queryHistQuote(payload.id, payload.startBlock, payload.endBlock)
          returnObj = {
            status: true,
            info: res
          }
        } else {
          throw new Error("Database turned off")
        }
        break
      case 'gethisttrade':
        if (USE_DATABASE) {
          res = await db.queryHistTrade(payload.id)
          res.curheight = curheight
          returnObj = {
            status: true,
            info: res
          }
        } else {
          throw new Error("Database turned off")
        }
        break
      case 'accountsync':
        if (USE_DATABASE) {
          console.log("Sync requested: " + env.acct + " " + payload.startblock + ":" + payload.endblock)
          res = await db.queryAccountHistory(env.acct, payload.startblock, payload.endblock)
          res.map(ev => {
            sendAccountEvent(env.acct, ev.type, ev.data)
          })
          returnObj = {
            status: true
          }
        } else {
          throw new Error("Database turned off")
        }
        break
      case 'accountledgersize':
        if (USE_DATABASE) {
          res = await db.queryAccountTotalEvents(env.acct)
          returnObj = {
            status: true,
            total: res
          }
          break
        } else {
          throw new Error("Database turned off")
        }
      case 'accountledger':
        if (USE_DATABASE) {
          res = await db.queryAccountLedger(env.acct, payload.page, payload.perPage)
          returnObj = {
            status: true,
            page: res.map(el => {
              return format.ledgerTx[el.type](env.acct, el.data)
            })
          }
        } else {
          throw new Error("Database turned off")
        }
        break
      case 'markethistory':
        if (USE_DATABASE) {
          res = await db.queryMarketHistory(payload.market, payload.startblock,
            payload.endblock, payload.target)
          return {
            status: true,
            history: res
          }
        } else {
          throw new Error("Database turned off")
        }
      case 'getauthinfo':
        // get the account number, sequence number
        res = await grpc.queryAuthAccount(payload.acct)
        return {
          status: true,
          info: {
            chainid: chainid,
            account: res.accountNumber,
            sequence: res.sequence
          }
        }
      case 'posttx':
        res = await new Promise(async (outerResolve, outerReject) => {
          const pendingTx = {
            sequence: payload.sequence,
            submitted: false,
            submit: async (acct) => {
              if (pendingTx.submitted) return
              try {
                const txtype = payload.type
                console.log("Posting [" + env.id + "] TX " + txtype)
                
                pendingTx.submitted = true
                const res = await axios.post('http://' + tendermint, {
                  jsonrpc: "2.0",
                  id: 1,
                  method: "broadcast_tx_commit",
                  params: {
                    tx: payload.tx
                  }
                }, {
                  headers: {
                    "Content-Type": "text/json"
                  }
                })
  
                if (res.data.result.check_tx.code !== 0) {
                  // error
                  outerReject(new Error(res.data.result.check_tx.log))
                  console.log("  failed: " + res.data.result.check_tx.log)
                  return
                } else {
                  if (LOG_TX) console.log("  hash=" + shortHash(res.data.result.hash))
                }
                const txres = await new Promise((resolve, reject) => {
                  const obj = {
                    success: txres => {
                      resolve(txres)
                    },
                    failure: err => {
                      console.log("failure")
                      reject(err)
                    },
                    timedout: false,
                    tries: 0
                  }
                  setTimeout(() => {obj.timedout = true}, TXTIMEOUT)
                  pending[res.data.result.hash] = obj
                })
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
                console.log("TX failed: " + acct)
                outerReject(err)
              }
            }
          }
          if (cache.accounts === undefined) {
            cache.accounts = {}
          }
          if (cache.accounts[env.acct] === undefined) {
            cache.accounts[env.acct] = {
              queue: []
            }
          }
          cache.accounts[env.acct].queue.push(pendingTx)
        })
        return {
          status: true,
          info: {
            height: res.height,
            hash: res.hash
          }
        }
    }
    
    // Save in cache
    if (name !== "posttx") {
      cache[hash] = returnObj
    }
    
    return returnObj
    
  } catch (err) {
    console.log("API error: " + name + ": " + err.message)
    //console.log(err)
    //if (err !== undefined) console.log(err)
    return {
      status: false,
      error: err.message
    }
  }
}
