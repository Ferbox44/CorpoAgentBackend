import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { KnowledgeBase } from '../../entities/knowledge_base.entity';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

interface WorkflowPlan {
  steps: WorkflowStep[];
  reasoning: string;
}

interface WorkflowStep {
  action: string;
  params: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

interface DataAnalysis {
  needs_cleaning: boolean;
  needs_transformation: boolean;
  needs_validation: boolean;
  raw_text_allowed?: boolean;
  explanation: string;
}

interface Report {
  title: string;
  summary: string;
  statistics: any;
  insights: string[];
  recommendations: string[];
  data_overview: any;
  generated_at: string;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function parseCSV(data: string): { headers: string[], rows: string[][] } {
  const normalizedData = data.replace(/\\n/g, '\n');
  const lines = normalizedData.trim().split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length < 2) {
    throw new Error('Invalid CSV: needs at least header and one row');
  }
  
  function parseCSVLine(line: string): string[] {
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
  }
  
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const headerCount = headers.length;
  
  const rows = lines.slice(1).map((line, idx) => {
    const cells = parseCSVLine(line);
    
    while (cells.length < headerCount) {
      cells.push('');
    }
    
    if (cells.length > headerCount) {
      return cells.slice(0, headerCount);
    }
    
    return cells;
  });
  
  return { headers, rows };
}

function reconstructCSV(headers: string[], rows: string[][]): string {
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

// ============================================================================
// MAIN SERVICE
// ============================================================================

@Injectable()
export class UniAgentService {
  private readonly model: ChatOllama;
  private plannerChain: RunnableSequence;
  private analyzerChain: RunnableSequence;
  private reportChain: RunnableSequence;

  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
  ) {
    this.model = new ChatOllama({
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
      temperature: 0.3,
    });

    this.setupChains();
  }

  // ============================================================================
  // CHAIN SETUP
  // ============================================================================

  private setupChains() {
    this.setupPlannerChain();
    this.setupAnalyzerChain();
    this.setupReportChain();
  }

  private setupPlannerChain() {
    const outputSchema = z.object({
      steps: z.array(
        z.object({
          action: z.enum([
            'get_by_id',
            'get_by_filename',
            'process_data',
            'generate_report',
            'export_pdf',
            'export_markdown'
          ]),
          params: z.record(z.any()),
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
        You are a unified AI agent that processes data, generates reports, and manages workflows.

        AVAILABLE ACTIONS:
        1. get_by_id: Retrieve a record from database by ID
        2. get_by_filename: Retrieve a record from database by filename
        3. process_data: Clean, transform, validate, and save new data to database
        4. generate_report: Create comprehensive report from data
        5. export_pdf: Export report as PDF (HTML format)
        6. export_markdown: Export report as Markdown

        WORKFLOW PLANNING RULES:
        - If user mentions EXISTING file/record, use get_by_filename or get_by_id
        - Only use process_data for NEW data or when explicitly asked to reprocess
        - Reports can be generated from existing records using recordId or filename
        - Use {{step.INDEX.FIELD}} to reference results from previous steps

        EXAMPLES:
        - "Create report from employees.csv" →
        Step 1: get_by_filename with filename="employees.csv"
        Step 2: generate_report with recordId="{{step.0.id}}"

        - "Process this CSV and generate report" →
        Step 1: process_data with data from context
        Step 2: generate_report with recordId="{{step.0.recordId}}"

        USER REQUEST: {request}
        CONTEXT: {context}

        CRITICAL: Return ONLY valid JSON with NO markdown formatting, NO code blocks, NO comments.
        Your response must be pure JSON that starts with {{ and ends with }}.

        Use this exact JSON format:
        ${formatInstructions}

        Provide your workflow plan:`;

    const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
    this.plannerChain = RunnableSequence.from([prompt, this.model, parser]);
  }

  private setupAnalyzerChain() {
    const outputSchema = z.object({
      needs_cleaning: z.boolean(),
      needs_transformation: z.boolean(),
      needs_validation: z.boolean(),
      raw_text_allowed: z.boolean().optional(),
      explanation: z.string(),
    });

    const parser = StructuredOutputParser.fromZodSchema(outputSchema);
    const formatInstructions = parser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const promptTemplate = `
You are a data quality analyst. Analyze the data and determine what processing is needed.

DEFINITIONS:
- needs_cleaning: true if data has NULL, N/A, empty values, or needs whitespace normalization
- needs_transformation: true if dates need standardization, emails need lowercase, or phone formatting needed
- needs_validation: true if need to check invalid emails, ages outside 0-120, or invalid dates
- raw_text_allowed: true if data is NOT tabular/CSV format

Use this exact JSON format:
${formatInstructions}

Data to analyze:
{data}

Provide your analysis:`;

    const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
    this.analyzerChain = RunnableSequence.from([prompt, this.model, parser]);
  }

  private setupReportChain() {
    const outputSchema = z.object({
      title: z.string(),
      summary: z.string(),
      insights: z.array(z.string()),
      recommendations: z.array(z.string()),
    });

    const parser = StructuredOutputParser.fromZodSchema(outputSchema);
    const formatInstructions = parser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const promptTemplate = `
You are a report generation specialist. Analyze the data and create a comprehensive report.

DATA:
{data}

STATISTICS:
{statistics}

Create a report with:
- Title: Clear, descriptive title
- Summary: Executive summary (2-3 sentences)
- Insights: 3-5 key findings from the data
- Recommendations: 3-5 actionable recommendations

Use this exact JSON format:
${formatInstructions}

Generate the report:`;

    const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
    this.reportChain = RunnableSequence.from([prompt, this.model, parser]);
  }

  // ============================================================================
  // MAIN WORKFLOW PROCESSING
  // ============================================================================

  async processRequest(request: string, context?: any): Promise<any> {
    console.log('=== UNIFIED AGENT: Processing Request ===');
    console.log('Request:', request);

    const plan = await this.planWorkflow(request, context);
    console.log('Workflow plan:', JSON.stringify(plan, null, 2));

    const results = await this.executeWorkflow(plan, context);

    return {
      plan,
      results,
      summary: this.summarizeResults(results),
    };
  }

  private async planWorkflow(request: string, context?: any): Promise<WorkflowPlan> {
    try {
      const contextStr = context ? JSON.stringify(context) : 'None';
      
      // Try using the structured parser first
      let result;
      try {
        result = await this.plannerChain.invoke({ request, context: contextStr });
      } catch (parseError) {
        console.error('Structured parser failed, trying manual extraction...');
        console.error('Parse error:', parseError.message);
        
        // Fallback: Call model directly and parse manually
        const promptText = `
You are a unified AI agent that processes data, generates reports, and manages workflows.

AVAILABLE ACTIONS:
1. get_by_id: Retrieve a record from database by ID
2. get_by_filename: Retrieve a record from database by filename
3. process_data: Clean, transform, validate, and save new data to database
4. generate_report: Create comprehensive report from data
5. export_pdf: Export report as PDF (HTML format)
6. export_markdown: Export report as Markdown

WORKFLOW PLANNING RULES:
- If user mentions EXISTING file/record, use get_by_filename or get_by_id
- Only use process_data for NEW data or when explicitly asked to reprocess
- Reports can be generated from existing records using recordId or filename
- Use {{step.INDEX.FIELD}} to reference results from previous steps

USER REQUEST: ${request}
CONTEXT: ${contextStr}

CRITICAL: Return ONLY valid JSON with NO markdown, NO code blocks, NO comments.

Required JSON format:
{
  "steps": [
    {
      "action": "action_name",
      "params": {}
    }
  ],
  "reasoning": "explanation"
}

Provide your workflow plan:`;

        const llmResponse = await this.model.invoke(promptText);
        
        // Extract and clean JSON
        let jsonText = llmResponse.content.toString();
        
        // Remove markdown code blocks
        jsonText = jsonText.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
        
        // Extract JSON object
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON object found in LLM response');
        }
        
        jsonText = jsonMatch[0];
        
        // Remove comments
        jsonText = jsonText.replace(/\/\/[^\n]*/g, '');
        jsonText = jsonText.replace(/\/\*[\s\S]*?\*\//g, '');
        
        // Clean up trailing commas
        jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
        
        result = JSON.parse(jsonText);
      }

      const steps: WorkflowStep[] = result.steps.map((step: any) => ({
        action: step.action,
        params: step.params || {},
        status: 'pending' as const,
      }));

      return {
        steps,
        reasoning: result.reasoning || 'Workflow planned successfully',
      };
    } catch (error) {
      console.error('Planning error:', error);
      console.error('Error details:', error.message);
      throw new Error(`Failed to plan workflow: ${error.message}`);
    }
  }

  private async executeWorkflow(plan: WorkflowPlan, context?: any): Promise<any[]> {
    console.log('=== UNIFIED AGENT: Executing Workflow ===');
    const results: any[] = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      console.log(`\nExecuting step ${i + 1}/${plan.steps.length}:`, step.action);

      step.status = 'running';

      try {
        const enrichedParams = this.enrichParams(step.params, results, context);
        const result = await this.executeAction(step.action, enrichedParams);
        
        step.status = 'completed';
        step.result = result;
        results.push(result);
        
        console.log(`Step ${i + 1} completed successfully`);
      } catch (error) {
        step.status = 'failed';
        step.error = error.message;
        results.push({ error: error.message });
        console.error(`Step ${i + 1} failed:`, error.message);
        
        if (step.action === 'process_data') {
          throw new Error(`Critical step failed: ${error.message}`);
        }
      }
    }

    return results;
  }

  private enrichParams(params: any, previousResults: any[], context?: any): any {
    const enriched = { ...params };

    // Replace placeholders from previous steps
    for (const [key, value] of Object.entries(enriched)) {
      if (typeof value === 'string') {
        const match = value.match(/{{step\.(\d+)\.(\w+)}}/);
        if (match) {
          const [, stepIdx, field] = match;
          const stepResult = previousResults[parseInt(stepIdx)];
          if (stepResult && stepResult[field] !== undefined) {
            enriched[key] = stepResult[field];
          }
        }
      }
    }

    // Inject context
    if (context) {
      if (context.fileData && !enriched.data) {
        enriched.data = context.fileData;
      }
      if (context.filename && !enriched.filename) {
        enriched.filename = context.filename;
      }
      enriched._context = context;
    }

    return enriched;
  }

  // ============================================================================
  // ACTION EXECUTION
  // ============================================================================

  private async executeAction(action: string, params: any): Promise<any> {
    console.log('Executing action:', action, params);

    switch (action) {
      case 'get_by_id':
        return this.getRecordById(params.id);
      
      case 'get_by_filename':
        return this.findRecordByFilename(params.filename);
      
      case 'process_data':
        return this.processData(params);
      
      case 'generate_report':
        return this.generateReport(params);
      
      case 'export_pdf':
        return this.exportPdf(params);
      
      case 'export_markdown':
        return this.exportMarkdown(params);
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // ============================================================================
  // DATA PROCESSING ACTIONS
  // ============================================================================

  async getRecordById(id: string) {
    const record = await this.knowledgeBaseRepository.findOne({ where: { id } });
    if (!record) {
      throw new NotFoundException(`Record with id ${id} not found`);
    }
    return record;
  }

  async findRecordByFilename(filename: string) {
    const cleanFilename = filename.replace(/\.[^/.]+$/, '');
    const record = await this.knowledgeBaseRepository.findOne({
      where: { title: cleanFilename },
    });
    if (!record) {
      throw new NotFoundException(`Record with filename "${filename}" not found`);
    }
    return record;
  }

  private async processData(params: any): Promise<any> {
    console.log('=== PROCESS DATA ===');
    console.log('Params received:', Object.keys(params));
    
    const data = params.data || params._context?.fileData;
    const filename = params.filename || params._context?.filename || 'processed_data.csv';
    const tags = params.tags;

    console.log('Data source:', data ? 'found' : 'NOT FOUND');
    console.log('Data type:', typeof data);
    console.log('Filename:', filename);

    if (!data) {
      throw new BadRequestException('No data provided for processing');
    }

    console.log('Data length:', data.length);
    console.log('First 200 chars:', data.substring(0, 200));

    const analysis = await this.analyzeData(data);
    console.log('Analysis complete:', analysis);
    
    const processedData = await this.executeDataProcessing(data, analysis);
    console.log('Processing complete, data length:', processedData.length);

    const saved = await this.saveProcessedData({
      title: filename,
      content: processedData,
      tags,
    });

    return {
      analysis,
      processedData,
      recordId: saved.id,
      filename: saved.filename,
    };
  }

  private async analyzeData(data: string): Promise<DataAnalysis> {
    try {
      let result;
      try {
        result = await this.analyzerChain.invoke({ data });
      } catch (parseError) {
        console.error('Analyzer parser failed, trying manual extraction...');
        
        const promptText = `
You are a data quality analyst. Analyze the data and determine what processing is needed.

DEFINITIONS:
- needs_cleaning: true if data has NULL, N/A, empty values, or needs whitespace normalization
- needs_transformation: true if dates need standardization, emails need lowercase, or phone formatting needed
- needs_validation: true if need to check invalid emails, ages outside 0-120, or invalid dates
- raw_text_allowed: true if data is NOT tabular/CSV format

Data to analyze:
${data.substring(0, 1000)}

CRITICAL: Return ONLY valid JSON with NO markdown, NO code blocks, NO comments.

Required JSON format:
{
  "needs_cleaning": true or false,
  "needs_transformation": true or false,
  "needs_validation": true or false,
  "raw_text_allowed": true or false,
  "explanation": "your explanation"
}

Provide your analysis:`;

        const llmResponse = await this.model.invoke(promptText);
        
        let jsonText = llmResponse.content.toString();
        jsonText = jsonText.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
        
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in analyzer response');
        }
        
        jsonText = jsonMatch[0];
        jsonText = jsonText.replace(/\/\/[^\n]*/g, '');
        jsonText = jsonText.replace(/\/\*[\s\S]*?\*\//g, '');
        jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
        
        result = JSON.parse(jsonText);
      }
      
      console.log('Analysis result:', JSON.stringify(result, null, 2));
      return result as DataAnalysis;
    } catch (error) {
      console.error('Analysis error:', error);
      // Fallback to safe defaults
      return {
        needs_cleaning: true,
        needs_transformation: true,
        needs_validation: true,
        raw_text_allowed: false,
        explanation: 'Error during analysis, applying all processing steps as precaution',
      };
    }
  }

  private async executeDataProcessing(data: string, analysis: DataAnalysis): Promise<string> {
    console.log('=== EXECUTE DATA PROCESSING ===');
    console.log('Input data type:', typeof data);
    console.log('Input data length:', data?.length);
    console.log('Input data sample:', data?.substring(0, 200));
    console.log('Analysis:', JSON.stringify(analysis, null, 2));
    
    if (!data) {
      throw new Error('No data provided to executeDataProcessing');
    }
    
    if (typeof data !== 'string') {
      console.error('Data is not a string, received:', typeof data);
      data = String(data);
    }
    
    let result = data;

    if (analysis.needs_cleaning) {
      console.log('Running clean...');
      result = this.cleanData(result);
      console.log('After cleaning - type:', typeof result, 'length:', result?.length);
    }

    if (analysis.needs_transformation) {
      console.log('Running transform...');
      result = this.transformData(result);
      console.log('After transformation - type:', typeof result, 'length:', result?.length);
    }

    if (analysis.needs_validation) {
      console.log('Running validate...');
      result = this.validateData(result);
      console.log('After validation - type:', typeof result, 'length:', result?.length);
    }

    console.log('=== DATA PROCESSING COMPLETE ===');
    return result;
  }

  private cleanData(data: string): string {
    if (!data) {
      console.error('cleanData received empty data');
      return '';
    }
    
    if (typeof data !== 'string') {
      console.error('cleanData received non-string data:', typeof data, data);
      // Try to convert to string
      data = String(data);
    }
    
    console.log('cleanData input type:', typeof data, 'length:', data.length);
    
    try {
      const { headers, rows } = parseCSV(data);
      
      const cleanedRows = rows.map(row => {
        return row.map(cell => {
          const nullPatterns = /^(NULL|N\/A|null|na|n\/a|PENDING|TBD|undefined|nil|none|--|)$/gi;
          if (nullPatterns.test(cell)) {
            return 'Unknown';
          }
          return cell.replace(/\s+/g, ' ').trim();
        });
      });
      
      return reconstructCSV(headers, cleanedRows);
    } catch (e) {
      console.error('Clean failed:', e.message);
      console.error('Data sample:', data.substring(0, 200));
      
      // Fallback: simple text cleaning
      try {
        let cleaned = data.toString();
        cleaned = cleaned.replace(/\b(NULL|N\/A|null|na|n\/a|PENDING|TBD|undefined|nil|none|--)\b/gi, 'Unknown');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        return cleaned;
      } catch (fallbackError) {
        console.error('Fallback cleaning also failed:', fallbackError.message);
        return data.toString();
      }
    }
  }

  private transformData(data: string): string {
    if (!data) {
      console.error('transformData received empty data');
      return '';
    }
    
    if (typeof data !== 'string') {
      console.error('transformData received non-string data:', typeof data);
      data = String(data);
    }
    
    console.log('transformData input type:', typeof data, 'length:', data.length);
    
    try {
      const { headers, rows } = parseCSV(data);
      
      const transformedRows = rows.map(row => {
        return row.map((cell, idx) => {
          if (idx >= headers.length) return cell;
          const header = headers[idx] || '';
          
          // Date transformations
          if (header.includes('date') || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cell)) {
            cell = cell.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (match, m, d, y) => {
              const month = m.padStart(2, '0');
              const day = d.padStart(2, '0');
              if (parseInt(month) > 12 || parseInt(day) > 31) return match;
              return `${y}-${month}-${day}`;
            });
          }
          
          // Email transformations
          if (header.includes('email') || cell.includes('@')) {
            const validEmailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (validEmailPattern.test(cell)) {
              cell = cell.toLowerCase();
            }
          }
          
          // Phone transformations
          if (header.includes('phone') || /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(cell)) {
            cell = cell.replace(/\+?1?[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/, '$1-$2-$3');
          }
          
          // Currency transformations
          if (header.includes('salary') || header.includes('price') || header.includes('amount')) {
            cell = cell.replace(/^(\d{1,3}(?:,\d{3})+)$/, (match) => match.replace(/,/g, ''));
            cell = cell.replace(/^\$(\d{1,3}(?:,\d{3})+(?:\.\d{2})?)$/, (match, num) => num.replace(/,/g, ''));
          }
          
          return cell;
        });
      });
      
      return reconstructCSV(headers, transformedRows);
    } catch (e) {
      console.error('Transform failed:', e.message);
      console.error('Data sample:', data.substring(0, 200));
      return data;
    }
  }

  private validateData(data: string): string {
    try {
      const { headers, rows } = parseCSV(data);
      
      const validatedRows = rows.map(row => {
        return row.map((cell, idx) => {
          if (idx >= headers.length) return cell;
          const header = headers[idx] || '';
          
          // Email validation
          if (header === 'email' || header.includes('email')) {
            const validEmailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (!validEmailPattern.test(cell) && cell.toLowerCase() !== 'unknown') {
              return '[INVALID_EMAIL]';
            }
          }
          
          // Age validation
          if (header === 'age' || header.includes('age')) {
            if (!/^\d+$/.test(cell) && cell.toLowerCase() !== 'unknown') {
              return '[INVALID_AGE]';
            }
            if (/^\d+$/.test(cell)) {
              const age = parseInt(cell);
              if (age < 0 || age > 120) {
                return '[INVALID_AGE]';
              }
            }
          }
          
          // Date validation
          if (header === 'date' || header.includes('date')) {
            const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
            const match = cell.match(datePattern);
            if (match && cell.toLowerCase() !== 'unknown') {
              const [, y, m, d] = match;
              const year = parseInt(y);
              const month = parseInt(m);
              const day = parseInt(d);
              
              if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) {
                return '[INVALID_DATE]';
              }
            }
          }
          
          return cell;
        });
      });
      
      return reconstructCSV(headers, validatedRows);
    } catch (e) {
      console.error('Validate failed:', e.message);
      return data;
    }
  }

  private async saveProcessedData(params: { title: string; content: string; tags?: string }) {
    const parts = params.title.split('.');
    const extension = parts.length > 1 ? parts.pop()?.toLowerCase() : 'unknown';
    const titleWithoutExt = parts.join('.');

    const entity = this.knowledgeBaseRepository.create({
      title: titleWithoutExt,
      content: params.content,
      raw_content: params.content,
      analysis_summary: 'Data processed and saved',
      filename: params.title,
      file_type: extension,
      tags: params.tags,
    });

    return await this.knowledgeBaseRepository.save(entity);
  }

  // ============================================================================
  // REPORT GENERATION ACTIONS
  // ============================================================================

  private async generateReport(params: any): Promise<Report> {
    let data: string;
    let recordId: string;

    if (params.recordId) {
      const record = await this.getRecordById(params.recordId);
      data = record.content;
      recordId = record.id;
    } else if (params.filename) {
      const record = await this.findRecordByFilename(params.filename);
      data = record.content;
      recordId = record.id;
    } else if (params.data) {
      data = params.data;
      recordId = 'adhoc';
    } else {
      throw new BadRequestException('No data source provided for report generation');
    }

    const statistics = this.calculateStatistics(data);
    const reportContent = await this.generateReportContent(data, statistics);

    const report: Report = {
      ...reportContent,
      statistics,
      data_overview: {
        recordId,
        rowCount: statistics.rowCount,
        columnCount: statistics.columnCount,
      },
      generated_at: new Date().toISOString(),
    };

    return report;
  }

  private calculateStatistics(data: string): any {
    try {
      const { headers, rows } = parseCSV(data);
      
      const stats: any = {
        rowCount: rows.length,
        columnCount: headers.length,
        columns: headers,
        columnStats: {},
      };

      headers.forEach((header, idx) => {
        const values = rows.map(row => row[idx]).filter(v => v && v !== 'Unknown');
        const numericValues = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        
        stats.columnStats[header] = {
          totalValues: values.length,
          uniqueValues: new Set(values).size,
          missingValues: rows.length - values.length,
        };

        if (numericValues.length > 0) {
          const sum = numericValues.reduce((a, b) => a + b, 0);
          stats.columnStats[header].numeric = {
            min: Math.min(...numericValues),
            max: Math.max(...numericValues),
            mean: sum / numericValues.length,
            sum,
          };
        }
      });

      return stats;
    } catch (e) {
      return {
        rowCount: 0,
        columnCount: 0,
        error: 'Failed to calculate statistics',
      };
    }
  }

  private async generateReportContent(data: string, statistics: any): Promise<any> {
    try {
      let result;
      try {
        result = await this.reportChain.invoke({
          data: data.substring(0, 2000),
          statistics: JSON.stringify(statistics, null, 2),
        });
      } catch (parseError) {
        console.error('Report parser failed, trying manual extraction...');
        
        const statsStr = JSON.stringify(statistics, null, 2);
        const promptText = `
You are a report generation specialist. Analyze the data and create a comprehensive report.

DATA:
${data.substring(0, 2000)}

STATISTICS:
${statsStr}

Create a report with:
- Title: Clear, descriptive title
- Summary: Executive summary (2-3 sentences)
- Insights: 3-5 key findings from the data
- Recommendations: 3-5 actionable recommendations

CRITICAL: Return ONLY valid JSON with NO markdown, NO code blocks, NO comments.

Required JSON format:
{
  "title": "Report Title",
  "summary": "Executive summary text",
  "insights": ["insight 1", "insight 2"],
  "recommendations": ["rec 1", "rec 2"]
}

Generate the report:`;

        const llmResponse = await this.model.invoke(promptText);
        
        let jsonText = llmResponse.content.toString();
        jsonText = jsonText.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
        
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in report response');
        }
        
        jsonText = jsonMatch[0];
        jsonText = jsonText.replace(/\/\/[^\n]*/g, '');
        jsonText = jsonText.replace(/\/\*[\s\S]*?\*\//g, '');
        jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
        
        result = JSON.parse(jsonText);
      }

      return result;
    } catch (error) {
      console.error('Report generation error:', error);
      return {
        title: 'Data Report',
        summary: 'Report generated from processed data',
        insights: ['Data has been processed successfully'],
        recommendations: ['Review the statistics for detailed information'],
      };
    }
  }

  private async exportPdf(params: any): Promise<string> {
    const report = await this.generateReport(params);
    
    return `
<!DOCTYPE html>
<html>
<head>
  <title>${report.title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
    h2 { color: #34495e; margin-top: 30px; }
    .summary { background: #ecf0f1; padding: 20px; border-radius: 5px; margin: 20px 0; }
    .stats { background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0; }
    ul { margin: 10px 0; }
    li { margin: 8px 0; }
    .footer { margin-top: 40px; text-align: center; color: #7f8c8d; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>${report.title}</h1>
  
  <div class="summary">
    <h2>Executive Summary</h2>
    <p>${report.summary}</p>
  </div>
  
  <div class="stats">
    <h2>Data Overview</h2>
    <p><strong>Total Rows:</strong> ${report.statistics.rowCount}</p>
    <p><strong>Total Columns:</strong> ${report.statistics.columnCount}</p>
    <p><strong>Columns:</strong> ${report.statistics.columns.join(', ')}</p>
  </div>
  
  <h2>Key Insights</h2>
  <ul>
    ${report.insights.map(insight => `<li>${insight}</li>`).join('')}
  </ul>
  
  <h2>Recommendations</h2>
  <ul>
    ${report.recommendations.map(rec => `<li>${rec}</li>`).join('')}
  </ul>
  
  <div class="footer">
    <p>Generated: ${report.generated_at}</p>
  </div>
</body>
</html>`;
  }

  private async exportMarkdown(params: any): Promise<string> {
    const report = await this.generateReport(params);
    
    return `# ${report.title}

## Executive Summary
${report.summary}

## Data Overview
- **Total Rows:** ${report.statistics.rowCount}
- **Total Columns:** ${report.statistics.columnCount}
- **Columns:** ${report.statistics.columns.join(', ')}

## Key Insights
${report.insights.map(insight => `- ${insight}`).join('\n')}

## Recommendations
${report.recommendations.map(rec => `- ${rec}`).join('\n')}

---
*Generated: ${report.generated_at}*`;
  }

  // ============================================================================
  // FILE UPLOAD PROCESSING
  // ============================================================================

  async processFileUpload(file: Express.Multer.File, request: string): Promise<any> {
    console.log('=== UNIFIED AGENT: Processing File Upload ===');
    console.log('Filename:', file.originalname);
    console.log('Request:', request);

    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'unknown';
    let text = '';

    try {
      if (ext === 'csv' || ext === 'txt') {
        text = file.buffer.toString('utf8');
      } else if (ext === 'pdf') {
        const pdfExtractText = require('pdf-parse');
        const pdfData = await pdfExtractText(file.buffer);
        text = pdfData.text;
      } else {
        text = file.buffer.toString('utf8');
      }
    } catch (error) {
      throw new Error(`Failed to extract text from file: ${error.message}`);
    }

    if (!text || text.trim().length === 0) {
      throw new Error('File appears to be empty or could not be read');
    }

    const context = {
      filename: file.originalname,
      fileSize: file.size,
      fileType: ext,
      fileData: text,
    };

    const enhancedRequest = `
      A file named "${file.originalname}" has been uploaded.
      Task: ${request}
      The file data is ready to be processed and saved to the database.
    `;

    return this.processRequest(enhancedRequest, context);
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  private summarizeResults(results: any[]): string {
    const successful = results.filter(r => !r.error).length;
    const failed = results.filter(r => r.error).length;
    return `Workflow completed: ${successful} steps successful, ${failed} steps failed`;
  }
}