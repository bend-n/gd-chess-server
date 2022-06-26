const { Server } = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new Server({ port: PORT }); // init server asap

const { putVar, getVar } = require("@gd-com/utils");
const { command } = require("./pg");
const { self_ping } = require("./ping");

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
  spectate: "0", // the eye
};

// { gamecode: {clients: {}, ids: {}, infos: {names: [], countrys:[]} turn = true, pgn: ""} }
let games = {};

function str_obj(obj) {
  return JSON.stringify(obj, null, 0);
}

function send_group_packet(data, header, clients) {
  clients.forEach((client) => {
    if (client) client.send_packet(data, header);
  });
}

const garbage_collector = setInterval(() => {
  function cleanup_games() {
    const keys = Object.keys(games);
    keys.forEach((key) => {
      // deal with clients dieing
      const game = games[key];
      let clients = game.clients;
      clients.forEach((client) => {
        if (client) {
          if (client.is_alive === false) {
            client.terminate();
            wss.clients.delete(client);
            game.remove_client(client);
            console.log("removed dead client from", key);
          } else {
            client.is_alive = false; // becomes true on next ping
          }
        }
        if (clients[0] == undefined && clients[1] == undefined) {
          console.log(`dead game: ${key} deleted (${game.pgn})`);
          delete games[key];
          return;
        }
      });
      // deal with spectators being ded
      let specs = game.spectators;
      specs.forEach((spec) => {
        if (spec.is_alive === false) {
          spec.terminate();
          wss.clients.delete(spec);
          game.remove_spectator(spec);
        }
      });
    });
  }
  cleanup_games();
}, 6 * 1000);

// ping every 5 seconds, but only engage gc every 6 seconds
const auto_ping = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client) client.ping();
    else wss.clients.delete(client);
  });
}, 5 * 1000);

// to fix a wierd bug where it would kill itself for "idling" when alive
const ping_if_games = setInterval(() => {
  if (Object.keys(games).length > 0) self_ping();
}, 10 * 60 * 1000); // every ten minutes

wss.on("close", function close() {
  clearInterval(garbage_collector);
  clearInterval(auto_ping);
  clearInterval(ping_if_games);
});

console.log(`Server started on port ${PORT}`);
wss.on("connection", (ws, req) => {
  console.log(`client connected (${req.socket.remoteAddress})`);
  ws.is_alive = true;
  ws.heartbeat = function heartbeat() {
    this.is_alive = true;
  };
  ws.send_packet = function send_packet(data, header) {
    const packet = putVar({ data: data, header: header });
    this.send(packet);
  };
  ws.on("pong", ws.heartbeat);
  // on message recieved
  ws.on("message", (message) => {
    let recieve = getVar(Buffer.from(message)).value;
    let data = recieve.data;
    let header = recieve.header;
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
        case HEADERS.spectate:
          handle_spectate(data, ws);
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
  if (res.rows[0]) ws.send_packet(res.rows[0], HEADERS.signin);
  else ws.send_packet("Incorrect credentials", HEADERS.signin);
}

async function signup(data, ws) {
  console.log("attempting to create user");
  const res = await get_propertys(data.name);
  if (res) {
    ws.send_packet("err: user already exists", HEADERS.create_user);
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
    ws.send_packet(packet, HEADERS.create_user);
    console.error(e.stack);
    return;
  }
  ws.send_packet(id, HEADERS.create_user);
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
      send_group_packet(game.pgn, HEADERS.loadpgn, game.clients);
    } else ws.send_packet(game.pgn, HEADERS.loadpgn); // rejoin: dont send to both
    game.clients[0].send_packet(game.infos.get(1), HEADERS.info);
    game.clients[1].send_packet(game.infos.get(0), HEADERS.info); // give each their data
    ws.send_packet({ idx: i }, HEADERS.joinrequest);
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
        ws.send_packet(packet, HEADERS.joinrequest);
      }
    else ws.send_packet(`err: game does not exist`, HEADERS.joinrequest);
  else ws.send_packet("err: gamecode or id not defined", HEADERS.joinrequest);
}

class Game {
  constructor(data, ws) {
    this.clients = [undefined, undefined];
    this.clients[Number(!data.team)] = ws;

    this.ids = [data.id]; // not a set so i can play against myself
    this.infos = {
      names: [data.name],
      countrys: [data.country],
      get(index) {
        return {
          name: this.names[index],
          country: this.countrys[index],
        };
      },
    };
    this.spectators = [];
    this.moves = [];
    this.fullmoves = 1;
    this.turn = true;
    if (data.moves) this.load_move_array(data.moves);
  }
  get pgn() {
    return this.moves.join(" ");
  }
  load_move_array(move_array) {
    move_array.forEach((item) => {
      this.add_turn(item);
    });
  }
  add_turn(move) {
    this.turn = !this.turn;
    if (this.turn) {
      this.moves.push(`${move}`);
      this.fullmoves++;
    } else this.moves.push(`${this.fullmoves}. ${move}`);
  }
  pop_move() {
    this.moves.pop();
    this.turn = !this.turn;
    if (!this.turn) this.fullmoves--;
  }
  remove_client(ws) {
    this.clients[this.clients.indexOf(ws)] = undefined;
  }
  add_spectator(ws) {
    this.spectators.push(ws);
  }
  remove_spectator(ws) {
    this.spectators.slice(this.spectators.indexOf(ws));
  }
  send_group_packet(packet, header) {
    delete packet.gamecode;
    send_group_packet(packet, header, this.clients);
    send_group_packet(packet, header, this.spectators);
  }
  send_signal_packet(data, ws, header) {
    let i = this.clients.indexOf(ws);
    if (i !== -1) {
      let sendto = this.clients[i ? 0 : 1];
      delete data.gamecode; // dont send the gamecode to the other player: waste of bytes
      if (sendto) {
        sendto.send_packet(data, header);
        console.log(`sending signal ${str_obj(data)}`);
        send_group_packet(data, header, this.spectators); // give it to the specs
        return true;
      }
    } else console.log(`could not find client in game ${data.gamecode}`);
    return false;
  }
}

function handle_hostrequest(data, ws) {
  if (data.gamecode !== undefined && data.id !== undefined) {
    if (games[data.gamecode] === undefined) {
      if (data.team == undefined) data.team = true;
      console.log("hostrequest:", data.gamecode);
      games[data.gamecode] = new Game(data, ws);
      ws.send_packet({ idx: Number(!data.team) }, HEADERS.hostrequest);
      console.log(`game ${data.gamecode} created`);
    } else {
      const err_packet = `err: "${data.gamecode}" already exists`;
      ws.send_packet(err_packet, HEADERS.hostrequest);
    }
  } else ws.send_packet("err: gamecode or id not defined", HEADERS.hostrequest);
}

function handle_stop(data, ws) {
  if (games.hasOwnProperty(data.gamecode)) {
    if (games[data.gamecode].clients.includes(ws)) {
      console.log("stopgame " + data.gamecode);
      games[data.gamecode].send_group_packet(data.reason, HEADERS.stopgame);
      delete games[data.gamecode]; // kill
    }
  }
}

function handle_move(data, ws) {
  const gc = data.gamecode;
  if (signal_other(data, ws, HEADERS.move)) games[gc].add_turn(data.move);
}

function handle_undo(data, ws) {
  const gc = data.gamecode;
  if (signal_other(data, ws, HEADERS.undo) && data.accepted == true)
    games[gc].pop_move();
}

function handle_spectate(data, ws) {
  if (games.hasOwnProperty(data.gamecode)) {
    const game = games[data.gamecode];
    console.log("spectate " + data.gamecode);
    game.add_spectator(ws);
    const packet = {
      white: game.infos.get(0),
      black: game.infos.get(1),
      pgn: game.pgn,
    }; // spectator starter kit
    // provides white info, black info, and pgn
    ws.send_packet(packet, HEADERS.spectate);
  } else ws.send_packet("err: game does not exist", HEADERS.spectate);
}

// relays to both clients
function dual_relay(data, ws, header = HEADERS.relay) {
  if (games.hasOwnProperty(data.gamecode)) {
    games[data.gamecode].send_group_packet(data, header);
    console.log(`relaying ${str_obj(data)} to both clients`);
    return true;
  } else console.log(`dual relay: game ${data.gamecode} does not exist`);
  return false;
}

// relays to the other client
function signal_other(data, ws, header = HEADERS.signal) {
  if (games.hasOwnProperty(data.gamecode))
    return games[data.gamecode].send_signal_packet(data, ws, header);
  return false;
}
