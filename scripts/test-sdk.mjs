import { createClient } from '@insforge/sdk';

const baseUrl = 'https://vb9ucr22.us-east.insforge.app';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNzQ3MjZ9.CORVtgdxoKKq0AhdUN0RY8s1h3jHMUF3ZOB0CpmnoYk';

const client = createClient({ baseUrl, anonKey });

async function test() {
  try {
    const { data, error } = await client.database.rpc('get_customer_orders', { p_phone: '9876543210' });
    console.log('SDK test result:', { data, error });
  } catch (err) {
    console.error('SDK test failed:', err);
  }
}

test();
