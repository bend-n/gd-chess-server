const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT }); // init server asap

const { putVar, getVar } = require("@gd-com/utils");
const { command } = require("./pg");

const HEADERS = {
  relay: "R",
  joinrequest: "J",
  hostrequest: "H",
  stopgame: "K",
  signal: "S",
  create_user: "C",
  signin: ">",
  loadpgn: "L",
  info: "I",
  move: "M",
  undo: "<",
};

// { gamecode: {clients: [], ids: [], infos: {names: [], countrys:[]} turn = true, pgn: ""} }
let games = {};

function str_obj(obj) {
  return JSON.stringify(obj, null, 0);
}

function send_packet(data, header, client) {
  const packet = putVar({ data: data, header: header });
  client.send(packet);
}

function send_group_packet(data, header, clients) {
  clients.forEach((client) => {
    if (client) send_packet(data, header, client);
  });
}

const interval = setInterval(() => {
  function cleanup_games() {
    const keys = Object.keys(games);
    keys.forEach((key) => {
      let clients = games[key].clients;
      clients.forEach((client) => {
        if (client) {
          if (client.is_alive === false) {
            client.terminate();
            wss.clients.delete(client);
            clients[clients.indexOf(client)] = undefined;
            console.log("removed dead client from", key);
          } else {
            client.is_alive = false; // becomes true on next ping
            client.ping();
          }
        }
        if (clients[0] == undefined && clients[1] == undefined) {
          delete games[key];
          console.log(`dead game: ${key} deleted`);
        }
      });
    });
  }
  cleanup_games();
}, 10000);

const random_ping = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client) client.ping();
  });
}, 20000);

function heartbeat() {
  this.is_alive = true;
}

wss.on("close", function close() {
  clearInterval(interval);
  clearInterval(random_ping);
});

console.log(`Server started on port ${PORT}`);
wss.on("connection", (ws, req) => {
  console.log(`client connected (${req.socket.remoteAddress})`);
  ws.is_alive = true;
  ws.on("pong", heartbeat);
  // on message recieved
  ws.on("message", (message) => {
    let recieve = getVar(Buffer.from(message)).value;
    let data = recieve.data;
    let header = recieve.header;
    console.log(
      `recieved ${str_obj(recieve)} from ${req.socket.remoteAddress}`
    );
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
        case HEADERS.signal:
          signal_other(data, ws);
          break;
        case HEADERS.create_user:
          signup(data, ws);
          break;
        case HEADERS.signin:
          signin(data, ws);
          break;
        case HEADERS.undo:
          handle_undo(data, ws);
          break;
        case HEADERS.move:
          handle_move(data, ws);
          break;
        default:
          console.log(`header ${header} unknown`);
          break;
      }
    }
  });
});

async function get_propertys(name) {
  const c = `SELECT * FROM users WHERE name = '${name}';`;
  const result = await command(c);
  return result.rows[0] ? result.rows[0] : undefined;
}

async function signin(data, ws) {
  const c = `SELECT id, country FROM users WHERE name = '${data.name}' AND password = '${data.password}';`;
  const res = await command(c);
  if (res.rows[0]) send_packet(res.rows[0], HEADERS.signin, ws);
  else send_packet("Incorrect credentials", HEADERS.signin, ws);
}

async function signup(data, ws) {
  console.log("attempting to create user");
  const res = await get_propertys(data.name);
  if (res) {
    send_packet("err: user already exists", HEADERS.create_user, ws);
    console.error("user already exists");
    return; // if existing, send err
  }

  async function init_user() {
    const c = `INSERT INTO users (name, country, password) VALUES ('${data.name}', '${data.country}',  '${data.password}') RETURNING id;`;
    const res = await command(c);
    console.log(`created user sucessully! (${c})`);
    return res.rows[0].id; // return the uuid
  }
  let id;
  try {
    id = await init_user();
  } catch (e) {
    const packet = `err: could not create user(${e.stack})`;
    send_packet(packet, HEADERS.create_user, ws);
    console.error(e.stack);
    return;
  }
  send_packet(id, HEADERS.create_user, ws);
}

function handle_joinrequest(data, ws) {
  const game = games[data.gamecode];
  function done(push = true) {
    console.log("joinrequest:", data.gamecode);
    const i = game.clients.indexOf(undefined);
    game.clients[i] = ws;
    if (push) {
      game.ids.push(data.id);
      game.infos.names.push(data.name);
      game.infos.countrys.push(data.country);
    }
    send_packet(game.infos.get(1), HEADERS.info, game.clients[0]);
    send_packet(game.infos.get(0), HEADERS.info, game.clients[1]); // give each their data
    if (!game.pgn) send_group_packet(game.pgn, HEADERS.loadpgn, game.clients);
    else send_packet(game.pgn, HEADERS.loadpgn, ws); // only send it to the new guy
    // if its empty send it to both(it acts as startgame signal)
    send_packet({ idx: i }, HEADERS.joinrequest, ws);
  }
  if (data.gamecode !== undefined && data.id !== undefined)
    if (game !== undefined)
      if (game.ids.length < 2) done();
      else if (
        game.ids.includes(data.id) &&
        game.clients.indexOf(undefined) !== -1 &&
        data.id !== ""
      )
        done(false);
      else {
        const packet =
          "err: game full ( if rejoining, please try again in 10-20 seconds )";
        send_packet(packet, HEADERS.joinrequest, ws);
      }
    else send_packet("err: game does not exist", HEADERS.joinrequest, ws);
  else send_packet("err: gamecode or id not defined", HEADERS.joinrequest, ws);
}

function handle_hostrequest(data, ws) {
  if (data.gamecode !== undefined && data.id !== undefined) {
    if (games[data.gamecode] === undefined) {
      console.log("hostrequest:", data.gamecode);
      games[data.gamecode] = {
        clients: [ws, undefined],
        ids: [data.id],
        infos: {
          names: [data.name],
          countrys: [data.country],
          get: function (index) {
            return {
              name: this.names[index],
              country: this.countrys[index],
            };
          },
        },
        moves: [],
        pgn: "",
        fullmoves: 1,
        turn: true,
        add_turn(move) {
          this.turn = !this.turn;
          if (this.turn) {
            this.moves.push(`${move}`);
            this.fullmoves++;
          } else this.moves.push(`${this.fullmoves}. ${move}`);
          this.pgn = this.moves.join(" ");
        },
        pop_move() {
          this.moves.pop();
          this.turn = !this.turn;
          if (!this.turn) this.fullmoves--;
          this.pgn = this.moves.join(" ");
          console.log("POPPED");
        },
      };
      send_packet({ idx: 0 }, HEADERS.hostrequest, ws);
      console.log(`game ${data.gamecode} created`);
    } else {
      const err_packet = `err: "${data.gamecode}" already exists`;
      send_packet(err_packet, HEADERS.hostrequest, ws);
    }
  } else
    send_packet("err: gamecode or id not defined", HEADERS.hostrequest, ws);
}

function handle_stop(data, ws) {
  if (games.hasOwnProperty(data.gamecode)) {
    if (games[data.gamecode].clients.includes(ws)) {
      console.log("stopgame " + data.gamecode);
      send_group_packet(
        data.reason,
        HEADERS.stopgame,
        games[data.gamecode].clients
      );
      delete games[data.gamecode];
    }
  }
}

function handle_move(data, ws) {
  if (dual_relay(data, ws, HEADERS.move))
    games[data.gamecode].add_turn(data.move);
}

function handle_undo(data, ws) {
  if (signal_other(data, ws, HEADERS.undo) && data.accepted == true) {
    console.log("calling popper");
    games[data.gamecode].pop_move();
  } else console.warn(data.accepted);
}

// relays to both clients
function dual_relay(data, ws, header = HEADERS.relay) {
  if (games.hasOwnProperty(data.gamecode)) {
    if (games[data.gamecode].clients.includes(ws)) {
      send_group_packet(data, header, games[data.gamecode].clients);
      console.log(`relaying ${str_obj(data)} to both clients`);
      return true;
    } else console.log(`requester is not in game ${data.gamecode}`);
  } else console.log(`dual relay: game ${data.gamecode} does not exist`);
  return false;
}

// relays to the other client
function signal_other(data, ws, header = HEADERS.signal) {
  if (games.hasOwnProperty(data.gamecode)) {
    let i = games[data.gamecode].clients.indexOf(ws);
    if (i !== -1) {
      let sendto = games[data.gamecode].clients[i ? 0 : 1];
      send_packet(data, header, sendto);
      console.log(`sending signal ${str_obj(data)}`);
      return true;
    } else console.log(`could not find client in game ${data.gamecode}`);
  }
  return false;
}
