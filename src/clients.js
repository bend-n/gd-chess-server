import { pick } from "./utils.js";

/**
 * Creates data
 *
 * @param {WebSocket} ws Clients websocket
 * @param {String} id Clients id
 * @param {String} name Clients name
 * @param {String} country Clients country
 * @return {Object}
 */
function create_data(ws, id, name, country) {
  return {
    name: name,
    id: id,
    ws: ws,
    country: country,
  };
}

/**
 * Creates empty data
 *
 * @return {Object}
 */
function create_empty_data() {
  return {
    empty: true,
  };
}

/**
 * The clients class
 * Used by the `Game` class
 * Acts like a array
 *
 * @export
 * @class Clients
 */
export class Clients {
  /**
   * Creates an instance of `Clients`.
   * @param {WebSocket} ws The websocket that hosted
   * @param {String} id Hosters id
   * @param {String} name Hosters name
   * @param {String} country Hosters country
   * @param {Boolean} is_white Is hoster white
   * @memberof Clients
   * @constructor
   */
  constructor(ws, id, name, country, is_white) {
    this.add(ws, name, id, country, is_white);
    if (is_white) this.b = create_empty_data();
    else this.w = create_empty_data();
  }

  /**
   * Gets the websocket of a color
   *
   * @param {String} color The color
   * @return {WebSocket} The websocket
   * @memberof Clients
   */
  get_ws(color) {
    return color === "w" ? this.w.ws : this.b.ws;
  }

  /**
   * Gets the info of a color
   *
   * @param {String} color The color
   * @return {Object} The info
   * @memberof Clients
   */
  get_info(color) {
    return pick(color === "w" ? this.w : this.b, "name", "country");
  }

  /**
   * Returns a client list
   *
   * @return {WebSocket[]} The client list
   * @memberof Clients
   */
  get client_list() {
    return [this.get_ws("w"), this.get_ws("b")];
  }

  /**
   * Gets the number of players
   * players !== number of clients
   *
   * @return {Number} the number of players
   * @memberof Clients
   */
  get players() {
    let players = 0;
    if (!this.w.empty) players++;
    if (!this.b.empty) players++;
    return players;
  }

  /**
   * Gets the number of clients
   * clients !== number of players
   *
   * @return {Number} the number of clients
   * @memberof Clients
   */
  get length() {
    let client_count = 0;
    if (this.w.ws != undefined) client_count++;
    if (this.b.ws != undefined) client_count++;
    return client_count;
  }

  /**
   * Gets the info of white & black
   *
   * @return {Object}
   * @memberof Clients
   */
  get_all_info() {
    return { w: this.get_info("w"), b: this.get_info("b") };
  }

  /**
   * Adds a client
   *
   * @param {WebSocket} ws Client ws
   * @param {String} name Client name
   * @param {String} id Client id
   * @param {String} country Client country
   * @param {Boolean} [is_white=this.w.empty]
   * @memberof Clients
   */
  add(ws, name, id, country, is_white = this.w.empty) {
    if (is_white) this.w = create_data(ws, id, name, country);
    else this.b = create_data(ws, id, name, country);
  }

  /**
   * Is the client of color alive?
   *
   * @param {String} color The color
   * @return {Boolean} aliveness
   * @memberof Clients
   */
  alive(color) {
    return color === "w" ? !!this.w.ws : !!this.b.ws;
  }

  /**
   * Checks the color of a client
   * Employs fake function overloading
   *
   * @param {(String|WebSocket)} nameorws Clients name, or websocket
   * @param {(String|undefined)} country Clients country
   * @param {(String|undefined)} id Clients id
   * @return {*}
   * @memberof Clients
   */
  color_of(nameorws, country, id) {
    if (typeof nameorws == "string") {
      // if you check name, country AND id, even if there are duplicate ids (impossible) it wont have problems
      function check(on) {
        // if on doesnt have a name property, this will not error, because js
        return on.name === nameorws && on.country === country && on.id === id;
      }
      if (check(this.w)) return "w";
      else if (check(this.b)) return "b";
    } else if (typeof nameorws === "object") {
      if (this.w.ws === nameorws) return "w";
      if (this.b.ws === nameorws) return "b";
    }
  }

  /**
   * Erase the client
   *
   * @param {WebSocket} client The client to erase
   * @memberof Clients
   */
  erase(client) {
    if (this.w.ws === client) this.w.ws = undefined;
    else if (this.b.ws === client) this.b.ws = undefined;
  }
}
