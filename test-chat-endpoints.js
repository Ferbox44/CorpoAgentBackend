const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testChatEndpoints() {
  try {
    console.log('🚀 Testing Chat Backend Endpoints...\n');

    // 1. Register a new user
    console.log('1. Registering new user...');
    const registerResponse = await axios.post(`${BASE_URL}/auth/register`, {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
      role: 'user',
      department: 'IT'
    });
    console.log('✅ User registered:', registerResponse.data.user.name);
    const token = registerResponse.data.access_token;

    // 2. Login with the user
    console.log('\n2. Logging in...');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'test@example.com',
      password: 'password123'
    });
    console.log('✅ User logged in:', loginResponse.data.user.name);
    const authToken = loginResponse.data.access_token;

    // 3. Get session (should create one)
    console.log('\n3. Getting chat session...');
    const sessionResponse = await axios.get(`${BASE_URL}/chat/session`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('✅ Session retrieved:', sessionResponse.data.id);

    // 4. Send a text message
    console.log('\n4. Sending text message...');
    const messageResponse = await axios.post(`${BASE_URL}/chat/send`, {
      content: 'Hello, can you help me analyze some data?'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('✅ Message sent and AI responded');

    // 5. Get messages
    console.log('\n5. Getting messages...');
    const messagesResponse = await axios.get(`${BASE_URL}/chat/messages`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log(`✅ Retrieved ${messagesResponse.data.length} messages`);

    // 6. Test file upload (create a simple test file)
    console.log('\n6. Testing file upload...');
    const FormData = require('form-data');
    const fs = require('fs');
    
    // Create a simple test CSV file
    const testData = 'name,age,department\nJohn,30,IT\nJane,25,HR';
    fs.writeFileSync('test-data.csv', testData);
    
    const form = new FormData();
    form.append('file', fs.createReadStream('test-data.csv'));
    form.append('request', 'Analyze this employee data');

    const fileResponse = await axios.post(`${BASE_URL}/chat/send-file`, form, {
      headers: { 
        Authorization: `Bearer ${authToken}`,
        ...form.getHeaders()
      }
    });
    console.log('✅ File uploaded and processed');

    // 7. Get updated messages
    console.log('\n7. Getting updated messages...');
    const updatedMessagesResponse = await axios.get(`${BASE_URL}/chat/messages`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log(`✅ Retrieved ${updatedMessagesResponse.data.length} messages after file upload`);

    // 8. Clear session
    console.log('\n8. Clearing session...');
    const clearResponse = await axios.delete(`${BASE_URL}/chat/session`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('✅ Session cleared:', clearResponse.data.message);

    console.log('\n🎉 All tests passed! Chat backend is working correctly.');

    // Cleanup
    fs.unlinkSync('test-data.csv');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Check if axios is available
try {
  require('axios');
  testChatEndpoints();
} catch (error) {
  console.log('Installing axios for testing...');
  const { execSync } = require('child_process');
  execSync('npm install axios form-data', { stdio: 'inherit' });
  testChatEndpoints();
}
