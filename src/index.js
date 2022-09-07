import ws from "ws";
const { Server } = ws;

const PORT = process.env.PORT || 3000;
const wss = new Server({ port: PORT }); // init server asap

import utils from "@gd-com/utils";
const { putVar, getVar } = utils;
import { command } from "./pg.js";
import { self_ping } from "./ping.js";
import { Chess } from "chess.js";

const HEADERS = {
  relay: "R",
  joinrequest: "J",
  hostrequest: "H",
  signal: "S",
  create_user: "C",
  signin: ">",
  loadpgn: "L",
  info: "I",
  move: "M",
  undo: "<",
  rematch: "r",
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

const auto_clean_clients = setInterval(() => {
  const keys = Object.keys(games);
  keys.forEach((key) => {
    const game = games[key];
    game.clean_clients();
  });
}, 20 * 1000);

function delete_game_if_empty(game) {
  if (game && game.dead) {
    console.log(`dead game: ${game.gamecode} deleted (${game.pgn})`);
    delete games[game.gamecode];
  }
}

const auto_clean_games = setInterval(() => {
  function clean_games() {
    const keys = Object.keys(games);
    keys.forEach((key) => {
      delete_game_if_empty(games[key]);
    });
  }
  clean_games();
}, 60 * 1000);

const auto_ping = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client) client.ping();
    else wss.clients.delete(client);
  });
}, 10 * 1000);

// to fix a wierd bug where it would kill itself for "idling" when alive
const ping_if_games = setInterval(() => {
  if (Object.keys(games).length > 0) self_ping();
}, 10 * 60 * 1000); // every ten minutes

wss.on("close", function close() {
  clearInterval(auto_clean_clients);
  clearInterval(auto_clean_games);
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
        case HEADERS.move:
          handle_move(data, ws);
          break;
        case HEADERS.joinrequest:
          handle_joinrequest(data, ws);
          break;
        case HEADERS.hostrequest:
          handle_hostrequest(data, ws);
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
        case HEADERS.rematch:
          handle_rematch(data, ws);
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
  function done(rejoin = false) {
    console.log("joinrequest:", data.gamecode);
    const i = game.clients.indexOf(undefined);
    game.clients[i] = ws;
    ws.send_packet({ idx: i }, HEADERS.joinrequest);
    if (!rejoin) {
      game.ids.push(data.id);
      game.infos.names.push(data.name);
      game.infos.countrys.push(data.country);
      send_group_packet(game.pgn, HEADERS.loadpgn, game.clients);
      if (game.clients[0] !== undefined)
        game.clients[0].send_packet(game.infos.get(1), HEADERS.info);
      if (game.clients[1] !== undefined)
        game.clients[1].send_packet(game.infos.get(0), HEADERS.info);
    } else ws.send_packet(game.pgn, HEADERS.loadpgn); // rejoin: dont send to both
    let other = i == 0 ? 1 : 0;
    if (game.clients[other] !== undefined)
      game.clients[other].send_packet(game.infos.get(i), HEADERS.info);
  }
  const game = games[data.gamecode];
  if (data.gamecode !== undefined && data.id !== undefined) {
    if (game !== undefined) {
      game.clean_clients(false); // clean before attempting to join
      if (game.ids.length < 2) done();
      else if (
        game.ids.includes(data.id) &&
        game.clients.indexOf(undefined) !== -1 &&
        data.id !== ""
      )
        done(true);
      else ws.send_packet("err: game full", HEADERS.joinrequest);
    } else ws.send_packet(`err: game does not exist`, HEADERS.joinrequest);
  } else ws.send_packet("err: gamecode or id not defined", HEADERS.joinrequest);
}

class Game {
  constructor(data, ws) {
    this.clients = [undefined, undefined];
    this.clients[Number(!data.team)] = ws;
    this.gamecode = data.gamecode;
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
    this.game = new Chess();
    if (data.hasOwnProperty("moves")) this.game.load_pgn(data.moves.join(" "));
  }
  get pgn() {
    return this.game.pgn();
  }
  //true for valid
  validate_move(move) {
    const res = this.game.move(move);
    if (str_obj(res) == "{}") return false;
    this.game.undo();
    return true;
  }
  move(move) {
    this.game.move(move);
  }
  undo() {
    this.game.undo();
  }
  remove_client(ws) {
    this.clients[this.clients.indexOf(ws)] = undefined;
  }

  clean_clients(set_is_alive = true) {
    this.spectators.forEach((spec) => {
      if (spec.is_alive === false) {
        spec.terminate();
        wss.clients.delete(spec);
        this.remove_spectator(spec);
      }
    });

    this.clients.forEach((client) => {
      if (client) {
        if (client.is_alive === false) {
          client.terminate();
          wss.clients.delete(client);
          this.remove_client(client);
          console.log("removed dead client from", this.gamecode);
        } else if (set_is_alive) client.is_alive = false; // becomes true on next ping
      }
    });
  }

  get dead() {
    this.clean_clients(false);
    return (
      this.clients[0] == undefined &&
      this.clients[1] == undefined &&
      this.spectators.length == 0
    );
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
  is_game_over() {
    return this.game.game_over();
  }
  reset_game() {
    this.game = new Chess();
  }
}

function handle_hostrequest(data, ws) {
  if (data.gamecode !== undefined && data.id !== undefined) {
    delete_game_if_empty(games[data.gamecode]); // see if its dead
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

function handle_move(data, ws) {
  const gc = data.gamecode;
  if (
    games.hasOwnProperty(data.gamecode) &&
    games[gc].validate_move(data.move) &&
    signal_other(data, ws, HEADERS.move)
  )
    games[gc].move(data.move);
}

function handle_undo(data, ws) {
  const gc = data.gamecode;
  const sent = signal_other(data, ws, HEADERS.undo);
  if (sent && data.accepted === true) {
    games[gc].undo();
    if (data.two === true) games[gc].undo();
  }
}

function handle_rematch(data, ws) {
  const gc = data.gamecode;
  if (games.hasOwnProperty(gc)) {
    if (games[gc].is_game_over() === true) {
      signal_other(data, ws, HEADERS.rematch);
      // check if its a request, and if the request is accepted
      if (data.accepted === true) games[gc].reset_game(); // reset if it is
    } else
      ws.send_packet(
        { accepted: false, err: "Game not over" },
        HEADERS.rematch
      );
  }
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
