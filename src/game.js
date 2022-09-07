import { Chess } from "chess.js";
import { Infos } from "./infos.js";
import { str_obj, flip_int, send_group_packet } from "./utils.js";

export class Game {
  constructor(data, ws, wss) {
    this.wss = wss;
    this.hosterIndex = Number(!data.team);
    this.clients = [undefined, undefined];
    this.clients[this.hosterIndex] = ws; // team === true : 0 ? 1
    this.gamecode = data.gamecode;
    this.ids = [undefined, undefined]; // not a set so i can play against myself
    this.ids[this.hosterIndex] = data.id;
    this.infos = new Infos(this.hosterIndex, data.name, data.country);
    this.spectators = [];
    this.game = new Chess();
    if (data.hasOwnProperty("moves")) this.game.load_pgn(data.moves.join(" "));
  }
  get pgn() {
    return this.game.pgn();
  }

  get players() {
    let players = 0;
    this.ids.forEach((id) => {
      if (id !== undefined) players++;
    });
    return players;
  }

  get client_count() {
    let clients = 0;
    this.clients.forEach((client) => {
      if (client !== undefined) clients++;
    });
    return clients;
  }

  get joinerIndex() {
    return flip_int(this.hosterIndex);
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

  add_client(ws, data) {
    this.clients[this.joinerIndex] = ws;
    this.ids[this.joinerIndex] = data.id;
    this.infos.add(data.name, data.country);
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

    this.clients.forEach((client) => {
      remove_client(client, this.wss, this.remove_client.bind(this));
    });
  }

  get dead() {
    return this.client_count === 0 && this.spectators.length == 0;
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
