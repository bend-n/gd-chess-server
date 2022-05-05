const WebSocket = require('ws')
const gdCom = require('@gd-com/utils')

const PORT = process.env.PORT || 3000;

const wss = new WebSocket.Server({ port: PORT })
console.log(`Server started on port ${PORT}`)
wss.on('connection', ws => {

  console.log("client connected")

  // on message recieved
  ws.on('message', (message) => {
    console.log("attempting to relay the message")
    wss.clients.forEach((client) => {
      console.log("relaying message to client")
      if (client.readyState === WebSocket.OPEN) {
        var recieve= gdCom.getVar(Buffer.from(message))
        console.log(recieve.value)
        client.send(gdCom.putVar(recieve))
      }})
  })
})
