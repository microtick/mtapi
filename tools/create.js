const wallet = require('../client/wallet.js')
const prompt = require('prompt')
const sjcl = require('sjcl')

async function doPrompt(message) {
  const password = await new Promise( (resolve, reject) => {
    prompt.start()
    prompt.message = message
    prompt.delimiter = ' '
   
    var schema = {
      properties: {
        password: {
          hidden: true
        }
      }
    }
  
    prompt.get(schema, async (err, res) => {
      if (err) {
        reject(err)
      } else {
        resolve(res.password)
      }
    })
  })
  
  return password
}

async function main() {
  const password = await doPrompt("New account")
  const mnemonic = await wallet.seed()
  console.log("mnemonic='" + mnemonic + "'")
  const keys = await wallet.generate(mnemonic)
  const acct = {
    type: "software",
    acct: keys.cosmosAddress,
    pub: keys.publicKey,
    priv: Buffer.from(sjcl.encrypt(password, keys.privateKey)).toString('base64')
  }
  console.log(JSON.stringify(acct, null, 2))
}

main()
