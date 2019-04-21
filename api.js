const wallet = require('./wallet')
const axios = require('axios')

class API {
  
  constructor(tendermint, cosmos, faucet) {
    this.tm = tendermint
    this.cosmos = cosmos
    this.faucet = faucet
  }
  
  async cosmosQuery(url) {
    try {
      const query = this.cosmos + url
      console.log("Cosmos query: " + query)
      return await axios.get(query)
    } catch (err) {
      throw new Error("Cosmos query failed: " + err.message)
      console.log(err.stack)
    }
  }
  
  async cosmosPostTx(tx) {
    try {
      return await axios.post(this.cosmos + "/microtick/broadcast", {
        tx: JSON.stringify(tx)
      })
    } catch (err) {
      throw new Error("Cosmos post failed")
      console.log(err.stack)
    }
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
    return res.data
  }
  
  async createMarket(market) {
    let msg = await this.cosmosQuery('/microtick/createmarket/' + this.wallet.cosmosAddress + "/" + market)
    const unsigned = msg.data.tx
    const signed = wallet.sign(unsigned, this.wallet, {
      sequence: msg.data.sequence,
      account_number: msg.data.accountNumber,
      chain_id: msg.data.chainId
    })
    console.log(JSON.stringify(signed))
    await this.cosmosPostTx(signed)
  }
  
  async createQuote(market, dur, backing, spot, premium) {
    let msg = await this.cosmosQuery('/microtick/createquote/' + this.wallet.cosmosAddress + "/" + market +
      "/" + dur + "/" + backing + "/" + spot + "/" + premium)
    const unsigned = msg.data.tx
    const signed = wallet.sign(unsigned, this.wallet, {
      sequence: msg.data.sequence,
      account_number: msg.data.accountNumber,
      chain_id: msg.data.chainId
    })
    console.log(JSON.stringify(signed))
    await this.cosmosPostTx(signed)
  }
  
  async getMarketInfo(market) {
    const res = await this.cosmosQuery("/microtick/market/" + market)
    return res.data
  }
  
  async getOrderbookInfo(market, dur) {
    const res = await this.cosmosQuery("/microtick/orderbook/" + market + "/" + dur)
    return res.data
  }
  
  async getMarketSpot(market) {
    const res = await this.cosmosQuery("/microtick/consensus/" + market)
    return res.data
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
