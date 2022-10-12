import { request } from "https";

const options = {
  hostname: "gd-chess-server.herokuapp.com",
  port: 443,
  method: "GET",
};

/**
 * Pings self
 */
export function self_ping() {
  const ping = request(options);
  ping.end();
}
