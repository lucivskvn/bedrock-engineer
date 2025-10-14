/**
 * DockerExecutor integration tests - requires actual Docker installation
 */

import { test, expect, beforeAll, beforeEach, afterEach, describe } from '@jest/globals'
import { DockerExecutor } from './DockerExecutor'
import { SecurityManager } from './SecurityManager'
import { ToolLogger } from '../../base/types'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

describe('DockerExecutor Integration Tests', () => {
  let dockerExecutor: DockerExecutor
  let mockLogger: ToolLogger
  let securityManager: SecurityManager
  let tempWorkspace: string
  let dockerAvailable = false

  beforeAll(async () => {
    // Create mock logger
    mockLogger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      verbose: () => {}
    }

    // Create real security manager for integration test
    securityManager = new SecurityManager(mockLogger)
    dockerExecutor = new DockerExecutor(mockLogger, securityManager)

    // Check if Docker is actually available
    const dockerCheck = await dockerExecutor.checkDockerAvailability()
    dockerAvailable = dockerCheck.available

    if (!dockerAvailable) {
      console.warn('⚠️  Docker is not available. Integration tests will be skipped.')
      console.warn('Docker check error', { error: dockerCheck.error })
    }
  })

  beforeEach(async () => {
    if (!dockerAvailable) return

    // Create temporary workspace for each test
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'docker-executor-test-'))
  })

  afterEach(async () => {
    if (!dockerAvailable) return

    try {
      // Stop any running containers
      await dockerExecutor.stopAllContainers()

      // Clean up temporary workspace
      if (tempWorkspace) {
        await fs.rm(tempWorkspace, { recursive: true, force: true })
      }
    } catch (error) {
      console.warn('Warning: Failed to clean up test resources', { error })
    }
  })

  test('should check actual Docker availability', async () => {
    const result = await dockerExecutor.checkDockerAvailability()

    if (result.available) {
      expect(result.available).toBe(true)
      expect(result.error).toBeUndefined()
    } else {
      expect(result.available).toBe(false)
      expect(result.error).toBeDefined()
      console.log('Docker not available:', result.error)
    }
  })

  test('should execute simple Python code successfully', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    const code = 'print("Hello from Docker!")'
    const result = await dockerExecutor.executeCode(code, 'python', tempWorkspace)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('Hello from Docker!')
    // Note: stderr might contain Docker image pull logs on first run, so we check it's not a Python error
    if (result.stderr && result.stderr.length > 0) {
      // If there's stderr output, it should be Docker pull logs, not Python errors
      expect(result.stderr).not.toContain('Traceback')
      expect(result.stderr).not.toContain('Error:')
      console.log('Note: Docker image pull logs detected in stderr (expected on first run)')
    }
    expect(result.executionTime).toBeGreaterThan(0)
  })

  test('should execute Python code with calculations', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    const code = `
import math
result = 2 + 3 * 4
pi_value = math.pi
print(f"Calculation result: {result}")
print(f"Pi value: {pi_value:.2f}")
print("Python math works!")
`

    const result = await dockerExecutor.executeCode(code, 'python', tempWorkspace)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Calculation result: 14')
    expect(result.stdout).toContain('Pi value: 3.14')
    expect(result.stdout).toContain('Python math works!')
    // Allow for Docker pull logs in stderr
    if (result.stderr && result.stderr.length > 0) {
      expect(result.stderr).not.toContain('Traceback')
      expect(result.stderr).not.toContain('Error:')
    }
  })

  test('should handle Python code with file creation', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    const code = `
# Create a simple text file
with open('output.txt', 'w') as f:
    f.write('Hello from Python in Docker!\\n')
    f.write('This is line 2\\n')

# Read and print the file
with open('output.txt', 'r') as f:
    content = f.read()
    print("File content:")
    print(content)

print("File operations completed successfully!")
`

    const result = await dockerExecutor.executeCode(code, 'python', tempWorkspace)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('File content:')
    expect(result.stdout).toContain('Hello from Python in Docker!')
    expect(result.stdout).toContain('This is line 2')
    expect(result.stdout).toContain('File operations completed successfully!')
    // Allow for Docker pull logs in stderr
    if (result.stderr && result.stderr.length > 0) {
      expect(result.stderr).not.toContain('Traceback')
      expect(result.stderr).not.toContain('Error:')
    }

    // Verify the file was actually created in the workspace
    const outputFilePath = path.join(tempWorkspace, 'output.txt')
    const fileExists = await fs
      .access(outputFilePath)
      .then(() => true)
      .catch(() => false)
    expect(fileExists).toBe(true)

    if (fileExists) {
      const fileContent = await fs.readFile(outputFilePath, 'utf8')
      expect(fileContent).toContain('Hello from Python in Docker!')
      expect(fileContent).toContain('This is line 2')
    }
  })

  test('should handle Python syntax errors correctly', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    const code = 'print("Missing closing quote and parenthesis'

    const result = await dockerExecutor.executeCode(code, 'python', tempWorkspace)

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('SyntaxError')
    expect(result.executionTime).toBeGreaterThan(0)
  })

  test('should handle Python runtime errors correctly', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    const code = `
print("Starting execution...")
# This will cause a division by zero error
result = 10 / 0
print("This should not be printed")
`

    const result = await dockerExecutor.executeCode(code, 'python', tempWorkspace)

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toContain('Starting execution...')
    expect(result.stderr).toContain('ZeroDivisionError')
    expect(result.executionTime).toBeGreaterThan(0)
  })

  test('should handle execution timeout', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    const code = `
import time
print("Starting long operation...")
time.sleep(10)  # Sleep for 10 seconds
print("This should not be printed due to timeout")
`

    const config = {
      timeout: 2, // 2 second timeout
      memoryLimit: '128m', // Required field
      cpuLimit: 0.5 // Required field
    }

    const result = await dockerExecutor.executeCode(code, 'python', tempWorkspace, config)

    expect(result.exitCode).toBe(124) // Timeout exit code
    expect(result.stdout).toContain('Starting long operation...')
    expect(result.stderr).toContain('[Execution timed out]')
    expect(result.executionTime).toBeGreaterThanOrEqual(2000) // At least 2 seconds
  })

  test('should work with Python packages (standard library)', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    const code = `
import json
import datetime
from collections import Counter

# Test JSON operations
data = {"name": "Docker Test", "version": 1.0, "active": True}
json_string = json.dumps(data)
parsed_data = json.loads(json_string)
print(f"JSON test: {parsed_data['name']}")

# Test datetime
now = datetime.datetime.now()
print(f"Current time: {now.strftime('%Y-%m-%d %H:%M:%S')}")

# Test collections
words = ['apple', 'banana', 'apple', 'cherry', 'banana', 'apple']
counter = Counter(words)
print(f"Word count: {dict(counter)}")

print("All standard library tests passed!")
`

    const result = await dockerExecutor.executeCode(code, 'python', tempWorkspace)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('JSON test: Docker Test')
    expect(result.stdout).toContain('Current time:')
    expect(result.stdout).toContain('Word count:')
    expect(result.stdout).toContain('All standard library tests passed!')
    // Allow for Docker pull logs in stderr
    if (result.stderr && result.stderr.length > 0) {
      expect(result.stderr).not.toContain('Traceback')
      expect(result.stderr).not.toContain('Error:')
    }
  })

  test('should properly isolate executions (no cross-contamination)', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    // First execution creates a variable
    const code1 = `
test_variable = "First execution"
print(f"Set variable: {test_variable}")
`

    const result1 = await dockerExecutor.executeCode(code1, 'python', tempWorkspace)
    expect(result1.exitCode).toBe(0)
    expect(result1.stdout).toContain('Set variable: First execution')

    // Second execution should not have access to the variable from first execution
    const code2 = `
try:
    print(f"Variable from previous execution: {test_variable}")
    print("ERROR: Variable should not exist!")
except NameError:
    print("SUCCESS: Variable isolation working correctly")
`

    const result2 = await dockerExecutor.executeCode(code2, 'python', tempWorkspace)
    expect(result2.exitCode).toBe(0)
    expect(result2.stdout).toContain('SUCCESS: Variable isolation working correctly')
  })

  test('should handle multiple file operations', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    const code = `
import os

# Create multiple files
files_to_create = ['file1.txt', 'file2.txt', 'data.json']

for filename in files_to_create:
    with open(filename, 'w') as f:
        f.write(f"Content of {filename}\\n")
        f.write(f"Created in Docker container\\n")

# List all files in current directory
files_in_dir = os.listdir('.')
python_files = [f for f in files_in_dir if not f.startswith('temp_')]

print(f"Created {len(python_files)} files:")
for file in sorted(python_files):
    print(f"  - {file}")

# Read one of the files
with open('file1.txt', 'r') as f:
    content = f.read()
    print(f"Content of file1.txt: {content.strip()}")

print("Multi-file operations completed!")
`

    const result = await dockerExecutor.executeCode(code, 'python', tempWorkspace)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Created 3 files:')
    expect(result.stdout).toContain('file1.txt')
    expect(result.stdout).toContain('file2.txt')
    expect(result.stdout).toContain('data.json')
    expect(result.stdout).toContain('Content of file1.txt: Content of file1.txt')
    expect(result.stdout).toContain('Multi-file operations completed!')
    // Allow for Docker pull logs in stderr
    if (result.stderr && result.stderr.length > 0) {
      expect(result.stderr).not.toContain('Traceback')
      expect(result.stderr).not.toContain('Error:')
    }

    // Verify files exist in workspace
    const files = await fs.readdir(tempWorkspace)
    const createdFiles = files.filter((f) => !f.startsWith('temp_'))
    expect(createdFiles.length).toBeGreaterThanOrEqual(3)
    expect(createdFiles).toContain('file1.txt')
    expect(createdFiles).toContain('file2.txt')
    expect(createdFiles).toContain('data.json')
  })

  test('should mount and access multiple input files', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    // Create temporary input files
    const inputFile1Path = path.join(tempWorkspace, 'input1.txt')
    const inputFile2Path = path.join(tempWorkspace, 'input2.csv')
    const inputFile3Path = path.join(tempWorkspace, 'config.json')

    await fs.writeFile(
      inputFile1Path,
      'This is input file 1\nLine 2 of input1\nLine 3 of input1',
      'utf8'
    )
    await fs.writeFile(
      inputFile2Path,
      'name,age,city\nJohn,25,Tokyo\nJane,30,Osaka\nBob,35,Kyoto',
      'utf8'
    )
    await fs.writeFile(
      inputFile3Path,
      JSON.stringify({
        version: '1.0',
        environment: 'test',
        features: ['feature1', 'feature2', 'feature3']
      }),
      'utf8'
    )

    const inputFiles = [
      { path: inputFile1Path },
      { path: inputFile2Path },
      { path: inputFile3Path }
    ]

    const code = `
import os
import json

print("=== Checking mounted files ===")

# List files in /data directory
data_files = os.listdir('/data')
print(f"Files in /data: {sorted(data_files)}")

# Read and process input1.txt
print("\\n=== Processing input1.txt ===")
with open('/data/input1.txt', 'r') as f:
    content = f.read()
    lines = content.strip().split('\\n')
    print(f"Lines in input1.txt: {len(lines)}")
    for i, line in enumerate(lines, 1):
        print(f"  Line {i}: {line}")

# Read and process input2.csv
print("\\n=== Processing input2.csv ===")
with open('/data/input2.csv', 'r') as f:
    csv_content = f.read().strip()
    csv_lines = csv_content.split('\\n')
    print(f"CSV rows: {len(csv_lines)}")

    # Parse header
    header = csv_lines[0].split(',')
    print(f"CSV header: {header}")

    # Parse data rows
    for i, line in enumerate(csv_lines[1:], 1):
        row = line.split(',')
        print(f"  Row {i}: {dict(zip(header, row))}")

# Read and process config.json
print("\\n=== Processing config.json ===")
with open('/data/config.json', 'r') as f:
    config = json.load(f)
    print(f"Config version: {config['version']}")
    print(f"Environment: {config['environment']}")
    print(f"Features: {config['features']}")

# Create a summary file based on all inputs
print("\\n=== Creating summary ===")
summary = {
    'input_files_processed': len(data_files),
    'txt_lines': len(lines),
    'csv_rows': len(csv_lines) - 1,  # Exclude header
    'config_features': len(config['features']),
    'total_features_analyzed': len(lines) + (len(csv_lines) - 1) + len(config['features'])
}

with open('processing_summary.json', 'w') as f:
    json.dump(summary, f, indent=2)

print(f"Summary: {summary}")
print("Multiple file processing completed successfully!")
`

    const result = await dockerExecutor.executeCode(
      code,
      'python',
      tempWorkspace,
      undefined,
      inputFiles
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('=== Checking mounted files ===')
    expect(result.stdout).toContain('Files in /data: [')
    expect(result.stdout).toContain('input1.txt')
    expect(result.stdout).toContain('input2.csv')
    expect(result.stdout).toContain('config.json')

    // Check text file processing
    expect(result.stdout).toContain('=== Processing input1.txt ===')
    expect(result.stdout).toContain('Lines in input1.txt: 3')
    expect(result.stdout).toContain('Line 1: This is input file 1')
    expect(result.stdout).toContain('Line 2: Line 2 of input1')

    // Check CSV processing
    expect(result.stdout).toContain('=== Processing input2.csv ===')
    expect(result.stdout).toContain('CSV rows: 4')
    expect(result.stdout).toContain("CSV header: ['name', 'age', 'city']")
    expect(result.stdout).toContain("{'name': 'John', 'age': '25', 'city': 'Tokyo'}")

    // Check JSON processing
    expect(result.stdout).toContain('=== Processing config.json ===')
    expect(result.stdout).toContain('Config version: 1.0')
    expect(result.stdout).toContain('Environment: test')
    expect(result.stdout).toContain("Features: ['feature1', 'feature2', 'feature3']")

    // Check summary creation
    expect(result.stdout).toContain('=== Creating summary ===')
    expect(result.stdout).toContain('Multiple file processing completed successfully!')

    // Allow for Docker pull logs in stderr
    if (result.stderr && result.stderr.length > 0) {
      expect(result.stderr).not.toContain('Traceback')
      expect(result.stderr).not.toContain('Error:')
    }

    // Verify summary file was created in workspace
    const summaryPath = path.join(tempWorkspace, 'processing_summary.json')
    const summaryExists = await fs
      .access(summaryPath)
      .then(() => true)
      .catch(() => false)
    expect(summaryExists).toBe(true)

    if (summaryExists) {
      const summaryContent = await fs.readFile(summaryPath, 'utf8')
      const summary = JSON.parse(summaryContent)
      expect(summary.input_files_processed).toBe(3)
      expect(summary.txt_lines).toBe(3)
      expect(summary.csv_rows).toBe(3)
      expect(summary.config_features).toBe(3)
    }
  })

  test('should handle mixed file types with different operations', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    // Create different types of input files
    const textFile = path.join(tempWorkspace, 'readme.txt')
    const pythonFile = path.join(tempWorkspace, 'helper.py')
    const yamlFile = path.join(tempWorkspace, 'config.yaml')
    const mdFile = path.join(tempWorkspace, 'docs.md')

    await fs.writeFile(
      textFile,
      'Project Documentation\n===================\nThis is a sample project\nwith multiple components.',
      'utf8'
    )

    await fs.writeFile(
      pythonFile,
      'def calculate_sum(a, b):\n    return a + b\n\ndef calculate_product(a, b):\n    return a * b\n\nPI = 3.14159',
      'utf8'
    )

    await fs.writeFile(
      yamlFile,
      'database:\n  host: localhost\n  port: 5432\n  name: testdb\napi:\n  version: "1.0"\n  endpoints:\n    - /users\n    - /products',
      'utf8'
    )

    await fs.writeFile(
      mdFile,
      '# Project Title\n\n## Features\n\n- Feature 1\n- Feature 2\n- Feature 3\n\n## Installation\n\n```bash\nnpm install\n```',
      'utf8'
    )

    const inputFiles = [
      { path: textFile },
      { path: pythonFile },
      { path: yamlFile },
      { path: mdFile }
    ]

    const code = `
import os
import re
import json

print("=== Multi-format File Analysis ===")

# List all mounted files
data_files = os.listdir('/data')
print(f"Mounted files: {sorted(data_files)}")

# Analyze each file type
file_analysis = {}

# Process text file
print("\\\\n--- Analyzing readme.txt ---")
with open('/data/readme.txt', 'r') as f:
    txt_content = f.read()
    txt_lines = len(txt_content.split('\\\\n'))
    txt_words = len(txt_content.split())
    print(f"Text file: {txt_lines} lines, {txt_words} words")
    file_analysis['readme.txt'] = {'lines': txt_lines, 'words': txt_words, 'type': 'text'}

# Process Python file
print("\\\\n--- Analyzing helper.py ---")
with open('/data/helper.py', 'r') as f:
    py_content = f.read()
    py_lines = len(py_content.split('\\\\n'))
    # Count function definitions
    func_count = len(re.findall(r'^def ', py_content, re.MULTILINE))
    # Count variable assignments (simple pattern)
    var_count = len(re.findall(r'^[A-Z_]+ = ', py_content, re.MULTILINE))
    print(f"Python file: {py_lines} lines, {func_count} functions, {var_count} constants")
    file_analysis['helper.py'] = {'lines': py_lines, 'functions': func_count, 'constants': var_count, 'type': 'python'}

# Process YAML file
print("\\\\n--- Analyzing config.yaml ---")
with open('/data/config.yaml', 'r') as f:
    yaml_content = f.read()
    yaml_lines = len(yaml_content.split('\\\\n'))
    # Count YAML keys (simple pattern)
    key_count = len(re.findall(r'^\\s*\\w+:', yaml_content, re.MULTILINE))
    print(f"YAML file: {yaml_lines} lines, {key_count} keys")
    file_analysis['config.yaml'] = {'lines': yaml_lines, 'keys': key_count, 'type': 'yaml'}

# Process Markdown file
print("\\\\n--- Analyzing docs.md ---")
with open('/data/docs.md', 'r') as f:
    md_content = f.read()
    md_lines = len(md_content.split('\\\\n'))
    # Count markdown headers
    header_count = len(re.findall(r'^#+\\s', md_content, re.MULTILINE))
    # Count code blocks with proper regex
    code_block_count = md_content.count('\`\`\`')
    print(f"Markdown file: {md_lines} lines, {header_count} headers, {code_block_count} code block markers")
    file_analysis['docs.md'] = {'lines': md_lines, 'headers': header_count, 'code_blocks': code_block_count, 'type': 'markdown'}

# Generate comprehensive report
print("\\\\n=== Analysis Report ===")
total_lines = sum(info['lines'] for info in file_analysis.values())
print(f"Total lines across all files: {total_lines}")

for filename, info in file_analysis.items():
    print(f"{filename} ({info['type']}): {info}")

# Save analysis results
with open('file_analysis_report.json', 'w') as f:
    json.dump({
        'summary': {
            'total_files': len(file_analysis),
            'total_lines': total_lines,
            'file_types': list(set(info['type'] for info in file_analysis.values()))
        },
        'detailed_analysis': file_analysis
    }, f, indent=2)

print("\\\\nMulti-format file analysis completed!")
`

    const result = await dockerExecutor.executeCode(
      code,
      'python',
      tempWorkspace,
      undefined,
      inputFiles
    )

    console.log(result)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('=== Multi-format File Analysis ===')
    expect(result.stdout).toContain('Mounted files: [')
    expect(result.stdout).toContain('readme.txt')
    expect(result.stdout).toContain('helper.py')
    expect(result.stdout).toContain('config.yaml')
    expect(result.stdout).toContain('docs.md')

    // Check individual file analysis
    expect(result.stdout).toContain('--- Analyzing readme.txt ---')
    expect(result.stdout).toContain('Text file:')
    expect(result.stdout).toContain('--- Analyzing helper.py ---')
    expect(result.stdout).toContain('Python file:')
    expect(result.stdout).toContain('functions')
    expect(result.stdout).toContain('--- Analyzing config.yaml ---')
    expect(result.stdout).toContain('YAML file:')
    expect(result.stdout).toContain('--- Analyzing docs.md ---')
    expect(result.stdout).toContain('Markdown file:')
    expect(result.stdout).toContain('headers')

    expect(result.stdout).toContain('=== Analysis Report ===')
    expect(result.stdout).toContain('Total lines across all files:')
    expect(result.stdout).toContain('Multi-format file analysis completed!')

    // Allow for Docker pull logs in stderr
    if (result.stderr && result.stderr.length > 0) {
      expect(result.stderr).not.toContain('Traceback')
      expect(result.stderr).not.toContain('Error:')
    }

    // Verify analysis report was created
    const reportPath = path.join(tempWorkspace, 'file_analysis_report.json')
    const reportExists = await fs
      .access(reportPath)
      .then(() => true)
      .catch(() => false)
    expect(reportExists).toBe(true)

    if (reportExists) {
      const reportContent = await fs.readFile(reportPath, 'utf8')
      const report = JSON.parse(reportContent)

      // Simplified assertions to avoid Jest display bug
      expect(report.summary.total_files).toBe(4)
      expect(Object.keys(report.detailed_analysis)).toHaveLength(4)
      expect(Object.keys(report.detailed_analysis)).toEqual(
        expect.arrayContaining(['readme.txt', 'helper.py', 'config.yaml', 'docs.md'])
      )
    }
  })

  test('should handle file mount errors gracefully', async () => {
    if (!dockerAvailable) {
      console.log('⏭️  Skipping test: Docker not available')
      return
    }

    // Create some valid files and include some invalid ones
    const validFile = path.join(tempWorkspace, 'valid.txt')
    const nonExistentFile = path.join(tempWorkspace, 'nonexistent.txt')
    const invalidExtensionFile = path.join(tempWorkspace, 'binary.exe')

    await fs.writeFile(validFile, 'This is a valid file', 'utf8')
    // Create a file with invalid extension
    await fs.writeFile(invalidExtensionFile, 'fake binary content', 'utf8')

    const inputFiles = [
      { path: validFile },
      { path: nonExistentFile }, // This doesn't exist
      { path: invalidExtensionFile } // Invalid extension
    ]

    const code = `
import os

print("=== Checking mounted files ===")
try:
    data_files = os.listdir('/data')
    print(f"Files in /data: {sorted(data_files)}")

    for filename in data_files:
        filepath = f'/data/{filename}'
        with open(filepath, 'r') as f:
            content = f.read()
            print(f"Content of {filename}: {content[:50]}...")

except Exception as e:
    print(f"Error accessing files: {e}")

print("File mount error handling test completed")
`

    const result = await dockerExecutor.executeCode(
      code,
      'python',
      tempWorkspace,
      undefined,
      inputFiles
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('=== Checking mounted files ===')
    expect(result.stdout).toContain('Files in /data:')
    expect(result.stdout).toContain('valid.txt')
    expect(result.stdout).toContain('This is a valid file')
    expect(result.stdout).toContain('File mount error handling test completed')

    // The nonexistent and invalid extension files should not be mounted
    expect(result.stdout).not.toContain('nonexistent.txt')
    expect(result.stdout).not.toContain('binary.exe')

    // Allow for Docker pull logs in stderr
    if (result.stderr && result.stderr.length > 0) {
      expect(result.stderr).not.toContain('Traceback')
      expect(result.stderr).not.toContain('Error:')
    }
  })
})
