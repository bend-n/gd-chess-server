import { pick } from "./utils.js";

function create_data(ws, id, name, country) {
  return {
    name: name,
    id: id,
    ws: ws,
    country: country,
  };
}

function create_empty_data() {
  return {
    empty: true,
  };
}

export class Clients {
  constructor(ws, id, name, country, is_white) {
    this.add(ws, name, id, country, is_white);
    if (is_white) this.b = create_empty_data();
    else this.w = create_empty_data();
  }

  get_ws(color) {
    return color === "w" ? this.w.ws : this.b.ws;
  }

  get_info(color) {
    return pick(color === "w" ? this.w : this.b, "name", "country");
  }

  get client_list() {
    return [this.get_ws("w"), this.get_ws("b")];
  }

  get players() {
    let players = 0;
    if (!this.w.empty) players++;
    if (!this.b.empty) players++;
    return players;
  }

  get length() {
    let client_count = 0;
    if (this.w.ws != undefined) client_count++;
    if (this.b.ws != undefined) client_count++;
    return client_count;
  }

  get_all_info() {
    return { w: this.get_info("w"), b: this.get_info("b") };
  }

  add(ws, name, id, country, is_white = this.w.empty) {
    if (is_white) this.w = create_data(ws, id, name, country);
    else this.b = create_data(ws, id, name, country);
  }

  alive(color) {
    return color === "w" ? !!this.w.ws : !!this.b.ws;
  }

  // fake function overloading
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

  erase(client) {
    if (this.w.ws === client) this.w.ws = undefined;
    else if (this.b.ws === client) this.b.ws = undefined;
  }
}
