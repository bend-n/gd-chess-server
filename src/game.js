import { Chess } from "chess.js";
import { Clients } from "./clients.js";
import { str_obj, send_group_packet, flip_color } from "./utils.js";

export class Game {
  constructor(data, ws, wss) {
    this.wss = wss;
    this.gamecode = data.gamecode;
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

  get pgn() {
    return this.game.pgn();
  }

  get players() {
    return this.clients.players;
  }

  get client_count() {
    return this.clients.length;
  }

  get client_list() {
    return this.clients.client_list;
  }

  // true for valid
  validate_move(move) {
    const res = this.game.move(move);
    if (str_obj(res) == "{}") return false;
    this.game.undo();
    return true;
  }

  add_client(ws, data, is_white = this.clients.w.empty) {
    this.clients.add(ws, data.name, data.id, data.country, is_white);
    return is_white ? 0 : 1;
  }

  clean_clients(set_is_alive = true) {
    function remove_client(c, wss, removal_func) {
      if (c) {
        if (c.is_alive === false) {
          removal_func(c);
          c.terminate();
          wss.clients.delete(c);
        } else if (set_is_alive) c.is_alive = false; // becomes true on next ping
      }
    }

    this.spectators.forEach((spec) => {
      remove_client(spec, this.wss, this.remove_spectator.bind(this));
    });

    this.client_list.forEach((client) => {
      remove_client(client, this.wss, this.remove_client.bind(this));
    });
  }

  get dead() {
    return this.client_count === 0 && this.spectators.length == 0;
  }

  remove_spectator(ws) {
    this.spectators.slice(this.spectators.indexOf(ws));
  }

  send_group_packet(packet, header) {
    delete packet.gamecode;
    send_group_packet(packet, header, this.clients.client_list);
    send_group_packet(packet, header, this.spectators);
  }

  send_signal_packet(data, ws, header) {
    let us = this.color_of(ws);
    if (us !== undefined) {
      let sendto = this.get_ws(flip_color(us));
      delete data.gamecode; // dont send the gamecode to the other player: waste of bytes
      if (sendto) {
        sendto.send_packet(data, header);
        send_group_packet(data, header, this.spectators); // give it to the specs
        return true;
      }
    } else console.log(`could not find client in game ${data.gamecode}`);
    return false;
  }

  reset_game() {
    this.game = new Chess();
  }
}
