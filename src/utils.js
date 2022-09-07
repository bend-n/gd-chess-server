export function str_obj(obj) {
  return JSON.stringify(obj, null, 0);
}

export function flip_int(int) {
  return int === 0 ? 1 : 0;
}

export function send_group_packet(data, header, clients) {
  clients.forEach((client) => {
    if (client) client.send_packet(data, header);
  });
}
