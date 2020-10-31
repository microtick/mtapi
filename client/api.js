const WebSocketClient = require('websocket').w3cwebsocket

const wallet = require('./wallet.js')
const protocol = require('../lib/protocol.js')
const codec = require('../lib/tx.js')

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
        delete this.auth
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
      const mnemonic = await wallet.generateNewMnemonic()
      if (typeof cb === "function") cb(mnemonic)
      this.wallet = wallet.newFromHD("micro", 0, 0)
      await this.wallet.init(mnemonic)
      this.wallettype = "software"
    } else if (keys === "ledger") {
      this.getApp = cb
      const app = await this.getApp()
      const path = [44, 118, 0, 0, 0]
      const response = await app.getAddressAndPubKey(path, "micro")
      if (response.return_code !== 0x9000) {
        throw new Error("Ledger initialization failed")
      }
      this.wallet = wallet.newFromLedger(response.compressed_pk.toString('hex'), response.bech32_address)
    } else if (Array.isArray(keys)) {
      const mnemonic = keys.join(" ")
      this.wallet =wallet.newFromHD("micro", 0, 0)
      await this.wallet.init(mnemonic)
      this.wallettype = "software"
    } else {
      console.log("Using wallet: " + keys.acct)
      this.wallet = wallet.newFromKey("micro", Buffer.from(keys.priv, 'hex'))
    }
    
    const api = this
    await new Promise((resolve, reject) => {
      connectServer(this.url, async client => {
        this.client = client
        const response = await this.protocol.newMessage('connect', {
          acct: this.wallet.address
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
      type: this.wallettype,
      acct: this.wallet.address,
      pub: this.wallet.pub.toString("hex"),
      priv: this.wallet.priv.toString("hex")
    }
  }
  
  async getWallet() {
    return {
      type: this.wallettype,
      acct: this.wallet.address,
      pub: this.wallet.pub.toString("hex"),
      priv: this.wallet.priv.toString("hex")
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
  
  async getMarketInfo(market) {
    const response = await this.protocol.newMessage('getmarketinfo', {
      market: market
    })
    if (!response.status) {
      throw new Error("Get market info: " + response.error)
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
  
  async getSyntheticInfo(market, dur) {
    const response = await this.protocol.newMessage('getsyntheticinfo', {
      market: market,
      duration: dur
    })
    if (!response.status) {
      throw new Error("Get synthetic info: " + response.error)
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
  
  async getAccountAuth(acct) {
    const response = await this.protocol.newMessage('getauthinfo', {
      acct: acct
    })
    if (!response.status) {
      throw new Error("Account not found: please add funds and try again")
    }
    return response.info
  }
    
    /*
  async postTx(msg) {
    if (this.wallettype === "ledger") {
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
  */
  
  async postTx(tx, txtype, gas) {
    if (this.auth === undefined) {
      this.auth = await this.getAccountAuth(this.wallet.address)
    }
    const sequence = this.auth.sequence++
    const hash = tx.createSigningHash(this.wallet.pub, this.auth.chainid, this.auth.account, sequence, gas)
    if (this.wallettype === "ledger") {
      // not supported yet
    } else {
      const sig = this.wallet.sign(hash)
      var bytes = tx.generateBroadcastBytes(sig)
    }
    const res = await this.protocol.newMessage('posttx', {
      tx: bytes.toString("base64"),
      sequence: sequence,
      type: txtype
    })
    if (!res.status) {
      throw new Error("Post Tx: " + res.error)
    }
    return res.info
  }
  
  async send(from, to, amount) {
    const msg = new codec.Send(from, to, amount)
    const tx = new codec.Tx(msg)
    return await this.postTx(tx, "send", 200000)
  }
  
  async createQuote(market, duration, backing, spot, ask, bid) {
    if (bid === undefined) {
      bid = "0premium"
    }
    const msg = new codec.Create(market, duration, this.wallet.address, backing, spot, ask, bid)
    const tx = new codec.Tx(msg)
    return await this.postTx(tx, "create", 1000000) 
  }
  
  async cancelQuote(id) {
    const msg = new codec.Cancel(id, this.wallet.address)
    const tx = new codec.Tx(msg)
    return await this.postTx(tx, "cancel", 1000000)
  }
  
  async depositQuote(id, deposit) {
    const msg = new codec.Deposit(id, this.wallet.address, deposit)
    const tx = new codec.Tx(msg)
    return await this.postTx(tx, "deposit", 1000000)
  }
  
  async withdrawQuote(id, withdraw) {
    const msg = new codec.Withdraw(id, this.wallet.address, withdraw)
    const tx = new codec.Tx(msg)
    return await this.postTx(tx, "withdraw", 1000000)
  }
  
  async updateQuote(id, newspot, newask, newbid) {
    const msg = new codec.Update(id, this.wallet.address, newspot, newask, newbid)
    const tx = new codec.Tx(msg)
    return await this.postTx(tx, "update", 1000000)
  }
  
  async marketTrade(market, duration, ordertype, quantity) {
    const msg = new codec.Trade(market, duration, this.wallet.address, ordertype, quantity)
    const tx = new codec.Tx(msg)
    return await this.postTx(tx, "trade", 1000000)
  }
  
  async pickTrade(id, ordertype) {
    const msg = new codec.Pick(id, this.wallet.address, ordertype)
    const tx = new codec.Tx(msg)
    return await this.postTx(tx, "pick", 1000000)
  }
  
  async settleTrade(id) {
    const msg = new codec.Settle(id, this.wallet.address)
    const tx = new codec.Tx(msg)
    return await this.postTx(tx, "settle", 1000000)
  }
  
}

module.exports = API
