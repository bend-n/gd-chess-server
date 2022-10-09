import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("database: err:", err);
});

export async function command(command) {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query(command);
    return res;
  } catch (err) {
    console.error("database: err:", err.stack);
  } finally {
    client.release();
  }
}
