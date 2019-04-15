const express = require('express')
const { exec } = require('child_process')

const app = express()

app.get('/:address', (req, res) => {
    const addr = req.params.address
    if (addr.startsWith("cosmos")) {
        console.log("Address: " + addr)
        exec("mtcli query account " + addr, err => {
            if (err !== null) {
                exec("~/.shapeshift/mtcli.exp " + req.params.address, (err, stdout, stderr) => {
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

app.listen(3000)
