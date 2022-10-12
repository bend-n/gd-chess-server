import { WebSocket, WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT }); // init server asap

import utils from "@gd-com/utils";
const { putVar, getVar } = utils;
import { command } from "./pg.js";
import { self_ping } from "./ping.js";
import { Game } from "./game.js";
import { flip_color, fail } from "./utils.js";

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

/**
 * Delete game if empty
 *
 * @param {(Object|undefined)} game The game
 */
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
  console.log(`client connected (${req.headers["x-forwarded-for"] || req.socket.remoteAddress})`);
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
          console.warn(`header '${header}' unknown`);
          break;
      }
    }
  });
});

/**
 * Gets the properties of a user, by name
 *
 * @param {String} name The name
 * @return {Promise<(string|undefined)>} The properties
 */
async function get_propertys(name) {
  const c = `SELECT * FROM users WHERE name = '${name}';`;
  const result = await command(c);
  return result.rows[0] ? result.rows[0] : undefined;
}

/**
 * Signs in a user
 *
 * @param {Object} data The packet the client sent
 * @param {WebSocket} ws The client websocket, to be talked to
 * @return {Promise<void>}
 */
async function signin(data, ws) {
  const c = `SELECT id, country FROM users WHERE name = '${data.name}' AND password = '${data.password}';`;
  const res = await command(c);
  if (fail(!res.rows[0], ws, "INVALID_DATA", HEADERS.signin)) return;
  ws.send_packet(res.rows[0], HEADERS.signin);
}

/**
 * Signs up a user
 *
 * @param {Object} data The packet the client sent
 * @param {WebSocket} ws The clients websocket, to be talked to
 * @return {Promise<void>}
 */
async function signup(data, ws) {
  const res = await get_propertys(data.name);
  if (fail(res, ws, "ALREADY_EXISTS", HEADERS.create_user)) return; // if existing, fail

  /**
   * Creates the user
   *
   * @return {Promise<String>} uuid
   */
  async function init_user() {
    const c = `INSERT INTO users (name, country, password) VALUES ('${data.name}', '${data.country}',  '${data.password}') RETURNING id;`;
    const res = await command(c);
    console.log(`created user '${data.name}', '${data.country}' sucessully!`);
    return res.rows[0].id;
  }
  let id;
  try {
    id = await init_user();
  } catch (e) {
    const packet = { err: "FAILED", stack: e.stack };
    ws.send_packet(packet, HEADERS.create_user);
    console.error("signup failed\n", e.stack);
    return;
  }
  ws.send_packet({ id: id }, HEADERS.create_user);
}

/**
 * Handle a request to join.
 * > **Note** Hoster does *not* call this function with itself, joiner must tell hoster about joiner
 *
 * @param {Object} data The packet the websocket sent
 * @param {WebSocket} ws The websocket calling this
 */
function handle_joinrequest(data, ws) {
  function send_info(they_know_about_me = false) {
    const us = game.clients.color_of(ws);
    const them = flip_color(us);
    // in a ideal world, clients dont disconnect and stop existing. we do not live in a ideal world. (sadly) (or they just left the game :/)
    if (game.alive(them) && !they_know_about_me) game.get_ws(them).send_packet(game.get_info(us), HEADERS.info);

    // send a packet to us
    game.get_ws(us).send_packet(game.get_info(them), HEADERS.info);
  }

  if (fail(!data.id, ws, "NO_ID", HEADERS.joinrequest)) return;
  if (fail(!data.gamecode, ws, "NO_GAMECODE", HEADERS.joinrequest)) return;
  const game = games[data.gamecode];
  if (fail(game === undefined, ws, "NOT_EXIST", HEADERS.joinrequest)) return;

  if (game.players < 2) {
    // hoster is waiting for someone to join
    const joiner_idx = game.add_client(ws, data);
    ws.send_packet({ idx: joiner_idx }, HEADERS.joinrequest); // tell them what team they are
    game.send_group_packet(game.pgn, HEADERS.loadpgn); // hoster doesnt send a joinrequest, so tell it to load pgn too
    send_info();
    console.log(`'${data.name}' joined '${data.gamecode}'`);
  } else {
    let color = game.color_of(data.name, data.country, data.id);

    if (fail(color === undefined, ws, "FULL", HEADERS.joinrequest)) {
      console.warn(
        `rejected join to '${data.gamecode}' (by '${data.name}'): game full / id(${data.id}) not included in ${game.ids}`
      );
      return;
    }
    // someone is trying to rejoin
    console.log(`'${data.name}' rejoined '${data.gamecode}' as ${color}`);
    ws.send_packet({ idx: color == "w" ? 0 : 1 }, HEADERS.joinrequest);
    game.add_client(ws, data, color == "w");
    ws.send_packet(game.pgn, HEADERS.loadpgn); // pass them the pgn
    send_info(true); // and send them their opponents info
  }
}

/**
 * Handle a hostrequest
 *
 * @param {Object} data The packet the websocket sent
 * @param {WebSocket} ws The websocket
 */
function handle_hostrequest(data, ws) {
  if (fail(data.id === undefined, ws, "NO_ID", HEADERS.hostrequest)) return; // fail conds
  if (fail(data.gamecode === undefined, ws, "NO_GAMECODE", HEADERS.hostrequest)) return;

  const g = games[data.gamecode];
  delete_game_if_empty(g); // see if its dead

  if (fail(!!g, ws, g && g.players < 2 ? "ALREADY_EXISTS_EMPTY" : "ALREADY_EXISTS", HEADERS.hostrequest)) return;

  if (data.team == undefined) data.team = true;
  games[data.gamecode] = new Game(data, ws, wss);
  ws.send_packet({ idx: Number(!data.team) }, HEADERS.hostrequest);
  console.log(`'${data.name}' hosted '${data.gamecode}'`);
}

/**
 * Handle a move request:
 * Make a move, if the move is legal.
 *
 * @param {Object} data The packet the websocket sent
 * @param {WebSocket} ws The websocket
 */
function handle_move(data, ws) {
  const gc = ws.gamecode;
  if (!(games.hasOwnProperty(gc) && games[gc].validate_move(data.move) && signal_other(data, ws, HEADERS.move)))
    return;
  games[gc].move(data.move);
  const player = games[gc].get_info(games[gc].game.turn).name;
  console.log(`'${player}' made move '${data.move}' on '${gc}'`);
}

/**
 * Handle a undo request
 *
 * @param {Object} data The packet the websocket sent
 * @param {WebSocket} ws The websocket
 */
function handle_undo(data, ws) {
  if (!signal_other(data, ws, HEADERS.undo) && data.accepted !== true) return;

  games[ws.gamecode].undo();
  if (data.two === true) games[ws.gamecode].undo(); // do it again
}

/**
 * Handle a rematch request
 *
 * @param {Object} data The packet the websocket sent
 * @param {WebSocket} ws The websocket
 */
function handle_rematch(data, ws) {
  if (!signal_other(data, ws, HEADERS.rematch)) return;

  // check if its a request, and if the request is accepted
  if (data.accepted === true) games[ws.gamecode].reset_game(); // reset if it is
}

/**
 * Handle a spectate request
 *
 * @param {Object} data The packet the websocket sent
 * @param {WebSocket} ws The websocket
 */
function handle_spectate(data, ws) {
  if (fail(!games.hasOwnProperty(data.gamecode), ws, "NOT_EXIST", HEADERS.spectate)) return;

  const game = games[data.gamecode];
  game.add_spectator(ws);
  const packet = {
    white: game.get_info("w"),
    black: game.get_info("b"),
    pgn: game.pgn,
  }; // spectator starter kit: provides white info, black info, and pgn
  ws.send_packet(packet, HEADERS.spectate);
}

/**
 * Relays to both clients
 *
 * @param {Object} data The packet to send
 * @param {WebSocket} ws The websocket
 * @param {String} [header=HEADERS.relay] The header to be used
 * @return {Boolean} success
 */
function dual_relay(data, ws, header = HEADERS.relay) {
  if (!games.hasOwnProperty(ws.gamecode)) return false;

  games[ws.gamecode].send_group_packet(data, header);
  return true;
}

/**
 * Signals to the other client
 *
 * @param {Object} data The packet to send
 * @param {WebSocket} ws The websocket
 * @param {String} [header=HEADERS.signal] The header to use
 * @return {Boolean} success
 */
function signal_other(data, ws, header = HEADERS.signal) {
  if (!games.hasOwnProperty(ws.gamecode)) return false;
  return games[ws.gamecode].send_signal_packet(data, ws, header);
}
