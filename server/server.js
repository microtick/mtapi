const fs = require('fs')
const https = require('https')
const ws = require('ws')
const axios = require('axios')
const objecthash = require('object-hash')
const crypto = require('crypto')
const cryptojs = require('crypto-js')
const ripemd160 = require('crypto-js/ripemd160')
const sha256 = require('js-sha256')
const bech32 = require('bech32')
const BN = require('bignumber.js')

const protocol = require('../lib/protocol.js')
const codec = require('./codec.js')
const config = JSON.parse(fs.readFileSync('./config.json'))

// Set to true if you want blocks and events stored in mongo
const USE_DATABASE = config.use_database 

// This seems to work regardless so disabling with default to true
const PRUNING_OFF = true

const LOG_API = false
const LOG_TX = false
const LOG_TRANSFERS = false

var chainid_mapping = {}
var chainid = null

if (USE_DATABASE) {
  var db = require('./database.js')
}

process.on('unhandledRejection', error => {
  if (error !== undefined) {
    console.error('Unhandled API error: ', error.message)
    //console.log(error.stack)
  } else {
    console.error("Promise rejection")
  }
  //process.exit(-1)
})

// Protobuf message package name
const PROTOBUF_MICROTICK_PACKAGE = "microtick.v1beta1.msg"

// Transactions
const NEWBLOCK = "tm.event='NewBlock'"
const TXTIMEOUT = config.timeout
const pending = {}

const globals = {
  account_cache: {}
}

// ABCI calls to Tendermint and REST

const queryTendermint = async (url, tendermint=config.tendermint) => {
  const query = "http://" + tendermint + url
  const res = await axios.get(query)
  return res.data.result
}

const queryRest = async (url, rest=config.rest) => {
  try {
    const query = "http://" + rest + url
    const res = await axios.get(query)
    return res.data.result
  } catch (err) {
    return {}
  }
}

// API query caching
var cache = {}
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
    
  const tmclient = new ws("ws://" + config.tendermint + "/websocket")
  
  tmclient.on('open', async () => {
    console.log("Tendermint connected")
    
    // query genesis markets, durations
    const res = await queryTendermint("/genesis")
    globals.genesis = res.genesis
    console.log("Genesis Markets=" + globals.genesis.app_state.microtick.markets.map(m => m.name))
    console.log("Genesis Durations=" + globals.genesis.app_state.microtick.durations.map(d => d.name))
    
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
      console.error("Tendermint message error: " + JSON.stringify(obj, null, 2))
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
    console.error("Tendermint error: " + err.message)
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
  if (keys.length > 0) {
    console.log("Market Subscription(s):")
    keys.map(key => {
      if (marketSubscriptions[key].length > 0) {
        console.log("  " + key + " => " + JSON.stringify(marketSubscriptions[key]))
      }
    })
  }
}

const convertCoinString = (str, assert) => {
  const arr = str.match(/^(\d+\.?\d*)([a-zA-Z]+|ibc\/[0-9A-F]+)$/)
  if (arr === null) {
    throw new Error("Invalid coin string: " + str)
  }
  if (assert !== undefined && assert !== arr[2]) {
    throw new Error("Denom mismatch got: '" + arr[2] + "' expected '" + assert + "'")
  }
  return {
    denom: arr[2],
    amount: parseFloat(arr[1])
  }
}
  
const convertCoin = (coin, precision) => {
  const amount = new BN(coin.amount)
  return {
    denom: coin.denom,
    amount: amount.dividedBy(precision).toNumber()
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
      //console.log("  New Block => [" + id + "]")
      client.send(msg)
    }
  })
}

const broadcastTick = (market, payload) => {
  if (syncing) return
  if (marketSubscriptions[market] === undefined) return
  const msg = apiProtocol.createEvent('tick', market, payload)
  //console.log("marketSubscriptions:[" + event + "] " + marketSubscriptions[event])
  marketSubscriptions[market].map(id => {
    const client = clients[id]
    if (client !== undefined) {
      console.log("  Market Tick: " + market + " => ["+ id + "]")
      client.send(msg)
    }
  })
}

const sendAccountEvent = (acct, event, payload) => {
  if (syncing) return
  const msg = apiProtocol.createEvent('account', event, payload)
  if (ids[acct] !== undefined) {
    ids[acct].map(id => {
      const client = clients[id]
      if (client !== undefined) {
        console.log("  Account: " + event + " => [" + id + "]")
        client.send(msg)
      }
    })
  }
}

/*
// Before REST turned on - GRPC query example
// equivalent to queryRest("/auth/accounts/" + acct)
//
const queryAuthAccount  = async acct => {
  const query = codec.create("cosmos.auth.v1beta1.QueryAccountRequest", { address: acct })
  const data = {
    jsonrpc: "2.0",
    id: 0,
    method: "abci_query",
    params: {
      data: query.toString('hex'),
      height: "0",
      path: "/cosmos.auth.v1beta1.Query/Account",
      prove: false
    }
  }
  const res = await axios.post("http://" + config.tendermint, data)
  if (res.data.result.response.code !== 0) {
    throw new Error("Account not found")
  }
  const buf = Buffer.from(res.data.result.response.value, 'base64')
  return codec.decode("cosmos.auth.v1beta1.QueryAccountResponse", buf, true)
}
*/

const updateAccountBalance = async (height, hash, acct, denom, amount) => {
  if (globals.account_cache[acct] === undefined) {
    let res = await queryRest("/auth/accounts/" + acct)
    if (res.type === "cosmos-sdk/ModuleAccount") {
      globals.account_cache[acct] = {
        name: res.value.name,
        module: true
      }
    } else {
      globals.account_cache[acct] = {
        name: res.value.address,
        module: false
      }
    }
  }
  if (USE_DATABASE) {
    if (hash.startsWith("lookup")) {
      const value = hash.split(":")
      const lookup = value[1]
      if (globals.account_cache[lookup] === undefined) {
        let res = await queryRest("/auth/accounts/" + acct)
        if (res.type === "cosmos-sek/ModuleAccount") {
          globals.account_cache[acct] = {
            name: res.value.name,
            module: true
          }
          hash = res.value.name
        } else {
          hash = "blocktx"
        }
      } else {
        hash = globals.account_cache[lookup].name
      }
    }
    db.updateAccountBalance(height, hash, globals.account_cache[acct].name, denom, amount, 
      !globals.account_cache[acct].module)
  }
  if (!globals.account_cache[acct].module) {
    sendAccountEvent(globals.account_cache[acct].name, amount > 0 ? "deposit": "withdraw", {
      hash: hash,
      amount: amount >= 0 ? amount : -1 * amount,
      denom: denom
    })
  }
}

var txlog
const handleNewBlock = async obj => {
  if (processing) return
  if (syncing) return

  processing = true

  txlog = "Transfers:"
  
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
      console.log("Syncing...")
      for (var i=dbHeight + 1; i < chainHeight; i++) {
        await processBlock(i)
      }
      console.log("Done syncing...")
      syncing = false
    }
  }
  
  // Reset cache for every new block
  cache = {
    accounts: {}
  }
  
  await processBlock(chainHeight)
  
  if (LOG_TRANSFERS) {
    console.log(txlog)
  }
    
  processing = false
}

const processBlock = async (height) => {
  
  // handle genesis markets and accounts -> DB
  if (USE_DATABASE && height === 1) {
    globals.genesis.app_state.microtick.markets.map(async m => {
      await db.insertMarket(m.name, m.description)
    })
    globals.genesis.app_state.bank.balances.map(a => {
      a.coins.map(async c => {
        await updateAccountBalance(height, "genesis", a.address, c.denom, parseFloat(c.amount))
      })
    })
  }
      
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
  
  const hashes = Object.keys(pending)
  console.log("Block " + block.height + ": txs=" + num_txs + " pending=" + hashes.length)
  
  // Handle pending timeouts
  for (var i=0; i<hashes.length; i++) {
    const hash = hashes[i]
    if (pending[hash].timedout) {
      console.log("  Timeout: " + hash)
      delete pending[hash]
    }
  }
  
  if (!syncing) {
    this.latestBlock = {
      height: block.height,
      time: block.time,
      hash: block.block.header.last_block_id.hash,
      chainid: chainid
    }
    broadcastBlock(this.latestBlock)
    dump_subscriptions()
    console.log("Block Events:")
  }
  
  
  if (num_txs > 0) {
    const txs = block.block.data.txs
    for (i=0; i<txs.length; i++) {
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
          pending[hash].success({ height: block.height, hash: hash })
        }
        delete pending[hash]
      }
      if (txr.code === 0) { // Tx successful
        try {
          const txstruct = {
            height: block.height,
            hash: hash,
            events: {},
            transfers: []
          }
          txstruct.tx = codec.decode("cosmos.tx.v1beta1.Tx", Buffer.from(txb64, 'base64'))
          if (txr.data !== null) {
            txstruct.result = codec.decode("cosmos.base.abci.v1beta1.TxMsgData", Buffer.from(txr.data, 'base64'))
          }
          if (USE_DATABASE) {
            await db.insertTx(hash, block.height, txstruct.tx.body.messages.map(m => m.type_url))
          }
          for (var j=0; j<txr.events.length; j++) {
            const event = txr.events[j]
            if (event.type === "message") {
              for (var attr = 0; attr < event.attributes.length; attr++) {
                const a = event.attributes[attr]
                if (a.index) {
                  var key = Buffer.from(a.key, 'base64').toString()
                  var value = Buffer.from(a.value, 'base64').toString()
                } else {
                  key = a.key
                  value = a.value
                }
                txstruct.events[key] = value
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
          
          //console.log(JSON.stringify(txstruct, null, 2))
          //console.log(JSON.stringify(txr, null, 2))
          
          // Update account balances from any transfers
          txstruct.transfers.map(async transfer => {
            if (!syncing && LOG_TRANSFERS) {
              txlog += "\n  " + transfer.amount + " " + transfer.sender + " -> " + transfer.recipient
            }
            transfer.amount.split(",").map(async amt => {
              const coin = convertCoinString(amt)
              await updateAccountBalance(height, hash, transfer.sender, coin.denom, -1 * coin.amount)
              await updateAccountBalance(height, hash, transfer.recipient, coin.denom, coin.amount)
            })
          })
          
          //console.log("Result " + txstruct.module + " / " + txstruct.action + ": hash=" + shortHash(hash))
          //console.log(JSON.stringify(txstruct.events))
          
          if (txstruct.events.module === "microtick") {
            await processMicrotickTx(block, txstruct)
          } 
          if (txstruct.events.module === "governance") {
            txstruct.tx.body.messages.map(msg => {
              switch (msg.type_url) {
                case "/cosmos.gov.v1beta1.MsgSubmitProposal":
                  const proposal = codec.decode(msg.type_url.slice(1), Buffer.from(msg.value, 'base64'), true)
                  switch (proposal.content["@type"]) {
                    case '/' + PROTOBUF_MICROTICK_PACKAGE + '.DenomChangeProposal':
                      console.log("Denom change: " + proposal.content.backingDenom + " ratio: " + proposal.content.backingRatio)
                      break
                    case '/' + PROTOBUF_MICROTICK_PACKAGE + '.AddMarketsProposal':
                      proposal.content.markets.map(async m => {
                        console.log("Add market: " + m.name)
                        if (USE_DATABASE) {
                          await db.insertMarket(m.name, m.description)
                        }
                      })
                      break
                  }
                  break
              }
            })
          }
          if (txstruct.events.module === "ibc") {
            console.log(JSON.stringify(txstruct.tx.body.messagesList, null, 2))
          }
        } catch (err) {
          console.error(err)
          console.error("UNKNOWN TX TYPE")
          process.exit()
        }
      }
    }
  }
  
  // Handle block transfers
  const transfer_handler = async e => {
    //console.log("  "  + e.type)
    if (e.type === "transfer") {
      const obj = {}
      e.attributes.map(a => {
        const key = Buffer.from(a.key, 'base64').toString()
        const value = Buffer.from(a.value, 'base64').toString()
        obj[key] = value
      })
      obj.amount.split(",").map(async amt => {
        const coin = convertCoinString(amt)
        await updateAccountBalance(height, "lookup:" + obj.recipient, obj.sender, coin.denom, -1 * coin.amount)
        await updateAccountBalance(height, "lookup:" + obj.sender, obj.recipient, coin.denom, coin.amount)
      })
      // Do not log block transfers
      //if (!syncing && LOG_TRANSFERS) {
        //txlog += "\n  " + obj.amount + " " + obj.sender + " -> " + obj.recipient
      //}
    }
  }
  for (i=0; i<results.begin_block_events.length; i++) {
    transfer_handler(results.begin_block_events[i])
  }
  for (i=0; i<results.end_block_events.length; i++) {
    transfer_handler(results.end_block_events[i])
  }
  
  if (USE_DATABASE) {
    await db.insertBlock(block.height, block.time)
  }
}

const convertTradeResultToObj = trade => {
  const obj = {}
  obj.id = trade.id
  obj.quantity = convertCoin(trade.quantity, "1e18").amount
  obj.start = parseInt(trade.start)
  obj.expiration = parseInt(trade.expiration)
  obj.strike = convertCoin(trade.strike, "1e18").amount
  obj.commission = convertCoin(trade.commission, "1e18").amount
  obj.settleIncentive = convertCoin(trade.settleIncentive, "1e18").amount
  obj.legs = trade.legs.map(leg => {
    return {
      legId: leg.legId === undefined ? 0 : leg.legId,
      type: leg.type ? "call" : "put",
      backing: convertCoin(leg.backing, "1e18").amount,
      premium: convertCoin(leg.premium, "1e18").amount,
      cost: convertCoin(leg.cost, "1e18").amount,
      quantity: convertCoin(leg.quantity, "1e18").amount,
      long: bech32.encode("micro", bech32.toWords(Buffer.from(leg.long, "base64"))),
      short: bech32.encode("micro", bech32.toWords(Buffer.from(leg.short, "base64"))),
      quoteId: leg.quoted.id,
      remainBacking: convertCoin(leg.quoted.remainBacking, "1e18").amount,
      final: leg.quoted.final ? true : false
    }
  })
  return obj
}

const processMicrotickTx = async (block, txstruct) => {
  const tx = txstruct.tx
  if (tx.result !== undefined) {
    tx.result.height = block.height
    tx.result.balance = {}
  }
  
  // Decode results according to message type
  for (var i=0; i<tx.body.messages.length; i++) {
    const message = tx.body.messages[i]
    const payload = codec.decode(tx.body.messages[i].type_url.slice(1), 
      Buffer.from(tx.body.messages[i].value, 'base64'), true)
    const result = txstruct.result.data[i]
    const item = {}
    switch (message.type_url) {
    case "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxCancelQuote":
      var data = codec.decode(PROTOBUF_MICROTICK_PACKAGE + ".CancelQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "cancel"
      item.time = parseInt(data.time) * 1000
      item.id = payload.id
      item.hash = txstruct.hash
      item.requester = bech32.encode("micro", bech32.toWords(Buffer.from(payload.requester, "base64")))
      item.account = bech32.encode("micro", bech32.toWords(Buffer.from(data.account, "base64")))
      item.market = data.market
      item.duration = data.duration
      item.consensus = convertCoin(data.consensus, "1e18").amount
      item.refund = convertCoin(data.refund, "1e18").amount
      item.slash = convertCoin(data.slash, "1e18").amount
      item.commission = convertCoin(data.commission, "1e18").amount
      break
    case "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxCreateQuote":
      data = codec.decode(PROTOBUF_MICROTICK_PACKAGE + ".CreateQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "create"
      item.time = parseInt(data.time) * 1000
      item.id = data.id
      item.hash = txstruct.hash
      item.provider = bech32.encode("micro", bech32.toWords(Buffer.from(payload.provider, "base64")))
      item.market = payload.market
      item.duration = payload.duration
      item.backing = convertCoinString(payload.backing, "backing").amount
      item.spot = convertCoinString(payload.spot, "spot").amount
      item.ask = convertCoinString(payload.ask, "premium").amount
      item.bid = convertCoinString(payload.bid, "premium").amount
      item.consensus = convertCoin(data.consensus, "1e18").amount
      item.commission = convertCoin(data.commission, "1e18").amount
      item.reward = convertCoin(data.reward, "1e6").amount
      item.adjustment = parseFloat(data.adjustment)
      break
    case "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxDepositQuote":
      data = codec.decode(PROTOBUF_MICROTICK_PACKAGE + ".DepositQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "deposit"
      item.time = parseInt(data.time) * 1000
      item.id = payload.id
      item.hash = txstruct.hash
      item.requester = bech32.encode("micro", bech32.toWords(Buffer.from(payload.requester, "base64")))
      item.market = data.market
      item.duration = data.duration
      item.deposit = convertCoinString(payload.deposit, "backing").amount
      item.consensus = convertCoin(data.consensus, "1e18").amount
      item.backing = convertCoin(data.backing, "1e18").amount
      item.commission = convertCoin(data.commission, "1e18").amount
      item.reward = convertCoin(data.reward, "1e6").amount
      item.adjustment = parseFloat(data.adjustment)
      break
    case "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxPickTrade":
      data = codec.decode(PROTOBUF_MICROTICK_PACKAGE + ".PickTradeData", Buffer.from(result.data, 'base64'), true)
      item.type = "pick"
      item.time = parseInt(data.time) * 1000
      item.hash = txstruct.hash
      item.taker = bech32.encode("micro", bech32.toWords(Buffer.from(payload.taker, "base64")))
      item.order = payload.orderType
      item.market = data.market
      item.duration = data.duration
      item.trade = convertTradeResultToObj(data.trade)
      item.consensus = convertCoin(data.consensus, "1e18").amount
      item.commission = convertCoin(data.commission, "1e18").amount
      item.reward = convertCoin(data.reward, "1e6").amount
      break
    case "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxSettleTrade":
      data = codec.decode(PROTOBUF_MICROTICK_PACKAGE + ".SettleTradeData", Buffer.from(result.data, 'base64'), true)
      item.type = "settle"
      item.time = parseInt(data.time) * 1000
      item.id = data.id
      item.hash = txstruct.hash
      item.settler = bech32.encode("micro", bech32.toWords(Buffer.from(data.settler, "base64")))
      item.settleConsensus = convertCoin(data.final, "1e18").amount
      item.incentive = convertCoin(data.incentive, "1e18").amount
      item.commission = convertCoin(data.commission, "1e18").amount
      item.reward = convertCoin(data.reward, "1e6").amount
      item.legs = data.legs.map(leg => {
        return {
          legId: leg.legId === undefined ? 0 : leg.legId,
          settleAccount: bech32.encode("micro", bech32.toWords(Buffer.from(leg.settleAccount, "base64"))),
          settle: convertCoin(leg.settle, "1e18").amount,
          refundAccount: bech32.encode("micro", bech32.toWords(Buffer.from(leg.refundAccount, "base64"))),
          refund: convertCoin(leg.refund, "1e18").amount
        }
      })
      break
    case "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxMarketTrade":
      data = codec.decode(PROTOBUF_MICROTICK_PACKAGE + ".MarketTradeData", Buffer.from(result.data, 'base64'), true)
      item.type = "trade"
      item.time = parseInt(data.time) * 1000
      item.hash = txstruct.hash
      item.taker = bech32.encode("micro", bech32.toWords(Buffer.from(payload.taker, "base64")))
      item.order = payload.orderType
      item.market = payload.market
      item.duration = payload.duration
      item.trade = convertTradeResultToObj(data.trade)
      item.consensus = convertCoin(data.consensus, "1e18").amount
      item.commission = convertCoin(data.commission, "1e18").amount
      item.reward = convertCoin(data.reward, "1e6").amount
      break
    case "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxUpdateQuote":
      data = codec.decode(PROTOBUF_MICROTICK_PACKAGE + ".UpdateQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "update"
      item.time = parseInt(data.time) * 1000
      item.id = payload.id
      item.hash = txstruct.hash
      item.requester = bech32.encode("micro", bech32.toWords(Buffer.from(payload.requester, "base64")))
      item.market = data.market
      item.duration = data.duration
      item.spot = convertCoinString(payload.newSpot, "spot").amount
      item.ask = convertCoinString(payload.newAsk, "premium").amount
      item.bid = convertCoinString(payload.newBid, "premium").amount
      item.consensus = convertCoin(data.consensus, "1e18").amount
      item.commission = convertCoin(data.commission, "1e18").amount
      item.reward = convertCoin(data.reward, "1e6").amount
      item.adjustment = parseFloat(data.adjustment)
      break
    case "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxWithdrawQuote":
      data = codec.decode(PROTOBUF_MICROTICK_PACKAGE + ".WithdrawQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "withdraw"
      item.time = parseInt(data.time) * 1000
      item.id = payload.id
      item.hash = txstruct.hash
      item.requester = bech32.encode("micro", bech32.toWords(Buffer.from(payload.requester, "base64")))
      item.market = data.market
      item.duration = data.duration
      item.withdraw = convertCoinString(payload.withdraw, "backing").amount
      item.consensus = convertCoin(data.consensus, "1e18").amount
      item.backing = convertCoin(data.backing, "1e18").amount
      item.commission = convertCoin(data.commission, "1e18").amount
      break
    }
    
    //console.log(JSON.stringify(txstruct, null, 2))
    //console.log(JSON.stringify(item, null, 2))
  
    if (item.consensus !== undefined) {
      // add tick
      if (USE_DATABASE) {
        db.insertTick(txstruct.height, item.time, item.market, item.consensus)
      }
      broadcastTick(item.market, {
        height: txstruct.height,
        hash: txstruct.hash,
        time: item.time,
        consensus: item.consensus
      })
    }
    
    if (item.type === "create") {
      if (USE_DATABASE) {
        db.insertQuote(txstruct.height, item.id, item.hash, item.provider, item.market, item.duration,
          item.spot, item.backing, item.ask, item.bid, item.commission, item.reward, item.adjustment)
      }
      sendAccountEvent(item.provider, "create", {
        hash: item.hash,
        quote: item.id,
        commission: item.commission,
        reward: item.reward,
        adjustment: item.adjustment
      })
    }
    
    if (item.type === "update") {
      if (USE_DATABASE) {
        db.updateQuoteParams(txstruct.height, item.id, item.hash, item.spot, item.ask, item.bid, 
          item.commission, item.reward, item.adjustment)
      }
      sendAccountEvent(item.requester, "update", {
        hash: item.hash,
        quote: item.id,
        commission: item.commission,
        reward: item.reward,
        adjustment: item.adjustment
      })
    }
    
    if (item.type === "trade" || item.type === "pick") {
      item.trade.legs.map(leg => {
        if (USE_DATABASE) {
          db.insertTrade(txstruct.height, item.trade.id, leg.legId, item.hash, item.market, item.duration,
            leg.type, item.trade.strike, item.trade.start, item.trade.expiration, leg.premium, leg.quantity,
            leg.cost, leg.backing, leg.long, leg.short)
          if (leg.final) {
            db.removeQuote(txstruct.height, item.hash, leg.quoteId, item.type, 0)
          } else {
            db.updateQuoteBacking(txstruct.height, leg.quoteId, item.hash, leg.remainBacking, item.type, 
              item.commission, item.reward, 1)
          }
        }
        sendAccountEvent(item.taker, "taker", {
          hash: item.hash,
          trade: item.trade.id,
          leg: leg.legId,
          commission: item.commission,
          reward: item.reward
        })
        if (leg.long === item.taker) {
          sendAccountEvent(leg.short, "maker", {
            hash: item.hash,
            trade: item.trade.id,
            leg: leg.legId,
            quote: leg.quoteId
          })
        } else {
          sendAccountEvent(leg.long, "maker", {
            hash: item.hash,
            trade: item.trade.id,
            leg: leg.legId,
            quote: leg.quoteId
          })
        }
      })
    }
    
    if (item.type === "settle") {
      item.legs.map(leg => {
        if (USE_DATABASE) {
          db.settleTrade(item.id, leg.legId, item.settleConsensus, leg.settle, leg.refund)
        }
        sendAccountEvent(leg.settleAccount, "settle", {
          hash: item.hash,
          trade: item.id,
          leg: leg.legId
        })
        sendAccountEvent(leg.refundAccount, "refund", {
          hash: item.hash,
          trade: item.id,
          leg: leg.legId
        })
      })
    }
    
    if (item.type === "deposit") {
      if (USE_DATABASE) {
        db.updateQuoteBacking(txstruct.height, item.id, item.hash, item.backing, item.type, item.commission,
          item.reward, item.adjustment)
      }
      sendAccountEvent(item.requester, "update", {
        hash: item.hash,
        quote: item.id,
        commission: item.commission,
        reward: item.reward,
        adjustment: item.adjustment
      })
    }
    
    if (item.type === "withdraw") {
      if (USE_DATABASE) {
        db.updateQuoteBacking(txstruct.height, item.id, item.hash, item.backing, item.type, item.commission,
          0, 0)
      }
      sendAccountEvent(item.requester, "update", {
        hash: item.hash,
        quote: item.id,
        commission: item.commission
      })
    }
    
    if (item.type === "cancel") {
      if (USE_DATABASE) {
        db.removeQuote(txstruct.height, item.hash, item.id, "cancel", item.commission)
      }
      sendAccountEvent(item.account, "cancel", {
        hash: item.hash,
        id: item.id,
        commission: item.commission
      })
    }
  }
}

const txlookup = {
  cancel: "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxCancelQuote",
  create: "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxCreateQuote",
  deposit: "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxDepositQuote",
  withdraw: "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxWithdrawQuote",
  update: "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxUpdateQuote",
  trade: "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxMarketTrade",
  pick: "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxPickTrade",
  settle: "/" + PROTOBUF_MICROTICK_PACKAGE + ".TxSettleTrade",
  transfer: "/ibc.applications.transfer.v1.MsgTransfer"
}

const publish = (type, payload, pubkey, sig, gas) => {
  const tx = {
    body: {
      messages: [],
    },
    authInfo: {
      signerInfos: [],
      fee: {
        gasLimit: {
          low: gas,
        }
      }
    }
  }
  
  // convert non_camel_case keys to camelCase (incompatibility in protobufjs library
  // that doesn't honor the gogoproto.jsontag attribute)
  function doRecursiveCamelCase(obj) {
    const keys = Object.keys(obj)
    keys.map(key => {
      const ary = key.split("_")
      if (ary.length > 1) {
        let camel = ary[0]
        for (var i=1; i<ary.length; i++) {
          const syllable = ary[i]
          camel = camel + syllable.substring(0, 1).toUpperCase() + syllable.substring(1)
        }
        //console.log("Substituting " + key + " with " + camel)
        obj[camel] = obj[key]
        delete obj[key]
        if (typeof obj[camel] === 'object') {
          doRecursiveCamelCase(obj[camel])
        }
      }
    })
  }
  doRecursiveCamelCase(payload)
  
  tx.body.messages.push(Object.assign({
    "@type": txlookup[type],
  }, payload))
  
  // add signer info
  const si = {
    publicKey: {
      '@type': "/cosmos.crypto.secp256k1.PubKey",
      key: pubkey
    },
    modeInfo: {
      single: {
        mode: "SIGN_MODE_LEGACY_AMINO_JSON"
      }
    }
  }
  tx.authInfo.signerInfos.push(si)

  // add signature
  tx.signatures = [ sig ]
  
  const txmsg = codec.create("cosmos.tx.v1beta1.Tx", tx)
  return txmsg.toString("base64")
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
    const subkeys = Object.keys(marketSubscriptions)
    for (var i=0; i<subkeys.length; i++) {
      const key = subkeys[i]
      marketSubscriptions[key] = marketSubscriptions[key].reduce((acc, subid) => {
        if (subid !== id) acc.push(subid)
        return acc
      }, [])
      if (marketSubscriptions[key].length === 0) {
        delete marketSubscriptions[key]
      }
    }
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
        //res = await queryTendermint('/abci_query?path="custom/microtick/params"')
        console.log("Incoming connection [" + env.id + "] account=" + env.acct)
        if (ids[env.acct] === undefined) {
          ids[env.acct] = []
        }
        ids[env.acct].push(env.id)
        return {
          status: true,
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
        
      // Queries
      case 'getblock':
        returnObj = {
          status: true,
          info: this.latestBlock
        }
        break
      case 'getparams':
        res = await queryRest("/microtick/params")
        returnObj = {
          status: true,
          info: {
            commissionCreatePerunit: parseFloat(res.commission_create_perunit),
            commissionUpdatePerunit: parseFloat(res.commission_update_perunit),
            commissionTradeFixed: parseFloat(res.commission_trade_fixed),
            commissionUpdatePerunit: parseFloat(res.commission_update_perunit),
            commissionSettleFixed: parseFloat(res.commission_settle_fixed),
            commissionCancelPerunit: parseFloat(res.commission_cancel_perunit),
            mintRewardCreatePerunit: parseFloat(res.mint_reward_create_perunit),
            mintRewardUpdatePerunit: parseFloat(res.mint_reward_update_perunit),
            mintRewardTradeFixed: parseFloat(res.mint_reward_trade_fixed),
            mintRewardSettleFixed: parseFloat(res.mint_reward_settle_fixed),
            settleIncentive: parseFloat(res.settle_incentive),
            mintRatio: parseFloat(res.mint_ratio),
            backingDenom: res.backing_denom
          }
        }
        break
      case 'getmarkets':
        res = await db.queryMarkets()
        returnObj = {
          status: true,
          info: res.map(m => {
            return {
              name: m.name,
              description: m.description
            }
          })
        }
        break
      case 'getacctinfo':
        const acct = payload.acct === undefined ? env.acct : payload.acct
        var url = "/microtick/account/" + acct
        var params = false
        if (payload.offset !== undefined) {
          url = url + "?offset=" + payload.offset
          params = true
        }
        if (payload.limit !== undefined) {
          if (params) {
            url = url + "&"
          } else {
            url = url + "?"
          }
          url = url + "limit=" + payload.limit
        }
        res = await queryRest(url)
        returnObj = {
          status: true,
          info: {
            account: res.account,
            balances: res.balances.reduce((acc, bal) => {
              acc[bal.denom] = parseFloat(bal.amount)
              return acc
            }, {}),
            placedQuotes: res.placed_quotes,
            placedTrades: res.placed_trades,
            activeQuotes: res.active_quotes,
            activeTrades: res.active_trades,
            quoteBacking: parseFloat(res.quote_backing.amount),
            tradeBacking: parseFloat(res.trade_backing.amount),
            settleBacking: parseFloat(res.settle_backing.amount)
          }
        }
        break
      case 'getmarketinfo':
        res = await queryRest("/microtick/market/" + payload.market)
        if (res.order_books === null) res.order_books = []
        returnObj = {
          status: true,
          info: {
            market: res.market,
            description: res.description,
            consensus: parseFloat(res.consensus.amount),
            totalBacking: parseFloat(res.total_backing.amount),
            totalWeight: parseFloat(res.total_weight.amount),
            orderBooks: res.order_books.map(ob => {
              return {
                name: ob.name,
                sumBacking: parseFloat(ob.sum_backing.amount),
                sumWeight: parseFloat(ob.sum_weight.amount),
                insideAsk: parseFloat(ob.inside_ask.amount),
                insideBid: parseFloat(ob.inside_bid.amount),
                insideCallAsk: parseFloat(ob.inside_call_ask.amount),
                insideCallBid: parseFloat(ob.inside_call_bid.amount),
                insidePutAsk: parseFloat(ob.inside_put_ask.amount),
                insidePutBid: parseFloat(ob.inside_put_bid.amount)
              }
            })
          }
        }
        break
      case 'getmarketspot':
        res = await queryRest("/microtick/consensus/" + payload.market)
        returnObj = {
          status: true,
          info: {
            market: res.market,
            consensus: parseFloat(res.consensus.amount),
            sumBacking: parseFloat(res.total_backing.amount),
            sumWeight: parseFloat(res.total_weight.amount)
          }
        }
        break
      case 'getorderbookinfo':
        url = "/microtick/orderbook/" + payload.market + "/" + payload.duration
        params = false
        if (payload.offset !== undefined) {
          url = url + "?offset=" + payload.offset
          params = true
        }
        if (payload.limit !== undefined) {
          if (params) {
            url = url + "&"
          } else {
            url = url + "?"
          }
          url = url + "limit=" + payload.limit
        }
        res = await queryRest(url)
        const quoteListParser = q => {
          return {
            id: q.id,
            premium: parseFloat(q.premium.amount),
            quantity: parseFloat(q.quantity.amount)
          }
        }
        returnObj = {
          status: true,
          info: {
            sumBacking: parseFloat(res.sum_backing.amount),
            sumWeight: parseFloat(res.sum_weight.amount),
            callAsks: res.call_asks.map(quoteListParser),
            putAsks: res.put_asks.map(quoteListParser),
            callBids: res.call_bids.map(quoteListParser),
            putBids: res.put_bids.map(quoteListParser)
          }
        }
        break
      case 'getsyntheticinfo':
        url = "/microtick/synthetic/" + payload.market + "/" + payload.duration
        params = false
        if (payload.offset !== undefined) {
          url = url + "?offset=" + payload.offset
          params = true
        }
        if (payload.limit !== undefined) {
          if (params) {
            url = url + "&"
          } else {
            url = url + "?"
          }
          url = url + "limit=" + payload.limit
        }
        res = await queryRest(url)
        const synListParser = q => {
          return {
            spot: parseFloat(q.spot.amount),
            quantity: parseFloat(q.quantity.amount)
          }
        }
        returnObj = {
          status: true,
          info: {
            consensus: parseFloat(res.consensus.amount),
            sumBacking: parseFloat(res.sum_backing.amount),
            sumWeight: parseFloat(res.sum_weight.amount),
            asks: res.asks.map(synListParser),
            bids: res.bids.map(synListParser),
          }
        }
        break
      case 'getlivequote':
        res = await queryRest("/microtick/quote/" + payload.id)
        returnObj = {
          status: true,
          info: {
            id: res.id,
            provider: res.provider,
            market: res.market,
            duration: res.duration,
            backing: parseFloat(res.backing.amount),
            ask: parseFloat(res.ask.amount),
            bid: parseFloat(res.bid.amount),
            quantity: parseFloat(res.quantity.amount),
            consensus: parseFloat(res.consensus.amount),
            spot: parseFloat(res.spot.amount),
            callAsk: parseFloat(res.call_ask.amount),
            callBid: parseFloat(res.call_bid.amount),
            putAsk: parseFloat(res.put_ask.amount),
            putBid: parseFloat(res.put_bid.amount),
            modified: res.modified * 1000,
            canModify: res.can_modify * 1000
          }
        }
        break
      case 'getlivetrade':
        res = await queryRest("/microtick/trade/" + payload.id)
        returnObj = {
          status: true,
          info: {
            id: res.id,
            market: res.market,
            duration: res.duration,
            order: res.order,
            taker: res.taker,
            quantity: parseFloat(res.quantity.amount),
            start: res.start * 1000,
            expiration: res.expiration * 1000,
            strike: parseFloat(res.strike.amount),
            currentSpot: parseFloat(res.consensus.amount),
            currentValue: parseFloat(res.current_value),
            commission: parseFloat(res.commission.amount),
            settleIncentive: parseFloat(res.settle_incentive.amount),
            legs: res.legs.map(leg => {
              return {
                leg_id: leg.leg_id,
                type: leg.type,
                backing: parseFloat(leg.backing.amount),
                premium: parseFloat(leg.premium.amount),
                quantity: parseFloat(leg.quantity.amount),
                cost: parseFloat(leg.cost.amount),
                long: leg.long,
                short: leg.short,
                quoted: {
                  id: leg.quoted.id,
                  premium: parseFloat(leg.quoted.premium.amount),
                  spot: parseFloat(leg.quoted.spot.amount)
                }
              }
            })
          }
        }
        break
        
      /*
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
        */
      case 'accountsync':
        if (USE_DATABASE) {
          console.log("Sync requested: " + env.acct + " " + payload.startblock + ":" + payload.endblock)
          /*
          res = await db.queryAccountHistory(env.acct, payload.startblock, payload.endblock)
          res.map(ev => {
            sendAccountEvent(env.acct, ev.type, ev.data)
          })
          */
          returnObj = {
            status: true
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
        
      // Transactions
      
      case 'getauthinfo':
        // get the account number, sequence number
        res = await queryRest("/auth/accounts/" + payload.acct)
        return {
          status: true,
          info: {
            chainid: chainid,
            account: res.value.account_number,
            sequence: res.value.sequence !== undefined ? res.value.sequence : 0
          }
        }
        
      case 'posttx':
        const publishTx = publish(payload.type, payload.tx, payload.pubkey, payload.sig, payload.gas)
        res = await new Promise(async (outerResolve, outerReject) => {
          const pendingTx = {
            sequence: payload.sequence,
            submitted: false,
            submit: async (acct) => {
              if (pendingTx.submitted) return
              try {
                console.log("  Posting [" + env.id + "] TX " + payload.type)
                pendingTx.submitted = true

                const tendermint = payload.chainid !== undefined ? chainid_mapping[payload.chainid].tendermint : config.tendermint
                const res = await axios.post('http://' + tendermint, {
                  jsonrpc: "2.0",
                  id: 1,
                  method: "broadcast_tx_commit",
                  params: {
                    tx: publishTx
                  }
                }, {
                  headers: {
                    "Content-Type": "text/json"
                  }
                })
  
                if (res.data.result.check_tx.code !== 0) {
                  // error
                  outerReject(new Error(res.data.result.check_tx.log))
                  console.error("  outer posttx promise failed: " + res.data.result.check_tx.log)
                  return
                }
                if (LOG_TX) console.log("  hash=" + shortHash(res.data.result.hash))
                
                if (payload.chainid === undefined) {
                  // if posted to the native microtick chain, wait for block with tx results
                  // and return that
                  const txres = await new Promise((resolve, reject) => {
                    const obj = {
                      success: txres => {
                        resolve(txres)
                      },
                      failure: err => {
                        console.error("  posttx transaction failed: " + err)
                        reject(err)
                      },
                      timedout: false,
                    }
                    setTimeout(() => {obj.timedout = true}, TXTIMEOUT)
                    pending[res.data.result.hash] = obj
                  })
                  outerResolve(txres)
                } else {
                  // if posted to some other chain, it's IBC so just return the tx hash
                  outerResolve({
                    hash: res.data.result.hash
                  })
                }
              } catch (err) {
                console.error("TX failed: " + acct + " sequence: " + payload.sequence)
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
          info: res
        }
      
      // IBC
        
      case 'getibcinfo':
        const info = await collectIBCEndpoints(payload.pubkey)
        returnObj = {
          status: true,
          info: info
        }
        break
    }
    
    // Save query in cache
    cache[hash] = returnObj
    return returnObj
    
  } catch (err) {
    if (err !== undefined) {
      if (config.development) {
        console.error(err)
      } else {
        console.error("API error: " + name + ": " + err.message)
      }
    }
    return {
      status: false,
      error: err.message === undefined ? "Request failed" : err.message
    }
  }
}

const collectIBCEndpoints = async pubkey => {
  const pubKeyBytes = Buffer.from(pubkey, 'base64')
  const enc = cryptojs.enc.Hex.parse(sha256(pubKeyBytes).toString('hex'))
  const hash = ripemd160(enc).toString()
  const address = Buffer.from(hash, `hex`)
  const words = bech32.toWords(address) 
  
  const endpoints = []
  
  for (var i=0; i<config.ibc.length; i++) {
    const endpoint = config.ibc[i]
    const address = bech32.encode(endpoint.prefix, words)
    
    //console.log(endpoint.name + ": " + address)
    let ep = {
      name: endpoint.name,
      address: address
    }
    
    // Define denominations
    if (endpoint.incoming !== undefined) {
      ep.incoming = endpoint.incoming
      const denoms = endpoint.incoming_denom.split(":")
      const ratio = endpoint.incoming_ratio.split(":")
      ep.backingHere = "ibc/" + sha256("transfer/" + endpoint.incoming + "/" + denoms[0]).toUpperCase()
      ep.backingThere = denoms[0]
      ep.backingRatio = parseInt(ratio[0]) / parseInt(ratio[1])
    }
    
    if (endpoint.outgoing !== undefined) {
      ep.outgoing = endpoint.outgoing
      ep.tickThere = "ibc/" + sha256("transfer/" + endpoint.outgoing + "/stake").toUpperCase()
    }
    
    // Fetch balances (if chain is online)
    // If chain is offline, don't push it to array
    try {
      const gen = await queryTendermint("/genesis", endpoint.tendermint)
      ep.chainid = gen.genesis.chain_id
        
      if (chainid_mapping[ep.chainid] === undefined) {
        // So we cache how to posttx IBC transfers from this chain, if necessary
        chainid_mapping[ep.chainid] = {
          tendermint: endpoint.tendermint,
          rest: endpoint.rest
        }
      }
        
      const status = await queryTendermint("/status", endpoint.tendermint)
      const auth = await queryRest("/auth/accounts/" + address, endpoint.rest)
      const bal = await queryRest("/bank/balances/" + address, endpoint.rest)
      
      ep.blocktime = Date.parse(status.sync_info.latest_block_time)
      ep.blockheight = parseInt(status.sync_info.latest_block_height)
      ep.account = auth.value.account_number === undefined ? -1 : parseInt(auth.value.account_number)
      ep.sequence = auth.value.sequence === undefined ? 0 : parseInt(auth.value.sequence)
        
      if (endpoint.incoming !== undefined) {
        ep.backingBalance = bal.reduce((acc, b) => {
        console.log(b.denom + " " + ep.backingThere + " " + ep.backingRatio)
          if (b.denom === ep.backingThere) {
            const coin = convertCoin(b, ep.backingRatio)
            acc = coin.amount
          }
          return acc
        }, 0)
      }
      
      if (endpoint.outgoing !== undefined) {
        ep.tickBalance = bal.reduce((acc, b) => {
          if (b.denom === ep.tickThere) {
            const coin = convertCoin(b, "1e6")
            acc = coin.amount
          }
          return acc
        }, 0)
      }
        
      endpoints.push(ep)
    } catch (err) {
      // no error, just not online so don't push
    }
  }
  
  return endpoints
}
