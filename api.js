const wallet = require('./wallet')
const axios = require('axios')
const WebSocketClient = require('websocket').w3cwebsocket

/*
class Mutex {
 
  constructor() {
    this.promise = Promise.resolve()
  }
 
  async lock() {
    const cur = this.promise
    var unlock
    console.log("1")
    await new Promise(outerResolve => {
      this.promise = new Promise(innerResolve => {
        unlock = () => {
          console.log("2")
          innerResolve()
        }
        console.log("3")
        outerResolve()
      })
    })
    console.log("4")
    await cur
    console.log("5")
    return unlock
  }
  
}
*/

class API {
  
  constructor(tendermint, cosmos, faucet) {
    this.pending = {}
    this.tm = tendermint
    this.ws = this.tm.replace("http:", "ws:") + "/websocket"
    this.cosmos = cosmos
    this.faucet = faucet
    this.durationLookup = {
      "5minute": 300,
      "15minute": 900,
      "1hour": 3600,
      "4hour": 14400,
      "12hour": 43200
    }
    this.durationReverseLookup = {
      300: "5minute",
      900: "15minute",
      3600: "1hour",
      14400: "4hour",
      43200: "12hour"
    }
    
    this.cosmosQuery = async function(url) {
      const query = this.cosmos + url
      try {
        const res = await axios.get(query)
        return res.data
      } catch (err) {
        //console.log("Cosmos query: " + query)
        var errmsg = ""
        if (err.response !== undefined) {
          errmsg = ": " + err.response.data.message
        }
        console.log(err.stack)
        throw new Error("Cosmos query failed" + errmsg)
      }
    }
    
    this.cosmosPostTx = async function(msg) {
      //console.log("cosmosPostTx: " + JSON.stringify(msg, null, 2))
      try {
        const signed = wallet.sign(msg.tx, this.wallet, {
          sequence: msg.sequence,
          account_number: msg.accountNumber,
          chain_id: msg.chainId
        })
        //console.log(JSON.stringify(signed))
        const res = await axios.post(this.cosmos + "/microtick/broadcast", {
          tx: JSON.stringify(signed)
        })
        //console.log(JSON.stringify(res.data))
        //console.log("TX hash=" + res.data.txhash)
        const txres = await new Promise((resolve, reject) => {
          this.pending[res.data.txhash] = {
            success: txres => {
              //console.log("Success")
              resolve(txres)
            },
            failure: err => {
              //console.log("Failure")
              reject(err)
            }
          }
        })
        //console.log("txres=" + JSON.stringify(txres, null, 2))
        return txres
      } catch (err) {
        //console.log("cosmosPostTx: " + JSON.stringify(msg, null, 2))
        if (err.response !== undefined) {
          throw new Error("Cosmos post failed: " + err.response.data.message)
        }
        throw new Error("Cosmos post failed: " + err.message)
      }
    }
    
    this.search = async function(query, page, perPage) {
      const str = this.tm + "/tx_search?query=\"" + query + "\"&page=" + page + "&per_page=" + perPage
      //console.log("str=" + str)
      try {
        const res = await axios.get(str)
        return res.data.result
      } catch (err) {
        return null
      }
    }
    
    this.status = async function() {
      try {
        const res = await axios.get(this.tm + "/status")
        return res.data.result
      } catch (err) {
        return null
      }
    }
    
    this.client = null
    this.subscriptions = {}
    this.subids = {}
    this.sub_id = 0
    
    this.connect = async function(query, cb) {
      const obj = this
      
      // create client if necessary
      if (obj.client === null) {
        await new Promise((res, rej) => {
          //console.log("Opening websocket...")
          obj.client = new WebSocketClient(this.ws)
          
          obj.client.onerror = function() {
            console.log("Connection error")
            rej()
          }
          
          obj.client.onopen = function() {
            //console.log("Websocket client connected")
            res()
          }
          
          obj.client.onmessage = function(msg) {
            const tmpdata = JSON.parse(msg.data)
            if (tmpdata === undefined || tmpdata.error) {
              console.log("Error: " + tmpdata.error.data)
              return
            }
            if (tmpdata.result.query !== undefined) {
              if (tmpdata.result.data !== undefined && tmpdata.result.data.value.TxResult !== undefined) {
                const query = tmpdata.result.query.split('=')
                const data = tmpdata.result.data.value.TxResult
                const event = {
                  height: parseInt(data.height, 10),
                  event: query[0],
                  value: query[1].replace(/(^')|('$)/g, ''),
                  data: JSON.parse(Buffer.from(data.result.data, 'base64').toString()),
                  tags: data.result.tags.map(tag => {
                    return {
                      key: Buffer.from(tag.key, 'base64').toString(),
                      value: Buffer.from(tag.value, 'base64').toString()
                    }
                  })
                }
                obj.subscriptions[tmpdata.result.query].map(cb => {
                  cb.callback(event)
                  return false
                })
              } else {
                obj.subscriptions[tmpdata.result.query].map(cb => {
                  cb.callback(tmpdata.result.data)
                  return false
                })
              }
            }
          }
          
          obj.client.onclose = function() {
            if (Object.keys(obj.subscriptions).length > 0) {
              //console.log("Reopening websocket...")
              setTimeout(() => {
                obj.client = new WebSocketClient(this.ws)
                obj.client.onerror = this.onerror
                obj.client.onclose = this.onclose
                obj.client.onmessage = this.onmessage
                obj.client.onopen = function() {
                  Object.keys(obj.subscriptions).map(key => {
                    //console.log("Resubscribing: " + key)
                    const req = {
                      "jsonrpc": "2.0",
                      "method": "subscribe",
                      "id": "0",
                      "params": {
                        "query": key
                      }
                    }
                    obj.client.send(JSON.stringify(req))
                    return false
                  })
                }
              }, 5000)
            }
          }
          
        })
      }
      
      const next_id = this.sub_id++
      if (obj.subscriptions[query] === undefined) {
        obj.subscriptions[query] = []
      }
      if (obj.subscriptions[query].length === 0) {
        //console.log("API subscribing: " + query)
        const req = {
          "jsonrpc": "2.0",
          "method": "subscribe",
          "id": "0",
          "params": {
            "query": query
          }
        }
        obj.client.send(JSON.stringify(req))
      }
      obj.subscriptions[query].push({
        id: next_id,
        callback: cb
      })
      obj.subids[next_id] = query
      return next_id
    }
    
  }
  
  init() {
    this.connect("tm.event='NewBlock'", this.blockHandler.bind(this))
  }
  
  async blockHandler() {
    //console.log("API block handler")
    const hashes = Object.keys(this.pending)
    console.log("Pending Txs: " + hashes.length)
    hashes.map(async el => {
      const url = "/tx?hash=0x" + el
      //console.log("URL=" + url)
      const res = await axios.get(this.tm + url)
      //console.log("res=" + JSON.stringify(res.data))
      if (res.data.error !== undefined) {
        this.pending[el].failure(res.data.error)
      } else if (res.data.result !== undefined) {
        this.pending[el].success(res.data.result)
      }
      delete this.pending[el]
    })
  }
  
  async blockInfo() {
    try {
      const res = await axios.get(this.tm + '/status')
      return {
        block: parseInt(res.data.result.sync_info.latest_block_height, 10),
        timestamp: Math.floor(new Date(res.data.result.sync_info.latest_block_time).getTime() / 1000)
      }
    } catch (err) {
      throw new Error("Block number request failed")
    }
  }
  
  async getBlock(blockNumber) {
    try {
      const query = this.tm + "/block?height=" + blockNumber
      const res = await axios.get(query)
      return res.data.result.block_meta
    } catch (err) {
      throw new Error("Block request failed")
    }
  }
  
  async generateWallet() {
    this.wallet = await wallet.generate()
    return {
      pub: this.wallet.publicKey,
      priv: this.wallet.privateKey,
      acct: this.wallet.cosmosAddress
    }
  }
  
  async createAccount(keys) {
    this.wallet = {
      privateKey: keys.priv,
      publicKey: keys.pub,
      cosmosAddress: keys.acct
    }
    try {
      await axios.get(this.faucet + "/" + this.wallet.cosmosAddress)
    } catch (err) {
      throw new Error("Unable to connect to faucet")
    }
  }
  
  async getAccountInfo(acct) {
    const res = await this.cosmosQuery("/microtick/account/" + acct)
    return res
  }
  
  async createMarket(market) {
    //const unlock = await this.mutex.lock()
    try {
      const url = "/microtick/createmarket/" + this.wallet.cosmosAddress + "/" + market
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Create market failed: " + err.message)
    }
    //unlock()
  }
  
  async createQuote(market, dur, backing, spot, premium) {
    //const unlock = await this.mutex.lock()
    try {
      const url = "/microtick/createquote/" + this.wallet.cosmosAddress + "/" + market +
        "/" + dur + "/" + backing + "fox/" + spot + "spot/" + premium + "premium"
      const msg = await this.cosmosQuery(url)
      const res = await this.cosmosPostTx(msg)
      const id = res.tx_result.tags.reduce((acc, t) => {
        if (t.key === 'mtm.NewQuote') {
          return t.value
        }
        return acc
      }, null)
      //unlock()
      return id
    } catch (err) {
      console.log("Create quote failed: " + err.message)
    }
    //unlock()
  }
  
  async cancelQuote(id) {
    //const unlock = await this.mutex.lock()
    try {
      const url = "/microtick/cancelquote/" + this.wallet.cosmosAddress + "/" + id
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Cancel quote failed: " + err.message)
    }
    //unlock()
  }
  
  async depositQuote(id, amount) {
    //const unlock = await this.mutex.lock()
    try {
      const url = "/microtick/depositquote/" + this.wallet.cosmosAddress + "/" + id + "/" + amount + "fox"
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Deposit quote failed: " + err.message)
    }
    //unlock()
  }
  
  async updateQuote(id, spot, premium) {
    //const unlock = await this.mutex.lock()
    try {
      const url = "/microtick/updatequote/" + this.wallet.cosmosAddress + "/" + id + "/" + spot + "spot/" + premium + "premium"
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Update quote failed: " + err.message)
    }
    //unlock()
  }
  
  async marketTrade(market, duration, tradetype, quantity) {
    //const unlock = await this.mutex.lock()
    try {
      const url = "/microtick/markettrade/" + this.wallet.cosmosAddress + "/" + market + "/" + duration + "/" + tradetype + "/" + quantity
      const msg = await this.cosmosQuery(url)
      const res = await this.cosmosPostTx(msg)
      const id = res.tx_result.tags.reduce((acc, t) => {
        if (t.key === 'mtm.NewTrade') {
          return t.value
        }
        return acc
      }, null)
      //unlock()
      return id
    } catch (err) {
      console.log("Market trade failed: " + err.message)
    }
    //unlock()
  }
  
  async limitTrade(market, duration, tradetype, maxpremium) {
    //const unlock = await this.mutex.lock()
    try {
      const url = "/microtick/limittrade/" + this.wallet.cosmosAddress + "/" + market + "/" + duration + "/" + tradetype + "/" + maxpremium
      const msg = await this.cosmosQuery(url)
      const res = await this.cosmosPostTx(msg)
      const id = res.tx_result.tags.reduce((acc, t) => {
        if (t.key === 'mtm.NewTrade') {
          return t.value
        }
        return acc
      }, null)
      //unlock()
      return id
    } catch (err) {
      console.log("Limit trade failed: " + err.message)
    }
    //unlock()
  }
  
  async settleTrade(id) {
    //const unlock= await this.mutex.lock()
    try {
      const url = "/microtick/settletrade/" + this.wallet.cosmosAddress + "/" + id
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Settle trade failed: " + err.message)
    }
    //unlock()
  }
  
  async getMarketInfo(market) {
    const res = await this.cosmosQuery("/microtick/market/" + market)
    return res
  }
  
  async getOrderbookInfo(market, dur) {
    const res = await this.cosmosQuery("/microtick/orderbook/" + market + "/" + dur)
    return res
  }
  
  async getMarketSpot(market) {
    const res = await this.cosmosQuery("/microtick/consensus/" + market)
    return res
  }
  
  async getQuote(id) {
    const res = await this.cosmosQuery("/microtick/quote/" + id) 
    if (res !== undefined) {
      res.dur = this.durationLookup[res.duration]
    }
    return res
  }
  
  async canModify(id) {
    const res = await this.cosmosQuery("/microtick/quote/" + id)
    const now = Date.now()
    const canModify = Date.parse(res.canModify)
    //console.log("now=" + now)
    //console.log("canModify=" + canModify)
    //console.log(now - canModify)
    if (now >= canModify) {
      return true
    }
    return false
  }
  
  async history(query, fromBlock, toBlock, includeLast) {
    /*
    const str = this.tm + "/tx_search?query=\"" + query + "\"&page=" + page + "&per_page=" + perPage
    
    /tx_search?query="tx.height > 10 AND tx.height < 20"
    
    try {
      const res = await axios.get(str)
      return res.data.result
    } catch (err) {
      return null
    }
    */
    
    // get total txs
    var res = await this.search(query, 0, 1)
    if (res === null) return []
    const total = parseInt(res.total_count, 10)
    if (total === 0) return []
    res = await this.status()
    var lo = 0
    var hi = res.sync_info.latest_block_height
    while (hi-lo > 1) {
      //console.log("lo=" + lo + " hi=" + hi)
      var mid = Math.floor((hi + lo) / 2)
      res = await this.search(query, mid, 1)
      var test = parseInt(res.txs[0].height, 10)
      if (test >= fromBlock) {
        hi = mid
      } else {
        lo = mid
      }
    }
    const first = lo
    // load transactions
    const history = []
    var height = fromBlock
    var index = first
    const pageSize = 100
    var last = null
    do {
      //console.log("index=" + index)
      const page = Math.floor(index / pageSize) + 1  // 1 based
      index = (page-1) * pageSize
      //console.log("page=" + page)
      res = await this.search(query, page, pageSize)
      res.txs = res.txs.sort((x1, x2) => {
        const h1 = parseInt(x1.height, 10)
        const h2 = parseInt(x2.height, 10)
        if (h1 > h2) return 1
        if (h1 < h2) return -1
        if (x1.index > x2.index) return 1
        if (x1.index < x2.index) return -1
        return 0
      })
      //console.log("res.length=" + res.txs.length)
      for (var i=0; i<res.txs.length; i++) {
        const tx = res.txs[i] 
        height = parseInt(tx.height, 10)
        if (includeLast && height < fromBlock) {
          last = JSON.parse(Buffer.from(tx.tx_result.data, "base64"))
          last.block = height
          last.index = (page-1) * pageSize + i
        }
        if (height >= fromBlock && height <= toBlock) {
          var data = {}
          data.tags = []
          if (tx.tx_result.data !== undefined) {
            data = Object.assign(data, JSON.parse(Buffer.from(tx.tx_result.data, "base64")))
          }
          if (tx.tx_result.tags !== undefined) {
            tx.tx_result.tags.map(tag => {
              data.tags.push({
                key: Buffer.from(tag.key, "base64").toString(),
                value: Buffer.from(tag.value, "base64").toString()
              })
            })
          }
          data.block = height
          data.index = (page-1) * pageSize + i
          if (includeLast && last !== null) {
            history.push(last)
            last = null
          }
          history.push(data)
        }
      }
      index += pageSize
      if (index > total) index = total
    } while (height < toBlock && index < total)
    return history
  }
  
  async subscribe(query, cb) {
    return await this.connect(query, cb)
  }
  
  async unsubscribe(id) {
    const query = this.subids[id]
    if (query !== undefined && this.subscriptions[query] !== undefined) {
      this.subscriptions[query] = this.subscriptions[query].filter(sub => {
        if (sub.id === id) return false
        return true
      })
      if (this.subscriptions[query].length === 0) {
        console.log("API unsubscribing: " + query)
        const req = {
          "jsonrpc": "2.0",
          "method": "unsubscribe",
          "id": "0",
          "params": {
            "query": query
          }
        }
        this.client.send(JSON.stringify(req))
      }
    }
    delete this.subids[id]
  }
  
}

/*
async function main() {
  const localWallet = await wallet.generate()
  console.log("Created wallet: " + localWallet.cosmosAddress)
  //const url = "microtick/createmarket/cosmos1qlzp94qve0np3du8k43epfc532rxwclxen0pnu/ETHUSD"
  try {
    // fund account
    console.log("Requesting funds...")
    await axios.get('http://localhost:3000/' + localWallet.cosmosAddress)
    
    // generate transaction
    const url = "microtick/createmarket/" + localWallet.cosmosAddress + "/TEST5"
    const res = await axios.get('http://localhost:1317/' + url)
    const msg = res.data
    console.log("unsigned=" + JSON.stringify(msg))
    
    const signed = wallet.sign(msg.tx, localWallet, {
      sequence: msg.sequence,
      account_number: msg.accountNumber,
      chain_id: msg.chainId
    })
    console.log(JSON.stringify(signed))
    
    // broadcast
    const broadurl = "microtick/broadcast"
    const res2 = await axios.post('http://localhost:1317/' + broadurl, {
      tx: JSON.stringify(signed)
    }) 
    console.log(res2.data)
  } catch (err) {
    console.log(err.message)
  }
}

main()
*/

module.exports = (tm, cosmos, faucet) => {
  return new API(tm, cosmos, faucet)
}
