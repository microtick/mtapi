const WebSocketClient = require('websocket').w3cwebsocket
const wallet = require('./wallet.js')
const protocol = require('./protocol.js')

const NEWBLOCKKEY = "tm.event='NewBlock'"

var client
const connectServer = (url, onOpen, onMessage) => {
  
  client = new WebSocketClient(url)
  
  client.onopen = () => {
    console.log("Server connected")
    if (onOpen !== undefined) {
      onOpen(client)
    }
  }
  
  client.onmessage = msg => {
    onMessage(msg.data)
  }
  
  client.onclose = () => {
    console.log("Server disconnected")
    setTimeout(() => {
      connectServer(url, onOpen, onMessage)
    }, 1000)
  }
  
  client.onerror = err => {
    //console.log("Server error")
  }
    
}

class API {
    
  constructor(url) {
    this.url = url
    
    this.subscriptions = {}
    this.subid = 0
    this.submap = {}
    
    this.protocol = new protocol(240000, async (env, name, payload) => {
      return await this.handleMessage(env, name, payload)
    }, (env, name, payload) => {
      //console.log("Event: " + name)
      //console.log(JSON.stringify(payload, null, 2))
      const tags = {}
      if (name === "tm.event='NewBlock'") {
        var data = payload
      } else {
        data = JSON.parse(Buffer.from(payload.data.value.TxResult.result.data, 'base64').toString())
        data.block = payload.data.value.TxResult.height
        payload.data.value.TxResult.result.tags.map(tag => {
          const key = Buffer.from(tag.key, 'base64').toString()
          tags[key] = Buffer.from(tag.value, 'base64').toString()
          return null
        })
      }
      if (this.subscriptions[name] !== undefined) {
        this.subscriptions[name] = this.subscriptions[name].reduce((acc, id) => {
          if (this.submap[id] !== undefined) {
            this.submap[id].cb(data, tags)
            acc.push(id)
          }
          return acc
        }, [])
      }
    }, str => {
      client.send(str)
    })
    
    this.durationFromSeconds = seconds => {
      switch (seconds) {
        case 300: return "5minute"
        case 900: return "15minute"
        case 3600: return "1hour"
        case 14400: return "4hour"
        case 43200: return "12hour"
      }
      throw new Error("Unknown duration")
    }
    
    this.secondsFromDuration = dur => {
      switch (dur) {
        case "5minute": return 300
        case "15minute": return 900
        case "1hour": return 3600
        case "4hour": return 14400
        case "12hour": return 43200
      }
    }
  
  }
  
  async handleMessage(env, name, payload) {
    console.log("handleMessage")
  }
  
  async init(keys) {
    // If keys passed in, use them, otherwise generate new account
    if (keys === undefined) {
      console.log("Creating wallet")
      this.wallet = await wallet.generate()
    } else {
      console.log("Using wallet: " + keys.acct)
      this.wallet = {
        privateKey: keys.priv,
        publicKey: keys.pub,
        cosmosAddress: keys.acct
      }
    }
    
    await new Promise((resolve, reject) => {
      connectServer(this.url, async client => {
        this.client = client
        const response = await this.protocol.newMessage('connect', {
          acct: this.wallet.cosmosAddress
        })
        if (!response.status) {
          reject()
          throw new Error("Connect failed")
        }
        resolve()
      }, async msg => {
        const response = await this.protocol.process(null, msg)
        if (response !== undefined) {
          client.send(response)
        }
      })
    })
    
    // Wait connection
    await new Promise(res => {
      setInterval(() => {
        if (this.client !== undefined) {
          res()
        }
      }, 100)
    })
  }
  
  async getWallet() {
    return {
      pub: this.wallet.publicKey,
      priv: this.wallet.privateKey,
      acct: this.wallet.cosmosAddress
    }
  }
  
  async subscribe(key, cb) {
    const response = await this.protocol.newMessage('subscribe', {
      key: key
    })
    if (!response.status) {
      throw new Error("Subscription failed: " + response.error)
    }
    const id = this.subid++
    this.submap[id] = {
      key: key,
      cb: cb
    }
    if (this.subscriptions[key] === undefined) {
      this.subscriptions[key] = []
    }
    this.subscriptions[key].push(id)
    return id
  }
  
  async unsubscribe(id) {
    if (this.submap[id] === undefined) return
    const key = this.submap[id].key
    delete this.submap[id]
    this.subscriptions[key] = this.subscriptions[key].reduce((acc, thisid) => {
      if (thisid !== id) {
        acc.push(id)
      }
      return acc
    }, [])
    if (this.subscriptions[key].length === 0) {
      const response = await this.protocol.newMessage('unsubscribe', {
        key: key
      })
      if (!response.status) {
        throw new Error("Unsubscribe failed: " + response.error)
      }
    }
  }
  
  async blockInfo() {
    const response = await this.protocol.newMessage('blockinfo')
    if (!response.status) {
      throw new Error("Status request failed: " + response.error)
    }
    return response
  }
  
  async getBlock(blockNumber) {
    const response = await this.protocol.newMessage('getblock', {
      blockNumber: blockNumber
    })
    if (!response.status) {
      throw new Error("Get block failed: " + response.error)
    }
    return response.block
  }
  
  async getAccountInfo(acct) {
    const response = await this.protocol.newMessage('getacctinfo', {
      acct: acct
    })
    if (!response.status) {
      throw new Error("Get account info failed: " + response.error)
    }
    return response.info
  }
  
  async getMarketInfo(market) {
    const response = await this.protocol.newMessage('getmarketinfo', {
      market: market
    })
    if (!response.status) {
      throw new Error("Get market info failed: " + response.error)
    }
    return response.info
  }
  
  async getOrderbookInfo(market, dur) {
    const response = await this.protocol.newMessage('getorderbookinfo', {
      market: market,
      duration: dur
    })
    if (!response.status) {
      throw new Error("Get order book info failed: " + response.error)
    }
    return response.info
  }
  
  async getMarketSpot(market) {
    const response = await this.protocol.newMessage('getmarketspot', {
      market: market
    })
    if (!response.status) {
      throw new Error("Get market spot failed: " + response.error)
    }
    return response.info
  }
  
  async getQuote(id) {
    const response = await this.protocol.newMessage('getquote', {
      id: id
    })
    if (!response.status) {
      throw new Error("Get quote failed: " + response.error)
    }
    return response.info
  }
  
  async canModify(id) {
    const res = await this.getQuote(id)
    const now = Date.now()
    const canModify = Date.parse(res.canModify)
    if (now >= canModify) {
      return true
    }
    return false
  }
  
  async getTrade(id) {
    const response = await this.protocol.newMessage('gettrade', {
      id: id
    })
    if (!response.status) {
      throw new Error("Get trade failed: " + response.error)
    }
    return response.info
  }
  
  async history(query, fromBlock, toBlock, whichTags) {
    if (fromBlock < 0) fromBlock = 0
    if (toBlock < fromBlock) toBlock = fromBlock
    const response = await this.protocol.newMessage('history', {
      query: query,
      from: fromBlock,
      to: toBlock,
      tags: whichTags
    })
    if (!response.status) {
      throw new Error("Get history failed: " + response.error)
    }
    return response.history
  }
  
  async totalEvents(acct) {
    const response = await this.protocol.newMessage('totalevents', {})
    if (!response.status) {
      throw new Error("Get total events failed: " + response.error)
    }
    return response.total
  }
  
  async pageHistory(acct, page, inc) {
    const response = await this.protocol.newMessage('pagehistory', {
      page: page,
      inc: inc
    })
    if (!response.status) {
      throw new Error("Get page history failed: " + response.error)
    }
    return response.history
  }
  
  async marketHistory(market, startblock, endblock, target) {
    const response = await this.protocol.newMessage('markethistory', {
      market: market,
      startblock: startblock,
      endblock: endblock,
      target: target
    })
    if (!response.status) {
      throw new Error("Get market history failed: " + response.error)
    }
    return response.history
  }
  
  // Transactions
  
  async postTx(msg) {
    const signed = wallet.sign(msg.tx, this.wallet, {
      sequence: msg.sequence,
      account_number: msg.accountNumber,
      chain_id: msg.chainId
    })
    const res = await this.protocol.newMessage('posttx', {
      tx: signed
    })
    //console.log("res=" + JSON.stringify(res, null, 2))
    if (!res.status) {
      throw new Error("Post Tx failed: " + res.error)
    }
    return res.info
  }
  
  async createMarket(market) {
    const data = await this.protocol.newMessage('createmarket', {
      market: market
    })
    if (!data.status) {
      throw new Error("Create market failed: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async createQuote(market, duration, backing, spot, premium) {
    const data = await this.protocol.newMessage('createquote', {
      market: market,
      duration: duration,
      backing: backing,
      spot: spot,
      premium: premium
    })
    if (!data.status) {
      throw new Error("Create quote failed: " + data.error)
    }
    return await this.postTx(data.msg) 
  }
  
  async cancelQuote(id) {
    const data = await this.protocol.newMessage('cancelquote', {
      id: id
    })
    if (!data.status) {
      throw new Error("Cancel quote failed: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async depositQuote(id, deposit) {
    const data = await this.protocol.newMessage('depositquote', {
      id: id,
      deposit: deposit
    })
    if (!data.status) {
      throw new Error("Deposit quote failed: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async updateQuote(id, newspot, newpremium) {
    const data = await this.protocol.newMessage('updatequote', {
      id: id,
      newspot: newspot,
      newpremium: newpremium
    })
    if (!data.status) {
      throw new Error("Update quote failed: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async marketTrade(market, duration, tradetype, quantity) {
    const data = await this.protocol.newMessage('markettrade', {
      market: market,
      duration: duration,
      tradetype: tradetype,
      quantity: quantity
    })
    if (!data.status) {
      throw new Error("Market trade failed: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async limitTrade(market, duration, tradetype, limit, maxcost) {
    const data = await this.protocol.newMessage('limittrade', {
      market: market,
      duration: duration,
      tradetype: tradetype,
      limit: limit,
      maxcost: maxcost
    })
    if (!data.status) {
      throw new Error("Limit trade failed: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async settleTrade(id) {
    const data = await this.protocol.newMessage('settletrade', {
      id: id
    })
    if (!data.status) {
      throw new Error("Settle trade failed: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
}

module.exports = API
/*
async (ws, keys) => {
  const api = new API(ws)
  await api.init(keys)
  await api.subscribe(NEWBLOCKKEY, payload => {
    console.log("New block: " + payload.height.value.block.header.height + " " + payload.height.value.block.header.time) 
  })
  return api
}
*/
