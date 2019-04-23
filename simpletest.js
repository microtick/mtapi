const axios = require('axios')

const account = "cosmos1hdq4rhfaz33plxh0qk49wr40edp8mhzfr4ckq8"

//const url = "microtick/account/cosmos1qwu9f6zk5klej0tfs8p40j6uu8j86nh80nm3t4"
//const url = "microtick/market/ETHUSD"
//const url = "microtick/consensus/ETHUSD"
//const url = "microtick/orderbook/ETHUSD/5minute"
//const url = "microtick/quote/1"
//const url = "microtick/trade/1"
//const url = "microtick/createmarket/" + account + "/ETHUSD"
//const url = "microtick/createquote/" + account + "/5minute/10fox/170spot/1.2premium"
//const url = "microtick/cancelquote/" + account + "/1"
//const url = "microtick/depositquote/" + account + "/1/10fox"
//const url = "microtick/updatequote/" + account + "/1/172spot/2.1premium"
const url = "microtick/markettrade/" + account + "/ETHUSD/5minute/call/1quantity"
//const url = "microtick/limittrade/" + account + "/ETHUSD/5minute/call/1.1premium"
//const url = "microtick/settletrade/" + account + "/1"

async function main() {
    try {
        const res = await axios.get('http://localhost:1317/' + url)
        console.log(JSON.stringify(res.data, null, 2))
    } catch (err) {
        console.log(err.response.data.message)
    }
}

main()
