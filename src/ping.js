const https = require("https");

const options = {
  hostname: "gd-chess-server.herokuapp.com",
  port: 443,
  method: "GET",
};

module.exports = {
  self_ping: function ping() {
    const ping = https.request(options);
    ping.end();
  },
};
