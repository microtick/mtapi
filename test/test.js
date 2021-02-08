const API = require('../client/api.js')

process.on('unhandledRejection', error => {
  if (error !== undefined) {
    console.log('unhandled promise rejection: ', error.message);
    console.log(error.stack)
  } else {
    console.log("promise rejection")
  }
  process.exit()
});

async function main() {
  const mnemonic = "congress collect dance legend genre fine traffic ethics post nature recycle short test neutral skin rain remain fetch evil champion drink when trigger still"
  const api = new API("ws://localhost:1320")
  await api.init(mnemonic.split(" "), console.log)
  var res = await api.getAccountInfo(api.wallet.address)
  //console.log(JSON.stringify(res))
  //res = await api.getMarketInfo("ETHUSD")
  //console.log(JSON.stringify(res))
  //res = await api.getMarketSpot("ETHUSD")
  //console.log(JSON.stringify(res))
  //res = await api.getOrderbookInfo("ETHUSD", "5minute")
  //console.log(JSON.stringify(res))
  //res = await api.getSyntheticInfo("ETHUSD", "5minute")
  //console.log(JSON.stringify(res))
  //res = await api.getLiveQuote(1)
  //console.log(JSON.stringify(res))
  //res = await api.getLiveTrade(1)
  //console.log(JSON.stringify(res))
  res = await api.getAccountAuth(api.wallet.address)
  console.log(JSON.stringify(res))
  
  console.log()
  res = await api.createQuote("ETHUSD", "5minute", "10backing", "442spot", "1premium")
  console.log("res=" + JSON.stringify(res, null, 2))
  //res = await api.cancelQuote(1)
  //console.log(JSON.stringify(res))
  //res = await api.depositQuote(2, "10backing")
  //console.log(JSON.stringify(res))
  //res = await api.withdrawQuote(2, "0.75backing")
  //console.log(JSON.stringify(res))
  //res = await api.updateQuote(2, "301spot", "0.8premium", "0.1premium")
  //console.log(JSON.stringify(res))
  //res = await api.marketTrade("ETHUSD", "5minute", "buy-call", "0.1quantity")
  //console.log(JSON.stringify(res))
  //res = await api.pickTrade(4, "buy-call")
  //console.log(JSON.stringify(res))
  //res = await api.settleTrade(7)
  //console.log(JSON.stringify(res))
  
  process.exit()
}

main()
