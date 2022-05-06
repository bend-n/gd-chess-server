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
    let data = recieve.data;
    let header = recieve.header;
    console.log(`packet ${data} recieved with header ${header}`);
    if (header) {
      switch (header) {
        case HEADERS.move:
          if (games[data.gamecode] !== undefined) {
            console.log("move");
            games[data.gamecode].forEach((client) => {
              send_packet(data, HEADERS.move, client);
            });
            break;
          }
          console.log("game not found!");
          break;
        case HEADERS.joinrequest:
          console.log("joinrequest");
          if (games[data] !== undefined) {
            if (games[data].length < 2) {
              if (games[data][0] !== ws) {
                send_packet("Y", HEADERS.joinrequest, ws);
                games[data].push(ws);
              } else {
                send_packet(
                  "err: you have already joined",
                  HEADERS.joinrequest,
                  ws
                );
              }
            } else {
              send_packet("err: game full", HEADERS.joinrequest, ws);
            }
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
          games[data].forEach((client) => {
            send_packet("", HEADERS.stopgame, client);
          });
          delete games[data];
          break;
        default:
          console.log(`header ${header} unknown`);
          break;
      }
    }
  });
});
