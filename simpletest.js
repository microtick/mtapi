const axios = require('axios')

//const url = "microtick/account/cosmos1qwu9f6zk5klej0tfs8p40j6uu8j86nh80nm3t4"
//const url = "microtick/market/ETHUSD"
//const url = "microtick/consensus/ETHUSD"
//const url = "microtick/orderbook/ETHUSD/5minute"
//const url = "microtick/quote/1"
//const url = "microtick/trade/1"
//const url = "microtick/createmarket/cosmos1qlzp94qve0np3du8k43epfc532rxwclxen0pnu/ETHUSD"
const url = "microtick/createquote/cosmos1hdq4rhfaz33plxh0qk49wr40edp8mhzfr4ckq8/ETHUSD/5minute/10fox/170spot/1.2premium"

async function main() {
    try {
        const res = await axios.get('http://localhost:1317/' + url)
        console.log(JSON.stringify(res.data, null, 2))
    } catch (err) {
        console.log(err.message)
    }
}

main()
