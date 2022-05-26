/*jshint esversion: 6 */
const WebSocket = require("ws");
const gdCom = require("@gd-com/utils");

const PORT = process.env.PORT || 3000;

const wss = new WebSocket.Server({ port: PORT });

const HEADERS = {
  relay: "R",
  joinrequest: "J",
  hostrequest: "H",
  stopgame: "K",
  ping: "P",
  signal: "S",
};

let games = {};

function str_obj(obj) {
  return JSON.stringify(obj, null, 0);
}

function send_packet(data, header, client) {
  const packet = gdCom.putVar({ data: data, header: header });
  client.send(packet);
}

function send_group_packet(data, header, clients) {
  clients.forEach((client) => {
    send_packet(data, header, client);
  });
}

console.log(`Server started on port ${PORT}`);
wss.on("connection", (ws, req) => {
  console.log(`client connected (${req.socket.remoteAddress})`);
  // on message recieved
  ws.on("message", (message) => {
    let recieve = gdCom.getVar(Buffer.from(message)).value;
    let data = recieve.data;
    let header = recieve.header;
    console.log(`recieved ${str_obj(data)}`);
    if (header) {
      switch (header) {
        case HEADERS.relay:
          dual_relay(data, ws);
          break;
        case HEADERS.joinrequest:
          handle_joinrequest(data, ws);
          break;
        case HEADERS.hostrequest:
          handle_hostrequest(data, ws);
          break;
        case HEADERS.stopgame:
          handle_stop(data, ws);
          break;
        case HEADERS.ping:
          send_packet("", HEADERS.ping, ws);
          break;
        case HEADERS.signal:
          signal_other(data, ws);
          break;
        default:
          console.log(`header ${header} unknown`);
          break;
      }
    }
  });
});

function handle_joinrequest(data, ws) {
  console.log("joinrequest", data);
  if (games[data] !== undefined) {
    if (games[data].length < 2) {
      if (games[data][0] !== ws) {
        send_packet("Y", HEADERS.joinrequest, ws);
        games[data].push(ws);
      } else {
        send_packet("err: you have already joined", HEADERS.joinrequest, ws);
      }
    } else {
      send_packet("err: game full", HEADERS.joinrequest, ws);
    }
  } else {
    send_packet("err: game does not exist", HEADERS.joinrequest, ws);
  }
}

function handle_hostrequest(data, ws) {
  console.log("hostrequest: ", data);
  if (games[data] === undefined) {
    games[data] = [ws];
    send_packet("Y", HEADERS.hostrequest, ws);
    console.log(`game ${data} created`);
  } else {
    send_packet("err: game already exists", HEADERS.hostrequest, ws);
  }
}

function handle_stop(data, ws) {
  if (data.gamecode in games) {
    if (games[data.gamecode].includes(ws)) {
      console.log("stopgame " + data.gamecode);
      send_group_packet(data.reason, HEADERS.stopgame, games[data.gamecode]);
      delete games[data.gamecode];
    }
  }
}

// relays to both clients
function dual_relay(data, ws) {
  if (data.gamecode in games) {
    if (games[data.gamecode].includes(ws)) {
      send_group_packet(data, HEADERS.relay, games[data.gamecode]);
      console.log(`relaying ${str_obj(data)} to both clients`);
    }
  }
}

// relays to the other client
function signal_other(data, ws) {
  if (data.gamecode in games) {
    let i = games[data.gamecode].indexOf(ws);
    if (i !== -1) {
      let sendto = games[data.gamecode][i ? 0 : 1];
      send_packet(data, HEADERS.signal, sendto);
      console.log(`sending signal ${str_obj(data)}`);
    }
  }
}
