const ws = require('ws')
const protocol = require('../lib/protocol.js')
const axios = require('axios')
const { marshalTx, unmarshalTx } = require('./amino.js')

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
const historyCache = {}

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
        return {
          status: true,
          block: parseInt(res.sync_info.latest_block_height, 10),
          timestamp: Math.floor(new Date(res.sync_info.latest_block_time).getTime() / 1000)
        }
      case 'getblock':
        res = await queryTendermint('/block?height=' + payload.blockNumber)
        return {
          status: true,
          block: res.block_meta
        }
      case 'getacctinfo':
        res = await queryCosmos('/microtick/account/' + payload.acct)
        return {
          status: true,
          info: res
        }
      case 'getmarketinfo':
        res = await queryCosmos('/microtick/market/' + payload.market)
        return {
          status: true,
          info: res
        }
      case 'getorderbookinfo':
        res = await queryCosmos('/microtick/orderbook/' + payload.market + "/" + 
          payload.duration)
        return {
          status: true,
          info: res
        }
      case 'getmarketspot':
        res = await queryCosmos('/microtick/consensus/' + payload.market)
        return {
          status: true,
          info: res
        }
      case 'getquote':
        res = await queryCosmos('/microtick/quote/' + payload.id)
        return {
          status: true,
          info: res
        }
      case 'gettrade':
        res = await queryCosmos('/microtick/trade/' + payload.id)
        return {
          status: true,
          info: res
        }
      case 'history':
        res = await doHistory(payload.query, payload.from, payload.to, payload.tags)
        return {
          status: true,
          history: res
        }
      case 'totalevents':
        res = await queryTendermint("/tx_search?query=\"acct." + env.acct + 
          " CONTAINS '.'\"&page=1&per_page=1")
        return {
          status: true,
          total: res.total_count
        }
      case 'pagehistory':
        res = await pageHistory(env.acct, payload.page, payload.inc)
        return {
          status: true,
          history: res
        }
      case 'createmarket':
        res = await queryCosmos("/microtick/generate/createmarket/" + 
          env.acct + "/" + payload.market)
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
  
  if (fromBlock < 0) fromBlock = 0
  if (historyCache[query] === undefined) {
    historyCache[query] = {
      startBlock: Number.MAX_VALUE,
      endBlock: 0,
      data: [],
      hit: {}
    }
  }
  const cache = historyCache[query]
  
  const baseurl = "/tx_search?query=\"" + query + " AND tx.height>" + fromBlock + " AND tx.height<" + toBlock + "\""
  try {
    do {
      page++
      const url = baseurl + "&page=" + page + "&per_page=" + perPage
  
      const start = Date.now()
      console.log("query=" + url)
      const res = await queryTendermint(url)
      const end = Date.now()
      console.log("done: " + (end - start) + "ms")
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
        /*
        if (!cache.hit[data.hash]) {
          cache.hit[data.hash] = true
          cache.data.push(data)
          cache.data.sort((a, b) => {
            if (a.block === b.block) return a.txindex - b.txindex
            return a.block - b.block
          })
          if (data.block < cache.startBlock) cache.startBlock = data.block
          if (data.block > cache.endBlock) cache.endBlock = data.block
        }
        */
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
