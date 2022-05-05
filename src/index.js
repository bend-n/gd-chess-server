const WebSocket = require("ws");
const gdCom = require("@gd-com/utils");

const PORT = process.env.PORT || 3000;

const wss = new WebSocket.Server({ port: PORT });

const HEADERS = {
  move: "M",
  joinrequest: "J",
  hostrequest: "H",
  stopgame: "K",
};

let games = {};

function send_packet(string, header, client) {
  const packet = gdCom.putVar({ string: string, header: header });
  client.send(packet);
}

console.log(`Server started on port ${PORT}`);
wss.on("connection", (ws) => {
  console.log("client connected");

  // on message recieved
  ws.on("message", (message) => {
    let recieve = gdCom.getVar(Buffer.from(message)).value;

    let data = recieve.string;
    console.log(`packet ${data} recieved with header ${recieve.header}`);
    if (recieve.header) {
      switch (recieve.header) {
        case HEADERS.move:
          console.log("move");
          break;
        case HEADERS.joinrequest:
          console.log("joinrequest");
          if (games[data] !== undefined && games[data].length < 2) {
            send_packet("Y", HEADERS.joinrequest, ws);
            games[data].push(ws);
          } else {
            send_packet("err: game does not exist", HEADERS.joinrequest, ws);
          }
          break;
        case HEADERS.hostrequest:
          console.log("hostrequest");
          if (games[data] === undefined) {
            games[data] = [ws];
            send_packet("Y", HEADERS.hostrequest, ws);
            console.log(`game ${data} created`);
          } else {
            send_packet("err: game already exists", HEADERS.hostrequest, ws);
          }
          break;
        case HEADERS.stopgame:
          console.log("stopgame " + data);
          delete games[data];
          break;
        default:
          console.log(`header ${recieve.header} unknown`);
          break;
      }
    }
  });
});
