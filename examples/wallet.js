const API = require('mtapi')

const main = async () => {

  // Assumes API server is running
  const api = new API("http://localhost:1320")

  await api.init()
  const wallet = await api.getWallet()

  console.log("account = " + wallet.acct)
}

main()

