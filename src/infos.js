import { flip_int } from "./utils.js";

export class Infos {
  constructor(hosterIndex, hosterName, hosterCountry) {
    this.hosterIndex = hosterIndex;
    this.names = ["Anonymous", "Anonymous"];
    this.names[hosterIndex] = hosterName;
    this.countrys = ["rainbow", "rainbow"];
    this.countrys[hosterIndex] = hosterCountry;
  }
  get(index) {
    return {
      name: this.names[index],
      country: this.countrys[index],
    };
  }

  get_all() {
    return { w: this.get(0), b: this.get(1) };
  }

  get joinerIndex() {
    return flip_int(this.hosterIndex);
  }

  add(name, country) {
    this.names[this.joinerIndex] = name;
    this.countrys[this.joinerIndex] = country;
  }
}
