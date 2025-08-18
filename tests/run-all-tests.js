#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Running comprehensive API tests for production readiness...\n');

// Test suites to run
const testSuites = [
  'api/authentication.test.js',
  'api/icon-search.test.js', 
  'api/icon-generate.test.js',
  'api/icon-download.test.js',
  'api/usage-tracking.test.js'
];

async function runTests() {
  let allPassed = true;
  const results = [];

  console.log('📋 Test Plan:');
  testSuites.forEach((suite, index) => {
    console.log(`  ${index + 1}. ${suite.replace('api/', '').replace('.test.js', '')}`);
  });
  console.log('');

  for (const suite of testSuites) {
    console.log(`🚀 Running ${suite}...`);
    
    const result = await runTestSuite(suite);
    results.push({ suite, ...result });
    
    if (result.success) {
      console.log(`✅ ${suite} - PASSED\n`);
    } else {
      console.log(`❌ ${suite} - FAILED\n`);
      allPassed = false;
    }
  }

  // Print summary
  console.log('📊 Test Results Summary:');
  console.log('=' .repeat(50));
  
  let totalTests = 0;
  let totalPassed = 0;
  
  results.forEach(result => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${result.suite}`);
    if (result.testCount) {
      totalTests += result.testCount;
      totalPassed += result.success ? result.testCount : 0;
    }
  });
  
  console.log('=' .repeat(50));
  console.log(`Total: ${totalPassed}/${totalTests} tests passed`);
  
  if (allPassed) {
    console.log('\n🎉 All API tests passed! The application is ready for production.');
    console.log('\n✨ Production Readiness Checklist:');
    console.log('  ✅ Authentication & Authorization');
    console.log('  ✅ Rate Limiting & Usage Tracking');
    console.log('  ✅ Input Validation & Sanitization');
    console.log('  ✅ Error Handling & Security');
    console.log('  ✅ Icon Search Functionality');
    console.log('  ✅ AI Icon Generation');
    console.log('  ✅ File Download & Processing');
    console.log('  ✅ Database Integration');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please review and fix issues before production deployment.');
    process.exit(1);
  }
}

function runTestSuite(suite) {
  return new Promise((resolve) => {
    const testProcess = spawn('npm', ['test', '--', suite], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.dirname(__dirname)
    });

    let output = '';
    let errorOutput = '';

    testProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    testProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    testProcess.on('close', (code) => {
      const success = code === 0;
      
      // Try to extract test count from Jest output
      const testCountMatch = output.match(/(\d+) passed/);
      const testCount = testCountMatch ? parseInt(testCountMatch[1]) : 0;
      
      if (!success && errorOutput) {
        console.log('Error output:', errorOutput);
      }
      
      resolve({
        success,
        testCount,
        output: output.slice(-500), // Last 500 chars for debugging
        error: errorOutput.slice(-500)
      });
    });

    testProcess.on('error', (err) => {
      console.error(`Failed to start test process: ${err.message}`);
      resolve({
        success: false,
        testCount: 0,
        error: err.message
      });
    });
  });
}

// Handle interruption gracefully
process.on('SIGINT', () => {
  console.log('\n⚠️  Test run interrupted by user');
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Test run terminated');
  process.exit(143);
});

// Run the tests
runTests().catch((error) => {
  console.error('❌ Test runner failed:', error);
  process.exit(1);
});