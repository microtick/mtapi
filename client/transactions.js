import codec from '../proto/index.js'

const txlookup = {
  cancel: {
    proto: "/microtick.msg.TxCancelQuote",
    legacy: "microtick/Cancel"
  },
  create: {
    proto: "/microtick.msg.TxCreateQuote",
    legacy: "microtick/Create"
  },
  deposit: {
    proto: "/microtick.msg.TxDepositQuote",
    legacy: "/microtick/Deposit"
  },
  withdraw: {
    proto: "/microtick.msg.TxWithdrawQuote",
    legacy: "/microtick/Withdraw"
  },
  update: {
    proto: "/microtick.msg.TxUpdateQuote",
    legacy: "/microtick/Update"
  },
  trade: {
    proto: "/microtick.msg.TxMarketTrade",
    legacy: "/microtick/Trade"
  },
  pick: {
    proto: "/microtick.msg.TxPickTrade",
    legacy: "/microtick/Pick"
  },
  settle: {
    proto: "/microtick.msg.TxSettleTrade",
    legacy: "/microtick/Settle"
  }
}

export class TxFactory {
  
  constructor(type, gas) {
    this.type = type
    if (gas !== undefined) {
      this.gas = "" + gas
    } else {
      this.gas = "500000"
    }
  }
  
  build(payload, chainId, account, sequence) {
    this.chainId = chainId
    // make strings
    this.account = "" + account
    this.sequence = "" + sequence
    
    // Legacy envelope
    const tx = {
      msgs: [],
      memo: "",
      fee: {
        amount: [],
        gas: this.gas
      }
    }
    
    tx.msgs.push({
      type: txlookup[this.type].legacy,
      value: payload
    })
  
    // Canonicalize object
    return this._canonicalize(tx, this.chainId, this.account, this.sequence)
  }
  
  publish(payload, pubkey, sig) {
    const tx = {
      body: {
        messages: [],
      },
      authInfo: {
        signerInfos: [],
        fee: {
          gasLimit: {
            low: this.gas,
          }
        }
      }
    }
    
    tx.body.messages.push(Object.assign({
      "@type": txlookup[this.type].proto,
    }, payload))
    
    // add signer info
    const si = {
      publicKey: {
        '@type': "/cosmos.crypto.secp256k1.PubKey",
        key: pubkey
      },
      modeInfo: {
        single: {
          mode: "SIGN_MODE_LEGACY_AMINO_JSON"
        }
      }
    }
    tx.authInfo.signerInfos.push(si)
  
    // add signature
    tx.signatures = [ sig ]
  
    const txmsg = codec.create("cosmos.tx.v1beta1.Tx", tx)
    return txmsg
  }
  
  _canonicalize(jsonTx, chain, account, sequence) {
    // create deep copy
    const obj = JSON.parse(JSON.stringify(jsonTx))
  
    // add transient fields
    obj.chain_id = chain
    obj.account_number = account
    obj.sequence = sequence
    return this._sort(obj)
  }

  _sort(obj) {
    if (Array.isArray(obj)) {
      return obj.map(this._sort.bind(this))
    }
    if (typeof obj !== `object`) {
      return obj
    }
    let sorted = {}
    Object.keys(obj).sort().forEach(key => {
      if (obj[key] === undefined || obj[key] === null) return
      sorted[key] = this._sort(obj[key])
    })
    return sorted
  }
}
