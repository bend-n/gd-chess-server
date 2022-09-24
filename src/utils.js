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
