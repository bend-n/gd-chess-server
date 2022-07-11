import { request } from "https";

const options = {
  hostname: "gd-chess-server.herokuapp.com",
  port: 443,
  method: "GET",
};

export const self_ping = function ping() {
  const ping = request(options);
  ping.end();
};
