const txlookup = {
  cancel: "microtick/Cancel",
  create: "microtick/Create",
  deposit: "microtick/Deposit",
  withdraw: "microtick/Withdraw",
  update: "microtick/Update",
  trade: "microtick/Trade",
  pick: "microtick/Pick",
  settle: "microtick/Settle"
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
      type: txlookup[this.type],
      value: payload
    })
  
    // Canonicalize object
    return this._canonicalize(tx, this.chainId, this.account, this.sequence)
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
