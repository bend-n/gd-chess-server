export function str_obj(obj) {
  return JSON.stringify(obj, null, 0);
}

export function flip_color(color) {
  return color === "w" ? "b" : "w";
}

export function send_group_packet(data, header, clients) {
  clients.forEach((client) => {
    if (client) client.send_packet(data, header);
  });
}

export function pick(o, ...props) {
  if (o === undefined) return undefined;
  return Object.assign({}, ...props.map((prop) => ({ [prop]: o[prop] })));
}

/**
 * Sends a error message on condition
 *
 * @param {Boolean} when When to fail
 * @param {WebSocket} ws The websocket to send the error message to
 * @param {String} err The error message
 * @param {String} header The header used
 * @return {Boolean} `when`
 * @exports
 */
export function fail(when, ws, err, header) {
  if (when) ws.send_packet({ err: err }, header);
  return when;
}
