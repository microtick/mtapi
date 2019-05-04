const express = require('express')
const cors = require('cors')
const { exec } = require('child_process')

const app = express()

app.use(cors())

app.get('/:address', (req, res) => {
    const addr = req.params.address
    if (addr.startsWith("cosmos")) {
        console.log("Address: " + addr)
        exec("mtcli query account " + addr, err => {
            if (err !== null) {
                exec("./mtcli.exp " + req.params.address, (err, stdout, stderr) => {
                    if (!err) {
                        console.log("Success")
                        res.send("Success")
                    } else {
                        console.log("Failed")
                        res.send("Failed")
                    }
                })
            } else {
                console.log("Account already exists")
                res.send("Account already exists")
            }
        })
    }
})

console.log("Listening on port 3000")
app.listen(3000)
