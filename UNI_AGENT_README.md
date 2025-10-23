# Uni-Agent: Unified LLM Agent System

## Overview

The Uni-Agent is a unified agent that merges the functionality of three original agents:
- **Orchestrator Agent**: Workflow planning and task coordination
- **Data Agent**: Data processing, cleaning, transformation, and validation
- **Report Agent**: Report generation and analysis

## Key Changes

### 1. LLM Provider Migration
- **From**: Ollama Llama 3 (local)
- **To**: Google Gemini (cloud-based)
- **Benefits**: Better performance, no local setup required, more reliable API

### 2. Unified Architecture
- Single service (`UniAgentService`) that handles all three agent functionalities
- Single controller (`UniAgentController`) with all endpoints
- Consolidated module (`UniAgentModule`)

### 3. API Endpoints

The uni-agent provides all endpoints from the original three agents:

#### Orchestrator Endpoints
- `POST /uni-agent/process` - Process requests with workflow planning
- `POST /uni-agent/upload-and-process` - Upload and process files
- `POST /uni-agent/process-and-report` - Process existing data and generate reports
- `POST /uni-agent/quick-workflow` - Quick workflow execution

#### Data Agent Endpoints
- `GET /uni-agent/by-id/:id` - Get record by ID
- `GET /uni-agent/by-name/:filename` - Get record by filename
- `POST /uni-agent/analyze` - Analyze data
- `POST /uni-agent/upload` - Upload and process files
- `POST /uni-agent/upload-test` - Test file upload

#### Report Agent Endpoints
- `POST /uni-agent/generate` - Generate comprehensive reports
- `POST /uni-agent/summary` - Create data summaries
- `POST /uni-agent/export/pdf` - Export reports as PDF (HTML)
- `POST /uni-agent/export/markdown` - Export reports as Markdown
- `POST /uni-agent/export/json` - Export reports as JSON
- `GET /uni-agent/statistics/:id` - Get statistics by ID
- `POST /uni-agent/statistics` - Get data statistics

## Configuration

### Environment Variables
```bash
# Google Gemini API Key (required)
GOOGLE_API_KEY=your-google-api-key-here

# Database configuration (existing)
DB_HOST=localhost
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=admin
DB_NAME=corpoagent
```

### Dependencies
The following new dependency was added:
- `@langchain/google-genai` - Google Gemini integration for LangChain

## Usage Examples

### 1. Process and Analyze Data
```bash
curl -X POST http://localhost:3000/uni-agent/process \
  -H "Content-Type: application/json" \
  -d '{
    "request": "Process this data and generate a comprehensive report",
    "context": {
      "fileData": "name,age,email\nJohn,25,john@example.com\nJane,30,jane@example.com"
    }
  }'
```

### 2. Upload and Process File
```bash
curl -X POST http://localhost:3000/uni-agent/upload-and-process \
  -F "file=@data.csv" \
  -F "request=Process this data and create insights"
```

### 3. Generate Report from Existing Data
```bash
curl -X POST http://localhost:3000/uni-agent/generate \
  -H "Content-Type: application/json" \
  -d '{
    "recordId": "existing-record-id",
    "reportType": "comprehensive"
  }'
```

## Features

### Data Processing
- **Cleaning**: Remove null values, normalize whitespace
- **Transformation**: Standardize dates, emails, phone numbers, currency
- **Validation**: Check email formats, age ranges, date validity
- **Deduplication**: Remove duplicate rows
- **Normalization**: Consistent casing and formatting

### Report Generation
- **Executive Summary**: High-level data overview
- **Data Quality Assessment**: Quality metrics and issues
- **Key Insights**: Meaningful observations from data
- **Trends and Patterns**: Identified trends in the dataset
- **Anomalies**: Outliers and unusual data points
- **Recommendations**: Actionable suggestions

### Workflow Orchestration
- **Task Planning**: AI-powered workflow generation
- **Dependency Management**: Task ordering and dependencies
- **Context Injection**: Automatic parameter resolution
- **Error Handling**: Graceful failure handling

## Migration from Original Agents

The uni-agent is designed to be a drop-in replacement for the original three agents:

1. **Update API calls**: Change endpoints from `/orchestrator/*`, `/data-agent/*`, `/report-agent/*` to `/uni-agent/*`
2. **Configure Google API Key**: Set `GOOGLE_API_KEY` environment variable
3. **Remove old agent modules**: The original agents can be removed from `app.module.ts`

## Benefits

1. **Simplified Architecture**: Single agent instead of three separate ones
2. **Better Performance**: Google Gemini is faster and more reliable than local Ollama
3. **Reduced Complexity**: Fewer services to manage and maintain
4. **Unified Interface**: Single API for all data processing and reporting needs
5. **Cloud-based**: No need to run local Ollama service

## Testing

To test the uni-agent functionality:

1. Set up environment variables
2. Start the application: `npm run start:dev`
3. Use the provided curl examples or test with Postman
4. Check logs for detailed execution information

## Troubleshooting

### Common Issues

1. **Google API Key not set**: Ensure `GOOGLE_API_KEY` environment variable is configured
2. **Database connection issues**: Verify database configuration in environment variables
3. **File upload issues**: Check file size limits and supported formats (CSV, TXT, PDF)

### Logs

The uni-agent provides detailed logging for debugging:
- Request processing steps
- LLM interactions
- Data processing stages
- Error details and stack traces
