// One-off support tool: prints a real login link for a customer's account,
// without ever setting or knowing their password. Use this when a customer
// has explicitly asked you to log in and help (e.g. connecting a device) —
// open the printed link in your own browser and you're signed in as them.
//
// Needs the SAME .env this folder's push-server.js/index.js already use
// (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — the service-role key is what
// makes this possible, so never commit it or paste it anywhere outside
// your own .env.
//
// Usage:
//   node generate-login-link.js customer@example.com
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const email = process.argv[2];
if (!email) {
  console.error('Usage: node generate-login-link.js <customer-email>');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in this folder\'s .env (same one push-server.js uses).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) {
    console.error(`Could not generate a link for ${email}:`, error.message);
    process.exit(1);
  }
  console.log(`\nOpen this in your own browser to sign in as ${email} — it's single-use and expires quickly:\n`);
  console.log(data.properties.action_link);
  console.log('\nNo password was set, seen, or changed for this account.\n');
}

main();
