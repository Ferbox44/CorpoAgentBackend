import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { KnowledgeBase } from '../../entities/knowledge_base.entity';
import { AIMessage } from '@langchain/core/messages';

interface Task {
  action: string;
  params: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

interface WorkflowPlan {
  tasks: Task[];
  reasoning: string;
}

export interface ReportMetadata {
  title: string;
  generatedAt: Date;
  dataSource: string;
  recordCount: number;
  reportType: string;
}

export interface ReportSection {
  title: string;
  content: string;
  insights?: string[];
}

export interface GeneratedReport {
  metadata: ReportMetadata;
  sections: ReportSection[];
  summary: string;
  recommendations?: string[];
}

@Injectable()
export class UniAgentService {
  private readonly model: ChatOllama;
  private readonly tools: Map<string, Function>;
  private summaryChain: RunnableSequence;
  private insightsChain: RunnableSequence;

  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
  ) {
    this.model = new ChatOllama({
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
      temperature: 0.2,
    });

    this.setupReportChains();
    this.tools = this.initializeTools();
  }

  private setupReportChains() {
    // Summary chain
    const summarySchema = z.object({
      summary: z.string(),
      key_points: z.array(z.string()),
      data_quality: z.string(),
      record_count: z.number(),
    });

    const summaryParser = StructuredOutputParser.fromZodSchema(summarySchema);
    const summaryFormatInstructions = summaryParser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const summaryPromptTemplate = `
You are a data analyst creating concise summaries of processed datasets.

Analyze the following data and provide:
1. A brief summary (2-3 sentences) of what the data represents
2. Key points or notable patterns (3-5 bullet points)
3. Assessment of data quality (good/fair/poor with brief explanation)
4. Count of valid records

DATA:
{data}

CRITICAL JSON FORMATTING RULES:
- Respond with ONLY valid JSON - no markdown, no code blocks, no explanatory text
- ALL strings in arrays MUST be wrapped in double quotes: ["item1", "item2"]
- Do NOT write: [item1, item2] or ["item1, item2] - both are invalid
- Every array element must be a complete quoted string
- Do not wrap response in \`\`\`json or any other markers
- Ensure all commas and brackets are properly placed

Use this exact JSON format:
${summaryFormatInstructions}

Respond with only the JSON object:`;

    const summaryPrompt = ChatPromptTemplate.fromTemplate(summaryPromptTemplate);
    this.summaryChain = RunnableSequence.from([
      summaryPrompt,
      this.model,
      (output: AIMessage | string) => this.parseJSON(output, summaryParser),
    ]);

    // Insights chain
    const insightsSchema = z.object({
      insights: z.array(z.string()),
      trends: z.array(z.string()),
      anomalies: z.array(z.string()),
      recommendations: z.array(z.string()),
    });

    const insightsParser = StructuredOutputParser.fromZodSchema(insightsSchema);
    const insightsFormatInstructions = insightsParser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const insightsPromptTemplate = `
You are a data analyst providing deep insights from processed data.

Analyze the data and identify:
1. Key insights (3-5 meaningful observations)
2. Trends or patterns (2-4 trends)
3. Anomalies or outliers (if any, 0-3)
4. Actionable recommendations (2-4 suggestions)

DATA:
{data}

SUMMARY CONTEXT:
{summary}

CRITICAL JSON FORMATTING RULES:
- Respond with ONLY valid JSON - no markdown, no code blocks, no explanatory text
- ALL strings in arrays MUST be wrapped in double quotes: ["item1", "item2"]
- Do NOT write: [item1, item2] or ["item1, item2] - both are invalid
- Every array element must be a complete quoted string on one line
- Do not wrap response in \`\`\`json or any other markers
- Ensure all commas and brackets are properly placed

Use this exact JSON format:
${insightsFormatInstructions}

Respond with only the JSON object:`;

    const insightsPrompt = ChatPromptTemplate.fromTemplate(insightsPromptTemplate);
    this.insightsChain = RunnableSequence.from([
      insightsPrompt,
      this.model,
      (output: AIMessage | string) => this.parseJSON(output, insightsParser),
    ]);
  }

  private initializeTools(): Map<string, Function> {
    return new Map([
      // Data retrieval tools
      ['get_by_id', this.getRecordById.bind(this)],
      ['get_by_filename', this.findRecordByFilename.bind(this)],
      
      // Data processing tools
      ['analyze_data', this.analyzeData.bind(this)],
      ['clean_data', this.cleanData.bind(this)],
      ['transform_data', this.transformData.bind(this)],
      ['validate_data', this.validateData.bind(this)],
      ['deduplicate_data', this.deduplicateData.bind(this)],
      ['normalize_data', this.normalizeData.bind(this)],
      
      // Storage tools
      ['save_to_database', this.saveToDatabase.bind(this)],
      
      // Report generation tools
      ['generate_report', this.generateReport.bind(this)],
      ['create_summary', this.createSummary.bind(this)],
      ['export_pdf', this.exportPdf.bind(this)],
      ['export_markdown', this.exportMarkdown.bind(this)],
      ['export_json', this.exportJson.bind(this)],
      ['get_statistics', this.getDataStatistics.bind(this)],
      
      // Workflow tools
      ['plan_workflow', this.planWorkflow.bind(this)],
      ['execute_workflow', this.executeWorkflow.bind(this)],
    ]);
  }

  async processRequest(request: string, context?: any): Promise<any> {
    console.log('=== UNI-AGENT: Processing Request ===');
    console.log('Request:', request);
    console.log('Context:', context ? Object.keys(context) : 'None');

    // Decide if we need workflow planning or can directly execute
    const needsPlanning = await this.needsWorkflowPlanning(request);

    if (needsPlanning) {
      console.log('✓ Request requires workflow planning');
      const plan = await this.planWorkflow(request, context);
      return await this.executeWorkflow(plan, context);
    } else {
      console.log('✓ Request can be handled directly');
      return await this.handleDirectRequest(request, context);
    }
  }

  private async needsWorkflowPlanning(request: string): Promise<boolean> {
    // Simple heuristics to determine if we need multi-step planning
    const multiStepKeywords = [
      'then', 'after', 'and then', 'followed by',
      'first', 'second', 'finally',
      'process and', 'analyze and', 'clean and',
      'generate report', 'create report', 'export'
    ];

    return multiStepKeywords.some(keyword => 
      request.toLowerCase().includes(keyword)
    );
  }

  private async handleDirectRequest(request: string, context?: any): Promise<any> {
    // For simple single-action requests
    const intent = await this.detectIntent(request);
    
    switch (intent) {
      case 'retrieve':
        return this.handleRetrieveRequest(request, context);
      case 'process':
        return this.handleProcessRequest(request, context);
      case 'analyze':
        return this.handleAnalyzeRequest(request, context);
      case 'report':
        return this.handleReportRequest(request, context);
      default:
        throw new Error(`Unknown intent: ${intent}`);
    }
  }

  private async detectIntent(request: string): Promise<string> {
    const lowerRequest = request.toLowerCase();
    
    if (lowerRequest.includes('get') || lowerRequest.includes('retrieve') || lowerRequest.includes('find')) {
      return 'retrieve';
    }
    if (lowerRequest.includes('report') || lowerRequest.includes('summary') || lowerRequest.includes('export')) {
      return 'report';
    }
    if (lowerRequest.includes('process') || lowerRequest.includes('clean') || lowerRequest.includes('transform')) {
      return 'process';
    }
    if (lowerRequest.includes('analyze') || lowerRequest.includes('analysis')) {
      return 'analyze';
    }
    
    return 'process'; // Default
  }

  private async handleRetrieveRequest(request: string, context?: any): Promise<any> {
    // Extract filename or ID from request or context
    if (context?.filename) {
      return await this.findRecordByFilename(context.filename);
    }
    if (context?.id || context?.recordId) {
      return await this.getRecordById(context.id || context.recordId);
    }
    
    throw new Error('No filename or ID provided for retrieval');
  }

  private async handleProcessRequest(request: string, context?: any): Promise<any> {
    if (!context?.fileData) {
      throw new Error('No file data provided for processing');
    }

    const filename = context.filename || 'uploaded_file.csv';
    const data = context.fileData;

    // Full processing pipeline
    const analysis = await this.analyzeData(data);
    let processed = data;

    if (analysis.needs_cleaning) {
      processed = await this.cleanData(processed);
    }
    if (analysis.needs_transformation) {
      processed = await this.transformData(processed);
    }
    if (analysis.needs_validation) {
      processed = await this.validateData(processed);
    }

    const saved = await this.saveToDatabase({
      title: filename,
      content: processed,
      tags: context.tags,
    });

    return {
      analysis,
      processedData: processed,
      recordId: saved.id,
      message: 'Data processed and saved successfully',
    };
  }

  private async handleAnalyzeRequest(request: string, context?: any): Promise<any> {
    if (!context?.fileData) {
      throw new Error('No file data provided for analysis');
    }

    return await this.analyzeData(context.fileData);
  }

  private async handleReportRequest(request: string, context?: any): Promise<any> {
    const lowerRequest = request.toLowerCase();
    
    // Determine report type
    if (lowerRequest.includes('summary')) {
      return await this.createSummary(context);
    }
    if (lowerRequest.includes('statistics') || lowerRequest.includes('stats')) {
      if (!context?.fileData && !context?.data) {
        throw new Error('No data provided for statistics');
      }
      return await this.getDataStatistics(context.fileData || context.data);
    }
    
    // Default to full report
    return await this.generateReport(context);
  }

  private async planWorkflow(request: string, context?: any): Promise<WorkflowPlan> {
    console.log('=== PLANNING WORKFLOW ===');
    
    const outputSchema = z.object({
      tasks: z.array(
        z.object({
          action: z.string(),
          params: z.record(z.any()),
          dependencies: z.array(z.number()).optional(),
        })
      ),
      reasoning: z.string(),
    });

    const parser = StructuredOutputParser.fromZodSchema(outputSchema);
    const formatInstructions = parser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const promptTemplate = `
You are an intelligent agent that plans and executes data processing workflows.

AVAILABLE ACTIONS:
1. RETRIEVAL:
   - get_by_id: Retrieve record by ID (params: {id})
   - get_by_filename: Retrieve record by filename (params: {filename})

2. DATA PROCESSING:
   - analyze_data: Analyze data quality (params: {data})
   - clean_data: Remove nulls and format data (params: {data})
   - transform_data: Standardize formats (params: {data})
   - validate_data: Validate data integrity (params: {data})
   - deduplicate_data: Remove duplicates (params: {data})
   - normalize_data: Normalize text casing (params: {data})

3. STORAGE:
   - save_to_database: Save processed data (params: {title, content, tags?})

4. REPORTING:
   - generate_report: Create comprehensive report (params: {recordId?, filename?, data?, reportType?})
   - create_summary: Create quick summary (params: {recordId?, filename?, data?})
   - export_pdf: Export report as PDF/HTML (params: {report})
   - export_markdown: Export report as Markdown (params: {report})
   - export_json: Export report as JSON (params: {report})
   - get_statistics: Get basic statistics (params: {data})

PLANNING RULES:
- If user mentions an EXISTING file/record, start with get_by_filename or get_by_id
- For NEW file uploads, use processing actions (analyze_data → clean_data → etc.)
- Reports can reference recordId, filename, or work directly with data
- Use dependencies array to specify execution order (0-based indices)
- Use {{task.INDEX.FIELD}} syntax to reference previous task results
- For "process and report" workflows: process_data → save_to_database → generate_report
- For "export report" workflows: generate_report → export_pdf/markdown/json

EXAMPLES:
1. "Process this CSV and generate a report"
   → analyze_data → clean_data → transform_data → save_to_database → generate_report

2. "Create a report for employees.csv and export as PDF"
   → get_by_filename → generate_report → export_pdf

3. "Get statistics for the uploaded data"
   → get_statistics

4. "Clean the data, save it, and create a summary"
   → clean_data → save_to_database → create_summary

USER REQUEST: {request}

CONTEXT: {context}

Plan the workflow using this JSON format:
${formatInstructions}`;

    const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
    const chain = RunnableSequence.from([prompt, this.model, parser]);

    const result = await chain.invoke({
      request,
      context: context ? JSON.stringify(context, null, 2) : 'None',
    });

    const tasks: Task[] = result.tasks.map((task: any) => ({
      action: task.action,
      params: task.params,
      status: 'pending' as const,
      dependencies: task.dependencies || [],
    }));

    return {
      tasks,
      reasoning: result.reasoning,
    };
  }

  private async executeWorkflow(plan: WorkflowPlan, context?: any): Promise<any> {
    console.log('=== EXECUTING WORKFLOW ===');
    console.log('Plan:', JSON.stringify(plan, null, 2));

    const results: any[] = [];

    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i];
      console.log(`\nExecuting task ${i + 1}/${plan.tasks.length}: ${task.action}`);

      // Check dependencies
      const deps = (task as any).dependencies || [];
      for (const depIdx of deps) {
        if (results[depIdx]?.error) {
          task.status = 'failed';
          task.error = `Dependency task ${depIdx} failed`;
          results.push({ error: task.error });
          continue;
        }
      }

      task.status = 'running';

      try {
        // Resolve parameters with context and previous results
        const resolvedParams = this.resolveParams(task.params, results, context);
        
        // Execute the task
        const tool = this.tools.get(task.action);
        if (!tool) {
          throw new Error(`Unknown action: ${task.action}`);
        }

        const result = await tool(resolvedParams);
        task.status = 'completed';
        task.result = result;
        results.push(result);
        
        console.log(`✓ Task ${i + 1} completed successfully`);
      } catch (error) {
        task.status = 'failed';
        task.error = error.message;
        results.push({ error: error.message });
        console.error(`✗ Task ${i + 1} failed:`, error.message);
        
        // Stop workflow on critical failures
        throw new Error(`Workflow failed at task ${i + 1}: ${error.message}`);
      }
    }

    return {
      plan,
      results,
      summary: this.summarizeResults(results),
    };
  }

  private resolveParams(params: any, previousResults: any[], context?: any): any {
    const resolved = { ...params };

    // First, resolve task dependencies
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === 'string') {
        const match = value.match(/\{\{task\.(\d+)\.(\w+)\}\}/);
        if (match) {
          const [, taskIdx, field] = match;
          const taskResult = previousResults[parseInt(taskIdx)];
          if (taskResult && taskResult[field] !== undefined) {
            resolved[key] = taskResult[field];
          }
        }
      }
    }

    // Then, inject context values
    if (context) {
      if (context.fileData && !resolved.data && !resolved.fileData) {
        resolved.data = context.fileData;
      }
      if (context.filename && !resolved.filename && !resolved.title) {
        resolved.filename = context.filename;
        resolved.title = context.filename;
      }
      if (context.tags && !resolved.tags) {
        resolved.tags = context.tags;
      }
      if (context.recordId && !resolved.recordId) {
        resolved.recordId = context.recordId;
      }
    }

    return resolved;
  }

  private summarizeResults(results: any[]): string {
    const successful = results.filter(r => !r.error).length;
    const failed = results.filter(r => r.error).length;
    return `Workflow completed: ${successful} successful, ${failed} failed`;
  }

  // ==================== DATA TOOLS ====================

  private async findRecordByFilename(params: { filename: string } | string) {
    const filename = (typeof params === 'string' ? params : params.filename).replace(/\.[^/.]+$/, '');
    const record = await this.knowledgeBaseRepository.findOne({
      where: { title: filename },
    });

    if (!record) {
      throw new NotFoundException(`Record "${filename}" not found`);
    }

    return record;
  }

  private async getRecordById(params: { id: string } | string) {
    const id = typeof params === 'string' ? params : params.id;
    const record = await this.knowledgeBaseRepository.findOne({
      where: { id },
    });

    if (!record) {
      throw new NotFoundException(`Record ${id} not found`);
    }

    return record;
  }

  private async analyzeData(params: { data: string } | string) {
    const data = typeof params === 'string' ? params : params.data;
    
    const outputSchema = z.object({
      needs_cleaning: z.boolean(),
      needs_transformation: z.boolean(),
      needs_validation: z.boolean(),
      raw_text_allowed: z.boolean().optional(),
      explanation: z.string(),
    });

    const parser = StructuredOutputParser.fromZodSchema(outputSchema);
    const formatInstructions = parser.getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const promptTemplate = `
You are a data quality analyst. Analyze the data and determine processing needs.

RULES:
- needs_cleaning: true if NULL, N/A, empty values, or whitespace issues exist
- needs_transformation: true if dates, emails, phones, or currency need standardization
- needs_validation: true if data integrity checks are needed (invalid emails, ages, dates)
- raw_text_allowed: true if data is NOT tabular/CSV format

Use this JSON format:
${formatInstructions}

Data to analyze:
{data}`;

    const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
    const chain = RunnableSequence.from([prompt, this.model, parser]);

    return await chain.invoke({ data });
  }

  private async cleanData(params: { data: string } | string) {
    const data = typeof params === 'string' ? params : params.data;
    const { headers, rows } = this.parseCSV(data);
    
    const cleanedRows = rows.map(row =>
      row.map(cell => {
        const nullPatterns = /^(NULL|N\/A|null|na|PENDING|TBD|undefined|nil|none|--|)$/gi;
        if (nullPatterns.test(cell)) return 'Unknown';
        return cell.replace(/\s+/g, ' ').trim();
      })
    );
    
    return this.reconstructCSV(headers, cleanedRows);
  }

  private async transformData(params: { data: string } | string) {
    const data = typeof params === 'string' ? params : params.data;
    const { headers, rows } = this.parseCSV(data);
    
    const transformedRows = rows.map(row =>
      row.map((cell, idx) => {
        const header = headers[idx] || '';
        
        // Transform dates to YYYY-MM-DD
        if (header.includes('date')) {
          cell = cell.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_, m, d, y) =>
            `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
          );
        }
        
        // Transform emails to lowercase
        if (header.includes('email') && cell.includes('@')) {
          cell = cell.toLowerCase();
        }
        
        // Transform phone numbers
        if (header.includes('phone')) {
          cell = cell.replace(/\+?1?[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/, '$1-$2-$3');
        }
        
        // Transform currency
        if (header.includes('salary') || header.includes('amount')) {
          cell = cell.replace(/^\$?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?)$/, (_, num) => num.replace(/,/g, ''));
        }
        
        return cell;
      })
    );
    
    return this.reconstructCSV(headers, transformedRows);
  }

  private async validateData(params: { data: string } | string) {
    const data = typeof params === 'string' ? params : params.data;
    const { headers, rows } = this.parseCSV(data);
    
    const validatedRows = rows.map(row =>
      row.map((cell, idx) => {
        const header = headers[idx] || '';
        
        if (header.includes('email')) {
          const validEmail = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
          if (!validEmail.test(cell) && cell.toLowerCase() !== 'unknown') {
            return '[INVALID_EMAIL]';
          }
        }
        
        if (header.includes('age')) {
          if (!/^\d+$/.test(cell) && cell.toLowerCase() !== 'unknown') {
            return '[INVALID_AGE]';
          }
          if (/^\d+$/.test(cell)) {
            const age = parseInt(cell);
            if (age < 0 || age > 120) return '[INVALID_AGE]';
          }
        }

        if (header.includes('salary')){
          if (!/^\d+(\.\d{2})?$/.test(cell) && cell.toLowerCase() !== 'unknown') {
            return '[INVALID_SALARY]';
          }
        }
        
        return cell;
      })
    );
    
    return this.reconstructCSV(headers, validatedRows);
  }

  private async deduplicateData(params: { data: string } | string) {
    const data = typeof params === 'string' ? params : params.data;
    const { headers, rows } = this.parseCSV(data);
    
    const seen = new Set<string>();
    const uniqueRows = rows.filter(row => {
      const key = row.join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    return this.reconstructCSV(headers, uniqueRows);
  }

  private async normalizeData(params: { data: string } | string) {
    const data = typeof params === 'string' ? params : params.data;
    const { headers, rows } = this.parseCSV(data);
    
    const normalizedRows = rows.map(row =>
      row.map((cell, idx) => {
        const header = headers[idx] || '';
        
        if (header.includes('name')) {
          cell = cell.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        }
        
        if (header.includes('state')) {
          const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
          if (states.includes(cell.toUpperCase())) {
            cell = cell.toUpperCase();
          }
        }
        
        return cell.trim();
      })
    );
    
    return this.reconstructCSV(headers, normalizedRows);
  }

  private async saveToDatabase(params: { title: string; content: string; tags?: string }) {
    const parts = params.title.split('.');
    const extension = parts.length > 1 ? parts.pop()?.toLowerCase() : 'unknown';
    const titleWithoutExt = parts.join('.');

    const entity = this.knowledgeBaseRepository.create({
      title: titleWithoutExt,
      content: params.content,
      raw_content: params.content,
      analysis_summary: 'Processed by uni-agent',
      filename: params.title,
      file_type: extension,
      tags: params.tags,
    });

    return await this.knowledgeBaseRepository.save(entity);
  }

  // ==================== REPORT TOOLS ====================

  private async generateReport(params: {
    recordId?: string;
    filename?: string;
    data?: string;
    reportType?: string;
  } | any): Promise<GeneratedReport> {
    console.log('=== GENERATING REPORT ===');
    console.log('Params:', params);

    // Get data from various sources
    let data: string;
    let sourceInfo: string;
    let recordCount = 0;

    if (params.data) {
      data = params.data;
      sourceInfo = 'Direct data input';
    } else if (params.recordId) {
      const record = await this.knowledgeBaseRepository.findOne({
        where: { id: params.recordId },
      });
      if (!record) {
        throw new NotFoundException(`Record with ID ${params.recordId} not found`);
      }
      data = record.content;
      sourceInfo = record.filename || record.title;
    } else if (params.filename) {
      const filename = params.filename.replace(/\.[^/.]+$/, '');
      const record = await this.knowledgeBaseRepository.findOne({
        where: { title: filename },
      });
      if (!record) {
        throw new NotFoundException(`Record with filename ${params.filename} not found`);
      }
      data = record.content;
      sourceInfo = record.filename || record.title;
    } else {
      throw new Error('Must provide either recordId, filename, or data');
    }

    // Count records
    const lines = data.split('\n').filter(line => line.trim().length > 0);
    recordCount = Math.max(0, lines.length - 1);

    // Truncate data if too large
    const maxDataLength = 8000;
    let truncatedData = data;
    let wasTruncated = false;
    
    if (data.length > maxDataLength) {
      console.warn(`Data too large (${data.length} chars), truncating to ${maxDataLength}`);
      truncatedData = data.substring(0, maxDataLength) + '\n...[data truncated]...';
      wasTruncated = true;
    }

    try {
      // Generate summary
      console.log('Generating summary...');
      const summaryResult = await this.summaryChain.invoke({ data: truncatedData });

      // Generate insights
      console.log('Generating insights...');
      const insightsResult = await this.insightsChain.invoke({
        data: truncatedData,
        summary: summaryResult.summary || '',
      });

      // Build report sections
      const sections: ReportSection[] = [
        {
          title: 'Executive Summary',
          content: summaryResult.summary || 'Summary not available',
          insights: Array.isArray(summaryResult.key_points) ? summaryResult.key_points : [],
        },
        {
          title: 'Data Quality Assessment',
          content: summaryResult.data_quality || 'Data quality assessment not available',
        },
        {
          title: 'Key Insights',
          content: 'Analysis of the dataset reveals the following insights:',
          insights: Array.isArray(insightsResult.insights) ? insightsResult.insights : [],
        },
      ];

      if (Array.isArray(insightsResult.trends) && insightsResult.trends.length > 0) {
        sections.push({
          title: 'Trends and Patterns',
          content: 'The following trends were identified:',
          insights: insightsResult.trends,
        });
      }

      if (Array.isArray(insightsResult.anomalies) && insightsResult.anomalies.length > 0) {
        sections.push({
          title: 'Anomalies and Outliers',
          content: 'The following anomalies were detected:',
          insights: insightsResult.anomalies,
        });
      }

      if (wasTruncated) {
        sections.push({
          title: 'Note',
          content: 'This analysis was performed on a sample of the data due to size constraints.',
        });
      }

      const metadata: ReportMetadata = {
        title: `Data Analysis Report - ${sourceInfo}`,
        generatedAt: new Date(),
        dataSource: sourceInfo,
        recordCount,
        reportType: params.reportType || 'standard',
      };

      const report: GeneratedReport = {
        metadata,
        sections,
        summary: summaryResult.summary || 'Summary not available',
        recommendations: Array.isArray(insightsResult.recommendations) ? insightsResult.recommendations : [],
      };

      console.log('Report generated successfully');
      return report;
    } catch (error) {
      console.error('Error generating report:', error);
      return this.generateFallbackReport(sourceInfo, recordCount, error.message);
    }
  }

  private generateFallbackReport(
    sourceInfo: string,
    recordCount: number,
    errorMessage: string
  ): GeneratedReport {
    console.warn('Generating fallback report due to error');
    
    return {
      metadata: {
        title: `Data Analysis Report - ${sourceInfo}`,
        generatedAt: new Date(),
        dataSource: sourceInfo,
        recordCount,
        reportType: 'fallback',
      },
      sections: [
        {
          title: 'Report Generation Error',
          content: 'An error occurred while generating the detailed analysis.',
        },
        {
          title: 'Basic Information',
          content: `The dataset contains ${recordCount} records from ${sourceInfo}.`,
        },
      ],
      summary: `Basic report for ${sourceInfo} with ${recordCount} records.`,
      recommendations: [
        'Check data format and quality',
        'Ensure Ollama service is running',
        'Try with a smaller dataset',
      ],
    };
  }

  private async createSummary(params: {
    recordId?: string;
    filename?: string;
    data?: string;
  } | any): Promise<any> {
    console.log('=== CREATING SUMMARY ===');

    let data: string;

    if (params.data) {
      data = params.data;
    } else if (params.recordId) {
      const record = await this.knowledgeBaseRepository.findOne({
        where: { id: params.recordId },
      });
      if (!record) {
        throw new NotFoundException(`Record with ID ${params.recordId} not found`);
      }
      data = record.content;
    } else if (params.filename) {
      const filename = params.filename.replace(/\.[^/.]+$/, '');
      const record = await this.knowledgeBaseRepository.findOne({
        where: { title: filename },
      });
      if (!record) {
        throw new NotFoundException(`Record with filename ${params.filename} not found`);
      }
      data = record.content;
    } else {
      throw new Error('Must provide either recordId, filename, or data');
    }

    const summaryResult = await this.summaryChain.invoke({ data });
    return summaryResult;
  }

  private async exportPdf(params: { report?: GeneratedReport } | GeneratedReport | any): Promise<string> {
    console.log('=== EXPORTING PDF ===');
    
    let report: GeneratedReport;
    
    // Handle different parameter formats
    if (params.report) {
      report = params.report;
    } else if (params.metadata && params.sections) {
      report = params as GeneratedReport;
    } else {
      throw new Error('Invalid report format for PDF export');
    }

    const html = this.generateReportHtml(report);
    console.log('PDF/HTML export generated');
    
    return html;
  }

  private async exportMarkdown(params: { report?: GeneratedReport } | GeneratedReport | any): Promise<string> {
    console.log('=== EXPORTING MARKDOWN ===');
    
    let report: GeneratedReport;
    
    if (params.report) {
      report = params.report;
    } else if (params.metadata && params.sections) {
      report = params as GeneratedReport;
    } else {
      throw new Error('Invalid report format for Markdown export');
    }

    let markdown = `# ${report.metadata.title}\n\n`;
    markdown += `**Generated:** ${report.metadata.generatedAt.toLocaleString()}\n`;
    markdown += `**Data Source:** ${report.metadata.dataSource}\n`;
    markdown += `**Record Count:** ${report.metadata.recordCount}\n`;
    markdown += `**Report Type:** ${report.metadata.reportType}\n\n`;
    markdown += `---\n\n`;

    for (const section of report.sections) {
      markdown += `## ${section.title}\n\n`;
      markdown += `${section.content}\n\n`;

      if (section.insights && section.insights.length > 0) {
        section.insights.forEach(insight => {
          markdown += `- ${insight}\n`;
        });
        markdown += '\n';
      }
    }

    if (report.recommendations && report.recommendations.length > 0) {
      markdown += `## Recommendations\n\n`;
      report.recommendations.forEach(rec => {
        markdown += `- ${rec}\n`;
      });
      markdown += '\n';
    }

    return markdown;
  }

  private async exportJson(params: { report?: GeneratedReport } | GeneratedReport | any): Promise<any> {
    console.log('=== EXPORTING JSON ===');
    
    let report: GeneratedReport;
    
    if (params.report) {
      report = params.report;
    } else if (params.metadata && params.sections) {
      report = params as GeneratedReport;
    } else {
      throw new Error('Invalid report format for JSON export');
    }

    return {
      metadata: report.metadata,
      sections: report.sections,
      summary: report.summary,
      recommendations: report.recommendations,
    };
  }

  private generateReportHtml(report: GeneratedReport): string {
    const sectionsHtml = report.sections
      .map(section => {
        const insightsHtml = section.insights
          ? `<ul>${section.insights.map(insight => `<li>${insight}</li>`).join('')}</ul>`
          : '';

        return `
        <div class="section">
          <h2>${section.title}</h2>
          <p>${section.content}</p>
          ${insightsHtml}
        </div>
      `;
      })
      .join('');

    const recommendationsHtml = report.recommendations
      ? `
      <div class="section">
        <h2>Recommendations</h2>
        <ul>${report.recommendations.map(rec => `<li>${rec}</li>`).join('')}</ul>
      </div>
    `
      : '';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${report.metadata.title}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      color: #2c3e50;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
    }
    h2 {
      color: #34495e;
      margin-top: 30px;
      border-bottom: 1px solid #ecf0f1;
      padding-bottom: 5px;
    }
    .metadata {
      background: #ecf0f1;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .metadata p {
      margin: 5px 0;
    }
    .section {
      margin-bottom: 30px;
    }
    ul {
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <h1>${report.metadata.title}</h1>
  
  <div class="metadata">
    <p><strong>Generated:</strong> ${report.metadata.generatedAt.toLocaleString()}</p>
    <p><strong>Data Source:</strong> ${report.metadata.dataSource}</p>
    <p><strong>Record Count:</strong> ${report.metadata.recordCount}</p>
    <p><strong>Report Type:</strong> ${report.metadata.reportType}</p>
  </div>

  ${sectionsHtml}
  ${recommendationsHtml}
</body>
</html>
    `;
  }

  private async getDataStatistics(params: { data: string } | string): Promise<any> {
    const data = typeof params === 'string' ? params : params.data;
    
    const lines = data.split('\n').filter(line => line.trim().length > 0);
    const headers = lines[0]?.split(',') || [];
    const recordCount = lines.length - 1;

    const invalidCounts = {
      emails: 0,
      dates: 0,
      ages: 0,
      phones: 0,
      amounts: 0,
    };

    lines.slice(1).forEach(line => {
      if (line.includes('[INVALID_EMAIL]')) invalidCounts.emails++;
      if (line.includes('[INVALID_DATE]')) invalidCounts.dates++;
      if (line.includes('[INVALID_AGE]')) invalidCounts.ages++;
      if (line.includes('[INVALID_PHONE]')) invalidCounts.phones++;
      if (line.includes('[INVALID_AMOUNT]')) invalidCounts.amounts++;
    });

    return {
      totalRecords: recordCount,
      columns: headers,
      columnCount: headers.length,
      invalidCounts,
      hasInvalidData: Object.values(invalidCounts).some(count => count > 0),
    };
  }

  // ==================== JSON PARSING HELPERS ====================

  private parseJSON(output: AIMessage | string, parser: StructuredOutputParser<any>): any {
    try {
      let text: string;
      if (typeof output === 'string') {
        text = output;
      } else if (output instanceof AIMessage || (output && typeof output === 'object' && 'content' in output)) {
        text = output.content as string;
      } else {
        console.error('Unexpected output type:', typeof output);
        text = String(output);
      }

      let cleaned = text.trim();
      cleaned = cleaned.replace(/```json\s*/g, '');
      cleaned = cleaned.replace(/```\s*/g, '');
      
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1) {
        cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
      }

      cleaned = this.fixMalformedJSON(cleaned);
      const parsed = JSON.parse(cleaned);
      return parsed;
    } catch (error) {
      console.error('Failed to parse LLM response:', error.message);
      
      try {
        const text = typeof output === 'string' ? output : (output as AIMessage).content as string;
        return parser.parse(text);
      } catch (fallbackError) {
        console.error('Fallback parser failed, returning defaults');
        return this.getDefaultResponse();
      }
    }
  }

  private fixMalformedJSON(jsonStr: string): string {
    try {
      jsonStr = jsonStr.replace(/\]\s*\n\s*"/g, '],\n"');
      jsonStr = jsonStr.replace(/\}\s*\n\s*"/g, '},\n"');
      jsonStr = jsonStr.replace(/(\[|\,)\s*\n\s*([A-Z][^"\[\]\{\},]*?)\s*(?=,|\])/g, (match, prefix, content) => {
        if (!content.startsWith('"')) {
          return `${prefix}\n"${content.trim()}"`;
        }
        return match;
      });

      return jsonStr;
    } catch (error) {
      console.error('Error fixing malformed JSON:', error.message);
      return jsonStr;
    }
  }

  private getDefaultResponse(): any {
    console.warn('Using fallback default response');
    
    return {
      insights: ['Unable to parse insights from LLM response'],
      trends: ['Data analysis in progress'],
      anomalies: [],
      recommendations: ['Review data quality and retry'],
      summary: 'Analysis could not be completed',
      key_points: ['Parsing error occurred'],
      data_quality: 'unknown',
      record_count: 0,
    };
  }

  // ==================== CSV HELPERS ====================

  private parseCSV(data: string): { headers: string[], rows: string[][] } {
    const normalizedData = data.replace(/\\n/g, '\n');
    const lines = normalizedData.trim().split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error('Invalid CSV: needs header and at least one row');
    }
    
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      
      result.push(current.trim());
      return result;
    };
    
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const rows = lines.slice(1).map(line => {
      const cells = parseCSVLine(line);
      while (cells.length < headers.length) cells.push('');
      return cells.slice(0, headers.length);
    });
    
    return { headers, rows };
  }

  private reconstructCSV(headers: string[], rows: string[][]): string {
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // ==================== FILE UPLOAD ====================

  async processFileUpload(file: Express.Multer.File, request: string): Promise<any> {
    console.log('=== UNI-AGENT: Processing File Upload ===');
    
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'unknown';
    let text = file.buffer.toString('utf8');

    if (!text?.trim()) {
      throw new Error('File is empty or unreadable');
    }

    const context = {
      filename: file.originalname,
      fileSize: file.size,
      fileType: ext,
      fileData: text,
    };

    return this.processRequest(request, context);
  }
}