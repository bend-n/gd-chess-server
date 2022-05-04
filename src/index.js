const net = require('net')
const { putVar, getVar } = require('@gd-com/utils')
const StreamTcp = require('./StreamTcp')

var port = process.env.PORT || 8910

let server = net.createServer((socket) => {
  const tcpSplit = new StreamTcp()
  socket.pipe(tcpSplit).on('data', (data) => {
    const packet = new Buffer.from(data)

    const decoded = getVar(packet)
    console.log('receive :', decoded.value)

    const packetToSend = putVar(Math.random())

     // we need to put the packet length on top cause it's tcp
     const lengthBuffer = Buffer.alloc(4)
     lengthBuffer.writeUInt32LE(packetToSend.length, 0)
     const toSend = Buffer.concat([lengthBuffer, packetToSend])

    console.log('send :', toSend)
    socket.write(toSend)
  })

  socket.on('error', () => console.log('Bye :('))
})

server.on('error', (err) => {
  throw err
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Server launched TCP 127.0.0.1:${9090}`)
})
