const WebSocket = require('ws')
const gdCom = require('@gd-com/utils')

const PORT = process.env.PORT || 3000;

const wss = new WebSocket.Server({ port: PORT })
console.log(`Server started on port ${PORT}`)
wss.on('connection', ws => {
  console.log('connected')
  ws.on('message', (message) => {
    let recieveBuff = Buffer.from(message)
    let recieve = gdCom.getVar(recieveBuff)
    console.log(recieve.value)

    let buffer = gdCom.putVar(Math.random())
    ws.send(buffer)
  })
})
