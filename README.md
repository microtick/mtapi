![Microtick Logo](mtlogo.png)
# Microtick API

This API runs as a custom protocol through a single websocket connection between client and server.  On the server
side, the connection is multiplexed depending on the request type:

  - websocket to Tendermint (subscriptions)
  - REST to Tendermint (search, history)
  - REST to Tendermint ABCI query (cosmos queries, transactions)

The server side complexity is hidden from the client app through the protocol which makes it simple to develop
Microtick trading bots and market makers.

![API System Diagram](docs/API.png)

## API Server

To run the API server, cd into the 'server' directory and execute the following commands (default websocket port is 1320)

```
$ npm install
$ node api-server
```

## Client API Documentation

### Installation

1. Create the 'dist' directory

```
$ ./build.sh
```

2. Move or copy the 'dist' directory to 'node_modules/mtapi'

```
$ mv dist <your_project_dir>/node_modules/mtapi
```

### Usage

```
const API = require('mtapi')
const api = new API("http://localhost:1320")  // Assumes the API server is running on port 1320
```

The first step after creating the api object is to initialize the API with signing keys. You have two choices:
either initialize with no keys (in which case a new wallet will be created) or initialize with existing keys
(to use a specific wallet address and keys)

#### Initialization with signing keys

To create a new wallet:

```
await api.init()
const wallet = api.getWallet()
```

The returned wallet will contain your address and unencrypted public / private keys. ** You are responsible
for encrypting and safely storing your wallet keys **

To reuse an existing wallet:

```
await api.init(wallet)
```

where the wallet object is a previously returned object from api.getWallet()

#### API Function calls

##### Subscribe

```
await api.subscribe(event, callback)
```

- event - Tendermint event syntax, for example "tm.event='NewBlock'"
- callback - function accepting one parameter - the event object

returns the subscription id

##### Unsubscribe

```
await api.unsubscribe(id)
```

- id - subscription id returned from api.subscribe()

##### Get Block Info

```
const block = await api.blockInfo()
```

returns the current block height and time

##### Get Block

```
const block = await api.getBlock(height)
```

- height - Tendermint block height

##### Get Account Info

```
const info = await api.getAccountInfo(addr)
```

- addr - cosmos address of account

##### Get Market Info

```
const info = await api.getMarketInfo(market)
```

- market - Microtick market name, i.e. "ATOMUSD"

##### Get Orderbook Info

```
const info = await api.getOrderbookInfo(market, dur)
```

- market - Microtick market name
- dur - Microtick duration, i.e. ('5minute', '15minute', '1hour', '4hour', '12hour')

##### Get Market Spot

```
const info = await api.getMarketSpot(market)
```

returns an abbreviated object containing consensus price and overview information on a Microtick market

##### Get Quote

```
const quote = await api.getQuote(id)
```

- id - quote id to fetch

##### Can Modify

```
const canModify = await api.canModify(id)
```

- id - quote id 

returns a boolean value, **true** if the quote can be modified, **false** if not.  Quotes can not be modified
for immediately, there is a settling time that is specified in the genesis block parameters.

##### Get Trade

```
const trade = await api.getTrade(id)
```

- id - trade id to fetch

##### Create Market

```
await api.createMarket(market)
```

- market - market string, i.e. "ATOMUSD"

Create a new market

##### Create Quote

```
const id = await api.createQuote(market, duration, backing, spot, premium)
```

- market - market string, i.e. "ATOMUSD"
- duration - Microtick duration, i.e. ('5minute', '15minute', '1hour', '4hour', '12hour')
- backing - token amount, i.e. "10fox"
- spot - spot value, i.e. "3.5spot"
- premium - option premium requested, i.e. "1premium"

Creates a quote on the requested market, backed by the token amount, with a spot price specified, and the requested premium.
Note that the actual premium will be adjusted according to how close the quote is to the current consensus price at the
time a trade is made.  If the spot price is in the direction of the trade as compared to the consensus price, the premium will
be adjusted up, i.e. the market maker will receive more premium than requested (generally a good thing).  If the spot price
is in the opposite side of the consensus from the direction of the trade, the premium will be adjusted down, i.e. the market
maker will receive fewer premium than requested.  Premium is paid in fox tokens.

Returns the quote id

##### Cancel Quote

```
await api.cancelQuote(id)
```

- id - the quote id

Cancels a quote

##### Deposit Quote

```
await api.depositQuote(id, amount)
```

- id - the quote id
- amount - amount of tokens to add to the quote's backing, i.e. "2fox"

##### Update Quote

```
await api.updateQuote(id, newspot, newpremium)
```

- id - the quote id
- newspot - new spot for the quote (can be 0 for no change).  Example: "3.8spot"
- newpremium - new premium for the quote (can be 0 for no change).  Example: "1.2premium"

##### Market Trade

```
const id = await api.marketTrade(market, duration, tradetype, quantity)
```

- market - market string, i.e. "ATOMUSD"
- duration - Microtick duration, i.e. ('5minute', '15minute', '1hour', '4hour', '12hour')
- tradetype - can be "call" or "put"
- quantity - quantity to fill

Returns the trade id

##### Limit Trade

```
const id = await api.limitTrade(market, duration, tradetype, limit, maxcost)
```

 market - market string, i.e. "ATOMUSD"
- duration - Microtick duration, i.e. ('5minute', '15minute', '1hour', '4hour', '12hour')
- tradetype - can be "call" or "put"
- limit - max premium you are willing to pay, i.e. "1.1premium" would match any option less than the specifed amount
- maxcost - max number of tokens, i.e. "1fox".  the quantity for the trade will be adjusted so the total cost will be less than what is specified.

Returns the trade id

##### Settle Trade

```
await api.settleTrade(id)
```

- id - trade id to settle, after the expiration time has been reached.

Anyone can call api.settleTrade(). There is a small commission set aside with each trade to incentivize settling trades. Either counter party to 
the trade can call this function (espicially if the trade worked in their favor), or independent third parties can call it and collect the 
settle commission.

## Examples

To run the wallet example, run './build.sh' from the root directory, then
cd into the 'examples' directory and

```
$ node wallet
Creating wallet
Server connected
account = cosmos1wzt9et3w9cvqus7rwnndad44wnkn90dqu87fm7
```
