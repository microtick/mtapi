const wallet = require('./wallet')
const axios = require('axios')
const WebSocketClient = require('websocket').w3cwebsocket

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
        return txres
      } catch (err) {
        //console.log("cosmosPostTx: " + JSON.stringify(msg, null, 2))
        if (err.response !== undefined) {
          throw new Error("Cosmos post failed: " + err.response.data.message)
        }
        throw new Error("Cosmos post failed: " + err.message)
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
                const json = JSON.parse(Buffer.from(data.result.data, 'base64').toString())
                const event = Object.assign({
                  block: parseInt(data.height, 10),
                  event: query[0],
                  value: query[1].replace(/(^')|('$)/g, ''),
                  /*
                  tags: data.result.tags.map(tag => {
                    return {
                      key: Buffer.from(tag.key, 'base64').toString(),
                      value: Buffer.from(tag.value, 'base64').toString()
                    }
                  })
                  */
                }, json)
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
            const oldClient = obj.client
            if (Object.keys(obj.subscriptions).length > 0) {
              console.log("Reopening websocket...")
              setTimeout(() => {
                obj.client = new WebSocketClient(obj.ws)
                obj.client.onerror = oldClient.onerror
                obj.client.onclose = oldClient.onclose
                obj.client.onmessage = oldClient.onmessage
                obj.client.onopen = function() {
                  Object.keys(obj.subscriptions).map(key => {
                    console.log("Resubscribing: " + key)
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
    //console.log("Pending Txs: " + hashes.length)
    if (hashes.length > 25) {
      console.log("Warning: " + hashes.length + " pending Txs")
    }
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
    try {
      const url = "/microtick/createmarket/" + this.wallet.cosmosAddress + "/" + market
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Create market failed: " + err.message)
    }
  }
  
  async createQuote(market, dur, backing, spot, premium) {
    try {
      const url = "/microtick/createquote/" + this.wallet.cosmosAddress + "/" + market +
        "/" + dur + "/" + backing + "fox/" + spot + "spot/" + premium + "premium"
      const msg = await this.cosmosQuery(url)
      const res = await this.cosmosPostTx(msg)
      const id = res.tx_result.tags.reduce((acc, t) => {
        if (t.key === 'mtm.NewQuote') {
          return parseInt(t.value, 10)
        }
        return acc
      }, null)
      return id
    } catch (err) {
      console.log("Create quote failed: " + err.message)
    }
  }
  
  async cancelQuote(id) {
    try {
      const url = "/microtick/cancelquote/" + this.wallet.cosmosAddress + "/" + id
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Cancel quote failed: " + err.message)
    }
  }
  
  async depositQuote(id, amount) {
    try {
      const url = "/microtick/depositquote/" + this.wallet.cosmosAddress + "/" + id + "/" + amount + "fox"
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Deposit quote failed: " + err.message)
    }
  }
  
  async updateQuote(id, spot, premium) {
    try {
      const url = "/microtick/updatequote/" + this.wallet.cosmosAddress + "/" + id + "/" + spot + "spot/" + premium + "premium"
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Update quote failed: " + err.message)
    }
  }
  
  async marketTrade(market, duration, tradetype, quantity) {
    try {
      const url = "/microtick/markettrade/" + this.wallet.cosmosAddress + "/" + market + "/" + duration + "/" + tradetype + "/" + quantity + "quantity"
      const msg = await this.cosmosQuery(url)
      const res = await this.cosmosPostTx(msg)
      const id = res.tx_result.tags.reduce((acc, t) => {
        if (t.key === 'mtm.NewTrade') {
          return parseInt(t.value, 10)
        }
        return acc
      }, null)
      return id
    } catch (err) {
      console.log("Market trade failed: " + err.message)
    }
  }
  
  async limitTrade(market, duration, tradetype, maxpremium, maxcost) {
    try {
      const url = "/microtick/limittrade/" + this.wallet.cosmosAddress + "/" + market + "/" + duration + "/" + tradetype + 
        "/" + maxpremium + "premium/" + maxcost + "fox"
      console.log("url=" + url)
      const msg = await this.cosmosQuery(url)
      const res = await this.cosmosPostTx(msg)
      const id = res.tx_result.tags.reduce((acc, t) => {
        if (t.key === 'mtm.NewTrade') {
          return parseInt(t.value, 10)
        }
        return acc
      }, null)
      return id
    } catch (err) {
      console.log("Limit trade failed: " + err.message)
    }
  }
  
  async settleTrade(id) {
    try {
      const url = "/microtick/settletrade/" + this.wallet.cosmosAddress + "/" + id
      const msg = await this.cosmosQuery(url)
      await this.cosmosPostTx(msg)
    } catch (err) {
      console.log("Settle trade failed: " + err.message)
    }
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
  
  async getTrade(id) {
    const res = await this.cosmosQuery("/microtick/trade/" + id)
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
  
  async history(query, fromBlock, toBlock) {
    if (fromBlock < 0) fromBlock = 0
    const baseurl = this.tm + "/tx_search?query=\"" + query + " AND tx.height>" + fromBlock + " AND tx.height<" + toBlock + "\""
    var page = 0
    var count = 0
    const perPage = 100
    const history = []
    var total_count = 0
    try {
      do {
        page++
        const url = baseurl + "&page=" + page + "&per_page=" + perPage
        //console.log("url=" + url)
    
        const res = await axios.get(url)
        //console.log("res=" + JSON.stringify(res, null, 2))
        //console.log("date=" + res.headers.date)
        
        total_count = res.data.result.total_count
        //console.log("count=" + count + " total_count=" + total_count)
        
        const txs = res.data.result.txs
        //console.log("txs=" + JSON.stringify(txs, null, 2))
        //console.log("txs.length=" + txs.length)
        
        for (var i=0; i<txs.length; i++) {
          const tx = txs[i] 
          const height = parseInt(tx.height, 10)
          
          var data = {}
          data.tags = []
          if (tx.tx_result.data !== undefined) {
            const json = JSON.parse(Buffer.from(tx.tx_result.data, "base64"))
            data = Object.assign(data, json)
          }
          /*
          if (tx.tx_result.tags !== undefined) {
            tx.tx_result.tags.map(tag => {
              data.tags.push({
                key: Buffer.from(tag.key, "base64").toString(),
                value: Buffer.from(tag.value, "base64").toString()
              })
            })
          }
          */
          data.block = height
          data.index = count++
          history.push(data)
        } 
        
      } while (count < total_count)
      return history
      
    } catch (err) {
      console.log("Error in fetching history: " + err.message)
      return null
    }
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

module.exports = (tm, cosmos, faucet) => {
  return new API(tm, cosmos, faucet)
}
