const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testWorkflowFix() {
  console.log('🧪 Testing Workflow Parameter Resolution Fix\n');

  try {
    // Test the problematic workflow: Generate report and export to PDF
    console.log('1️⃣ Testing: Generate report from employees and export to PDF...');
    const response = await axios.post(`${BASE_URL}/uni-agent/process`, {
      request: 'Generate a report of the file employees and export it to PDF'
    });
    
    console.log('✅ Workflow completed successfully!');
    console.log('📊 Results summary:');
    console.log(`- Tasks executed: ${response.data.plan.tasks.length}`);
    console.log(`- Successful tasks: ${response.data.results.filter(r => !r.error).length}`);
    console.log(`- Failed tasks: ${response.data.results.filter(r => r.error).length}`);
    
    if (response.data.results.some(r => r.error)) {
      console.log('\n❌ Errors found:');
      response.data.results.forEach((result, index) => {
        if (result.error) {
          console.log(`  Task ${index + 1}: ${result.error}`);
        }
      });
    } else {
      console.log('\n🎉 All tasks completed successfully!');
      console.log('✅ Parameter resolution is working correctly');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the server is running: npm run start:dev');
    console.log('2. Check that GOOGLE_API_KEY is set in environment variables');
    console.log('3. Verify the "employees" record exists in the database');
    console.log('4. Check server logs for detailed error information');
  }
}

// Run the test
testWorkflowFix();
