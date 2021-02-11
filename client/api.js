import websocket from 'websocket'
import bech32 from 'bech32'

import protocol from '../lib/protocol.js'
import { SoftwareSigner, LedgerSigner } from './signers.js'
import { TxFactory } from './transactions.js'

export { MTAPI, SoftwareSigner, LedgerSigner }

class MTAPI {
    
  constructor(signer) {
    this.signer = signer
    
    this.subscriptions = {}
    this.blockHandlers = []
    this.tickHandlers = []
    this.accountHandlers = []
    
    // Set up protocol handlers
    this.protocol = new protocol(240000, 
      this._handleMessage.bind(this), 
      this._handleEvent.bind(this), 
      this._handleSend.bind(this))
    
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
  
  async init(url) {
    console.log("Initializing API")

    await new Promise((res, rej) => {
      try {
        this._connectServer(url, async () => {
          console.log("Wallet address: " + this.signer.address)
          const response = await this.protocol.newMessage('connect', {
            acct: this.signer.address
          })
          if (!response.status) {
            throw new Error("Connect: " + response.error)
          }
          Object.keys(this.subscriptions).map(async key => {
            if (this.subscriptions[key] > 0) {
              this.subscriptions[key]--
              console.log("Resubscribing: " + key)
              await this.subscribe(key)
            }
          })
          res()
        }, async msg => {
          const response = await this.protocol.process(null, msg)
          if (response !== undefined) {
            this.client.send(response)
          }
        })
      } catch (err) {
        rej(err)
      }
    })
  }
  
  _connectServer(url, onOpen, onMessage) {
    const WebSocketClient = websocket.w3cwebsocket
    this.client = new WebSocketClient(url)
    
    this.client.onopen = () => {
      console.log("Server connected")
      if (onOpen !== undefined) {
        onOpen()
      }
    }
    
    this.client.onmessage = msg => {
      onMessage(msg.data)
    }
    
    this.client.onclose = () => {
      console.log("Server disconnected (make sure API server is running)")
      setTimeout(() => {
        this._connectServer(url, onOpen, onMessage)
      }, 1000)
    }
    
    this.client.onerror = () => {
      // Websocket errors not generally helpful
      //console.log("Websocket error")
    }
  }
  
  async _handleMessage(env, name, payload) {
    // Clients do not get requests - this should never get hit
    console.error("Got request from server?!")
    process.exit()
  }
  
  async _handleEvent(env, msg) {
    // Async events passed from the server to us
    if (msg.type === 'block') {
      delete this.auth
      for (var i=0; i<this.blockHandlers.length; i++) {
        const handler = this.blockHandlers[i] 
        await handler(msg.payload)
      }
    } else if (msg.type === 'tick') {
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
  }
  
  async _handleSend(str) {
    // Handle errors from outgoing messages we're sending to the server
    try {
      this.client.send(str)
    } catch (err) {
      console.log("Send: " + err.message)
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
  
  async getParams() {
    const response = await this.protocol.newMessage('getparams')
    if (!response.status) {
      throw new Error("Get params: " + response.error)
    }
    return response.info
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
  
  async getOrderbookInfo(market, dur, offset, limit) {
    const response = await this.protocol.newMessage('getorderbookinfo', {
      market: market,
      duration: dur,
      offset: offset,
      limit: limit
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
  
  async signAndBroadcast(factory, payload, gas) {
    // get account auth
    const response = await this.protocol.newMessage('getauthinfo', {
      acct: this.signer.address
    })
    if (!response.status) {
      throw new Error("Account not found: please add funds and try again")
    }
    const auth = response.info
    
    // sign and publish tx
    const tx = factory.build(payload, auth.chainid, auth.account, auth.sequence)
    const sig = await this.signer.sign(tx)
    
    // change address to bytes for (requester, taker, or provider fields)
    if (payload.provider !== undefined) {
      const decoded = bech32.decode(payload.provider)
      payload.provider = Buffer.from(bech32.fromWords(decoded.words)).toString('base64')
    }
    if (payload.requester !== undefined) {
      const decoded = bech32.decode(payload.requester)
      payload.requester = Buffer.from(bech32.fromWords(decoded.words)).toString('base64')
    }
    if (payload.taker !== undefined) {
      const decoded = bech32.decode(payload.taker)
      payload.taker = Buffer.from(bech32.fromWords(decoded.words)).toString('base64')
    }
    
    // post tx
    const sequence = auth.sequence++
    const post_result = await this.protocol.newMessage('posttx', {
      type: factory.type,
      tx: payload,
      pubkey: this.signer.getPubKey(),
      sig: sig,
      gas: gas,
      sequence: sequence,
    })
    if (!post_result.status) {
      throw new Error("Post Tx: " + post_result.error)
    }
    return post_result.info
  }
  
  async createQuote(market, duration, backing, spot, ask, bid) {
    if (bid === undefined) {
      bid = "0premium"
    }
    const payload = {
      market: market,
      duration: duration,
      provider: this.signer.getAddress(),
      backing: backing,
      spot: spot,
      ask: ask,
      bid: bid
    }
    const factory = new TxFactory("create", 500000)
    return await this.signAndBroadcast(factory, payload, 500000)
  }
  
  async cancelQuote(id) {
    const payload = {
      id: id,
      requester: this.signer.getAddress()
    }
    const factory = new TxFactory("cancel", 500000)
    return await this.signAndBroadcast(factory, payload, 500000)
  }
  
  async depositQuote(id, deposit) {
    const payload = {
      id: id,
      requester: this.signer.getAddress(),
      deposit: deposit
    }
    const factory = new TxFactory("deposit", 500000)
    return await this.signAndBroadcast(factory, payload, 500000)
  }
  
  async withdrawQuote(id, withdraw) {
    const payload = {
      id: id,
      requester: this.signer.getAddress(),
      withdraw: withdraw
    }
    const factory = new TxFactory("withdrawt", 500000)
    return await this.signAndBroadcast(factory, payload, 500000)
  }
  
  async updateQuote(id, newspot, newask, newbid) {
    if (newbid === undefined) {
      newbid = "0premium"
    }
    const payload = {
      id: id,
      requester: this.signer.getAddress(),
      newSpot: newspot,
      newAsk: newask,
      newBid: newbid
    }
    const factory = new TxFactory("update", 500000)
    return await this.signAndBroadcast(factory, payload, 500000)
  }
  
  async marketTrade(market, duration, ordertype, quantity) {
    const payload = {
      market: market,
      duration: duration,
      taker: this.signer.getAddress(),
      orderType: ordertype,
      quantity: quantity
    }
    const factory = new TxFactory("trade", 500000)
    return await this.signAndBroadcast(factory, payload, 500000)
  }
  
  async pickTrade(id, ordertype) {
    const payload = {
      id: id,
      taker: this.signer.getAddress(),
      orderType: ordertype
    }
    const factory = new TxFactory("pick", 500000)
    return await this.signAndBroadcast(factory, payload, 500000)
  }
  
  async settleTrade(id) {
    const payload = {
      id: id,
      requester: this.signer.getAddress()
    }
    const factory = new TxFactory("settle", 500000)
    return await this.signAndBroadcast(factory, payload, 500000)
  }
  
}
