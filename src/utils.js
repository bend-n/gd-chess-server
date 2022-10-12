/**
 * Stringifies a object
 * @param  {Object} obj The thing to be stringed
 * @return {String} The string representation of obj
 * @exports
 */
export function str_obj(obj) {
  return JSON.stringify(obj, null, 0);
}

/**
 * Flips a color: `w` -> `b`
 *
 * @param {String} color
 * @returns {String} !color
 * @exports
 */
export function flip_color(color) {
  return color === "w" ? "b" : "w";
}

/**
 * Sends a packet to multiple clients
 *
 * @param {Object} data The stuff to send
 * @param {String} header The header to use
 * @param {WebSocket[]} clients The clients to sendd it to
 * @exports
 */
export function send_group_packet(data, header, clients) {
  clients.forEach((client) => {
    if (client) client.send_packet(data, header);
  });
}

/**
 * Picks properties from a object
 *
 * @param {Object} o The object
 * @param {...String} props The properties
 * @returns {(undefined|Object)} undefined if o === undefined
 * @exports
 */
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
