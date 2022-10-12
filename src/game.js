import { Chess } from "chess.js";
import { Clients } from "./clients.js";
import { str_obj, send_group_packet, flip_color } from "./utils.js";

export class Game {
  constructor(data, ws, wss) {
    this.wss = wss;
    this.gamecode = data.gamecode;
    ws.gamecode = this.gamecode;
    this.clients = new Clients(ws, data.id, data.name, data.country, data.team);
    this.spectators = [];
    this.game = new Chess();
    if (data.hasOwnProperty("moves")) {
      if (typeof data.moves == "string") this.game.load_pgn(data.moves);
      else this.game.load_pgn(data.moves.join(" "));
    }

    // create func aliases
    this.get_info = this.clients.get_info.bind(this.clients);
    this.get_ws = this.clients.get_ws.bind(this.clients);
    this.color_of = this.clients.color_of.bind(this.clients);
    this.alive = this.clients.alive.bind(this.clients);
    this.remove_client = this.clients.erase.bind(this.clients);
    this.add_spectator = this.spectators.push;

    this.is_game_over = this.game.game_over;
    this.move = this.game.move;
    this.undo = this.game.undo;
  }
  /**
   * Gets the games pgn
   *
   * @returns {String} the games PGN
   */
  get pgn() {
    return this.game.pgn();
  }

  /**
   * Gets the number of players
   * players !== number of clients
   *
   * @returns {Number} the number of players
   */
  get players() {
    return this.clients.players;
  }

  /**
   * Gets the number of clients
   * clients !== number of players
   *
   * @returns {Number} the number of clients
   */
  get client_count() {
    return this.clients.length;
  }

  /**
   * Gets the list of clients
   *
   * @returns {WebSocket[]} the list of clients
   */
  get client_list() {
    return this.clients.client_list;
  }

  /**
   * Checks if a move is valid
   *
   * @param {String} move the move
   * @returns {Boolean} valid
   */
  validate_move(move) {
    const res = this.game.move(move);
    if (str_obj(res) == "{}") return false;
    this.game.undo();
    return true;
  }
  /**
   * Adds a client
   *
   * @param  {WebSocket} ws The websocket of the client
   * @param  {Object} data The packet the client sent
   * @param  {Boolean} is_white=has_empty_slot Is the client white
   */
  add_client(ws, data, is_white = this.clients.w.empty) {
    this.clients.add(ws, data.name, data.id, data.country, is_white);
    ws.gamecode = this.gamecode;
    return is_white ? 0 : 1;
  }

  /**
   * Cleans dead clients
   *
   * @param  {} set_is_alive=true To set `websocket.is_alive` = false or not
   */
  clean_clients(set_is_alive = true) {
    /**
     * @param  {WebSocket} c client
     * @param  {WebSocketServer} wss websocketserver
     * @param  {CallableFunction} removal_func
     */
    function remove_client(c, wss, removal_func) {
      if (!c) return;
      if (c.is_alive === true && set_is_alive) {
        c.is_alive = false;
        return;
      }
      removal_func(c);
      c.terminate();
      wss.clients.delete(c);
    }

    this.spectators.forEach((spec) => {
      remove_client(spec, this.wss, this.remove_spectator.bind(this));
    });

    this.client_list.forEach((client) => {
      remove_client(client, this.wss, this.remove_client.bind(this));
    });
  }
  /**
   * Checks if the game is dead: no clients & no spectators
   *
   * @returns {Boolean} is dead
   */
  get dead() {
    return this.client_count === 0 && this.spectators.length == 0;
  }

  /**
   * Removes a spectator websocket
   *
   * @param  {WebSocket} ws The websocket to remove
   * @callback
   */
  remove_spectator(ws) {
    this.spectators.slice(this.spectators.indexOf(ws));
  }
  /**
   * Sends a packet to the clients and spectators
   *
   * @param  {Object} packet The packet to send
   * @param  {String} header The header to use
   */
  send_group_packet(packet, header) {
    delete packet.gamecode;
    send_group_packet(packet, header, this.clients.client_list);
    send_group_packet(packet, header, this.spectators);
  }
  /**
   * Sends a packet to the opponent, and spectators
   *
   * @param  {Object} data The packet to send
   * @param  {WebSocket} ws The thing thats sending it
   * @param  {String} header The header to use
   */
  send_signal_packet(data, ws, header) {
    let us = this.color_of(ws);
    if (us === undefined) return false;
    let sendto = this.get_ws(flip_color(us));
    if (!sendto) return false;
    sendto.send_packet(data, header);
    send_group_packet(data, header, this.spectators); // give it to the specs
    return true;
  }

  /**
   * Reset the internal game
   */
  reset_game() {
    this.game = new Chess();
  }
}
