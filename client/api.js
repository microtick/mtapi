import websocket from 'websocket'
import bech32 from 'bech32'
import { Mutex } from 'async-mutex'

import protocol from '../lib/protocol.js'
import { SoftwareSigner, LedgerSigner } from './signers.js'
import { TxFactory } from './transactions.js'

export { MTAPI as default, SoftwareSigner, LedgerSigner }

class MTAPI {
    
  constructor() {
    this.sequenceMutex = new Mutex()
    this.mutexCount = 0
    
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
  
  setUrl(url) {
    this.url = url
  }
  
  setSigner(signer) {
    this.signer = signer
  }
  
  async init() {
    console.log("Initializing API")
    
    if (this.url === undefined) {
      throw new Error("API url is undefined")
    }
    if (this.signer === undefined) {
      throw new Error("no signer defined")
    }

    await new Promise((res, rej) => {
      try {
        this._connectServer(this.url, async () => {
          console.log("Signer address: " + this.signer.address)
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
      if (this.mutexCount === 0) {
        delete this.auth
      }
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
  
  async getMarkets() {
    const response = await this.protocol.newMessage('getmarkets')
    if (!response.status) {
      throw new Error("Get markets: " + response.error)
    }
    return response.info
  }
  
  getDurations() {
    return this.durations
  }
  
  async subscribe(key) {
    if (this.subscriptions[key] === undefined) {
      this.subscriptions[key] = 0
    }
    if (this.subscriptions[key] === 0) {
      const response = await this.protocol.newMessage('subscribe', {
        key: key
      })
      if (!response.status) {
        throw new Error("Subscription: " + response.error)
      }
    }
    this.subscriptions[key]++
    console.log("Subscribe: " + key + " count=" + this.subscriptions[key])
  }
  
  async unsubscribe(key) {
    //console.log("Unsubscribe: " + key + " count (prior)=" + this.subscriptions[key])
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
  
  async getBlockInfo() {
    const response = await this.protocol.newMessage('getblock')
    if (!response.status) {
      throw new Error("Get account info: " + response.error)
    }
    return response.info
  }
  
  async getAccountInfo(acct, offset, limit) {
    const response = await this.protocol.newMessage('getacctinfo', {
      acct: acct,
      offset: offset,
      limit: limit
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
      throw new Error("Get market info: (" + market + "): " + response.error)
    }
    return response.info
  }
  
  async getMarketSpot(market) {
    const response = await this.protocol.newMessage('getmarketspot', {
      market: market
    })
    if (!response.status) {
      throw new Error("Get market spot (" + market + "): " + response.error)
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
  
  async getSyntheticInfo(market, dur, offset, limit) {
    const response = await this.protocol.newMessage('getsyntheticinfo', {
      market: market,
      duration: dur,
      offset: offset,
      limit: limit
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
  
  async getTradeLeg(id, leg) {
    const response = await this.protocol.newMessage('gettradeleg', {
      id: id,
      leg: leg
    })
    if (!response.status) {
      throw new Error("Get trade leg: " + response.error)
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
  
  async getActiveTrades() {
    const response = await this.protocol.newMessage('getactivetrades')
    if (!response.status) {
      throw new Error("Get active trades: " + response.error)
    }
    return response.active
  }
  
  async getHistoricalTrades(market, duration, startblock, endblock) {
    const response = await this.protocol.newMessage('gethisttrades', {
      market: market,
      duration: duration,
      startblock: startblock,
      endblock: endblock
    })
    if (!response.status) {
      throw new Error("Get historical trades: " + response.error)
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
  
  async signAndBroadcast(factory, payload, auth) {
    if (auth === undefined) {
      // For simultaneous tx requests, we use a mutex so the resulting
      // sequence numbers will be sequential
      this.mutexCount++
      await this.sequenceMutex.runExclusive(async () => {
        this.mutexCount--
        // if we don't have this.auth, fetch it
        if (this.auth === undefined) {
          // get account auth
          const response = await this.protocol.newMessage('getauthinfo', {
            acct: this.signer.address
          })
          if (!response.status) {
            throw new Error("Account not found: please add funds and try again")
          }
          this.auth = response.info
        }
      })
      var chainid = this.auth.chainid
      var account = this.auth.account
      var sequence = this.auth.sequence++
    } else {
      // If the caller specified their own auth, just use those values
      chainid = auth.chainid
      account = auth.account
      sequence = auth.sequence
    }
    
    // sign and publish tx
    const tx = factory.build(payload, chainid, account, sequence)
    //console.log(JSON.stringify(tx, null, 2))
    const sig = await this.signer.sign(tx)
    
    // change address to bytes for (requester, taker, or provider fields)
    // (note these do not overlap anything for cosmos-sdk packets we support so this is ok, for now)
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
    const packet = {
      type: factory.type,
      tx: payload,
      pubkey: this.signer.getPubKey(),
      sig: sig,
      gas: factory.gas,
      sequence: sequence,
    }
    
    if (auth !== undefined) {
      packet.chainid = chainid
    }
    
    const post_result = await this.protocol.newMessage('posttx', packet)
    if (!post_result.status) {
      throw new Error("Post Tx: " + post_result.error)
    }
    return post_result.info
  }
  
  async createQuote(market, duration, backing, spot, ask, bid) {
    if (spot === undefined || ask === undefined) {
      throw new Error("All quotes must have both a spot and an ask")
    }
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
    const factory = new TxFactory("create")
    return await this.signAndBroadcast(factory, payload)
  }
  
  async cancelQuote(id) {
    const payload = {
      id: id,
      requester: this.signer.getAddress()
    }
    const factory = new TxFactory("cancel")
    return await this.signAndBroadcast(factory, payload)
  }
  
  async depositQuote(id, deposit) {
    const payload = {
      id: id,
      requester: this.signer.getAddress(),
      deposit: deposit
    }
    const factory = new TxFactory("deposit")
    return await this.signAndBroadcast(factory, payload)
  }
  
  async withdrawQuote(id, withdraw) {
    const payload = {
      id: id,
      requester: this.signer.getAddress(),
      withdraw: withdraw
    }
    const factory = new TxFactory("withdraw")
    return await this.signAndBroadcast(factory, payload)
  }
  
  async updateQuote(id, newspot, newask, newbid) {
    if (newspot === undefined || newask === undefined) {
      throw new Error("All quotes must have both a spot and an ask")
    }
    if (newbid === undefined) {
      newbid = "0premium"
    }
    const payload = {
      id: id,
      requester: this.signer.getAddress(),
      new_spot: newspot,
      new_ask: newask,
      new_bid: newbid
    }
    const factory = new TxFactory("update")
    return await this.signAndBroadcast(factory, payload)
  }
  
  async marketTrade(market, duration, ordertype, quantity) {
    const payload = {
      market: market,
      duration: duration,
      taker: this.signer.getAddress(),
      order_type: ordertype,
      quantity: quantity
    }
    const factory = new TxFactory("trade")
    return await this.signAndBroadcast(factory, payload)
  }
  
  async pickTrade(id, ordertype) {
    const payload = {
      id: id,
      taker: this.signer.getAddress(),
      order_type: ordertype
    }
    const factory = new TxFactory("pick")
    return await this.signAndBroadcast(factory, payload)
  }
  
  async settleTrade(id) {
    const payload = {
      id: id,
      requester: this.signer.getAddress()
    }
    const factory = new TxFactory("settle")
    return await this.signAndBroadcast(factory, payload)
  }
  
  // IBC
  
  async getIBCEndpoints() {
    const response = await this.protocol.newMessage('getibcinfo', {
      pubkey: this.signer.getPubKey()
    })
    if (!response.status) {
      throw new Error("Get IBC endpoints: " + response.error)
    }
    return response.info
  }
  
  async IBCDeposit(channel, height, blocktime, sender, receiver, amount, denom, auth) {
    const response = await this.protocol.newMessage('getauthinfo', {
      acct: this.signer.address
    })
    if (!response.status) {
      throw new Error("Couldn't communicate with server")
    }
    var rev = response.info.chainid.match(/^.+[^-]-{1}([1-9][0-9]*)$/)
    if (rev === null) {
      rev = undefined
    } else {
      rev = rev[1]
    }
    //console.log("Dest Chain ID: " + response.info.chainid)
    //console.log("Revision: " + JSON.stringify(rev))
    const payload = {
      source_port: "transfer",
      source_channel: channel,
      token: {
        amount: amount,
        denom: denom
      },
      sender: sender,
      receiver: receiver,
      timeout_height: {
        revision_number: rev,
        revision_height: '' + height
      },
      timeout_timestamp: '' + blocktime + "000000"
    }
    const factory = new TxFactory("transfer")
    return await this.signAndBroadcast(factory, payload, auth)
  }
  
  async IBCWithdrawal(chainid, channel, height, blocktime, sender, receiver, amount, denom) {
    var rev = chainid.match(/^.+[^-]-{1}([1-9][0-9]*)$/)
    if (rev === null) {
      rev = undefined
    } else {
      rev = rev[1]
    }
    //console.log("Dest Chain ID: " + chainid)
    //console.log("Revision: " + JSON.stringify(rev))
    const payload = {
      source_port: "transfer",
      source_channel: channel,
      token: {
        amount: amount,
        denom: denom
      },
      sender: sender,
      receiver: receiver,
      timeout_height: {
        revision_number: rev,
        revision_height: '' + height
      },
      timeout_timestamp: '' + blocktime + "000000"
    }
    const factory = new TxFactory("transfer")
    return await this.signAndBroadcast(factory, payload)
  }
  
}
