process.on('unhandledRejection', error => {
  if (error !== undefined) {
    console.log('unhandled promise rejection: ', error.message);
    console.log(error.stack)
  } else {
    console.log("promise rejection")
  }
});

async function main() {
  const API = require('mtapi')
  const keys = JSON.parse('{"pub":"0332cbaab1a0397565f3ef26dcef6d89974a6f8fa04332e5a05acc4559916c1b17","priv":"8e047fd4a929bace52127ed67bd9ae3cc649a4fce03638775f7d3480658526c6","acct":"cosmos127ve5ay2xdn7q2fcu4xu8870wlnww845pv6ten"}')
  const api = await API("ws://localhost:1320", keys)
  const wallet = await api.getWallet()
  await api.subscribe("mtm.MarketTick='ETHUSD'", () => {
    console.log("Market tick")
  })
  /*
  var res = await api.blockInfo()
  console.log("Block info=" + JSON.stringify(res))
  res = await api.getBlock(10)
  console.log("Get block=" + res.block.header.last_commit_hash)
  res = await api.getAccountInfo('cosmos1585drq7u4cdgvdslclt0g7lceghwj9vljdm8tr')
  //res = await api.getAccountInfo(wallet.acct)
  console.log("Account info=" + JSON.stringify(res))
  res = await api.getMarketInfo("ETHUSD")
  console.log("Market info=" + JSON.stringify(res))
  res = await api.getOrderbookInfo("ETHUSD", "5minute")
  console.log("Orderbook info=" + JSON.stringify(res))
  res = await api.getMarketSpot("ETHUSD")
  console.log("Market spot=" + JSON.stringify(res))
  //res = await api.getQuote(2328)
  //console.log("Quote=" + JSON.stringify(res))
  //res = await api.getTrade(1)
  //console.log("Trade=" + JSON.stringify(res))
  res = await api.history("mtm.MarketTick='ETHUSD'", 100000, 100010, null)
  console.log("History length=" + res.history.length)
  */
  var res = await api.createQuote("ETHUSD", "5minute", "1fox", "210spot", "4premium")
  console.log(JSON.stringify(res))
}

main()
