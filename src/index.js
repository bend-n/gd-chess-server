import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT }); // init server asap

import utils from "@gd-com/utils";
const { putVar, getVar } = utils;
import { command } from "./pg.js";
import { self_ping } from "./ping.js";
import { Game } from "./game.js";
import { flip_color } from "./utils.js";

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
  console.log(
    `client connected (${
      req.headers["x-forwarded-for"] || req.socket.remoteAddress
    })`
  );
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
  else ws.send_packet({ err: "INVALID_DATA" }, HEADERS.signin);
}

async function signup(data, ws) {
  const res = await get_propertys(data.name);
  if (res) {
    ws.send_packet({ err: "ALREADY_EXISTS" }, HEADERS.create_user);
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
    const packet = { err: "FAILED", stack: e.stack };
    ws.send_packet(packet, HEADERS.create_user);
    console.error(e.stack);
    return;
  }
  ws.send_packet({ id: id }, HEADERS.create_user);
}

// hoster does *not* call this function with itself. joiner must tell hoster about itself
function handle_joinrequest(data, ws) {
  function send_info(they_know_about_me = false) {
    const us = game.clients.color_of(ws);
    const them = flip_color(us);
    // in a ideal world, clients dont disconnect and stop existing. we do not live in a ideal world. (sadly) (or they just left the game :/)
    if (game.exists(them) && !they_know_about_me)
      game.get_ws(them).send_packet(game.get_info(us), HEADERS.info);

    // send a packet to us
    game.get_ws(us).send_packet(game.get_info(them), HEADERS.info);
  }

  const game = games[data.gamecode];
  if (data.id) {
    if (data.gamecode !== undefined) {
      if (game !== undefined) {
        if (game.players < 2) {
          // hoster is waiting for someone to join
          game.add_client(ws, data);
          ws.send_packet({ idx: game.joinerIndex }, HEADERS.joinrequest); // tell them what team they are
          game.send_group_packet(game.pgn, HEADERS.loadpgn); // hoster doesnt send a joinrequest, so tell it to load pgn too
          send_info();
          console.log(`${data.name} joined ${data.gamecode}`);
        } else {
          let color = game.color_of(data.name, data.country, data.id);
          if (color != undefined) {
            // someone is trying to rejoin
            console.log(`rejoin ${data.name} to ${color}`);
            game.add_client(ws, data, color == "w");
            ws.send_packet(game.pgn, HEADERS.loadpgn); // pass them the pgn
            send_info(true); // and send them their opponents info
          } else {
            console.log(
              `rejected join to ${data.gamecode} (by ${data.name}): game full / id(${data.id}) not included in ${game.ids}`
            );
            ws.send_packet({ err: "FULL" }, HEADERS.joinrequest);
          }
        }
      } else ws.send_packet({ err: "NOT_EXIST" }, HEADERS.joinrequest);
    } else ws.send_packet({ err: "NO_GAMECODE" }, HEADERS.joinrequest);
  } else ws.send_packet({ err: "NO_ID" }, HEADERS.joinrequest);
}

function handle_hostrequest(data, ws) {
  if (data.id !== undefined) {
    if (data.gamecode !== undefined) {
      delete_game_if_empty(games[data.gamecode]); // see if its dead
      if (games[data.gamecode] === undefined) {
        if (data.team == undefined) data.team = true;
        games[data.gamecode] = new Game(data, ws, wss);
        ws.send_packet({ idx: Number(!data.team) }, HEADERS.hostrequest);
        console.log(`game ${data.gamecode} created`);
      } else if (games[data.gamecode].players < 2)
        ws.send_packet({ err: "ALREADY_EXISTS_EMPTY" }, HEADERS.hostrequest);
      else ws.send_packet({ err: "ALREADY_EXISTS" }, HEADERS.hostrequest);
    } else ws.send_packet({ err: "NO_GAMECODE" }, HEADERS.hostrequest);
  } else ws.send_packet({ err: "NO_ID" }, HEADERS.hostrequest);
}

function handle_move(data, ws) {
  const gc = data.gamecode;
  if (
    games.hasOwnProperty(data.gamecode) &&
    games[gc].validate_move(data.move) &&
    signal_other(data, ws, HEADERS.move)
  )
    console.log("made move", data.move, "on", gc);
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
    signal_other(data, ws, HEADERS.rematch);
    // check if its a request, and if the request is accepted
    if (data.accepted === true) games[gc].reset_game(); // reset if it is
  }
}

function handle_spectate(data, ws) {
  if (games.hasOwnProperty(data.gamecode)) {
    const game = games[data.gamecode];
    game.add_spectator(ws);
    const packet = {
      white: game.infos.get(0),
      black: game.infos.get(1),
      pgn: game.pgn,
    }; // spectator starter kit
    // provides white info, black info, and pgn
    ws.send_packet(packet, HEADERS.spectate);
  } else ws.send_packet({ err: "NOT_EXIST" }, HEADERS.spectate);
}

// relays to both clients
function dual_relay(data, ws, header = HEADERS.relay) {
  if (games.hasOwnProperty(data.gamecode)) {
    games[data.gamecode].send_group_packet(data, header);
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
