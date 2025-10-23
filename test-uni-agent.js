const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testUniAgent() {
  console.log('🧪 Testing Uni-Agent Functionality\n');

  try {
    // Test 1: Simple data analysis
    console.log('1️⃣ Testing data analysis...');
    const analysisResponse = await axios.post(`${BASE_URL}/uni-agent/analyze`, {
      data: 'name,age,email\nJohn,25,john@example.com\nJane,30,jane@example.com\nBob,invalid,bob@invalid'
    });
    console.log('✅ Analysis result:', analysisResponse.data);
    console.log('');

    // Test 2: Process request with workflow
    console.log('2️⃣ Testing workflow processing...');
    const workflowResponse = await axios.post(`${BASE_URL}/uni-agent/process`, {
      request: 'Analyze this data and provide insights',
      context: {
        fileData: 'name,age,email\nAlice,28,alice@example.com\nBob,35,bob@example.com\nCharlie,42,charlie@example.com'
      }
    });
    console.log('✅ Workflow result:', workflowResponse.data);
    console.log('');

    // Test 3: Generate statistics
    console.log('3️⃣ Testing data statistics...');
    const statsResponse = await axios.post(`${BASE_URL}/uni-agent/statistics`, {
      data: 'name,age,email\nJohn,25,john@example.com\nJane,30,jane@example.com\nBob,35,bob@example.com'
    });
    console.log('✅ Statistics result:', statsResponse.data);
    console.log('');

    console.log('🎉 All tests completed successfully!');
    console.log('\n📋 Summary:');
    console.log('- ✅ Data analysis working');
    console.log('- ✅ Workflow processing working');
    console.log('- ✅ Statistics generation working');
    console.log('\n🚀 Uni-Agent is ready for use!');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the server is running: npm run start:dev');
    console.log('2. Check that GOOGLE_API_KEY is set in environment variables');
    console.log('3. Verify database connection is working');
    console.log('4. Check server logs for detailed error information');
  }
}

// Run the test
testUniAgent();
