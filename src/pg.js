const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err, client) => {
  console.error("Error:", err);
});

async function command(command) {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query(command);
    return res;
  } catch (err) {
    console.error(err.stack);
  } finally {
    client.release();
  }
}

module.exports = {
  command: command,
};
