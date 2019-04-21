//const axios = require('axios')

//const url = "microtick/account/cosmos1qwu9f6zk5klej0tfs8p40j6uu8j86nh80nm3t4"
//const url = "microtick/market/ETHUSD"
//const url = "microtick/consensus/ETHUSD"
//const url = "microtick/orderbook/ETHUSD/5minute"
//const url = "microtick/quote/1"
//const url = "microtick/trade/1"
//const url = "microtick/createmarket/cosmos1qlzp94qve0np3du8k43epfc532rxwclxen0pnu/ETHUSD"

/*
async function main() {
    try {
        const res = await axios.get('http://localhost:1317/' + url)
        //console.log(JSON.stringify(res.data, null, 2))
        console.log(res.data)
    } catch (err) {
        console.log(err.message)
    }
}

main()
*/

const API = require('./api')
const api = API("http://localhost:26657", "http://localhost:1317", "http://localhost:3000")

async function main() {
  //const blockInfo = await api.blockInfo()
  //console.log(blockInfo.block)
  //const block = await api.getBlock(blockInfo.block)
  //console.log(block)
  const keys = await api.generateWallet()
  console.log(keys)
  await api.createAccount(keys)
  const info = await api.getAccountInfo(keys.acct)
  console.log(info)
  const market = "ETH"
  await api.createMarket(market)
  await api.createQuote(market, "5minute", "10fox", "170spot", "1.2premium")
  console.log("Market Info: " + JSON.stringify(await api.getMarketInfo(market)))
  console.log("Orderbook Info: " + JSON.stringify(await api.getOrderbookInfo(market, "5minute")))
  console.log("Consensus: " + JSON.stringify(await api.getMarketSpot(market)))
}

main()
