import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("database: err:", err);
});

/**
 * Runs a SQL command on the database
 *
 * @param {String|Object} query The query to run
 * @returns {Promise<(undefined|Object)>} result
 */
export async function command(query) {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query(query);
    return res;
  } catch (err) {
    console.error("database: err:", err.stack);
  } finally {
    if (client) client.release();
  }
}
