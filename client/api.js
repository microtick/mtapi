const WebSocketClient = require('websocket').w3cwebsocket
const wallet = require('./wallet.js')
const protocol = require('./protocol.js')

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
    this.blockHandlers = []
    this.tickHandlers = []
    this.accountHandlers = []
    
    this.protocol = new protocol(240000, async (env, name, payload) => {
      return await this.handleMessage(env, name, payload)
    }, async (env, msg) => {
      if (msg.type === 'block') {
        for (var i=0; i<this.blockHandlers.length; i++) {
          const handler = this.blockHandlers[i] 
          await handler(msg.payload)
        }
      } else if (msg.type === 'tick') {
        //console.log("Event: " + name)
        //console.log(JSON.stringify(payload, null, 2))
        if (this.subscriptions[msg.name] === undefined) {
          console.log("Warning: no subscription for tick: " + msg.name)
        } else {
          for (i=0; i<this.tickHandlers.length; i++) {
            const handler = this.tickHandlers[i]
            await handler(msg.name, msg.payload)
          }
        }
      } else if (msg.type === 'account') {
        for (i=0; i<this.accountHandlers.length; i++) {
          const handler = this.accountHandlers[i]
          await handler(msg.name, msg.payload)
        }
      }
    }, str => {
      try {
        client.send(str)
      } catch (err) {
        console.log("Send: " + err.message)
      }
    })
    
    this.durationFromSeconds = seconds => {
      switch (seconds) {
        case 300: return "5minute"
        case 600: return "10minute"
        case 900: return "15minute"
        case 1800: return "30minute"
        case 3600: return "1hour"
        case 7200: return "2hour"
        case 14400: return "4hour"
        case 28800: return "4hour"
        case 43200: return "12hour"
        case 86400: return "1day"
      }
      throw new Error("Unknown duration")
    }
    
    this.secondsFromDuration = dur => {
      switch (dur) {
        case "5minute": return 300
        case "10minute": return 600
        case "15minute": return 900
        case "30minute": return 1800
        case "1hour": return 3600
        case "2hour": return 7200
        case "4hour": return 14400
        case "8hour": return 28800
        case "12hour": return 43200
        case "1day": return 86400
      }
    }
  
  }
  
  addBlockHandler(handler) {
    this.blockHandlers.push(handler)
  }
  
  addTickHandler(handler) {
    this.tickHandlers.push(handler)
  }
  
  addAccountHandler(handler) {
    this.accountHandlers.push(handler)
  }
  
  async handleMessage(env, name, payload) {
    console.log("handleMessage")
  }
  
  async init(keys, cb) {
    // If keys passed in, use them, otherwise generate new account
    if (keys === "software") {
      console.log("Creating wallet")
      const mnemonic = await wallet.seed()
      if (typeof cb === "function") cb(mnemonic)
      this.wallet = await wallet.generate(mnemonic)
      this.wallet.type = "software"
    } else if (keys === "ledger") {
      this.getApp = cb
      const app = await this.getApp()
      const path = [44, 118, 0, 0, 0]
      const response = await app.getAddressAndPubKey(path, "micro")
      if (response.return_code !== 0x9000) {
        throw new Error("Ledger initialization failed")
      }
      this.wallet = {
        type: "ledger",
        publicKey: response.compressed_pk.toString('hex'),
        cosmosAddress: response.bech32_address,
      }
    } else if (Array.isArray(keys)) {
      const mnemonic = keys.join(" ")
      this.wallet = await wallet.generate(mnemonic)
      this.wallet.type = "software"
    } else {
      console.log("Using wallet: " + keys.acct)
      this.wallet = {
        type: "software",
        privateKey: keys.priv,
        publicKey: keys.pub,
        cosmosAddress: keys.acct
      }
    }
    
    const api = this
    await new Promise((resolve, reject) => {
      connectServer(this.url, async client => {
        this.client = client
        const response = await this.protocol.newMessage('connect', {
          acct: this.wallet.cosmosAddress
        })
        if (!response.status) {
          reject()
          throw new Error("Connect: " + response.error)
        }
        api.markets = response.markets
        api.durations = response.durations
        Object.keys(this.subscriptions).map(async key => {
          if (this.subscriptions[key] > 0) {
            this.subscriptions[key]--
            console.log("Resubscribing: " + key)
            await this.subscribe(key)
          }
        })
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
    
    return {
      type: this.wallet.type,
      acct: this.wallet.cosmosAddress,
      pub: this.wallet.publicKey,
      priv: this.wallet.privateKey
    }
  }
  
  async getWallet() {
    return {
      type: this.wallet.type,
      acct: this.wallet.cosmosAddress,
      pub: this.wallet.publicKey,
      priv: this.wallet.privateKey
    }
  }
  
  getMarkets() {
    return this.markets
  }
  
  getDurations() {
    return this.durations
  }
  
  async subscribe(key) {
    const response = await this.protocol.newMessage('subscribe', {
      key: key
    })
    if (!response.status) {
      throw new Error("Subscription: " + response.error)
    }
    if (this.subscriptions[key] === undefined) {
      this.subscriptions[key] = 0
    }
    this.subscriptions[key]++
  }
  
  async unsubscribe(key) {
    if (this.subscriptions[key] === undefined) return
    this.subscriptions[key]--
    if (this.subscriptions[key] <= 0) {
      if (this.subscriptions[key] < 0) {
        console.log("Warning: mismatched subscribe / unsubscribe: " + key)
      }
      this.subscriptions[key] = 0
      const response = await this.protocol.newMessage('unsubscribe', {
        key: key
      })
      if (!response.status) {
        throw new Error("Unsubscribe: " + response.error)
      }
    }
  }
  
  async blockInfo() {
    const response = await this.protocol.newMessage('blockinfo')
    if (!response.status) {
      throw new Error("Status request: " + response.error)
    }
    return response
  }
  
  async getAccountInfo(acct) {
    const response = await this.protocol.newMessage('getacctinfo', {
      acct: acct
    })
    if (!response.status) {
      throw new Error("Get account info: " + response.error)
    }
    return response.info
  }
  
  async getStake(acct) {
    const response = await this.protocol.newMessage('getstake', {
      acct: acct
    })
    if (!response.status) {
      throw new Error("Get stake: " + response.error)
    }
    return response.info
  }
  
  async getAccountPerformance(acct, start, end) {
    const response = await this.protocol.newMessage('getacctperf', {
      acct: acct,
      start: start,
      end: end
    })
    if (!response.status) {
      throw new Error("Get account performance: " + response.error)
    }
    return response.info
  }
  
  async getMarketInfo(market) {
    const response = await this.protocol.newMessage('getmarketinfo', {
      market: market
    })
    if (!response.status) {
      throw new Error("Get market info: " + response.error)
    }
    return response.info
  }
  
  async getOrderbookInfo(market, dur) {
    const response = await this.protocol.newMessage('getorderbookinfo', {
      market: market,
      duration: dur
    })
    if (!response.status) {
      throw new Error("Get order book info: " + response.error)
    }
    return response.info
  }
  
  async getMarketSpot(market) {
    const response = await this.protocol.newMessage('getmarketspot', {
      market: market
    })
    if (!response.status) {
      throw new Error("Get market spot: " + response.error)
    }
    return response.info
  }
  
  async getLiveQuote(id) {
    const response = await this.protocol.newMessage('getlivequote', {
      id: id
    })
    if (!response.status) {
      throw new Error("Get live quote: " + response.error)
    }
    return response.info
  }
  
  async canModify(id) {
    const res = await this.getLiveQuote(id)
    if (Date.now() >= res.canModify) {
      return true
    }
    return false
  }
  
  async getLiveTrade(id) {
    const response = await this.protocol.newMessage('getlivetrade', {
      id: id
    })
    if (!response.status) {
      throw new Error("Get live trade: " + response.error)
    }
    return response.info
  }
  
  async getHistoricalQuote(id, startBlock, endBlock) {
    const response = await this.protocol.newMessage('gethistquote', {
      id: id,
      startBlock: startBlock,
      endBlock: endBlock
    })
    if (!response.status) {
      throw new Error("Get historical quote: " + response.error)
    }
    return response.info
  }
  
  async getHistoricalTrade(id) {
    const response = await this.protocol.newMessage('gethisttrade', {
      id: id
    })
    if (!response.status) {
      throw new Error("Get historical trade: " + response.error)
    }
    return response.info
  }
  
  async accountSync(startblock, endblock) {
    const response = await this.protocol.newMessage('accountsync', {
      startblock: startblock,
      endblock: endblock
    })
    if (!response.status) {
      throw new Error("Account sync: " + response.error)
    }
    return response.history
  }
  
  async accountLedgerSize() {
    const response = await this.protocol.newMessage('accountledgersize')
    if (!response.status) {
      throw new Error("Get account ledger size: " + response.error)
    }
    return response.total
  }
  
  async accountLedger(page, perPage) {
    const response = await this.protocol.newMessage('accountledger', {
      page: page,
      perPage: perPage
    })
    if (!response.status) {
      throw new Error("Get account ledger: " + response.error)
    }
    return response.page
  }
  
  async marketHistory(market, startblock, endblock, target) {
    const response = await this.protocol.newMessage('markethistory', {
      market: market,
      startblock: startblock,
      endblock: endblock,
      target: target
    })
    if (!response.status) {
      throw new Error("Get market history: " + response.error)
    }
    return response.history
  }
  
  // Transactions
  
  async postTx(msg) {
    if (this.wallet.type === "ledger") {
      const app = await this.getApp()
      const path = [44, 118, 0, 0, 0]
      const message = wallet.prepare(msg.tx, msg.sequence, msg.accountNumber, msg.chainId)
      const response = await app.sign(path, message)
      if (response.return_code !== 0x9000) {
        throw new Error("Ledger transaction rejected")
      }
      var signature = response.signature
      var sigBuf = Buffer.from(response.signature)
      if (sigBuf[0] !== 0x30) {
        throw new Error("ASN: invalid encoding")
      }
      sigBuf = sigBuf.slice(2, sigBuf[1] + 2)
      if (sigBuf[0] !== 0x02) {
        throw new Error("ASN: invalid encoding")
      }
      var r = sigBuf.slice(2, sigBuf[1] + 2)
      if (r.length === 33) r = r.slice(1) // remove sign byte
      const sIndex = sigBuf[1] + 2
      if (sigBuf[sIndex] !== 2) {
        throw new Error("ASN: invalid encoding")
      }
      var s = sigBuf.slice(sIndex+2, sIndex + sigBuf[sIndex+1] + 2)
      if (s.length === 33) s = s.slice(1) // remove sign byte
      sigBuf = Buffer.concat([r, s])
      const aminokey = Buffer.from("eb5ae98721" + this.wallet.publicKey, "hex")
      var signed = {
        type: "cosmos-sdk/StdTx",
        value: Object.assign({}, msg.tx, {
          signatures: [{
            signature: sigBuf.toString('base64'),
            pub_key: aminokey.toString('base64')
          }]
        })
      }
    } else {
      signed = wallet.sign(msg.tx, this.wallet, {
        sequence: msg.sequence,
        account_number: msg.accountNumber,
        chain_id: msg.chainId
      })
    }
    const res = await this.protocol.newMessage('posttx', {
      tx: signed,
      sequence: msg.sequence
    })
    if (!res.status) {
      throw new Error("Post Tx: " + res.error)
    }
    return res.info
  }
  
  async postEnvelope() {
    const data = await this.protocol.newMessage('postenvelope')
    if (!data.status) {
      throw new Error("Post envelope: " + data.error)
    }
    return data.msg
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
      throw new Error("Create quote: " + data.error)
    }
    return await this.postTx(data.msg) 
  }
  
  async cancelQuote(id) {
    const data = await this.protocol.newMessage('cancelquote', {
      id: id
    })
    if (!data.status) {
      throw new Error("Cancel quote: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async depositQuote(id, deposit) {
    const data = await this.protocol.newMessage('depositquote', {
      id: id,
      deposit: deposit
    })
    if (!data.status) {
      throw new Error("Deposit quote: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async withdrawQuote(id, withdraw) {
    const data = await this.protocol.newMessage('withdrawquote', {
      id: id,
      withdraw: withdraw
    })
    if (!data.status) {
      throw new Error("Withdraw quote: " + data.error)
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
      throw new Error("Update quote: " + data.error)
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
      throw new Error("Buy " + tradetype + ": " + data.error)
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
      throw new Error("Buy " + tradetype + ": " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async pickTrade(id, tradetype) {
    const data = await this.protocol.newMessage('picktrade', {
      id: id,
      tradetype: tradetype
    })
    if (!data.status) {
      throw new Error("Buy " + tradetype + ": " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
  async settleTrade(id) {
    const data = await this.protocol.newMessage('settletrade', {
      id: id
    })
    if (!data.status) {
      throw new Error("Settle trade: " + data.error)
    }
    return await this.postTx(data.msg)
  }
  
}

module.exports = API
