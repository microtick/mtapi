const { unmarshalTx } = require('../server/amino.js')

const b64 = process.argv[2]
const bytes = new Buffer(b64, 'base64')

const res = unmarshalTx(bytes)

console.log(JSON.stringify(res, null, 2))