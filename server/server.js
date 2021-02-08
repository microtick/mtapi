const fs = require('fs')
const https = require('https')
const ws = require('ws')
const axios = require('axios')
const objecthash = require('object-hash')
const crypto = require('crypto')
const bech32 = require('bech32')
const BN = require('bignumber.js')

const protocol = require('../lib/protocol.js')
const codec = require('../proto/index.js')
const config = JSON.parse(fs.readFileSync('./config.json'))

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
  process.exit(-1)
})

// Transactions
const NEWBLOCK = "tm.event='NewBlock'"
const TXTIMEOUT = config.timeout
const pending = {}

const globals = {
  account_cache: {}
}

// ABCI calls to Tendermint and REST

const queryTendermint = async url => {
  const query = "http://" + config.tendermint + url
  const res = await axios.get(query)
  return res.data.result
}

const queryRest = async url => {
  const query = "http://" + config.rest + url
  const res = await axios.get(query)
  return res.data.result
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
      console.log("  Event New Block => [" + id + "]")
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
      console.log("  Event Market Tick: " + market + " => ["+ id + "]")
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
        console.log("  Account Event: " + event + " => [" + id + "]")
        client.send(msg)
      }
    })
  }
}

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
    throw new Error(res.data.result.response.log)
  }
  const buf = Buffer.from(res.data.result.response.value, 'base64')
  return codec.decode("cosmos.auth.v1beta1.QueryAccountResponse", buf, true)
}

const updateAccountBalance = async (height, hash, acct, denom, amount) => {
  if (globals.account_cache[acct] === undefined) {
    let res = await queryAuthAccount(acct)
    if (res.account["@type"] === "/cosmos.auth.v1beta1.ModuleAccount") {
      globals.account_cache[acct] = {
        name: res.account.name,
        module: true
      }
    } else {
      globals.account_cache[acct] = {
        name: res.account.address,
        module: false
      }
    }
  }
  if (USE_DATABASE) {
    if (hash.startsWith("lookup")) {
      const value = hash.split(":")
      const lookup = value[1]
      if (globals.account_cache[lookup] === undefined) {
        let res = await queryAuthAccount(acct)
        if (res.account["@type"] === "/cosmos.auth.v1beta1.ModuleAccount") {
          globals.account_cache[acct] = {
            name: res.account.name,
            module: true
          }
          hash = res.account.name
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
    
  // Check pending Tx hashes
  const hashes = Object.keys(pending)
  console.log(hashes.length + " Pending TXs")

  processing = false
}

const processBlock = async (height) => {
  
  // handle genesis markets and accounts -> DB
  if (USE_DATABASE && height === 1) {
    globals.genesis.app_state.microtick.markets.map(async m => {
      await db.insertMarket(m)
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
  console.log("Block " + block.height + ": txs=" + num_txs)
  if (!syncing) {
    dump_subscriptions()
  }
  
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
          
          //console.log(JSON.stringify(txstruct, null, 2))
          //console.log(JSON.stringify(txr, null, 2))
          
          // Update account balances from any transfers
          txstruct.transfers.map(async transfer => {
            if (!syncing && LOG_TRANSFERS) {
              txlog += "\n  " + transfer.amount + " " + transfer.sender + " -> " + transfer.recipient
            }
            if (USE_DATABASE) {
              transfer.amount.split(",").map(async amt => {
                const coin = convertCoinString(amt)
                await updateAccountBalance(height, hash, transfer.sender, coin.denom, -1 * coin.amount)
                await updateAccountBalance(height, hash, transfer.recipient, coin.denom, coin.amount)
              })
            }
          })
          
          //console.log("Result " + txstruct.module + " / " + txstruct.action + ": hash=" + shortHash(hash))
          if (txstruct.events.module === "microtick") {
            await processMicrotickTx(block, txstruct)
          } 
          if (txstruct.events.module === "governance") {
            txstruct.tx.body.messages.map(msg => {
              switch (msg.type_url) {
                case "/cosmos.gov.v1beta1.MsgSubmitProposal":
                  const proposal = codec.decode(msg.type_url.slice(1), Buffer.from(msg.value, 'base64'), true)
                  switch (proposal.content["@type"]) {
                    case '/microtick.msg.DenomChangeProposal':
                      console.log("Denom change: " + proposal.content.extDenom + " ratio: " + proposal.content.extPerInt)
                      break
                    case '/microtick.msg.AddMarketsProposal':
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
          console.log(err)
          console.log("UNKNOWN TX TYPE")
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
      if (USE_DATABASE) {
        obj.amount.split(",").map(async amt => {
          const coin = convertCoinString(amt)
          await updateAccountBalance(height, "lookup:" + obj.recipient, obj.sender, coin.denom, -1 * coin.amount)
          await updateAccountBalance(height, "lookup:" + obj.sender, obj.recipient, coin.denom, coin.amount)
        })
      }
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
  
  if (!syncing) {
    console.log("Events:")
    broadcastBlock({
      height: block.height,
      time: block.time,
      hash: block.block.header.last_block_id.hash,
      chainid: chainid
    })
  }
  
  if (USE_DATABASE) {
    await db.insertBlock(block.height, block.time)
  }
}

const convertTradeResultToObj = trade => {
  const obj = {}
  obj.id = trade.id
  obj.quantity = convertCoin(trade.quantity, "1e18").amount
  obj.start = trade.start
  obj.expiration = trade.expiration
  obj.strike = convertCoin(trade.strike, "1e18").amount
  obj.commission = convertCoin(trade.commission, "1e18").amount
  obj.settleIncentive = convertCoin(trade.settleIncentive, "1e18").amount
  obj.legs = trade.legsList.map(leg => {
    return {
      legId: leg.legId,
      type: leg.type ? "call" : "put",
      backing: convertCoin(leg.backing, "1e18").amount,
      premium: convertCoin(leg.premium, "1e18").amount,
      cost: convertCoin(leg.cost, "1e18").amount,
      quantity: convertCoin(leg.quantity, "1e18").amount,
      long: bech32.encode("micro", bech32.toWords(Buffer.from(leg.pb_long, "base64"))),
      short: bech32.encode("micro", bech32.toWords(Buffer.from(leg.pb_short, "base64"))),
      quoteId: leg.quoted.id,
      remainBacking: convertCoin(leg.quoted.remainBacking, "1e18").amount,
      final: leg.quoted.pb_final
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
    case "/microtick.msg.TxCancelQuote":
      var data = codec.decode("microtick.msg.CancelQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "cancel"
      item.time = data.time
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
    case "/microtick.msg.TxCreateQuote":
      data = codec.decode("microtick.msg.CreateQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "create"
      item.time = data.time
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
      break
    case "/microtick.msg.TxDepositQuote":
      data = codec.decode("microtick.msg.DepositQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "deposit"
      item.time = data.time
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
      break
    case "/microtick.msg.TxPickTrade":
      data = codec.decode("microtick.msg.PickTradeData", Buffer.from(result.data, 'base64'), true)
      item.type = "pick"
      item.time = data.time
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
    case "/microtick.msg.TxSettleTrade":
      data = codec.decode("microtick.msg.SettleTradeData", Buffer.from(result.data, 'base64'), true)
      item.type = "settle"
      item.time = data.time
      item.id = data.id
      item.hash = txstruct.hash
      item.settler = bech32.encode("micro", bech32.toWords(Buffer.from(data.settler, "base64")))
      item.settleConsensus = convertCoin(data.pb_final, "1e18").amount
      item.incentive = convertCoin(data.incentive, "1e18").amount
      item.commission = convertCoin(data.commission, "1e18").amount
      item.reward = convertCoin(data.reward, "1e6").amount
      item.legs = data.legsList.map(leg => {
        return {
          legId: leg.legId,
          settleAccount: bech32.encode("micro", bech32.toWords(Buffer.from(leg.settleAccount, "base64"))),
          settle: convertCoin(leg.settle, "1e18").amount,
          refundAccount: bech32.encode("micro", bech32.toWords(Buffer.from(leg.refundAccount, "base64"))),
          refund: convertCoin(leg.refund, "1e18").amount
        }
      })
      break
    case "/microtick.msg.TxMarketTrade":
      data = codec.decode("microtick.msg.MarketTradeData", Buffer.from(result.data, 'base64'), true)
      item.type = "trade"
      item.time = data.time
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
    case "/microtick.msg.TxUpdateQuote":
      data = codec.decode("microtick.msg.UpdateQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "update"
      item.time = data.time
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
      break
    case "/microtick.msg.TxWithdrawQuote":
      data = codec.decode("microtick.msg.WithdrawQuoteData", Buffer.from(result.data, 'base64'), true)
      item.type = "withdraw"
      item.time = data.time
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
    console.log(JSON.stringify(item, null, 2))
  
    if (item.consensus !== undefined) {
      // add tick
      if (USE_DATABASE) {
        db.insertTick(txstruct.height, item.time, item.market, item.consensus)
      }
      broadcastTick(item.market, {
        height: txstruct.height,
        time: item.time,
        consensus: item.consensus
      })
    }
    
    if (item.type === "create") {
      if (USE_DATABASE) {
        db.insertQuote(txstruct.height, item.id, item.hash, item.provider, item.market, item.duration,
          item.spot, item.backing, item.ask, item.bid)
      }
      sendAccountEvent(item.provider, "create", {
        hash: item.hash,
        quote: item.id
      })
    }
    
    if (item.type === "trade" || item.type === "pick") {
      item.trade.legs.map(leg => {
        if (USE_DATABASE) {
          db.insertTrade(txstruct.height, item.trade.id, leg.legId, item.hash, item.market, item.duration,
            leg.type, item.trade.strike, item.trade.start, item.trade.expiration, leg.premium, leg.backing, 
            leg.quantity, leg.long, leg.short)
          if (leg.final) {
            db.removeQuote(leg.quoteId)
          } else {
            db.updateQuoteBacking(leg.quoteId, item.hash, leg.remainBacking)
          }
        }
        sendAccountEvent(item.taker, "taker", {
          hash: item.hash,
          trade: item.trade.id,
          leg: leg.legId
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
    
    if (item.type === "update") {
      if (USE_DATABASE) {
        db.updateQuoteParams(item.id, item.hash, item.spot, item.ask, item.bid)
      }
      sendAccountEvent(item.requester, "update", {
        hash: item.hash,
        quote: item.id
      })
    }
    
    if (item.type === "deposit" || item.type === "withdraw") {
      if (USE_DATABASE) {
        db.updateQuoteBacking(item.id, item.hash, item.backing)
      }
      sendAccountEvent(item.requester, "update", {
        hash: item.hash,
        quote: item.id
      })
    }
    
    if (item.type === "cancel") {
      if (USE_DATABASE) {
        db.removeQuote(item.id)
      }
      sendAccountEvent(item.account, "cancel", {
        hash: item.hash,
        id: item.id
      })
    }
  }
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
      case 'getparams':
        res = await queryRest("/microtick/params")
        returnObj = {
          status: true,
          info: {
            commissionQuotePercent: parseFloat(res.commission_quote_percent),
            commissionTradeFixed: parseFloat(res.commission_trade_fixed),
            commissionUpdatePercent: parseFloat(res.commission_update_percent),
            commissionSettleFixed: parseFloat(res.commission_settle_fixed),
            commissionCancelPercent: parseFloat(res.commission_cancel_percent),
            settleIncentive: parseFloat(res.settle_incentive),
            mintRatio: parseFloat(res.mint_ratio),
            backingDenom: res.backing_denom
          }
        }
        break
      case 'getacctinfo':
        const acct = payload.acct === undefined ? env.acct : payload.acct
        res = await queryRest("/microtick/account/" + acct)
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
        res = await queryRest("/microtick/orderbook/" + payload.market + "/" + payload.duration)
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
        res = await queryRest("/microtick/synthetic/" + payload.market + "/" + payload.duration)
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
        */
        
      // Transactions
      
      case 'getauthinfo':
        // get the account number, sequence number
        res = await queryAuthAccount(payload.acct)
        return {
          status: true,
          info: {
            chainid: chainid,
            account: res.account.accountNumber,
            sequence: res.account.sequence !== undefined ? res.account.sequenct : 0
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
                console.log("Posting [" + env.id + "] TX " + payload.type)
                console.log(payload.tx)
                pendingTx.submitted = true

/*
  const auth = await codec.query('/cosmos.auth.v1beta1.QueryAccountRequest', '/cosmos.auth.v1beta1.QueryAccountResponse', async raw => {
    raw.setAddress(acct)
    const data = {
      jsonrpc: "2.0",
      id: 0,
      method: "abci_query",
      params: {
        data: Buffer.from(raw.serializeBinary()).toString('hex'),
        height: "0",
        path: "/cosmos.auth.v1beta1.Query/Account",
        prove: false
      }
    }
    const res = await axios.post("http://" + config.tendermint, data)
    if (res.data.result.response.code !== 0) {
      throw new Error(res.data.result.response.log)
    }
    return res.data.result.response.value
  })
  */
  console.log(Buffer.from(payload.tx, 'base64').toString('hex'))
                
                const res = await axios.post('http://' + config.tendermint, {
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
                console.log(JSON.stringify(res.data, null, 2))
  
                if (res.data.result.check_tx.code !== 0) {
                  // error
                  outerReject(new Error(res.data.result.check_tx.log))
                  console.log("  outer post failed: " + res.data.result.check_tx.log)
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
                      console.log("  transaction failed: " + err)
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
    
    // Save query in cache
    cache[hash] = returnObj
    return returnObj
    
  } catch (err) {
    console.log("API error: " + name + ": " + err.message)
    if (config.development) {
      console.log(err)
    }
    if (err !== undefined) console.log(err)
    return {
      status: false,
      error: err.message === undefined ? "Request failed" : err.message
    }
  }
}
